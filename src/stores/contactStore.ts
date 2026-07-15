import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface ContactPayload {
  id: number;
  onion_address: string;
  public_key_hex: string;
  local_nickname: string;
  safety_verified: boolean;
  created_at: string;
  safety_number: string;
}

export type View = "chats" | "contacts" | "add-contact" | "profile" | "verify-contact" | "chat";

interface ContactStore {
  contacts: ContactPayload[];
  currentView: View;
  pendingContact: ContactPayload | null; // for verification flow
  chatContact: ContactPayload | null;
  loading: boolean;
  error: string | null;

  setView: (view: View) => void;
  fetchContacts: () => Promise<void>;
  addContact: (onion: string, pubkeyB64: string, nickname: string) => Promise<ContactPayload>;
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

  addContact: async (onion, pubkeyB64, nickname) => {
    const contact = await invoke<ContactPayload>("add_contact", {
      onionAddress: onion,
      publicKeyB64: pubkeyB64,
      localNickname: nickname,
    });
    // Refresh list
    get().fetchContacts();
    return contact;
  },

  deleteContact: async (onion) => {
    await invoke("delete_contact", { onionAddress: onion });
    get().fetchContacts();
  },

  verifyContact: async (onion) => {
    const updated = await invoke<ContactPayload>("verify_contact", {
      onionAddress: onion,
    });
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.onion_address === onion ? updated : c,
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
        c.onion_address === onion ? updated : c,
      ),
    }));
  },

  resolveQr: async (qrData) => {
    const contact = await invoke<ContactPayload>("resolve_contact_qr", {
      qrData,
    });
    return contact;
  },

  setPendingContact: (c) => set({ pendingContact: c }),
  openChat: (contact) => set({ chatContact: contact, currentView: "chat" }),
  clearError: () => set({ error: null }),
}));
