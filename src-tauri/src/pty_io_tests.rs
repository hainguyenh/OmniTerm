use super::*;
use crate::adhoc::AdhocRegistry;
use crate::openshell::OpenShellRequest;
use crate::shell_spec::LocalShell;
use crate::test_support;
use std::io;
use tauri::ipc::InvokeResponseBody;
use tauri::Manager;

struct WriteError;

impl Write for WriteError {
    fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
        Err(io::Error::other("write failed"))
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct FlushError;

impl Write for FlushError {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::other("flush failed"))
    }
}

#[test]
fn live_session_reports_writer_and_flush_errors() {
    let _guard = test_support::lock();
    let app = test_support::mock_app();
    assert!(app.manage(PtyManager::new()));
    assert!(app.manage(AdhocRegistry::new()));
    let handle = app.handle().clone();
    let manager = handle.state::<PtyManager>();
    handle.state::<AdhocRegistry>().insert_named(
        "adhoc-io-errors".to_string(),
        OpenShellRequest {
            shell: LocalShell::Sh,
            cwd: None,
            command: None,
            args: None,
            keep_open: true,
            name: "I/O errors".to_string(),
        },
    );

    let data = Channel::<Response>::new(|_body: InvokeResponseBody| Ok(()));
    let status = Channel::<SessionStatus>::new(|_body: InvokeResponseBody| Ok(()));
    tauri::async_runtime::block_on(start_local_session(
        handle.clone(),
        manager.clone(),
        "io-errors".to_string(),
        "adhoc-io-errors".to_string(),
        None,
        None,
        data,
        status,
    ))
    .unwrap();

    let original_writer = {
        let mut session = manager.sessions.get_mut("io-errors").unwrap();
        let original = Arc::clone(&session.writer);
        session.writer = Arc::new(Mutex::new(Box::new(WriteError)));
        original
    };
    assert!(tauri::async_runtime::block_on(send_session_input(
        manager.clone(),
        "io-errors".to_string(),
        "input".to_string(),
    ))
    .unwrap_err()
    .contains("write failed"));

    {
        let mut session = manager.sessions.get_mut("io-errors").unwrap();
        session.writer = Arc::new(Mutex::new(Box::new(FlushError)));
    }
    assert!(tauri::async_runtime::block_on(send_session_input(
        manager.clone(),
        "io-errors".to_string(),
        "input".to_string(),
    ))
    .unwrap_err()
    .contains("flush failed"));

    tauri::async_runtime::block_on(disconnect_session(manager, "io-errors".to_string())).unwrap();
    drop(original_writer);
}
