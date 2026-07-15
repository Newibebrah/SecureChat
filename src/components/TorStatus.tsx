import { useEffect } from "react";
import { useTorStore, initTorEventListener } from "../stores/torStore";

export function TorStatus() {
  const { status, loading, error, fetchStatus } = useTorStore();

  // Initialize event listener on mount
  useEffect(() => {
    initTorEventListener();
    // Also poll in case events are delayed
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const progressPercent = Math.round(status.progress * 100);

  const statusColor = () => {
    switch (status.status) {
      case "ready":
        return "#22c55e";
      case "error":
        return "#ef4444";
      case "bootstrapping":
        return "#f59e0b";
      default:
        return "#6b7280";
    }
  };

  return (
    <div className="tor-status-container">
      <div className="tor-status-card">
        <div className="tor-indicator">
          <div
            className="tor-dot"
            style={{ backgroundColor: statusColor() }}
          />
          <span className="tor-label">{status.message}</span>
        </div>

        {status.status === "bootstrapping" && (
          <div className="tor-progress-bar">
            <div
              className="tor-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {loading && <p className="tor-loading">Checking status...</p>}

        {error && <p className="tor-error-text">{error}</p>}

        {status.status === "ready" && (
          <div className="tor-ready-actions">
            <p>Identity not yet set up.</p>
            <button className="continue-btn" disabled>
              Continue Setup
            </button>
            <p className="hint">
              Full setup will be available in a future phase.
            </p>
          </div>
        )}

        {status.status === "error" && (
          <div className="tor-error-actions">
            <button className="retry-btn" onClick={fetchStatus}>
              Retry Connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
