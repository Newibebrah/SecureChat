use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::core::identity::{
    decrypt_identity, encrypt_identity, generate_identity, generate_salt, Identity, SALT_LEN,
};

/// Check whether the identity table has a stored identity.
pub fn has_identity(conn: &Connection) -> Result<bool> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM identity", [], |row| row.get(0))
        .context("Failed to check identity existence")?;
    Ok(count > 0)
}

/// Create a new identity, encrypt it, and store in the database.
/// Returns the generated Identity (with decrypted keys in memory).
pub fn create_identity(conn: &Connection, password: &str) -> Result<Identity> {
    let identity = generate_identity();
    let salt = generate_salt();

    let blob = encrypt_identity(&identity, password, &salt);

    // Remove any previous identity (should not happen in normal flow)
    conn.execute("DELETE FROM identity", [])
        .context("Failed to clear old identity")?;

    conn.execute(
        "INSERT INTO identity (encrypted, salt, onion_address) VALUES (?1, ?2, ?3)",
        rusqlite::params![blob, salt.as_slice(), identity.onion_address],
    )
    .context("Failed to store identity")?;

    Ok(identity)
}

/// Load and decrypt the stored identity using the provided password.
/// Returns the Identity on success.
pub fn load_identity(conn: &Connection, password: &str) -> Result<Identity> {
    let (blob, salt_vec): (Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT encrypted, salt FROM identity WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .context("No identity found in database")?;

    if salt_vec.len() != SALT_LEN {
        anyhow::bail!("Corrupted salt in database");
    }

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&salt_vec);

    let identity = decrypt_identity(&blob, password, &salt)
        .context("Failed to decrypt identity – wrong password or corrupted data")?;

    Ok(identity)
}

/// Delete all identity data from the database.
pub fn delete_identity(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM identity", [])
        .context("Failed to delete identity")?;
    Ok(())
}

/// Get the stored onion address without needing the password.
/// Returns None if no identity exists.
pub fn get_stored_onion_address(conn: &Connection) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT onion_address FROM identity WHERE id = 1",
        [],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(addr) => Ok(Some(addr)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e).context("Failed to read onion address"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE identity (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                encrypted BLOB NOT NULL,
                salt BLOB NOT NULL,
                onion_address TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_create_and_load_identity() {
        let conn = test_db();
        let password = "test_password";

        assert!(!has_identity(&conn).unwrap());
        let identity = create_identity(&conn, password).unwrap();
        assert!(has_identity(&conn).unwrap());
        assert!(identity.onion_address.ends_with(".onion"));

        let loaded = load_identity(&conn, password).unwrap();
        assert_eq!(loaded.onion_address, identity.onion_address);
        assert_eq!(
            loaded.verifying_key.to_bytes(),
            identity.verifying_key.to_bytes()
        );
    }

    #[test]
    fn test_wrong_password_fails() {
        let conn = test_db();
        create_identity(&conn, "correct").unwrap();

        let result = load_identity(&conn, "wrong");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_onion_address() {
        let conn = test_db();
        assert!(get_stored_onion_address(&conn).unwrap().is_none());

        let identity = create_identity(&conn, "pw").unwrap();
        let stored = get_stored_onion_address(&conn).unwrap();
        assert_eq!(stored, Some(identity.onion_address));
    }
}
