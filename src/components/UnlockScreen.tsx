import { useState } from "react";
import { useIdentityStore } from "../stores/identityStore";

export function UnlockScreen() {
  const [password, setPassword] = useState("");
  const { unlockIdentity, loading, error, clearError } = useIdentityStore();

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    await unlockIdentity(password);
  };

  return (
    <div className="setup-container">
      <div className="setup-card">
        <h2>Unlock Your Identity</h2>
        <p className="setup-subtitle">
          Enter your password to decrypt your identity and start using Anon-Chat.
        </p>

        <form onSubmit={handleUnlock} className="setup-form">
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError();
              }}
              placeholder="Enter your password"
              autoFocus
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button
            type="submit"
            className="btn-primary"
            disabled={loading || password.length === 0}
          >
            {loading ? "Unlocking..." : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
