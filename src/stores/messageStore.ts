import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useContactStore } from "./contactStore";

export interface Message {
  id: number;
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

interface IncomingPayload {
  id: number;
  contactOnion: string;
  content: string;
  senderOnion: string;
  timestamp: number;
  isOutgoing: boolean;
  status: string;
}

interface MessageStore {
  messages: Message[];
  conversations: Conversation[];
  loading: boolean;
  error: string | null;

  loadMessages: () => Promise<void>;
  sendMessage: (contactOnion: string, content: string, myOnion: string) => Promise<void>;
  getConversations: (myOnion: string) => Conversation[];
  getConversation: (contactOnion: string) => Message[];
  markConversationRead: (contactOnion: string) => Promise<void>;
  decryptContent: (contactOnion: string, encryptedContent: string) => Promise<string>;
  startPolling: (myOnion: string) => void;
  stopPolling: () => void;
}

const POLL_INTERVAL = 3000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPollTimestamps: Record<string, number> = {};
let decryptCache = new Map<string, string>();
let eventListenerActive = false;

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: [],
  conversations: [],
  loading: false,
  error: null,

  loadMessages: async () => {
    set({ loading: true });
    try {
      const convs = await invoke<Conversation[]>("get_conversations");
      const allMessages: Message[] = [];
      for (const conv of convs) {
        const msgs = await invoke<Message[]>("get_conversation", {
          contactOnion: conv.contactOnion,
          limit: 50,
        });
        allMessages.push(...msgs);
      }
      set({ messages: allMessages, conversations: convs, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  sendMessage: async (contactOnion, content, myOnion) => {
    try {
      await invoke<Message>("send_message", { contactOnion, content });
      await get().loadMessages();
    } catch (err) {
      const mockId = Date.now();
      const failedMsg: Message = {
        id: mockId,
        contactOnion,
        content,
        senderOnion: myOnion,
        timestamp: Date.now(),
        isOutgoing: true,
        status: "failed",
      };
      set((s) => ({ messages: [...s.messages, failedMsg] }));
      set({ error: String(err) });
    }
  },

  getConversations: (_myOnion) => {
    return get().conversations;
  },

  getConversation: (contactOnion) => {
    return get()
      .messages.filter((m) => m.contactOnion === contactOnion)
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  markConversationRead: async (contactOnion) => {
    try {
      await invoke("mark_conversation_read", { contactOnion });
    } catch {
      // ignore
    }
  },

  decryptContent: async (contactOnion, encryptedContent) => {
    const cacheKey = `${contactOnion}:${encryptedContent.slice(0, 32)}`;
    const cached = decryptCache.get(cacheKey);
    if (cached) return cached;

    try {
      const contact = useContactStore.getState().contacts.find(
        (c) => c.onionAddress === contactOnion,
      );
      if (!contact) return encryptedContent;

      const plaintext = await invoke<string>("decrypt_message_content", {
        encryptedB64: encryptedContent,
        senderOnion: contactOnion,
      });
      decryptCache.set(cacheKey, plaintext);
      if (decryptCache.size > 500) {
        const firstKey = decryptCache.keys().next().value;
        if (firstKey) decryptCache.delete(firstKey);
      }
      return plaintext;
    } catch {
      return encryptedContent;
    }
  },

  startPolling: (_myOnion) => {
    get().stopPolling();
    get().loadMessages();

    if (!eventListenerActive) {
      eventListenerActive = true;
      listen<IncomingPayload>("new-message", (event) => {
        const msg = event.payload;
        const state = get();
        const existing = state.messages.find((m) => m.id === msg.id);
        if (existing) return;

        const newMsg: Message = {
          id: msg.id,
          contactOnion: msg.contactOnion,
          content: msg.content,
          senderOnion: msg.senderOnion,
          timestamp: msg.timestamp,
          isOutgoing: msg.isOutgoing,
          status: msg.status as Message["status"],
        };
        set({
          messages: [...state.messages, newMsg],
        });
      }).catch((err) => {
        console.error("Failed to listen for new-message events:", err);
      });
    }

    pollTimer = setInterval(async () => {
      try {
        const convs = await invoke<Conversation[]>("get_conversations");
        const state = get();
        let hasNew = false;

        for (const conv of convs) {
          const lastTs = lastPollTimestamps[conv.contactOnion] || 0;
          if (conv.lastTimestamp <= lastTs) continue;

          const newMsgs = await invoke<Message[]>("get_recent_messages", {
            contactOnion: conv.contactOnion,
            afterTimestamp: lastTs,
          });

          if (newMsgs.length > 0) {
            hasNew = true;
            lastPollTimestamps[conv.contactOnion] = conv.lastTimestamp;
            for (const msg of newMsgs) {
              if (!msg.isOutgoing) {
                try {
                  const decoded = await invoke<string>("decrypt_message_content", {
                    encryptedB64: msg.content,
                    senderOnion: msg.contactOnion,
                  });
                  msg.content = decoded;
                } catch {
                  //
                }
              }
            }
            set({
              messages: [...state.messages, ...newMsgs],
              conversations: convs,
            });
          }
        }

        if (!hasNew) {
          set({ conversations: convs });
        }
      } catch {
        // silent poll failure
      }
    }, POLL_INTERVAL);
  },

  stopPolling: () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
