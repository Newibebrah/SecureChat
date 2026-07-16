import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface ContactPayload {
  id: number;
  onionAddress: string;
  publicKeyHex: string;
  x25519PublicHex: string;
  localNickname: string;
  safetyVerified: boolean;
  createdAt: string;
  safetyNumber: string;
}

export type View = "chats" | "contacts" | "add-contact" | "profile" | "verify-contact" | "chat";

interface ContactStore {
  contacts: ContactPayload[];
  currentView: View;
  pendingContact: ContactPayload | null;
  chatContact: ContactPayload | null;
  loading: boolean;
  error: string | null;

  setView: (view: View) => void;
  fetchContacts: () => Promise<void>;
  addContact: (onion: string, pubkeyB64: string, nickname: string, x25519Hex?: string) => Promise<ContactPayload>;
  deleteContact: (onion: string) => Promise<void>;
  verifyContact: (onion: string) => Promise<void>;
  updateNickname: (onion: string, nickname: string) => Promise<void>;
  resolveQr: (qrData: string) => Promise<ContactPayload>;
  setPendingContact: (c: ContactPayload | null) => void;
  openChat: (contact: ContactPayload) => void;
  clearError: () => void;
}

export const useContactStore = create<ContactStore>((set, get) => ({
  contacts: [],
  currentView: "chats",
  pendingContact: null,
  chatContact: null,
  loading: false,
  error: null,

  setView: (view) => set({ currentView: view }),

  fetchContacts: async () => {
    set({ loading: true });
    try {
      const contacts = await invoke<ContactPayload[]>("list_contacts");
      set({ contacts, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  addContact: async (onion, pubkeyB64, nickname, x25519Hex?: string) => {
    const contact = await invoke<ContactPayload>("add_contact", {
      onionAddress: onion,
      publicKeyB64: pubkeyB64,
      x25519Hex: x25519Hex || "",
      localNickname: nickname,
    });
    await get().fetchContacts();
    return contact;
  },

  deleteContact: async (onion) => {
    await invoke("delete_contact", { onionAddress: onion });
    set((s) => ({
      contacts: s.contacts.filter((c) => c.onionAddress !== onion),
    }));
  },

  verifyContact: async (onion) => {
    const updated = await invoke<ContactPayload>("verify_contact", {
      onionAddress: onion,
    });
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.onionAddress === onion ? updated : c,
      ),
    }));
  },

  updateNickname: async (onion, nickname) => {
    const updated = await invoke<ContactPayload>("update_nickname", {
      onionAddress: onion,
      localNickname: nickname,
    });
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.onionAddress === onion ? updated : c,
      ),
    }));
  },

  resolveQr: async (qrData) => {
    return await invoke<ContactPayload>("resolve_contact_qr", { qrData });
  },

  setPendingContact: (c) => set({ pendingContact: c }),
  openChat: (contact) => set({ chatContact: contact, currentView: "chat" }),
  clearError: () => set({ error: null }),
}));
