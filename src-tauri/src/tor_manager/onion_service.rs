use std::sync::{Arc, Mutex};

use anyhow::Result;
use tauri::{AppHandle, Emitter};
use tracing::{error, info};

use super::client::AnonTorClient;
use crate::core::identity;

/// Incoming message payload for frontend events
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingMessagePayload {
    pub id: i64,
    pub contact_onion: String,
    pub content: String,
    pub sender_onion: String,
    pub timestamp: i64,
    pub is_outgoing: bool,
    pub status: String,
}

/// Placeholder: arti 0.13 onion service hosting is experimental and
/// marked "TODO: does not yet work". Once a stable arti release supports
/// hosting, replace this with `client.launch_onion_service(config)`.
///
/// For now, the app relies on outbound-only delivery via `NetworkGuard::connect()`.
/// Inbound messages can be received via external onion service + forward,
/// or via a future arti update.
pub async fn launch_and_listen(
    _client: &AnonTorClient,
    _app_handle: AppHandle,
    _active_identity: Arc<Mutex<Option<identity::Identity>>>,
) -> Result<()> {
    info!("Onion service hosting is not yet available in arti 0.13");
    info!("The app will only be able to SEND messages, not receive them directly");
    info!("Once arti supports hosting, remove this placeholder");
    Ok(())
}
