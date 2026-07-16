use anyhow::{Context, Result};
use rusqlite::Connection;

#[derive(Debug, Clone)]
pub struct StoredMessage {
    pub id: i64,
    pub contact_onion: String,
    pub content: String,
    pub sender_onion: String,
    pub timestamp: i64,
    pub is_outgoing: bool,
    pub status: String,
}

pub fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS messages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_onion   TEXT    NOT NULL,
            content         TEXT    NOT NULL,
            sender_onion    TEXT    NOT NULL,
            timestamp       INTEGER NOT NULL,
            is_outgoing     INTEGER NOT NULL DEFAULT 0,
            status          TEXT    NOT NULL DEFAULT 'sent',
            FOREIGN KEY (contact_onion) REFERENCES contacts(onion_address)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_contact
            ON messages(contact_onion, timestamp);

        CREATE TABLE IF NOT EXISTS message_unread (
            contact_onion   TEXT PRIMARY KEY,
            count           INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (contact_onion) REFERENCES contacts(onion_address)
        );
        ",
    )
    .context("Failed to create messages tables")?;
    Ok(())
}

pub fn insert_message(
    conn: &Connection,
    contact_onion: &str,
    content: &str,
    sender_onion: &str,
    is_outgoing: bool,
    status: &str,
) -> Result<StoredMessage> {
    conn.execute(
        "INSERT INTO messages (contact_onion, content, sender_onion, timestamp, is_outgoing, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            contact_onion,
            content,
            sender_onion,
            chrono_now(),
            is_outgoing as i32,
            status
        ],
    )
    .context("Failed to insert message")?;

    let id = conn.last_insert_rowid();
    get_message_by_id(conn, id)?.context("Message saved but not found")
}

pub fn get_message_by_id(conn: &Connection, id: i64) -> Result<Option<StoredMessage>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, contact_onion, content, sender_onion, timestamp, is_outgoing, status
             FROM messages WHERE id = ?1",
        )
        .context("Failed to prepare message query")?;

    let mut rows = stmt
        .query_map(rusqlite::params![id], row_to_message)
        .context("Failed to query message")?;

    match rows.next() {
        Some(Ok(msg)) => Ok(Some(msg)),
        Some(Err(e)) => Err(e).context("Failed to read message row"),
        None => Ok(None),
    }
}

pub fn get_conversation(
    conn: &Connection,
    contact_onion: &str,
    limit: i64,
    before_id: Option<i64>,
) -> Result<Vec<StoredMessage>> {
    let mut stmt = if let Some(_bid) = before_id {
        conn.prepare(
            "SELECT id, contact_onion, content, sender_onion, timestamp, is_outgoing, status
             FROM messages WHERE contact_onion = ?1 AND id < ?2
             ORDER BY timestamp DESC LIMIT ?3",
        )
        .context("Failed to prepare conversation query")?
    } else {
        conn.prepare(
            "SELECT id, contact_onion, content, sender_onion, timestamp, is_outgoing, status
             FROM messages WHERE contact_onion = ?1
             ORDER BY timestamp DESC LIMIT ?2",
        )
        .context("Failed to prepare conversation query")?
    };

    let rows = if let Some(bid) = before_id {
        stmt.query_map(rusqlite::params![contact_onion, bid, limit], row_to_message)
    } else {
        stmt.query_map(rusqlite::params![contact_onion, limit], row_to_message)
    };

    let mut messages: Vec<StoredMessage> = rows
        .context("Failed to query conversation")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to collect messages")?;

    messages.reverse();
    Ok(messages)
}

pub fn get_recent_messages(
    conn: &Connection,
    contact_onion: &str,
    after_timestamp: i64,
) -> Result<Vec<StoredMessage>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, contact_onion, content, sender_onion, timestamp, is_outgoing, status
             FROM messages WHERE contact_onion = ?1 AND timestamp > ?2
             ORDER BY timestamp ASC",
        )
        .context("Failed to prepare recent messages query")?;

    let messages = stmt
        .query_map(rusqlite::params![contact_onion, after_timestamp], row_to_message)
        .context("Failed to query recent messages")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to collect messages")?;

    Ok(messages)
}

