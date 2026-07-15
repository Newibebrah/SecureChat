use std::path::PathBuf;

use anyhow::{Context, Result};
use arti_client::{TorClient, TorClientConfig};
use tokio::sync::watch;
use tor_rtcompat::PreferredRuntime;
use tracing::{error, info};

use super::status::TorStatus;

/// Concrete TorClient type bound to the preferred async runtime.
pub type AnonTorClient = TorClient<PreferredRuntime>;

/// ArtiClientManager handles the lifecycle of the embedded Tor client.
pub struct ArtiClientManager;

impl ArtiClientManager {
    /// Bootstrap the Tor client.
    ///
    /// Reports progress via the watch sender. On success, returns the
    /// initialized TorClient bound to the PreferredRuntime.
    /// On failure, sends TorStatus::Error and returns the error.
    pub async fn bootstrap(
        status_tx: watch::Sender<TorStatus>,
        _state_dir: Option<PathBuf>,
    ) -> Result<AnonTorClient> {
        let _state_dir = _state_dir.unwrap_or_else(Self::default_state_dir);

        status_tx.send_modify(|s| {
            if matches!(s, TorStatus::Offline) {
                *s = TorStatus::Bootstrapping(0.05);
            }
        });

        let config = TorClientConfig::default();

        info!("Bootstrapping Tor client...");
        status_tx.send_modify(|s| *s = TorStatus::Bootstrapping(0.1));

        match TorClient::create_bootstrapped(config).await {
            Ok(client) => {
                info!("Tor client bootstrapped successfully");
                status_tx.send_modify(|s| *s = TorStatus::Ready);
                Ok(client)
            }
            Err(e) => {
                error!("Tor bootstrap failed: {:#}", e);
                status_tx.send_modify(|s| *s = TorStatus::Error(e.to_string()));
                Err(e).context("Failed to bootstrap Tor client")
            }
        }
    }

    /// Bootstrap with a fresh receiver so callers can monitor progress directly.
    #[allow(dead_code)]
    pub async fn bootstrap_with_receiver(
        state_dir: Option<PathBuf>,
    ) -> Result<(AnonTorClient, watch::Receiver<TorStatus>)> {
        let (tx, rx) = watch::channel(TorStatus::Offline);
        let client = Self::bootstrap(tx, state_dir).await?;
        Ok((client, rx))
    }

    fn default_state_dir() -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("anon-chat")
            .join("tor-state")
    }
}
