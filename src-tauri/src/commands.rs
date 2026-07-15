use serde::Serialize;
use sha2::Digest;
use tauri::State;

use crate::core::identity;
use crate::storage::{self, database, identity_repo};
use crate::tor_manager::TorStatus;
use crate::{ActiveIdentity, TorStatusState};

/// Serializable snapshot of Tor status for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct TorStatusPayload {
    pub status: String,
    pub progress: f64,
    pub message: String,
}

/// Serializable identity info sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct IdentityPayload {
    pub onion_address: String,
    pub public_key: String,
    pub fingerprint: String,
}

/// Tauri command: returns the current Tor connection status.
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

/// Tauri command: check if the database file already exists.
#[tauri::command]
pub async fn database_exists() -> bool {
    database::database_exists()
}

/// Tauri command: create a new identity (first-time setup).
///
/// Creates the database, generates a new Ed25519 keypair, encrypts it with
/// the password-derived key, and stores everything.
#[tauri::command]
pub async fn create_identity(
    password: String,
    active: State<'_, ActiveIdentity>,
) -> Result<IdentityPayload, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;

    let identity =
        identity_repo::create_identity(&conn, &password).map_err(|e| e.to_string())?;

    *active.identity.lock().map_err(|e| e.to_string())? = Some(identity.clone());

    let fp = identity::fingerprint(&identity.verifying_key);
    let pk_hex = hex::encode(identity.verifying_key.to_bytes());

    Ok(IdentityPayload {
        onion_address: identity.onion_address,
        public_key: pk_hex,
        fingerprint: fp,
    })
}

/// Tauri command: unlock an existing identity with a password.
#[tauri::command]
pub async fn unlock_identity(
    password: String,
    active: State<'_, ActiveIdentity>,
) -> Result<IdentityPayload, String> {
    if !database::database_exists() {
        return Err("No database found. Create a new identity first.".to_string());
    }

    let conn = database::open_database().map_err(|e| e.to_string())?;

    let identity = identity_repo::load_identity(&conn, &password).map_err(|e| e.to_string())?;

    *active.identity.lock().map_err(|e| e.to_string())? = Some(identity.clone());

    let fp = identity::fingerprint(&identity.verifying_key);
    let pk_hex = hex::encode(identity.verifying_key.to_bytes());

    Ok(IdentityPayload {
        onion_address: identity.onion_address,
        public_key: pk_hex,
        fingerprint: fp,
    })
}

/// Tauri command: get the currently active (unlocked) identity.
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

/// Tauri command: get the stored onion address without unlocking.
#[tauri::command]
pub async fn get_stored_onion_address() -> Result<Option<String>, String> {
    if !database::database_exists() {
        return Ok(None);
    }
    let conn = database::open_database().map_err(|e| e.to_string())?;
    identity_repo::get_stored_onion_address(&conn).map_err(|e| e.to_string())
}

// ─── Phase 2: Contact Management ─────────────────────────────────────────

/// Serializable contact info sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ContactPayload {
    pub id: i64,
    pub onion_address: String,
    pub public_key_hex: String,
    pub local_nickname: String,
    pub safety_verified: bool,
    pub created_at: String,
    pub safety_number: String,
}

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
        local_nickname: c.local_nickname.clone(),
        safety_verified: c.safety_verified,
        created_at: c.created_at.clone(),
        safety_number: compute_safety_number(&c.public_key_hex),
    }
}

/// Add a new contact from an onion address + base64-encoded public key.
/// Validates that the public key matches the onion address.
#[tauri::command]
pub async fn add_contact(
    onion_address: String,
    public_key_b64: String,
    local_nickname: String,
) -> Result<ContactPayload, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let contact =
        storage::contacts_repo::add_contact(&conn, &onion_address, &public_key_b64, &local_nickname)
            .map_err(|e| e.to_string())?;
    Ok(contact_to_payload(&contact))
}

/// List all saved contacts.
#[tauri::command]
pub async fn list_contacts() -> Result<Vec<ContactPayload>, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let contacts = storage::contacts_repo::list_contacts(&conn).map_err(|e| e.to_string())?;
    Ok(contacts.iter().map(contact_to_payload).collect())
}

/// Update a contact's local nickname.
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

/// Mark a contact as safety-verified.
#[tauri::command]
pub async fn verify_contact(onion_address: String) -> Result<ContactPayload, String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    let contact = storage::contacts_repo::verify_contact(&conn, &onion_address)
        .map_err(|e| e.to_string())?;
    Ok(contact_to_payload(&contact))
}

/// Delete a contact by onion address.
#[tauri::command]
pub async fn delete_contact(onion_address: String) -> Result<(), String> {
    let conn = database::open_database().map_err(|e| e.to_string())?;
    storage::contacts_repo::delete_contact(&conn, &onion_address).map_err(|e| e.to_string())
}

/// Parse a QR/paste payload and validate it.
/// Returns contact info if the public key matches the onion address.
/// The frontend shows this preview before saving.
#[tauri::command]
pub async fn resolve_contact_qr(qr_data: String) -> Result<ContactPayload, String> {
    let (onion, pubkey_b64) =
        storage::contacts_repo::parse_contact_qr(&qr_data).map_err(|e| e.to_string())?;

    // Validate by trying to add temporarily (we don't save yet).
    // We open a no-op connection and validate.
    let conn = database::open_database().map_err(|e| e.to_string())?;

    // Decode and validate without saving by using a transaction we roll back.
    conn.execute("SAVEPOINT validate_qr", [])
        .map_err(|e| e.to_string())?;

    let result = storage::contacts_repo::add_contact(&conn, &onion, &pubkey_b64, "");

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

/// Generate the user's own QR code JSON (onion + pubkey).
#[tauri::command]
pub async fn generate_own_qr_code(
    active: State<'_, ActiveIdentity>,
) -> Result<String, String> {
    let guard = active.identity.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(identity) => {
            let pk_bytes = identity.verifying_key.to_bytes();
            let json = storage::contacts_repo::generate_own_qr(
                &identity.onion_address,
                &pk_bytes,
            );
            Ok(json)
        }
        None => Err("No identity loaded".to_string()),
    }
}
