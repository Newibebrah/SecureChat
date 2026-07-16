import { useEffect, useState, lazy, Suspense, memo, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useIdentityStore } from "../stores/identityStore";
import { useTorStore } from "../stores/torStore";
import { useContactStore, View, ContactPayload } from "../stores/contactStore";
import { useMessageStore } from "../stores/messageStore";
import { hexToBase64 } from "../lib/tauri-core";
import { initTorEventListener } from "../stores/torStore";

const ContactList = lazy(() =>
  import("./ContactList").then((m) => ({ default: m.ContactList })),
);
const AddContact = lazy(() =>
  import("./AddContact").then((m) => ({ default: m.AddContact })),
);
const SafetyVerification = lazy(() =>
  import("./SafetyVerification").then((m) => ({ default: m.SafetyVerification })),
);
const ProfileScreen = lazy(() =>
  import("./ProfileScreen").then((m) => ({ default: m.ProfileScreen })),
);
const ChatView = lazy(() =>
  import("./ChatView").then((m) => ({ default: m.ChatView })),
);

const navItems: { id: View; label: string }[] = [
  { id: "chats", label: "Chats" },
  { id: "contacts", label: "Contacts" },
  { id: "profile", label: "Profile" },
];

const Sidebar = memo(function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const identity = useIdentityStore((s) => s.identity);
  const status = useTorStore((s) => s.status);
  const currentView = useContactStore((s) => s.currentView);
  const setView = useContactStore((s) => s.setView);
  const setAppState = useIdentityStore((s) => s.setAppState);
  const contacts = useContactStore((s) => s.contacts);
  const conversations = useMessageStore((s) => s.conversations);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

  const statusColor =
    status.status === "ready"
      ? "#22c55e"
      : status.status === "error"
        ? "#ef4444"
        : "#f59e0b";

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      <div className="sidebar-header">
        <h1 className="sidebar-title">Anon-Chat</h1>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-nav-item ${currentView === item.id ? "active" : ""}`}
            onClick={() => { setView(item.id); onClose(); }}
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

      {identity && (
        <div className="sidebar-identity">
          <div className="sidebar-qr">
            <QRCodeSVG
              value={JSON.stringify({
                onion: identity.onionAddress,
                pubkey: hexToBase64(identity.publicKey),
              })}
              size={120}
              bgColor="#ffffff"
              fgColor="#1a1a24"
              level="M"
            />
          </div>
          <div className="sidebar-onion">
            <label>Your Onion</label>
            <code className="onion-small">{identity.onionAddress}</code>
          </div>
          <div className="sidebar-fingerprint">
            <label>Safety Number</label>
            <code className="fp-small">{identity.fingerprint}</code>
          </div>
        </div>
      )}

      <div className="sidebar-tor">
        <div className="tor-indicator-small">
          <span
            className="tor-dot-small"
            style={{ backgroundColor: statusColor }}
          />
          <span className="tor-label-small">{status.message}</span>
        </div>
      </div>

      <div className="sidebar-lock">
        <button
          className="sidebar-nav-item lock-button"
          onClick={async () => {
            try {
              await invoke("lock_identity");
              setAppState("locked");
            } catch {
              //
            }
            onClose();
          }}
        >
          Lock Session
        </button>
      </div>
    </aside>
  );
});

const ConversationsList = memo(function ConversationsList() {
  const identity = useIdentityStore((s) => s.identity);
  const contacts = useContactStore((s) => s.contacts);
  const openChat = useContactStore((s) => s.openChat);
  const markConversationRead = useMessageStore((s) => s.markConversationRead);
  const loadMessages = useMessageStore((s) => s.loadMessages);
  const conversations = useMessageStore((s) => s.conversations);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  if (!identity) return null;

  const getContactName = (onion: string) => {
    const c = contacts.find((ct) => ct.onionAddress === onion);
    return c?.localNickname || onion.slice(0, 16) + "...";
  };

  const getContact = (onion: string) => {
    return contacts.find((ct) => ct.onionAddress === onion) || null;
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
              if (contact) {
                openChat(contact);
              } else {
                const tmp: ContactPayload = {
                  id: 0,
                  onionAddress: conv.contactOnion,
                  publicKeyHex: "",
                  x25519PublicHex: "",
                  localNickname: conv.contactOnion.slice(0, 16) + "...",
                  safetyVerified: false,
                  createdAt: new Date().toISOString(),
                  safetyNumber: "",
                };
                openChat(tmp);
              }
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
                <span className="conversation-preview">
                  {conv.lastMessage.length > 80
                    ? conv.lastMessage.slice(0, 80) + "..."
                    : conv.lastMessage}
                </span>
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
});

function MainContent() {
  const currentView = useContactStore((s) => s.currentView);
  const chatContact = useContactStore((s) => s.chatContact);
  const setView = useContactStore((s) => s.setView);

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

export const Layout = memo(function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const appState = useIdentityStore((s) => s.appState);
  const setAppState = useIdentityStore((s) => s.setAppState);
  const fetchContacts = useContactStore((s) => s.fetchContacts);
  const identity = useIdentityStore((s) => s.identity);
  const startPolling = useMessageStore((s) => s.startPolling);
  const stopPolling = useMessageStore((s) => s.stopPolling);

  // Reset session inactivity timer on any user interaction
  const resetSession = useCallback(() => {
    invoke("stop_session_timer").catch(() => {});
  }, []);

  useEffect(() => {
    initTorEventListener();
    fetchContacts();
    resetSession();

    // Listen for auto-lock events from backend
    const unlisten = listen<void>("session-locked", () => {
      setAppState("locked");
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [fetchContacts, resetSession, setAppState]);

  useEffect(() => {
    if (identity) {
      startPolling(identity.onionAddress);
      return () => stopPolling();
    }
  }, [identity?.onionAddress, startPolling, stopPolling]);

  // If session was locked, redirect to unlock
  useEffect(() => {
    if (appState === "locked") {
      stopPolling();
    }
  }, [appState, stopPolling]);

  const toggleSidebar = useCallback(() => {
    resetSession();
    setSidebarOpen((v) => !v);
  }, [resetSession]);

  const closeSidebar = useCallback(() => {
    resetSession();
    setSidebarOpen(false);
  }, [resetSession]);

  return (
    <div className="app-layout">
      <button
        className="hamburger"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "Close menu" : "Open menu"}
      >
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>
      <div
        className={`sidebar-overlay ${sidebarOpen ? "visible" : ""}`}
        onClick={closeSidebar}
      />
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />
      <main className="main-content">
        <Suspense
          fallback={
            <div className="loading-screen">
              <div className="spinner" />
            </div>
          }
        >
          <MainContent />
        </Suspense>
      </main>
    </div>
  );
});
