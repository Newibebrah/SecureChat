use std::path::PathBuf;

use anyhow::{Context, Result};
use rusqlite::Connection;

use super::messages_repo;

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

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("Failed to create database directory")?;
    }

    let conn = Connection::open(&path).context("Failed to open SQLite database")?;

    conn.execute_batch("PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA foreign_keys=ON;")
        .context("Failed to set pragmas")?;

    run_migrations(&conn)?;

    Ok(conn)
}

pub fn database_exists() -> bool {
    db_path().exists()
}

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
            x25519_public   BLOB   NOT NULL CHECK (length(x25519_public) = 32),
            local_nickname  TEXT   NOT NULL DEFAULT '',
            safety_verified INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT   NOT NULL DEFAULT (datetime('now'))
        );
        ",
    )
    .context("Failed to run base database migrations")?;

    messages_repo::create_tables(conn)?;

    Ok(())
}
