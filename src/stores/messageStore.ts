import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Message {
  id: string;
  contactOnion: string;
  content: string;
  senderOnion: string;
  timestamp: number;
  isOutgoing: boolean;
  status: "sent" | "delivered" | "failed";
}

export interface Conversation {
  contactOnion: string;
  lastMessage: string;
  lastTimestamp: number;
  unread: number;
}

const STORAGE_KEY = "anon-chat-messages";
const UNREAD_KEY = "anon-chat-unread";

function loadFromStorage(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(messages: Message[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function loadUnread(): Record<string, number> {
  try {
    const raw = localStorage.getItem(UNREAD_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveUnread(unread: Record<string, number>) {
  localStorage.setItem(UNREAD_KEY, JSON.stringify(unread));
}

function generateId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

interface MessageStore {
  messages: Message[];
  unreadCounts: Record<string, number>;
  selectedContact: string | null;

  loadMessages: () => void;
  sendMessage: (contactOnion: string, content: string, myOnion: string) => Promise<void>;
  getConversations: (myOnion: string) => Conversation[];
  getConversation: (contactOnion: string) => Message[];
  markConversationRead: (contactOnion: string) => void;
  setSelectedContact: (onion: string | null) => void;
  addIncomingMessage: (msg: Message) => void;
}

let bc: BroadcastChannel | null = null;
try {
  bc = new BroadcastChannel("anon-chat-messages");
} catch {
  // BroadcastChannel not available
}

export const useMessageStore = create<MessageStore>((set, get) => {
  // Listen for messages from other tabs
  if (bc) {
    bc.onmessage = (event) => {
      const data = event.data;
      if (data.type === "message") {
        const msg: Message = {
          id: data.id,
          contactOnion: data.contactOnion,
          content: data.content,
          senderOnion: data.senderOnion,
          timestamp: data.timestamp,
          isOutgoing: false,
          status: "delivered",
        };
        const state = get();
        const exists = state.messages.some((m) => m.id === msg.id);
        if (!exists) {
          const newMessages = [...state.messages, msg];
          saveToStorage(newMessages);
          const unread = { ...state.unreadCounts };
          unread[msg.contactOnion] = (unread[msg.contactOnion] || 0) + 1;
          saveUnread(unread);
          set({ messages: newMessages, unreadCounts: unread });
        }
      }
    };
  }

  // Listen for storage events from other tabs (fallback)
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        const incoming = JSON.parse(event.newValue) as Message[];
        const state = get();
        if (incoming.length > state.messages.length) {
          set({ messages: incoming });
        }
      } catch {
        // ignore
      }
    }
    if (event.key === UNREAD_KEY && event.newValue) {
      try {
        set({ unreadCounts: JSON.parse(event.newValue) });
      } catch {
        // ignore
      }
    }
  });

  return {
    messages: loadFromStorage(),
    unreadCounts: loadUnread(),
    selectedContact: null,

    loadMessages: () => {
      set({ messages: loadFromStorage(), unreadCounts: loadUnread() });
    },

    sendMessage: async (contactOnion, content, myOnion) => {
      const msg: Message = {
        id: generateId(),
        contactOnion,
        content,
        senderOnion: myOnion,
        timestamp: Date.now(),
        isOutgoing: true,
        status: "sent",
      };

      const state = get();
      const newMessages = [...state.messages, msg];
      saveToStorage(newMessages);
      set({ messages: newMessages });

      try {
        await invoke("send_message", {
          contactOnion,
          content,
        });
        const updated = get().messages.map((m) =>
          m.id === msg.id ? { ...m, status: "delivered" as const } : m,
        );
        saveToStorage(updated);
        set({ messages: updated });
      } catch {
        const failed = get().messages.map((m) =>
          m.id === msg.id ? { ...m, status: "failed" as const } : m,
        );
        saveToStorage(failed);
        set({ messages: failed });
      }

      if (bc) {
        bc.postMessage({
          type: "message",
          id: msg.id,
          contactOnion,
          content,
          senderOnion: myOnion,
          timestamp: msg.timestamp,
        });
      }
    },

    getConversations: (myOnion) => {
      const state = get();
      const grouped: Record<string, Message[]> = {};
      for (const msg of state.messages) {
        if (!grouped[msg.contactOnion]) grouped[msg.contactOnion] = [];
        grouped[msg.contactOnion].push(msg);
      }
      return Object.entries(grouped).map(([onion, msgs]) => {
        const sorted = msgs.sort((a, b) => b.timestamp - a.timestamp);
        return {
          contactOnion: onion,
          lastMessage: sorted[0].content,
          lastTimestamp: sorted[0].timestamp,
          unread: state.unreadCounts[onion] || 0,
        };
      }).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    },

    getConversation: (contactOnion) => {
      return get()
        .messages.filter((m) => m.contactOnion === contactOnion)
        .sort((a, b) => a.timestamp - b.timestamp);
    },

    markConversationRead: (contactOnion) => {
      const unread = { ...get().unreadCounts, [contactOnion]: 0 };
      saveUnread(unread);
      set({ unreadCounts: unread });
    },

    setSelectedContact: (onion) => set({ selectedContact: onion }),

    addIncomingMessage: (msg) => {
      const state = get();
      const exists = state.messages.some((m) => m.id === msg.id);
      if (!exists) {
        const newMessages = [...state.messages, msg];
        saveToStorage(newMessages);
        const unread = { ...state.unreadCounts };
        unread[msg.contactOnion] = (unread[msg.contactOnion] || 0) + 1;
        saveUnread(unread);
        set({ messages: newMessages, unreadCounts: unread });
      }
    },
  };
});
