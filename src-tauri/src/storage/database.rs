use std::path::PathBuf;

use anyhow::{Context, Result};
use rusqlite::Connection;

/// The database file name.
const DB_FILENAME: &str = "anon-chat.db";

/// Get the database file path.
pub fn db_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("anon-chat")
        .join(DB_FILENAME)
}

/// Open (or create) the SQLite database and run migrations.
pub fn open_database() -> Result<Connection> {
    let path = db_path();

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("Failed to create database directory")?;
    }

    let conn = Connection::open(&path)
        .context("Failed to open SQLite database")?;

    // Enable WAL mode for better concurrency
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .context("Failed to set WAL mode")?;

    // Run schema migrations
    run_migrations(&conn)?;

    Ok(conn)
}

/// Check if the database file exists on disk.
pub fn database_exists() -> bool {
    db_path().exists()
}

/// Run any pending schema migrations.
fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS identity (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            encrypted   BLOB    NOT NULL,
            salt        BLOB    NOT NULL CHECK (length(salt) = 16),
            onion_address TEXT  NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            onion_address   TEXT    NOT NULL UNIQUE,
            public_key      BLOB   NOT NULL CHECK (length(public_key) = 32),
            local_nickname  TEXT   NOT NULL DEFAULT '',
            safety_verified INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT   NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )
    .context("Failed to run database migrations")?;

    Ok(())
}
