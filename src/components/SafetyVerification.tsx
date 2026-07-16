import { useState } from "react";
import { useContactStore } from "../stores/contactStore";
import { hexToBase64 } from "../lib/tauri-core";

export function SafetyVerification() {
  const [verified, setVerified] = useState(false);
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { pendingContact, addContact, setPendingContact, setView } =
    useContactStore();

  if (!pendingContact) {
    return (
      <div className="contact-screen">
        <p>No contact data to verify.</p>
        <button className="btn-primary" onClick={() => setView("add-contact")}>
          Go Back
        </button>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await addContact(
        pendingContact.onionAddress,
        hexToBase64(pendingContact.publicKeyHex),
        nickname,
        pendingContact.x25519PublicHex,
      );
      setPendingContact(null);
      setView("contacts");
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const truncatedOnion =
    pendingContact.onionAddress.length > 20
      ? pendingContact.onionAddress.slice(0, 16) + "..." +
        pendingContact.onionAddress.slice(-6)
      : pendingContact.onionAddress;

  return (
    <div className="contact-screen">
      <div className="contact-screen-header">
        <button
          className="btn-back"
          onClick={() => {
            setPendingContact(null);
            setView("add-contact");
          }}
        >
          &larr; Back
        </button>
        <h2>Verify Contact</h2>
      </div>

      <div className="verify-card">
        <div className="verify-contact-info">
          <span className="verify-label">Contact</span>
          <code className="verify-onion">{truncatedOnion}</code>
        </div>

        <div className="safety-number-section">
          <span className="verify-label">Safety Number</span>
          <div className="safety-number-display">
            {pendingContact.safetyNumber
              .split(" ")
              .map((group, i) => (
                <span key={i} className="safety-group">
                  {group}
                </span>
              ))}
          </div>
          <p className="safety-hint">
            Compare this number with your contact over a secure channel (in
            person, phone call, etc.). Only proceed if the numbers match
            exactly.
          </p>
        </div>

        <div className="verify-checkbox">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            <span>
              Yes, I have verified that this Safety Number matches my contact.
            </span>
          </label>
        </div>

        <div className="form-group">
          <label htmlFor="nickname">Local Nickname (optional)</label>
          <input
            id="nickname"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="e.g., Alice, Bob"
            maxLength={64}
          />
          <span className="field-hint">
            Only visible to you. Never transmitted.
          </span>
        </div>

        {saveError && <p className="error-text">{saveError}</p>}

        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving || !verified}
        >
          {saving
            ? "Saving..."
            : verified
              ? "Save Contact"
              : "Verify Safety Number First"}
        </button>
      </div>
    </div>
  );
}
