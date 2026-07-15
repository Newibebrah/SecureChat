import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useIdentityStore } from "../stores/identityStore";
import { useTorStore } from "../stores/torStore";
import { useContactStore, View } from "../stores/contactStore";
import { useMessageStore } from "../stores/messageStore";
import { ContactList } from "./ContactList";
import { AddContact } from "./AddContact";
import { SafetyVerification } from "./SafetyVerification";
import { ProfileScreen } from "./ProfileScreen";
import { ChatView } from "./ChatView";

const navItems: { id: View; label: string }[] = [
  { id: "chats", label: "Chats" },
  { id: "contacts", label: "Contacts" },
  { id: "profile", label: "Profile" },
];

function Sidebar() {
  const { identity } = useIdentityStore();
  const { status } = useTorStore();
  const { currentView, setView, contacts } = useContactStore();
  const { getConversations } = useMessageStore();
  const totalUnread = identity
    ? getConversations(identity.onion_address).reduce(
        (sum, c) => sum + c.unread,
        0,
      )
    : 0;

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
            {item.id === "chats" && totalUnread > 0 && (
              <span className="nav-badge unread-badge">{totalUnread}</span>
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

function ConversationsList() {
  const { identity } = useIdentityStore();
  const { contacts, openChat } = useContactStore();
  const { getConversations, markConversationRead, loadMessages } =
    useMessageStore();

  useEffect(() => {
    loadMessages();
  }, []);

  if (!identity) return null;

  const conversations = getConversations(identity.onion_address);

  const getContactName = (onion: string) => {
    const c = contacts.find((c) => c.onion_address === onion);
    return c?.local_nickname || onion.slice(0, 16) + "...";
  };

  const getContact = (onion: string) => {
    return contacts.find((c) => c.onion_address === onion) || null;
  };

  if (conversations.length === 0) {
    return (
      <div className="chat-list-empty">
        <div className="welcome-placeholder">
          <h2>Welcome to Anon-Chat</h2>
          <p>
            No conversations yet. Add contacts via the Contacts tab to start
            chatting.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conv) => {
        const contact = getContact(conv.contactOnion);
        return (
          <button
            key={conv.contactOnion}
            className="conversation-item"
            onClick={() => {
              markConversationRead(conv.contactOnion);
              if (contact) openChat(contact);
            }}
          >
            <div className="conversation-avatar">
              {getContactName(conv.contactOnion)[0].toUpperCase()}
            </div>
            <div className="conversation-body">
              <div className="conversation-top">
                <span className="conversation-name">
                  {getContactName(conv.contactOnion)}
                </span>
                <span className="conversation-time">
                  {new Date(conv.lastTimestamp).toLocaleDateString([], {
                    weekday: conv.lastTimestamp > Date.now() - 86400000 * 2 ? "short" : undefined,
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              <div className="conversation-bottom">
                <span className="conversation-preview">{conv.lastMessage}</span>
                {conv.unread > 0 && (
                  <span className="unread-dot">{conv.unread}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MainContent() {
  const { currentView, chatContact, setView } = useContactStore();

  switch (currentView) {
    case "add-contact":
      return <AddContact />;
    case "verify-contact":
      return <SafetyVerification />;
    case "profile":
      return <ProfileScreen />;
    case "contacts":
      return <ContactList />;
    case "chat":
      return chatContact ? (
        <ChatView contact={chatContact} onBack={() => setView("chats")} />
      ) : (
        <ConversationsList />
      );
    case "chats":
    default:
      return <ConversationsList />;
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
