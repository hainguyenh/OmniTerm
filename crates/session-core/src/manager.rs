use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use dashmap::DashMap;
use portable_pty::{ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem};
use session_protocol::{
    DaemonStatus, LaunchSpec, PersistencePolicy, ServerMessage, SessionLifecycle, SessionSummary,
};
use tokio::sync::broadcast;

use crate::manifest::{self, SessionManifest};
use crate::output::{spawn_reader, Output};

const INITIAL_COLS: u16 = 80;
const INITIAL_ROWS: u16 = 24;

pub struct AttachedSession {
    pub snapshot: session_protocol::AttachSnapshot,
    pub replay: Vec<u8>,
    pub receiver: broadcast::Receiver<ServerMessage>,
}

pub(crate) struct Session {
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    pub(crate) pid: Option<u32>,
    pub(crate) output: Arc<Mutex<Output>>,
    pub(crate) launched_with_command: bool,
    pub(crate) ssh: bool,
    pub(crate) generation: u64,
    pub(crate) launch: LaunchSpec,
    pub(crate) policy: Mutex<PersistencePolicy>,
    owner_client: Mutex<String>,
    pub(crate) lifecycle: Arc<Mutex<SessionLifecycle>>,
    #[cfg(windows)]
    job: Option<Arc<app_core::win_job::JobHandle>>,
}

#[derive(Clone)]
pub struct SessionManager {
    pub(crate) sessions: Arc<DashMap<String, Arc<Session>>>,
    interrupted: Arc<DashMap<String, SessionManifest>>,
    requests: Arc<DashMap<String, String>>,
    pub(crate) state_dir: Arc<PathBuf>,
}

