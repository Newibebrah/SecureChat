import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useIdentityStore } from "../stores/identityStore";
import { useTorStore } from "../stores/torStore";
import { useContactStore, View } from "../stores/contactStore";
import { ContactList } from "./ContactList";
import { AddContact } from "./AddContact";
import { SafetyVerification } from "./SafetyVerification";
import { ProfileScreen } from "./ProfileScreen";

const navItems: { id: View; label: string }[] = [
  { id: "chats", label: "Chats" },
  { id: "contacts", label: "Contacts" },
  { id: "profile", label: "Profile" },
];

function Sidebar() {
  const { identity } = useIdentityStore();
  const { status } = useTorStore();
  const { currentView, setView, contacts } = useContactStore();

  const statusColor =
    status.status === "ready"
      ? "#22c55e"
      : status.status === "error"
        ? "#ef4444"
        : "#f59e0b";

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Anon-Chat</h1>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-nav-item ${currentView === item.id ? "active" : ""}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
            {item.id === "contacts" && contacts.length > 0 && (
              <span className="nav-badge">{contacts.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Identity card */}
      {identity && (
        <div className="sidebar-identity">
          <div className="sidebar-qr">
            <QRCodeSVG
              value={identity.onion_address}
              size={120}
              bgColor="#ffffff"
              fgColor="#1a1a24"
              level="M"
            />
          </div>
          <div className="sidebar-onion">
            <label>Your Onion</label>
            <code className="onion-small">{identity.onion_address}</code>
          </div>
          <div className="sidebar-fingerprint">
            <label>Safety Number</label>
            <code className="fp-small">{identity.fingerprint}</code>
          </div>
        </div>
      )}

      {/* Tor status */}
      <div className="sidebar-tor">
        <div className="tor-indicator-small">
          <span
            className="tor-dot-small"
            style={{ backgroundColor: statusColor }}
          />
          <span className="tor-label-small">{status.message}</span>
        </div>
      </div>
    </aside>
  );
}

function MainContent() {
  const { currentView } = useContactStore();

  switch (currentView) {
    case "add-contact":
      return <AddContact />;
    case "verify-contact":
      return <SafetyVerification />;
    case "profile":
      return <ProfileScreen />;
    case "contacts":
      return <ContactList />;
    case "chats":
    default:
      return (
        <div className="welcome-placeholder">
          <h2>Welcome to Anon-Chat</h2>
          <p>
            No conversations yet. Add contacts via the Contacts tab to start
            chatting. Messaging will be available in a future phase.
          </p>
        </div>
      );
  }
}

export function Layout() {
  const { fetchContacts } = useContactStore();

  useEffect(() => {
    fetchContacts();
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <MainContent />
      </main>
    </div>
  );
}
