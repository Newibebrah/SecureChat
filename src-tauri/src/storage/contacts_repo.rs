use anyhow::{Context, Result};
use ed25519_dalek::VerifyingKey;
use rusqlite::Connection;
use serde::Serialize;

use crate::core::identity::compute_onion_address;

/// A contact stored in the local encrypted database.
#[derive(Debug, Clone, Serialize)]
pub struct Contact {
    pub id: i64,
    pub onion_address: String,
    pub public_key_hex: String,
    pub local_nickname: String,
    pub safety_verified: bool,
    pub created_at: String,
}

/// Add a new contact after validating the onion address matches the public key.
///
/// `public_key_b64` is a base64-encoded Ed25519 public key (32 bytes).
/// On success, returns the newly inserted Contact.
pub fn add_contact(
    conn: &Connection,
    onion_address: &str,
    public_key_b64: &str,
    local_nickname: &str,
) -> Result<Contact> {
    // Validate onion address format
    if !onion_address.ends_with(".onion") || onion_address.len() != 62 {
        anyhow::bail!("Invalid onion address format");
    }

    // Decode public key
    let pk_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        public_key_b64,
    )
    .context("Failed to decode base64 public key")?;

    if pk_bytes.len() != 32 {
        anyhow::bail!("Public key must be exactly 32 bytes");
    }

    let pk_array: [u8; 32] = pk_bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid public key length"))?;

    // Validate it's a proper Ed25519 point
    let verifying_key = VerifyingKey::from_bytes(&pk_array)
        .map_err(|_| anyhow::anyhow!("Invalid Ed25519 public key (not on curve)"))?;

    // Derive the expected onion address and compare
    let expected_onion = compute_onion_address(&verifying_key);
    if expected_onion != onion_address {
        anyhow::bail!(
            "Onion address does not match public key: got '{}', expected '{}'",
            onion_address,
            expected_onion,
        );
    }

    // Insert
    conn.execute(
        "INSERT INTO contacts (onion_address, public_key, local_nickname) VALUES (?1, ?2, ?3)",
        rusqlite::params![onion_address, pk_array.as_slice(), local_nickname],
    )
    .context("Failed to insert contact (duplicate onion address?)")?;

    // Fetch back the full row (with id and created_at)
    get_contact_by_onion(conn, onion_address)
        .transpose()
        .unwrap_or_else(|| anyhow::bail!("Contact saved but failed to read back"))
}

/// List all contacts, ordered by creation date (newest first).
pub fn list_contacts(conn: &Connection) -> Result<Vec<Contact>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, onion_address, public_key, local_nickname, safety_verified, created_at
             FROM contacts ORDER BY created_at DESC",
        )
        .context("Failed to prepare contact list query")?;

    let contacts = stmt
        .query_map([], |row| {
            let pk_blob: Vec<u8> = row.get(2)?;
            let pk_hex = hex::encode(&pk_blob);
            Ok(Contact {
                id: row.get(0)?,
                onion_address: row.get(1)?,
                public_key_hex: pk_hex,
                local_nickname: row.get(3)?,
                safety_verified: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })
        .context("Failed to query contacts")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to collect contacts")?;

    Ok(contacts)
}

/// Get a single contact by onion address.
pub fn get_contact_by_onion(
    conn: &Connection,
    onion_address: &str,
) -> Result<Option<Contact>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, onion_address, public_key, local_nickname, safety_verified, created_at
             FROM contacts WHERE onion_address = ?1",
        )
        .context("Failed to prepare contact query")?;

    let mut rows = stmt
        .query_map(rusqlite::params![onion_address], |row| {
            let pk_blob: Vec<u8> = row.get(2)?;
            let pk_hex = hex::encode(&pk_blob);
            Ok(Contact {
                id: row.get(0)?,
                onion_address: row.get(1)?,
                public_key_hex: pk_hex,
                local_nickname: row.get(3)?,
                safety_verified: row.get::<_, i32>(4)? != 0,
                created_at: row.get(5)?,
            })
        })
        .context("Failed to query contact")?;

    match rows.next() {
        Some(Ok(contact)) => Ok(Some(contact)),
        Some(Err(e)) => Err(e).context("Failed to read contact row"),
        None => Ok(None),
    }
}

/// Update a contact's local nickname.
pub fn update_nickname(
    conn: &Connection,
    onion_address: &str,
    nickname: &str,
) -> Result<Contact> {
    conn.execute(
        "UPDATE contacts SET local_nickname = ?1 WHERE onion_address = ?2",
        rusqlite::params![nickname, onion_address],
    )
    .context("Failed to update nickname")?;

    get_contact_by_onion(conn, onion_address)
        .transpose()
        .unwrap_or_else(|| anyhow::bail!("Contact not found after update"))
}