impl SessionManager {
    pub fn new(state_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&state_dir)
            .map_err(|error| format!("Could not create session daemon state directory: {error}"))?;
        let interrupted = DashMap::new();
        for record in manifest::load_interrupted(&state_dir) {
            interrupted.insert(record.id.clone(), record);
        }
        Ok(Self {
            sessions: Arc::new(DashMap::new()),
            interrupted: Arc::new(interrupted),
            requests: Arc::new(DashMap::new()),
            state_dir: Arc::new(state_dir),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        client_id: &str,
        request_id: &str,
        session_id: &str,
        generation: u64,
        policy: PersistencePolicy,
        launch: LaunchSpec,
    ) -> Result<SessionSummary, String> {
        if let Some(existing_id) = self.requests.get(request_id) {
            if existing_id.as_str() == session_id {
                if let Some(existing) = self.sessions.get(session_id) {
                    return Ok(crate::summary::session_summary(session_id, &existing));
                }
            }
        }
        if let Some(existing) = self.sessions.get(session_id) {
            let lifecycle = existing
                .lifecycle
                .lock()
                .map(|value| *value)
                .unwrap_or(SessionLifecycle::Error);
            if lifecycle == SessionLifecycle::Live {
                return Ok(crate::summary::session_summary(session_id, &existing));
            }
            drop(existing);
            self.sessions.remove(session_id);
        }

        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: INITIAL_ROWS,
                cols: INITIAL_COLS,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Could not open a pseudo-terminal: {error}"))?;

        let mut cmd = CommandBuilder::new(&launch.exe);
        for arg in &launch.args {
            cmd.arg(arg);
        }
        if let Some(cwd) = &launch.cwd {
            let cwd = dunce::canonicalize(cwd)
                .map_err(|error| format!("Could not resolve working directory {cwd}: {error}"))?;
            cmd.cwd(cwd);
        }
        for (key, value) in &launch.env {
            cmd.env(key, value);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|error| format!("Could not start {}: {error}", launch.exe))?;

        #[cfg(windows)]
        let job = match child.as_raw_handle() {
            Some(raw) => app_core::win_job::assign_new_job(raw).ok().map(Arc::new),
            None => None,
        };

        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
        let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
        let killer = child.clone_killer();
        let pid = child.process_id();
        let mut output_state = Output::new(launch.label.clone(), launch.launched_with_command);
        if policy == PersistencePolicy::RecoverAfterReboot && generation > 1 {
            output_state.seed(&crate::scrollback::load(&self.state_dir, session_id));
        } else {
            crate::scrollback::remove(&self.state_dir, session_id);
        }
        let output = Arc::new(Mutex::new(output_state));
        let session = Arc::new(Session {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            killer: Arc::new(Mutex::new(killer)),
            pid,
            output: Arc::clone(&output),
            launched_with_command: launch.launched_with_command,
            ssh: launch.ssh,
            generation,
            launch: launch.clone(),
            policy: Mutex::new(policy),
            owner_client: Mutex::new(client_id.to_string()),
            lifecycle: Arc::new(Mutex::new(SessionLifecycle::Live)),
            #[cfg(windows)]
            job: job.clone(),
        });
        self.sessions.insert(session_id.to_string(), Arc::clone(&session));
        self.interrupted.remove(session_id);
        self.requests
            .insert(request_id.to_string(), session_id.to_string());
        self.persist(session_id, &session);

        spawn_reader(reader, Arc::clone(&output), Arc::clone(&session.lifecycle));
        self.spawn_exit_watcher(session_id.to_string(), child, session);
        Ok(self
            .sessions
            .get(session_id)
            .map(|entry| crate::summary::session_summary(session_id, &entry))
            .ok_or_else(|| "Session disappeared during startup".to_string())?)
    }

    fn spawn_exit_watcher(
        &self,
        id: String,
        mut child: Box<dyn portable_pty::Child + Send + Sync>,
        session: Arc<Session>,
    ) {
        let manager = self.clone();
        tokio::spawn(async move {
            let code = tokio::task::spawn_blocking(move || {
                child.wait().map(|status| status.exit_code()).unwrap_or(0)
            })
            .await
            .unwrap_or(0);
            #[cfg(windows)]
            if let Some(job) = &session.job {
                job.terminate(code);
            }
            if let Ok(mut lifecycle) = session.lifecycle.lock() {
                *lifecycle = SessionLifecycle::Closed;
            }
            if let Ok(mut output) = session.output.lock() {
                output.status(DaemonStatus::Closed { code });
            }
            // Do not let an explicit disconnect's late exit watcher recreate/overwrite its manifest.
            let still_current = manager
                .sessions
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current.value(), &session));
            if still_current {
                manager.persist(&id, &session);
            }
        });
    }

    pub fn attach(&self, client_id: &str, session_id: &str) -> Result<AttachedSession, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        if let Ok(mut owner) = session.owner_client.lock() {
            *owner = client_id.to_string();
        }
        let mut output = session
            .output
            .lock()
            .map_err(|_| "Session output lock is poisoned".to_string())?;
        let (snapshot, replay, receiver) = output.attach(session.generation);
        Ok(AttachedSession { snapshot, replay, receiver })
    }

    pub fn input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Session writer lock is poisoned".to_string())?;
        writer.write_all(data.as_bytes()).map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Err("Terminal size must be non-zero".to_string());
        }
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| "Session not found".to_string())?;
        let master = session
            .master
            .lock()
            .map_err(|_| "Session master lock is poisoned".to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())
    }

    pub fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let Some((_, session)) = self.sessions.remove(session_id) else {
            if self.interrupted.remove(session_id).is_some() {
                manifest::remove(&self.state_dir, session_id);
                crate::scrollback::remove(&self.state_dir, session_id);
                return Ok(());
            }
            return Err("Session not found".to_string());
        };
        let outcome = session
            .killer
            .lock()
            .map_err(|_| "Session killer lock is poisoned".to_string())?
            .kill();
        #[cfg(windows)]
        if let Some(job) = &session.job {
            job.terminate(1);
        }
        manifest::remove(&self.state_dir, session_id);
        crate::scrollback::remove(&self.state_dir, session_id);
        self.requests.retain(|_, value| value != session_id);
        if let Err(error) = outcome {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::debug!("[sessiond] kill for {session_id} reported: {error}");
            }
        }
        Ok(())
    }

    pub fn list(&self) -> Vec<SessionSummary> {
        let mut items: Vec<_> = self
            .sessions
            .iter()
            .map(|entry| crate::summary::session_summary(entry.key(), &entry))
            .collect();
        for record in self.interrupted.iter() {
            if !self.sessions.contains_key(record.key()) {
                items.push(record.summary());
            }
        }
        items.sort_by(|a, b| a.id.cmp(&b.id));
        items
    }

    pub fn set_policy(
        &self,
        client_id: &str,
        session_id: &str,
        policy: PersistencePolicy,
    ) -> Result<(), String> {
        if let Some(session) = self.sessions.get(session_id) {
            if let Ok(mut owner) = session.owner_client.lock() {
                *owner = client_id.to_string();
            }
            *session
                .policy
                .lock()
                .map_err(|_| "Session policy lock is poisoned".to_string())? = policy;
            self.persist(session_id, &session);
            if policy != PersistencePolicy::RecoverAfterReboot {
                crate::scrollback::remove(&self.state_dir, session_id);
            }
            return Ok(());
        }
        if let Some(mut record) = self.interrupted.get_mut(session_id) {
            record.policy = policy;
            manifest::write(&self.state_dir, &record)?;
            if policy != PersistencePolicy::RecoverAfterReboot {
                crate::scrollback::remove(&self.state_dir, session_id);
            }
            return Ok(());
        }
        Err("Session not found".to_string())
    }

    pub fn client_disconnected(&self, client_id: &str) {
        let ids: Vec<String> = self
            .sessions
            .iter()
            .filter_map(|entry| {
                let close = entry
                    .policy
                    .lock()
                    .map(|policy| *policy == PersistencePolicy::CloseWithApp)
                    .unwrap_or(false);
                let owned = entry
                    .owner_client
                    .lock()
                    .map(|owner| owner.as_str() == client_id)
                    .unwrap_or(false);
                (close && owned).then(|| entry.key().clone())
            })
            .collect();
        for id in ids {
            let _ = self.disconnect(&id);
        }
    }

    pub(crate) fn update_activity(&self, session_id: &str, busy: bool) {
        let Some(session) = self.sessions.get(session_id) else {
            return;
        };
        let changed = match session.output.lock() {
            Ok(mut output) if output.busy() != busy => {
                output.status(DaemonStatus::Activity { busy });
                true
            }
            _ => false,
        };
        if changed {
            self.persist(session_id, &session);
        }
    }

    fn persist(&self, id: &str, session: &Session) {
        let policy = session
            .policy
            .lock()
            .map(|value| *value)
            .unwrap_or(PersistencePolicy::KeepRunning);
        let lifecycle = session
            .lifecycle
            .lock()
            .map(|value| *value)
            .unwrap_or(SessionLifecycle::Error);
        let busy = session.output.lock().map(|value| value.busy()).unwrap_or(false);
        let mut record = SessionManifest::live(
            id.to_string(),
            session.generation,
            policy,
            session.launch.label.clone(),
            busy,
            session.launched_with_command,
            session.ssh,
        );
        record.lifecycle = lifecycle;
        if let Err(error) = manifest::write(&self.state_dir, &record) {
            log::warn!("[sessiond] could not persist {id}: {error}");
        }
    }
}

