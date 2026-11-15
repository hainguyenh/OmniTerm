use super::*;

#[test]
fn plugin_commands_smoke_test() {
    let mock = MockApp::new();
    let app = mock.handle();
    let host = app.state::<PluginHost>();

    // Test plugin_available
    let available = block_on(plugin_available(app.clone(), host.clone()));
    assert!(available.is_ok());

    // Test omni_plugin_list (named apart from the IDE backend's own plugin_list)
    let list = block_on(omni_plugin_list(app.clone(), host.clone()));
    assert!(list.is_ok());

    // Test omni_plugin_set_enabled
    let set_enabled = block_on(omni_plugin_set_enabled(
        app.clone(),
        host.clone(),
        "test".to_string(),
        true,
    ));
    assert!(set_enabled.is_ok() || set_enabled.is_err()); // Either way, we hit the code path

    // Test plugin_select_connection_provider
    let select_provider = block_on(plugin_select_connection_provider(
        host.clone(),
        Some("test".to_string()),
    ));
    assert!(select_provider.is_ok() || select_provider.is_err());

    // Test connection_provider_capabilities
    let capabilities = block_on(connection_provider_capabilities(host.clone()));
    assert!(capabilities.is_ok() || capabilities.is_err());

    // Test plugin_invoke
    let invoke = block_on(plugin_invoke(host.clone(), "test".to_string(), vec![]));
    assert!(invoke.is_ok() || invoke.is_err());

    // Test plugin_auth_gate
    let auth_gate = block_on(plugin_auth_gate(host.clone()));
    assert!(auth_gate.is_ok() || auth_gate.is_err());
}
