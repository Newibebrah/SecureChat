import { useEffect } from "react";
import { useContactStore, ContactPayload } from "../stores/contactStore";

function ContactItem({
  contact,
  onDelete,
  onVerify,
}: {
  contact: ContactPayload;
  onDelete: (onion: string) => void;
  onVerify: (onion: string) => void;
}) {
  const displayName =
    contact.local_nickname || contact.onion_address.slice(0, 16) + "...";

  const truncatedOnion =
    contact.onion_address.length > 25
      ? contact.onion_address.slice(0, 10) + "..." +
        contact.onion_address.slice(-8)
      : contact.onion_address;

  return (
    <div className="contact-item">
      <div className="contact-item-avatar">
        <div className="avatar-placeholder">
          {(contact.local_nickname || "?")[0].toUpperCase()}
        </div>
      </div>

      <div className="contact-item-body">
        <div className="contact-item-name">{displayName}</div>
        <div className="contact-item-onion">{truncatedOnion}</div>
      </div>

      <div className="contact-item-actions">
        {contact.safety_verified ? (
          <span className="badge-verified" title="Safety verified">
            &#10003;
          </span>
        ) : (
          <button
            className="badge-unverified"
            onClick={() => onVerify(contact.onion_address)}
            title="Not yet verified — click to verify"
          >
            &#9888;
          </button>
        )}
        <button
          className="btn-delete-icon"
          onClick={() => onDelete(contact.onion_address)}
          title="Delete contact"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

export function ContactList() {
  const { contacts, fetchContacts, deleteContact, verifyContact, setView } =
    useContactStore();

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleDelete = async (onion: string) => {
    if (window.confirm("Delete this contact?")) {
      await deleteContact(onion);
    }
  };

  const handleVerify = async (onion: string) => {
    const nickname = prompt("Has this contact been verified? Enter their nickname to confirm:");
    if (nickname !== null) {
      await verifyContact(onion);
    }
  };

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
              key={c.onion_address}
              contact={c}
              onDelete={handleDelete}
              onVerify={handleVerify}
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
}
