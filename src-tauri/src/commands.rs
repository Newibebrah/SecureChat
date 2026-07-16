use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::Serialize;
use sha2::Digest;
use tauri::{Emitter, State};
use tracing::{error, info};

use crate::core::crypto;
use crate::core::identity;
use crate::storage::{self, database, identity_repo, messages_repo};
use crate::tor_manager::{NetworkGuard, TorStatus};
use crate::{ActiveIdentity, NetGuard, TorStatusState};

// ─── Rate Limiter ────────────────────────────────────────────────
struct RateLimiter {
    attempts: Vec<Instant>,
    max_attempts: usize,
    window: Duration,
}

impl RateLimiter {
    fn new(max_attempts: usize, window_secs: u64) -> Self {
        Self {
            attempts: Vec::new(),
            max_attempts,
            window: Duration::from_secs(window_secs),
        }
    }

    fn check(&mut self) -> bool {
        let now = Instant::now();
        self.attempts.retain(|t| now.duration_since(*t) < self.window);
        if self.attempts.len() >= self.max_attempts {
            false
        } else {
            self.attempts.push(now);
            true
        }
    }
}

static PASSWORD_RATE_LIMITER: Lazy<std::sync::Mutex<RateLimiter>> =
    Lazy::new(|| std::sync::Mutex::new(RateLimiter::new(5, 30)));

// ─── Session Timer ───────────────────────────────────────────────
static SESSION_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Reset the lock timer. Must be called on every user interaction.
fn reset_session_timer() {
    SESSION_ACTIVE.store(true, Ordering::SeqCst);
}

/// Spawn a background task that locks the app after inactivity.
fn spawn_session_timeout(active: Arc<Mutex<Option<identity::Identity>>>, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(60));
            if SESSION_ACTIVE.load(Ordering::SeqCst) {
                SESSION_ACTIVE.store(false, Ordering::SeqCst);
                continue;
            }
            if let Ok(mut guard) = active.lock() {
                if guard.is_some() {
                    *guard = None;
                    info!("Session auto-locked due to inactivity");
                    let _ = app.emit("session-locked", ());
                }
            }
        }
    });
}

