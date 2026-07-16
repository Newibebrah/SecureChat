import { useEffect, memo, useCallback } from "react";
import { useContactStore, ContactPayload } from "../stores/contactStore";

const ContactItem = memo(function ContactItem({
  contact,
  onDelete,
  onVerify,
  onChat,
}: {
  contact: ContactPayload;
  onDelete: (onion: string) => void;
  onVerify: (onion: string) => void;
  onChat: (contact: ContactPayload) => void;
}) {
  const addr = contact.onionAddress || "";
  const displayName =
    contact.localNickname || addr.slice(0, 16) || "???";

  const truncatedOnion =
    addr.length > 25
      ? addr.slice(0, 10) + "..." + addr.slice(-8)
      : addr || "?";

  return (
    <div className="contact-item">
      <div className="contact-item-avatar">
        <div className="avatar-placeholder">
          {(contact.localNickname || "?")[0].toUpperCase()}
        </div>
      </div>

      <div className="contact-item-body" onClick={() => onChat(contact)} style={{ cursor: "pointer" }}>
        <div className="contact-item-name">{displayName}</div>
        <div className="contact-item-onion">{truncatedOnion}</div>
      </div>

      <div className="contact-item-actions">
        {contact.safetyVerified ? (
          <span className="badge-verified" title="Safety verified">
            &#10003;
          </span>
        ) : (
          <button
            className="badge-unverified"
            onClick={() => onVerify(contact.onionAddress)}
            title="Not yet verified — click to verify"
          >
            &#9888;
          </button>
        )}
        <button
          className="btn-delete-icon"
          onClick={() => onDelete(contact.onionAddress)}
          title="Delete contact"
        >
          &times;
        </button>
      </div>
    </div>
  );
});

export const ContactList = memo(function ContactList() {
  const contacts = useContactStore((s) => s.contacts) || [];
  const fetchContacts = useContactStore((s) => s.fetchContacts);
  const deleteContact = useContactStore((s) => s.deleteContact);
  const verifyContact = useContactStore((s) => s.verifyContact);
  const openChat = useContactStore((s) => s.openChat);
  const setView = useContactStore((s) => s.setView);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleDelete = useCallback(
    async (onion: string) => {
      if (window.confirm("Delete this contact?")) {
        await deleteContact(onion);
      }
    },
    [deleteContact],
  );

  const handleVerify = useCallback(
    async (onion: string) => {
      const nickname = prompt("Has this contact been verified? Enter their nickname to confirm:");
      if (nickname !== null) {
        await verifyContact(onion);
      }
    },
    [verifyContact],
  );

  return (
    <div className="contact-screen">
      <div className="contact-screen-header">
        <h2>Contacts</h2>
        <span className="contact-count">{contacts.length}</span>
      </div>

      {contacts.length === 0 ? (
        <div className="empty-state">
          <p>No contacts yet.</p>
          <p className="hint">
            Share your Onion Address via QR code or paste to add contacts.
          </p>
          <button
            className="btn-primary"
            onClick={() => setView("add-contact")}
          >
            Add Contact
          </button>
        </div>
      ) : (
        <div className="contact-list">
          {contacts.map((c) => (
            <ContactItem
              key={c.onionAddress}
              contact={c}
              onDelete={handleDelete}
              onVerify={handleVerify}
              onChat={openChat}
            />
          ))}
        </div>
      )}

      {contacts.length > 0 && (
        <button
          className="fab"
          onClick={() => setView("add-contact")}
          title="Add Contact"
        >
          +
        </button>
      )}
    </div>
  );
});
