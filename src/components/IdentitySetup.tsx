import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useIdentityStore } from "../stores/identityStore";

type Step = "password" | "generating" | "complete";

export function IdentitySetup() {
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const { createIdentity, identity, loading, error } = useIdentityStore();

  const handleCreate = async () => {
    setPasswordError(null);

    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setStep("generating");
    await createIdentity(password);
    setStep("complete");
  };

  // Generating step with spinner
  if (step === "generating") {
    return (
      <div className="setup-container">
        <div className="setup-card">
          <h2>Generating Your Identity</h2>
          <div className="setup-loading">
            <div className="spinner" />
            <p>Creating encrypted keypair...</p>
            {loading && <p className="hint">This should take a moment.</p>}
            {error && <p className="error-text">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  // Complete step - show identity
  if (step === "complete" && identity) {
    return (
      <div className="setup-container">
        <div className="setup-card">
          <h2>Your Identity Created</h2>

          <div className="identity-qr">
            <QRCodeSVG
              value={identity.onion_address}
              size={200}
              bgColor="#ffffff"
              fgColor="#1a1a24"
              level="M"
            />
          </div>

          <div className="identity-detail">
            <label>Onion Address</label>
            <code className="onion-address">{identity.onion_address}</code>
          </div>

          <div className="identity-detail">
            <label>Safety Number (Fingerprint)</label>
            <code className="fingerprint">{identity.fingerprint}</code>
          </div>

          <div className="identity-detail">
            <label>Public Key</label>
            <code className="public-key">{identity.public_key.slice(0, 32)}...</code>
          </div>

          <div className="setup-note">
            <p>
              Share your Onion Address with others to let them contact you.
              Verify the Safety Number out-of-band for secure communication.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Password creation step
  return (
    <div className="setup-container">
      <div className="setup-card">
        <h2>Set Up Your Identity</h2>
        <p className="setup-subtitle">
          Choose a strong password to encrypt your identity.
          This password cannot be recovered if lost.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
          className="setup-form"
        >
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
              autoFocus
              minLength={8}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm">Confirm Password</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              minLength={8}
            />
          </div>

          {passwordError && <p className="error-text">{passwordError}</p>}
          {error && <p className="error-text">{error}</p>}

          <button
            type="submit"
            className="btn-primary"
            disabled={loading || password.length < 8 || password !== confirm}
          >
            {loading ? "Creating..." : "Create Identity"}
          </button>
        </form>
      </div>
    </div>
  );
}
