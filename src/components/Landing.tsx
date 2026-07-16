import { useEffect } from "react";
import { useTorStore } from "../stores/torStore";
import { initTorEventListener } from "../stores/torStore";

export function Landing({
  onNew,
  onExisting,
}: {
  onNew: () => void;
  onExisting: () => void;
}) {
  const { status, fetchStatus } = useTorStore();

  useEffect(() => {
    initTorEventListener();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const statusColor =
    status.status === "ready"
      ? "#22c55e"
      : status.status === "error"
        ? "#ef4444"
        : "#f59e0b";

  return (
    <div className="landing">
      <div className="landing-card">
        <header className="landing-header">
          <div className="landing-logo">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="22" stroke="url(#lg)" strokeWidth="2.5" />
              <path d="M24 8C20 8 14 12 14 20c0 6 4 12 10 14 6-2 10-8 10-14 0-8-6-12-10-12z" fill="url(#lg)" opacity="0.85" />
              <path d="M24 22a3 3 0 100-6 3 3 0 000 6z" fill="#0f0f13" />
              <path d="M20 26c2 3 6 3 8 0" stroke="#0f0f13" strokeWidth="1.5" strokeLinecap="round" />
              <defs>
                <linearGradient id="lg" x1="8" y1="8" x2="40" y2="40">
                  <stop stopColor="#6c5ce7" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="landing-title">Anon-Chat</h1>
          <p className="landing-subtitle">Private. Anonymous. Encrypted.</p>
        </header>

        <div className="landing-actions">
          <button className="landing-btn" onClick={onExisting}>
            <span className="landing-btn-label">Unlock</span>
            <span className="landing-btn-desc">I have a password</span>
          </button>
          <button className="landing-btn" onClick={onNew}>
            <span className="landing-btn-label">Create</span>
            <span className="landing-btn-desc">New identity</span>
          </button>
        </div>

        <div className="landing-tor">
          <span className="landing-tor-dot" style={{ backgroundColor: statusColor }} />
          <span className="landing-tor-text">{status.message}</span>
        </div>
      </div>
    </div>
  );
}
