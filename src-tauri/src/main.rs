// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  if std::env::var("OMNITERM_ASKPASS").as_deref() == Ok("1") {
    let plugin = std::env::var("OMNITERM_ASKPASS_PLUGIN").unwrap_or_default();
    let key = std::env::var("OMNITERM_ASKPASS_KEY").unwrap_or_default();
    if let Ok(Some(secret)) = app_lib::credential_vault::get(&plugin, &key) {
      print!("{secret}");
    }
    return;
  }
  app_lib::run();
}
