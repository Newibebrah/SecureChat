import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface IdentityPayload {
  onion_address: string;
  public_key: string;
  fingerprint: string;
}

export type AppState = "uninitialized" | "locked" | "ready";

interface IdentityStore {
  appState: AppState;
  identity: IdentityPayload | null;
  error: string | null;
  loading: boolean;

  checkDatabase: () => Promise<void>;
  createIdentity: (password: string) => Promise<void>;
  unlockIdentity: (password: string) => Promise<void>;
  loadActiveIdentity: () => Promise<void>;
  clearError: () => void;
}

export const useIdentityStore = create<IdentityStore>((set) => ({
  appState: "uninitialized",
  identity: null,
  error: null,
  loading: false,

  checkDatabase: async () => {
    try {
      const exists = await invoke<boolean>("database_exists");
      if (exists) {
        // Try to load the already-active identity
        const active = await invoke<IdentityPayload | null>(
          "get_active_identity",
        );
        if (active) {
          set({ appState: "ready", identity: active });
        } else {
          set({ appState: "locked" });
        }
      } else {
        set({ appState: "uninitialized" });
      }
    } catch (err) {
      set({ error: String(err) });
    }
  },

  createIdentity: async (password: string) => {
    set({ loading: true, error: null });
    try {
      const identity = await invoke<IdentityPayload>("create_identity", {
        password,
      });
      set({
        identity,
        appState: "ready",
        loading: false,
      });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  unlockIdentity: async (password: string) => {
    set({ loading: true, error: null });
    try {
      const identity = await invoke<IdentityPayload>("unlock_identity", {
        password,
      });
      set({
        identity,
        appState: "ready",
        loading: false,
      });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  loadActiveIdentity: async () => {
    try {
      const active = await invoke<IdentityPayload | null>(
        "get_active_identity",
      );
      if (active) {
        set({ identity: active, appState: "ready" });
      }
    } catch {
      // ignore
    }
  },

  clearError: () => set({ error: null }),
}));