// ─── Payloads ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorStatusPayload {
    pub status: String,
    pub progress: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPayload {
    pub onion_address: String,
    pub public_key: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPayload {
    pub id: i64,
    pub onion_address: String,
    pub public_key_hex: String,
    pub x25519_public_hex: String,
    pub local_nickname: String,
    pub safety_verified: bool,
    pub created_at: String,
    pub safety_number: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePayload {
    pub id: i64,
    pub contact_onion: String,
    pub content: String,
    pub sender_onion: String,
    pub timestamp: i64,
    pub is_outgoing: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationPayload {
    pub contact_onion: String,
    pub last_message: String,
    pub last_timestamp: i64,
    pub unread: i64,
}

// ─── Helpers ─────────────────────────────────────────────────────

fn compute_safety_number(public_key_hex: &str) -> String {
    let pk_bytes = hex::decode(public_key_hex).unwrap_or_default();
    let hash = sha2::Sha256::digest(&pk_bytes);
    let hex_str = hex::encode(&hash[..8]);
    hex_str
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or("????"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn contact_to_payload(c: &storage::contacts_repo::Contact) -> ContactPayload {
    ContactPayload {
        id: c.id,
        onion_address: c.onion_address.clone(),
        public_key_hex: c.public_key_hex.clone(),
        x25519_public_hex: c.x25519_public_hex.clone(),
        local_nickname: c.local_nickname.clone(),
        safety_verified: c.safety_verified,
        created_at: c.created_at.clone(),
        safety_number: compute_safety_number(&c.public_key_hex),
    }
}

fn message_to_payload(msg: &messages_repo::StoredMessage) -> MessagePayload {
    MessagePayload {
        id: msg.id,
        contact_onion: msg.contact_onion.clone(),
        content: msg.content.clone(),
        sender_onion: msg.sender_onion.clone(),
        timestamp: msg.timestamp,
        is_outgoing: msg.is_outgoing,
        status: msg.status.clone(),
    }
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ─── Tor Commands ────────────────────────────────────────────────

#[tauri::command]
pub async fn get_tor_status(
    state: State<'_, TorStatusState>,
) -> Result<TorStatusPayload, String> {
    let status = state.status_rx.borrow().clone();
    Ok(TorStatusPayload {
        status: match &status {
            TorStatus::Offline => "offline",
            TorStatus::Bootstrapping(_) => "bootstrapping",
            TorStatus::Ready => "ready",
            TorStatus::Error(_) => "error",
        }
        .to_string(),
        progress: status.progress(),
        message: status.label().to_string(),
    })
}

// ─── Identity Commands ───────────────────────────────────────────

#[tauri::command]
pub async fn database_exists() -> bool {
    database::database_exists()
}

#[tauri::command]
pub async fn create_identity(
    password: String,
    active: State<'_, ActiveIdentity>,
    app: tauri::AppHandle,
) -> Result<IdentityPayload, String> {
    // Rate limit check
    {
        let mut limiter = PASSWORD_RATE_LIMITER.lock().map_err(|e| e.to_string())?;
        if !limiter.check() {
            return Err("Too many attempts. Please wait 30 seconds.".to_string());
        }
    }

    let conn = database::open_database().map_err(|e| e.to_string())?;
    let identity =
        identity_repo::create_identity(&conn, &password).map_err(|e| e.to_string())?;
    let identity_clone = identity.clone();
    *active.identity.lock().map_err(|e| e.to_string())? = Some(identity.clone());

    let fp = identity::fingerprint(&identity.verifying_key);
    let pk_hex = hex::encode(identity.verifying_key.to_bytes());

    reset_session_timer();
    spawn_session_timeout(
        Arc::new(Mutex::new(Some(identity_clone))),
        app,
    );

    Ok(IdentityPayload {
        onion_address: identity.onion_address,
        public_key: pk_hex,
        fingerprint: fp,
    })
}

#[tauri::command]
pub async fn unlock_identity(
    password: String,
    active: State<'_, ActiveIdentity>,
    app: tauri::AppHandle,
) -> Result<IdentityPayload, String> {
    // Rate limit check
    {
        let mut limiter = PASSWORD_RATE_LIMITER.lock().map_err(|e| e.to_string())?;
        if !limiter.check() {
            return Err("Too many attempts. Please wait 30 seconds.".to_string());
        }
    }

    if !database::database_exists() {
        return Err("No database found. Create a new identity first.".to_string());
    }
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let identity = identity_repo::load_identity(&conn, &password).map_err(|e| e.to_string())?;
    let identity_clone = identity.clone();
    *active.identity.lock().map_err(|e| e.to_string())? = Some(identity.clone());

    let fp = identity::fingerprint(&identity.verifying_key);
    let pk_hex = hex::encode(identity.verifying_key.to_bytes());

    reset_session_timer();
    spawn_session_timeout(Arc::new(Mutex::new(Some(identity_clone))), app);

    Ok(IdentityPayload {
        onion_address: identity.onion_address,
        public_key: pk_hex,
        fingerprint: fp,
    })
}

/// Lock the identity immediately (session lock).
#[tauri::command]
pub async fn lock_identity(active: State<'_, ActiveIdentity>) -> Result<(), String> {
    *active.identity.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Reset the session inactivity timer (called on user interaction).
#[tauri::command]
pub async fn stop_session_timer() -> Result<(), String> {
    reset_session_timer();
    Ok(())
}

#[tauri::command]
pub async fn get_active_identity(
    active: State<'_, ActiveIdentity>,
) -> Result<Option<IdentityPayload>, String> {
    let guard = active.identity.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(identity) => {
            let fp = identity::fingerprint(&identity.verifying_key);
            let pk_hex = hex::encode(identity.verifying_key.to_bytes());
            Ok(Some(IdentityPayload {
                onion_address: identity.onion_address.clone(),
                public_key: pk_hex,
                fingerprint: fp,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn get_stored_onion_address() -> Result<Option<String>, String> {
    if !database::database_exists() {
        return Ok(None);
    }
    let conn = database::open_database().map_err(|e| e.to_string())?;
    identity_repo::get_stored_onion_address(&conn).map_err(|e| e.to_string())
}

// ─── Contact Management ──────────────────────────────────────────

#[tauri::command]
pub async fn add_contact(
    onion_address: String,
    public_key_b64: String,
    x25519_hex: String,
    local_nickname: String,
) -> Result<ContactPayload, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let x25519_bytes = hex::decode(&x25519_hex)
        .map_err(|e| format!("Invalid x25519 hex: {}", e))?;
    let x25519_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &x25519_bytes,
    );
    let contact = storage::contacts_repo::add_contact(
        &conn,
        &onion_address,
        &public_key_b64,
        &x25519_b64,
        &local_nickname,
    )
    .map_err(|e| e.to_string())?;
    Ok(contact_to_payload(&contact))
}

#[tauri::command]
pub async fn list_contacts() -> Result<Vec<ContactPayload>, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let contacts = storage::contacts_repo::list_contacts(&conn).map_err(|e| e.to_string())?;
    Ok(contacts.iter().map(contact_to_payload).collect())
}

#[tauri::command]
pub async fn update_nickname(
    onion_address: String,
    local_nickname: String,
) -> Result<ContactPayload, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let contact = storage::contacts_repo::update_nickname(&conn, &onion_address, &local_nickname)
        .map_err(|e| e.to_string())?;
    Ok(contact_to_payload(&contact))
}

#[tauri::command]
pub async fn verify_contact(onion_address: String) -> Result<ContactPayload, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let contact = storage::contacts_repo::verify_contact(&conn, &onion_address)
        .map_err(|e| e.to_string())?;
    Ok(contact_to_payload(&contact))
}

#[tauri::command]
pub async fn delete_contact(onion_address: String) -> Result<(), String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    storage::contacts_repo::delete_contact(&conn, &onion_address).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resolve_contact_qr(qr_data: String) -> Result<ContactPayload, String> {
    let (onion, pubkey_b64, x25519_b64) =
        storage::contacts_repo::parse_contact_qr(&qr_data).map_err(|e| e.to_string())?;
    let conn = database::open_database().map_err(|e| e.to_string())?;

    conn.execute("SAVEPOINT validate_qr", [])
        .map_err(|e| e.to_string())?;

    let result = storage::contacts_repo::add_contact(&conn, &onion, &pubkey_b64, &x25519_b64, "");

    match result {
        Ok(contact) => {
            conn.execute("ROLLBACK TO validate_qr", [])
                .map_err(|e| e.to_string())?;
            Ok(contact_to_payload(&contact))
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK TO validate_qr", []);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn generate_own_qr_code(
    active: State<'_, ActiveIdentity>,
) -> Result<String, String> {
    let guard = active.identity.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(identity) => {
            let pk_bytes = identity.verifying_key.to_bytes();
            let seed = identity.signing_key.to_bytes();
            let x25519_pk = crypto::x25519_pubkey_from_seed(&seed);
            let json = storage::contacts_repo::generate_own_qr(
                &identity.onion_address,
                &pk_bytes,
                &x25519_pk,
            );
            Ok(json)
        }
        None => Err("No identity loaded".to_string()),
    }
}

// ─── Message Commands ────────────────────────────────────────────

#[tauri::command]
pub async fn send_message(
    contact_onion: String,
    content: String,
    active: State<'_, ActiveIdentity>,
    guard: State<'_, NetGuard>,
    app: tauri::AppHandle,
) -> Result<MessagePayload, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    reset_session_timer();

    let (my_secret, my_pk_bytes, my_onion) = {
        let guard_id = active.identity.lock().map_err(|e| e.to_string())?;
        let identity = guard_id.as_ref().ok_or("No identity loaded")?;
        (
            identity.signing_key.to_bytes(),
            identity.verifying_key.to_bytes(),
            identity.onion_address.clone(),
        )
    };

    let contact = storage::contacts_repo::get_contact_by_onion(&conn, &contact_onion)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Contact '{}' not found", contact_onion))?;

    let contact_x25519_bytes = hex::decode(&contact.x25519_public_hex)
        .map_err(|e| format!("Invalid contact x25519 public key: {}", e))?;
    let contact_x25519_array: [u8; 32] = contact_x25519_bytes
        .try_into()
        .map_err(|_| "Invalid x25519 public key length".to_string())?;

    // Use forward-secure encryption with Ed25519 identity binding
    let encrypted = crypto::encrypt_message_to_recipient(
        content.as_bytes(),
        &contact_x25519_array,
        &my_secret,
    );

    let encrypted_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &encrypted,
    );

    let stored = messages_repo::insert_message(
        &conn,
        &contact_onion,
        &encrypted_b64,
        &my_onion,
        true,
        "sent",
    )
    .map_err(|e| e.to_string())?;

    let payload = message_to_payload(&stored);

    let onion_copy = contact_onion.clone();
    let my_onion_copy: String = my_onion.to_owned();
    let content_copy = encrypted_b64.clone();
    let stored_id = stored.id;
    let guard_clone = guard.0.clone();

    tokio::spawn(async move {
        if let Err(e) = deliver_message_via_tor(
            &guard_clone,
            &onion_copy,
            &content_copy,
            &my_onion_copy,
        )
        .await
        {
            error!("Tor delivery failed for {}: {}", onion_copy, e);
            if let Ok(conn) = database::open_database() {
                let _ = messages_repo::update_message_status(&conn, stored_id, "failed");
            }
        } else {
            if let Ok(conn) = database::open_database() {
                let _ = messages_repo::update_message_status(&conn, stored_id, "delivered");
            }
        }
    });

    Ok(payload)
}

/// Real Tor delivery: connect to contact's onion service via Tor DataStream
/// Protocol: send `my_onion\n<encrypted_b64>` over TCP
async fn deliver_message_via_tor(
    guard: &Arc<NetworkGuard>,
    contact_onion: &str,
    encrypted_content: &str,
    my_onion: &str,
) -> Result<(), anyhow::Error> {
    use tokio::io::AsyncWriteExt;

    info!(
        "Delivering encrypted message to {} via Tor ({} bytes)",
        contact_onion,
        encrypted_content.len()
    );

    let mut stream = guard.connect(contact_onion, 12345).await?;

    let payload = format!("{my_onion}\n{encrypted_content}");
    stream.write_all(payload.as_bytes()).await?;
    stream.shutdown().await?;

    info!("Message delivered to {}", contact_onion);
    Ok(())
}

#[tauri::command]
pub async fn get_conversation(
    contact_onion: String,
    limit: Option<i64>,
    before_id: Option<i64>,
) -> Result<Vec<MessagePayload>, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let msgs = messages_repo::get_conversation(&conn, &contact_onion, limit.unwrap_or(50), before_id)
        .map_err(|e| e.to_string())?;
    Ok(msgs.iter().map(message_to_payload).collect())
}

#[tauri::command]
pub async fn get_recent_messages(
    contact_onion: String,
    after_timestamp: i64,
) -> Result<Vec<MessagePayload>, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let msgs =
        messages_repo::get_recent_messages(&conn, &contact_onion, after_timestamp)
            .map_err(|e| e.to_string())?;
    Ok(msgs.iter().map(message_to_payload).collect())
}

#[tauri::command]
pub async fn get_conversations() -> Result<Vec<ConversationPayload>, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let convs = messages_repo::get_all_conversations(&conn).map_err(|e| e.to_string())?;
    Ok(convs
        .into_iter()
        .map(|(onion, last_msg, ts, unread)| ConversationPayload {
            contact_onion: onion,
            last_message: last_msg,
            last_timestamp: ts,
            unread,
        })
        .collect())
}

#[tauri::command]
pub async fn mark_conversation_read(contact_onion: String) -> Result<(), String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    messages_repo::mark_read(&conn, &contact_onion).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn decrypt_message_content(
    encrypted_b64: String,
    sender_onion: String,
    active: State<'_, ActiveIdentity>,
) -> Result<String, String> {
    reset_session_timer();
    let (my_secret, my_pk) = {
        let guard = active.identity.lock().map_err(|e| e.to_string())?;
        let identity = guard.as_ref().ok_or("No identity loaded")?;
        (
            identity.signing_key.to_bytes(),
            identity.verifying_key.to_bytes(),
        )
    };

    let conn = database::open_database().map_err(|e| e.to_string())?;
    let contact = storage::contacts_repo::get_contact_by_onion(&conn, &sender_onion)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Contact not found: {}", sender_onion))?;

    let sender_pk_bytes = hex::decode(&contact.public_key_hex)
        .map_err(|e| format!("Invalid sender public key hex: {}", e))?;
    let sender_pk_array: [u8; 32] = sender_pk_bytes
        .try_into()
        .map_err(|_| "Invalid sender public key length".to_string())?;

    let encrypted = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &encrypted_b64,
    )
    .map_err(|e| format!("Invalid base64: {}", e))?;

    // Try new forward-secure format, fall back to legacy
    let plaintext = crypto::decrypt_message_from_sender(&encrypted, &sender_pk_array, &my_secret)
        .or_else(|_| crypto::legacy_decrypt_message_from_sender(&encrypted, &my_secret))
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
}

#[tauri::command]
pub async fn import_encrypted_messages(
    messages_json: String,
    active: State<'_, ActiveIdentity>,
) -> Result<i64, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let my_secret = {
        let guard = active.identity.lock().map_err(|e| e.to_string())?;
        let identity = guard.as_ref().ok_or("No identity loaded")?;
        identity.signing_key.to_bytes()
    };

    let incoming: Vec<serde_json::Value> =
        serde_json::from_str(&messages_json).map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut imported = 0i64;
    for msg in &incoming {
        let sender_onion = msg["sender_onion"]
            .as_str()
            .ok_or("Missing sender_onion")?
            .to_string();
        let encrypted_b64 = msg["content"]
            .as_str()
            .ok_or("Missing content")?;
        let _timestamp = msg["timestamp"].as_i64().unwrap_or_else(chrono_now);

        let contact = storage::contacts_repo::get_contact_by_onion(&conn, &sender_onion)
            .map_err(|e| e.to_string())?;

        if contact.is_none() {
            continue;
        }

        let contact = contact.unwrap();
        let sender_pk_bytes = hex::decode(&contact.public_key_hex)
            .map_err(|e| format!("Invalid sender public key hex: {}", e))?;
        let sender_pk_array: [u8; 32] = sender_pk_bytes
            .try_into()
            .map_err(|_| "Invalid sender public key length".to_string())?;

        let encrypted = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            encrypted_b64,
        )
        .map_err(|e| format!("Invalid base64: {}", e))?;

        if crypto::decrypt_message_from_sender(&encrypted, &sender_pk_array, &my_secret)
            .and_then(|_| Ok(()))
            .or_else(|_| {
                crypto::legacy_decrypt_message_from_sender(&encrypted, &my_secret).map(|_| ())
            })
            .is_err()
        {
            continue;
        }

        let exists = messages_repo::get_conversation(&conn, &sender_onion, 1, None)
            .map_err(|e| e.to_string())?
            .iter()
            .any(|m| m.content == encrypted_b64);

        if exists {
            continue;
        }

        messages_repo::insert_message(
            &conn,
            &sender_onion,
            encrypted_b64,
            &sender_onion,
            false,
            "delivered",
        )
        .map_err(|e| e.to_string())?;

        messages_repo::increment_unread(&conn, &sender_onion)
            .map_err(|e| e.to_string())?;

        imported += 1;
    }

    Ok(imported)
}
