import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@tauri-apps/api/core";
import { useIdentityStore } from "../stores/identityStore";

export function ProfileScreen() {
  const { identity } = useIdentityStore();
  const [qrData, setQrData] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<string>("generate_own_qr_code")
      .then(setQrData)
      .catch(console.error);
  }, []);

  const handleCopy = async () => {
    if (!identity) return;
    try {
      await navigator.clipboard.writeText(identity.onion_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (!identity) {
    return (
      <div className="contact-screen">
        <p>No identity loaded.</p>
      </div>
    );
  }

  return (
    <div className="contact-screen">
      <div className="contact-screen-header">
        <h2>My Profile</h2>
      </div>

      <div className="profile-card">
        <div className="profile-qr-section">
          <span className="verify-label">Share this QR code</span>
          <div className="profile-qr">
            {qrData ? (
              <QRCodeSVG
                value={qrData}
                size={220}
                bgColor="#ffffff"
                fgColor="#1a1a24"
                level="M"
              />
            ) : (
              <div className="spinner" />
            )}
          </div>
        </div>

        <div className="profile-detail">
          <span className="verify-label">Your Onion Address</span>
          <code className="profile-onion">{identity.onion_address}</code>
          <button className="btn-secondary btn-small" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <div className="profile-detail">
          <span className="verify-label">Safety Number (Fingerprint)</span>
          <code className="profile-fp">{identity.fingerprint}</code>
        </div>

        <div className="profile-detail">
          <span className="verify-label">Public Key</span>
          <code className="profile-pk">
            {identity.public_key.slice(0, 48)}...
          </code>
        </div>

        <div className="setup-note">
          <p>
            Share the QR code above with others to let them add you as a
            contact. They can scan it from the "Add Contact" screen.
          </p>
        </div>
      </div>
    </div>
  );
}
