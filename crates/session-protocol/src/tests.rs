use super::{
    AttachSnapshot, ClientRequest, LaunchSpec, PersistencePolicy, ServerMessage, SessionLifecycle,
    SessionSummary, PROTOCOL_VERSION,
};

#[test]
fn persistence_policy_uses_stable_kebab_case_wire_values() {
    assert_eq!(serde_json::to_string(&PersistencePolicy::CloseWithApp).unwrap(), "\"close-with-app\"");
    assert_eq!(serde_json::to_string(&PersistencePolicy::KeepRunning).unwrap(), "\"keep-running\"");
    assert_eq!(serde_json::to_string(&PersistencePolicy::RecoverAfterReboot).unwrap(), "\"recover-after-reboot\"");
    assert!(serde_json::from_str::<PersistencePolicy>("\"unknown\"").is_err());
}

#[test]
fn session_summary_round_trips_generation_and_lifecycle() {
    let summary = SessionSummary {
        id: "tab-1".into(),
        generation: 7,
        policy: PersistencePolicy::RecoverAfterReboot,
        lifecycle: SessionLifecycle::Live,
        pid: Some(42),
        label: "PowerShell".into(),
        busy: true,
        launched_with_command: false,
        ssh: false,
    };
    let encoded = serde_json::to_string(&summary).unwrap();
    assert_eq!(serde_json::from_str::<SessionSummary>(&encoded).unwrap(), summary);
}

#[test]
fn protocol_requests_and_stream_messages_have_stable_tags() {
    let request = ClientRequest::Hello {
        protocol_version: PROTOCOL_VERSION,
    };
    let request_json = serde_json::to_value(request).unwrap();
    assert_eq!(request_json["kind"], "hello");
    assert_eq!(request_json["protocolVersion"], PROTOCOL_VERSION);

    let launch = LaunchSpec {
        exe: "bash".into(),
        args: vec!["-l".into()],
        cwd: Some("/tmp".into()),
        env: vec![("TERM".into(), "xterm-256color".into())],
        label: "bash".into(),
        launched_with_command: false,
        ssh: false,
    };
    let create = ClientRequest::Create {
        client_id: "gui-1".into(),
        request_id: "request-1".into(),
        session_id: "tab-1".into(),
        generation: 1,
        policy: PersistencePolicy::KeepRunning,
        launch,
    };
    assert_eq!(serde_json::to_value(create).unwrap()["kind"], "create");

    let attach = ServerMessage::Attached {
        snapshot: AttachSnapshot {
            status: "ready".into(),
            label: Some("bash".into()),
            error: None,
            busy: false,
            generation: 1,
        },
        replay: vec![1, 2, 3],
    };
    assert_eq!(serde_json::to_value(attach).unwrap()["kind"], "attached");
}
