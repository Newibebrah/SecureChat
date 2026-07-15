// Allow dead code in early phases — functions will be used in Phases 2+.
#![allow(dead_code)]

mod commands;
mod core;
mod storage;
mod tor_manager;

use std::sync::{Arc, Mutex};

use tauri::Emitter;
use tokio::sync::watch;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use commands::TorStatusPayload;
use core::identity::Identity;
use tor_manager::{ArtiClientManager, NetworkGuard, TorStatus};

/// Tauri-managed state for Tor status updates.
pub(crate) struct TorStatusState {
    pub status_rx: watch::Receiver<TorStatus>,
}

/// Tauri-managed state for the active (unlocked) identity.
pub(crate) struct ActiveIdentity {
    pub identity: Mutex<Option<Identity>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(true)
        .with_thread_ids(false)
        .init();

    let (status_tx, status_rx) = watch::channel(TorStatus::Offline);
    let network_guard = Arc::new(NetworkGuard::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(TorStatusState { status_rx })
        .manage(ActiveIdentity {
            identity: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            // Phase 0
            commands::get_tor_status,
            // Phase 1
            commands::database_exists,
            commands::create_identity,
            commands::unlock_identity,
            commands::get_active_identity,
            commands::get_stored_onion_address,
            // Phase 2
            commands::add_contact,
            commands::list_contacts,
            commands::update_nickname,
            commands::verify_contact,
            commands::delete_contact,
            commands::resolve_contact_qr,
            commands::generate_own_qr_code,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let handle_clone = handle.clone();
            let guard = network_guard.clone();

            // Spawn the Tor bootstrap background task
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
                rt.block_on(async move {
                    info!("Starting Tor bootstrap in background task...");

                    match ArtiClientManager::bootstrap(status_tx.clone(), None).await {
                        Ok(client) => {
                            info!("Tor client ready, wiring into NetworkGuard");
                            guard.set_client(client).await;

                            let payload = TorStatusPayload {
                                status: "ready".to_string(),
                                progress: 1.0,
                                message: "Tor connected".to_string(),
                            };
                            let _ = handle_clone.emit("tor-status", &payload);
                        }
                        Err(e) => {
                            error!("Tor bootstrap failed: {:#}", e);
                            let payload = TorStatusPayload {
                                status: "error".to_string(),
                                progress: 0.0,
                                message: format!("Tor connection failed: {}", e),
                            };
                            let _ = handle_clone.emit("tor-status", &payload);
                        }
                    }
                });
            });

            // Emit initial status so the UI has something to show instantly
            let payload = TorStatusPayload {
                status: "bootstrapping".to_string(),
                progress: 0.0,
                message: "Connecting to Tor...".to_string(),
            };
            let _ = handle.emit("tor-status", &payload);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running anon-chat");
}
