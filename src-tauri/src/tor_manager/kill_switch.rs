use anyhow::{Context, Result};
use arti_client::DataStream;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::client::AnonTorClient;

/// NetworkGuard ensures all network connections are routed through Tor.
/// It wraps an optional TorClient and refuses clearnet connections.
pub struct NetworkGuard {
    tor_client: Arc<RwLock<Option<AnonTorClient>>>,
}

impl NetworkGuard {
    pub fn new() -> Self {
        Self {
            tor_client: Arc::new(RwLock::new(None)),
        }
    }

    pub fn with_client(client: AnonTorClient) -> Self {
        Self {
            tor_client: Arc::new(RwLock::new(Some(client))),
        }
    }

    pub async fn set_client(&self, client: AnonTorClient) {
        *self.tor_client.write().await = Some(client);
    }

    pub async fn clear_client(&self) {
        *self.tor_client.write().await = None;
    }

    /// Connect to a hidden service. The host must be a .onion address.
    /// Any non-.onion connection is refused.
    pub async fn connect(&self, host: &str, port: u16) -> Result<DataStream> {
        if !host.ends_with(".onion") {
            anyhow::bail!(
                "Kill-switch: direct connection to '{}' blocked. All traffic must go through Tor.",
                host
            );
        }

        let guard = self.tor_client.read().await;
        let client = guard
            .as_ref()
            .context("Tor client not initialized. Cannot connect.")?;

        let stream = client
            .connect((host, port))
            .await
            .context(format!("Failed to connect to {}:{} over Tor", host, port))?;

        Ok(stream)
    }

    pub fn tor_client_ref(&self) -> Arc<RwLock<Option<AnonTorClient>>> {
        self.tor_client.clone()
    }

    /// Check if the guard has an initialized Tor client.
    pub async fn is_initialized(&self) -> bool {
        self.tor_client.read().await.is_some()
    }
}

impl Default for NetworkGuard {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rejects_clearnet() {
        let guard = NetworkGuard::new();
        let result = guard.connect("example.com", 443).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Kill-switch"));
    }

    #[tokio::test]
    async fn test_rejects_when_no_client() {
        let guard = NetworkGuard::new();
        let result = guard.connect("someonionaddress.onion", 80).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Tor client not initialized"));
    }
}