/// Mark a contact as safety-verified.
pub fn verify_contact(conn: &Connection, onion_address: &str) -> Result<Contact> {
    conn.execute(
        "UPDATE contacts SET safety_verified = 1 WHERE onion_address = ?1",
        rusqlite::params![onion_address],
    )
    .context("Failed to mark contact as verified")?;

    get_contact_by_onion(conn, onion_address)
        .transpose()
        .unwrap_or_else(|| anyhow::bail!("Contact not found after verification"))
}

/// Delete a contact by onion address.
pub fn delete_contact(conn: &Connection, onion_address: &str) -> Result<()> {
    let affected = conn
        .execute(
            "DELETE FROM contacts WHERE onion_address = ?1",
            rusqlite::params![onion_address],
        )
        .context("Failed to delete contact")?;

    if affected == 0 {
        anyhow::bail!("Contact not found: {}", onion_address);
    }
    Ok(())
}

/// Parse a QR code / paste payload into a (onion_address, public_key_b64) pair.
/// Expected format: {"onion":"...","pubkey":"..."}
pub fn parse_contact_qr(json: &str) -> Result<(String, String)> {
    let v: serde_json::Value =
        serde_json::from_str(json).context("Invalid QR data format (expected JSON)")?;

    let onion = v["onion"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Missing 'onion' field in QR data"))?
        .to_string();

    let pubkey = v["pubkey"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Missing 'pubkey' field in QR data"))?
        .to_string();

    Ok((onion, pubkey))
}

/// Generate the JSON string for the user's own contact QR code.
pub fn generate_own_qr(onion_address: &str, public_key_bytes: &[u8; 32]) -> String {
    let pubkey_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        public_key_bytes,
    );
    serde_json::json!({
        "onion": onion_address,
        "pubkey": pubkey_b64,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE contacts (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                onion_address   TEXT    NOT NULL UNIQUE,
                public_key      BLOB   NOT NULL,
                local_nickname  TEXT   NOT NULL DEFAULT '',
                safety_verified INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT   NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        conn
    }

    fn make_valid_pubkey_b64() -> String {
        use ed25519_dalek::SigningKey;
        use rand::rngs::OsRng;
        let sk = SigningKey::generate(&mut OsRng);
        let pk = sk.verifying_key();
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, pk.to_bytes())
    }

    fn make_valid_onion_from_pubkey_b64(b64: &str) -> String {
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64).unwrap();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        let pk = VerifyingKey::from_bytes(&arr).unwrap();
        compute_onion_address(&pk)
    }

    #[test]
    fn test_add_and_list_contact() {
        let conn = test_db();
        let pubkey = make_valid_pubkey_b64();
        let onion = make_valid_onion_from_pubkey_b64(&pubkey);

        let contact = add_contact(&conn, &onion, &pubkey, "Alice").unwrap();
        assert_eq!(contact.onion_address, onion);
        assert_eq!(contact.local_nickname, "Alice");
        assert!(!contact.safety_verified);

        let list = list_contacts(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].onion_address, onion);
    }

    #[test]
    fn test_rejects_mismatched_pubkey() {
        let conn = test_db();
        // Generate a valid keypair but use a DIFFERENT onion
        let pubkey = make_valid_pubkey_b64();
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &pubkey).unwrap();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        let pk = VerifyingKey::from_bytes(&arr).unwrap();
        let wrong_onion = compute_onion_address(&pk);
        // The right onion, but we'll modify to make it wrong
        let bad_onion = format!("z{}", &wrong_onion[1..]);

        let result = add_contact(&conn, &bad_onion, &pubkey, "Eve");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("does not match"));
    }

    #[test]
    fn test_verify_and_nickname() {
        let conn = test_db();
        let pubkey = make_valid_pubkey_b64();
        let onion = make_valid_onion_from_pubkey_b64(&pubkey);

        add_contact(&conn, &onion, &pubkey, "").unwrap();

        let verified = verify_contact(&conn, &onion).unwrap();
        assert!(verified.safety_verified);

        let renamed = update_nickname(&conn, &onion, "Bob").unwrap();
        assert_eq!(renamed.local_nickname, "Bob");
    }

    #[test]
    fn test_delete() {
        let conn = test_db();
        let pubkey = make_valid_pubkey_b64();
        let onion = make_valid_onion_from_pubkey_b64(&pubkey);

        add_contact(&conn, &onion, &pubkey, "").unwrap();
        assert_eq!(list_contacts(&conn).unwrap().len(), 1);

        delete_contact(&conn, &onion).unwrap();
        assert_eq!(list_contacts(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_parse_qr() {
        let json = r#"{"onion":"test.onion","pubkey":"dGVzdHB1YmtleQ=="}"#;
        let (onion, pubkey) = parse_contact_qr(json).unwrap();
        assert_eq!(onion, "test.onion");
        assert_eq!(pubkey, "dGVzdHB1YmtleQ==");
    }

    #[test]
    fn test_generate_own_qr() {
        let pk = [0xABu8; 32];
        let json = generate_own_qr("my.onion", &pk);
        assert!(json.contains("my.onion"));
        assert!(json.contains("q6ur"));
    }
}