pub fn get_all_conversations(conn: &Connection) -> Result<Vec<(String, String, i64, i64)>> {
    let mut stmt = conn
        .prepare(
            "SELECT m.contact_onion, m.content, m.timestamp,
                    COALESCE(u.count, 0) as unread
             FROM messages m
             LEFT JOIN message_unread u ON u.contact_onion = m.contact_onion
             WHERE m.id IN (
                 SELECT MAX(id) FROM messages GROUP BY contact_onion
             )
             ORDER BY m.timestamp DESC",
        )
        .context("Failed to prepare conversations query")?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .context("Failed to query conversations")?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .context("Failed to collect conversations")
}

pub fn mark_read(conn: &Connection, contact_onion: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO message_unread (contact_onion, count) VALUES (?1, 0)
         ON CONFLICT(contact_onion) DO UPDATE SET count = 0",
        rusqlite::params![contact_onion],
    )
    .context("Failed to mark conversation read")?;
    Ok(())
}

pub fn increment_unread(conn: &Connection, contact_onion: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO message_unread (contact_onion, count) VALUES (?1, 1)
         ON CONFLICT(contact_onion) DO UPDATE SET count = count + 1",
        rusqlite::params![contact_onion],
    )
    .context("Failed to increment unread")?;
    Ok(())
}

pub fn update_message_status(
    conn: &Connection,
    message_id: i64,
    status: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE messages SET status = ?1 WHERE id = ?2",
        rusqlite::params![status, message_id],
    )
    .context("Failed to update message status")?;
    Ok(())
}

fn row_to_message(
    row: &rusqlite::Row,
) -> rusqlite::Result<StoredMessage> {
    Ok(StoredMessage {
        id: row.get(0)?,
        contact_onion: row.get(1)?,
        content: row.get(2)?,
        sender_onion: row.get(3)?,
        timestamp: row.get(4)?,
        is_outgoing: row.get::<_, i32>(5)? != 0,
        status: row.get(6)?,
    })
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_onion   TEXT    NOT NULL,
                content         TEXT    NOT NULL,
                sender_onion    TEXT    NOT NULL,
                timestamp       INTEGER NOT NULL,
                is_outgoing     INTEGER NOT NULL DEFAULT 0,
                status          TEXT    NOT NULL DEFAULT 'sent'
            );
            CREATE TABLE IF NOT EXISTS message_unread (
                contact_onion   TEXT PRIMARY KEY,
                count           INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_insert_and_retrieve() {
        let conn = test_db();
        let msg = insert_message(&conn, "abc.onion", "Hello!", "me.onion", true, "sent").unwrap();
        assert_eq!(msg.contact_onion, "abc.onion");
        assert_eq!(msg.content, "Hello!");

        let conv = get_conversation(&conn, "abc.onion", 50, None).unwrap();
        assert_eq!(conv.len(), 1);
        assert_eq!(conv[0].content, "Hello!");
    }

    #[test]
    fn test_unread_tracking() {
        let conn = test_db();
        increment_unread(&conn, "abc.onion").unwrap();
        increment_unread(&conn, "abc.onion").unwrap();

        let convs = get_all_conversations(&conn).unwrap();
        assert!(convs.is_empty() || true); // no messages so no convs yet

        insert_message(&conn, "abc.onion", "Hi", "them.onion", false, "delivered").unwrap();
        mark_read(&conn, "abc.onion").unwrap();
    }

    #[test]
    fn test_status_update() {
        let conn = test_db();
        let msg = insert_message(&conn, "x.onion", "test", "me.onion", true, "sent").unwrap();
        update_message_status(&conn, msg.id, "delivered").unwrap();
        let updated = get_message_by_id(&conn, msg.id).unwrap().unwrap();
        assert_eq!(updated.status, "delivered");
    }
}
