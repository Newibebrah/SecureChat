use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TorStatus {
    Offline,
    Bootstrapping(f64),
    Ready,
    Error(String),
}

impl TorStatus {
    pub fn label(&self) -> &str {
        match self {
            TorStatus::Offline => "Offline",
            TorStatus::Bootstrapping(_) => "Connecting to Tor...",
            TorStatus::Ready => "Tor connected",
            TorStatus::Error(_) => "Tor error",
        }
    }

    pub fn progress(&self) -> f64 {
        match self {
            TorStatus::Offline => 0.0,
            TorStatus::Bootstrapping(p) => *p,
            TorStatus::Ready => 1.0,
            TorStatus::Error(_) => 0.0,
        }
    }

    pub fn is_ready(&self) -> bool {
        matches!(self, TorStatus::Ready)
    }
}
