import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface TorStatusPayload {
  status: "offline" | "bootstrapping" | "ready" | "error";
  progress: number;
  message: string;
}

interface TorStore {
  status: TorStatusPayload;
  loading: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
  updateFromEvent: (payload: TorStatusPayload) => void;
}

export const useTorStore = create<TorStore>((set) => ({
  status: {
    status: "offline",
    progress: 0.0,
    message: "Starting...",
  },
  loading: false,
  error: null,

  fetchStatus: async () => {
    set({ loading: true, error: null });
    try {
      const payload = await invoke<TorStatusPayload>("get_tor_status");
      set({ status: payload, loading: false });
    } catch (err) {
      set({
        error: String(err),
        loading: false,
        status: {
          status: "error",
          progress: 0.0,
          message: String(err),
        },
      });
    }
  },

  updateFromEvent: (payload: TorStatusPayload) => {
    set({ status: payload, error: null });
  },
}));

let listenerInitialized = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

export function initTorEventListener() {
  if (listenerInitialized) return;
  listenerInitialized = true;

  listen<TorStatusPayload>("tor-status", (event) => {
    useTorStore.getState().updateFromEvent(event.payload);
  }).catch((err) => {
    console.error("Failed to listen for tor-status events:", err);
  });

  const fetchStatus = useTorStore.getState().fetchStatus;
  fetchStatus();
  pollInterval = setInterval(fetchStatus, 5000);
}

export function stopTorPolling() {
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
