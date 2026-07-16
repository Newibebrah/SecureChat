interface IdentityPayload {
  onionAddress: string;
  publicKey: string;
  fingerprint: string;
}

interface StoredContact {
  id: number;
  onionAddress: string;
  publicKeyHex: string;
  x25519PublicHex: string;
  localNickname: string;
  safetyVerified: boolean;
  createdAt: string;
  safetyNumber: string;
}

interface MessagePayload {
  id: number;
  contactOnion: string;
  content: string;
  senderOnion: string;
  timestamp: number;
  isOutgoing: boolean;
  status: string;
}

interface ConversationPayload {
  contactOnion: string;
  lastMessage: string;
  lastTimestamp: number;
  unread: number;
}

let activeIdentity: IdentityPayload | null = null;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomBase32(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz234567";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => chars[b % 32])
    .join("");
}

async function computeFingerprint(pubkeyHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(pubkeyHex));
  const first8 = new Uint8Array(hashBuffer).slice(0, 8);
  const hex = Array.from(first8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.replace(/(.{4})/g, "$1 ").trim().toUpperCase();
}

export function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return btoa(Array.from(bytes).map((b) => String.fromCharCode(b)).join(""));
}

function base64ToHex(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateIdentity(): IdentityPayload {
  const pubkeyHex = randomHex(32);
  const onionAddr = randomBase32(56) + ".onion";
  return {
    onionAddress: onionAddr,
    publicKey: pubkeyHex,
    fingerprint: "ABCD EFGH IJKL MNOP",
  };
}

async function finalizeIdentity(identity: IdentityPayload): Promise<IdentityPayload> {
  identity.fingerprint = await computeFingerprint(identity.publicKey);
  return identity;
}

function getStoredIdentity(): IdentityPayload | null {
  try {
    const data = localStorage.getItem("anon-chat-identity");
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function setStoredIdentity(identity: IdentityPayload) {
  localStorage.setItem("anon-chat-identity", JSON.stringify(identity));
}

function getStoredPasswordHash(): string | null {
  return localStorage.getItem("anon-chat-password-hash");
}

function setStoredPasswordHash(hash: string) {
  localStorage.setItem("anon-chat-password-hash", hash);
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getContacts(): StoredContact[] {
  try {
    const data = localStorage.getItem("anon-chat-contacts");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveContacts(contacts: StoredContact[]) {
  localStorage.setItem("anon-chat-contacts", JSON.stringify(contacts));
}

async function computeSafetyNumber(pubkeyHex: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(pubkeyHex));
  const first8 = new Uint8Array(hashBuffer).slice(0, 8);
  const hex = Array.from(first8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.replace(/(.{4})/g, "$1 ").trim().toUpperCase();
}

const MESSAGE_STORAGE_KEY = "anon-chat-messages";

function getMessages(): MessagePayload[] {
  try {
    const data = localStorage.getItem(MESSAGE_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: MessagePayload[]) {
  localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(msgs));
}

function generateId(): number {
  return Date.now() + Math.floor(Math.random() * 10000);
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  console.debug(`[Tauri Web] invoke("${cmd}")`, args);

  switch (cmd) {
    case "database_exists":
      return (getStoredIdentity() !== null) as T;

    case "get_active_identity":
      return activeIdentity as T;

    case "create_identity": {
      const password = args?.password as string;
      if (!password) throw new Error("Password required");
      const hash = await hashPassword(password);
      setStoredPasswordHash(hash);
      const identity = await finalizeIdentity(generateIdentity());
      setStoredIdentity(identity);
      activeIdentity = identity;
      return identity as T;
    }

    case "unlock_identity": {
      const password = args?.password as string;
      const storedHash = getStoredPasswordHash();
      if (!storedHash) throw new Error("No identity found");
      const hash = await hashPassword(password);
      if (hash !== storedHash) throw new Error("Invalid password");
      const identity = getStoredIdentity();
      if (!identity) throw new Error("No identity data");
      activeIdentity = identity;
      return identity as T;
    }

    case "get_tor_status":
      return { status: "ready", progress: 1.0, message: "Connected (web demo)" } as T;

    case "generate_own_qr_code": {
      if (!activeIdentity) throw new Error("No identity loaded");
      const pubkeyB64 = hexToBase64(activeIdentity.publicKey);
      return JSON.stringify({
        onion: activeIdentity.onionAddress,
        pubkey: pubkeyB64,
        x25519: pubkeyB64,
      }) as T;
    }

    case "list_contacts":
      return getContacts() as T;

    case "add_contact": {
      const onionAddress = args?.onionAddress as string;
      const publicKeyB64 = args?.publicKeyB64 as string;
      const x25519Hex = (args?.x25519Hex as string) || "";
      const localNickname = args?.localNickname as string;
      if (!onionAddress || !publicKeyB64)
        throw new Error("onionAddress and publicKeyB64 are required");
      const publicKeyHex = base64ToHex(publicKeyB64);
      const safetyNumber = await computeSafetyNumber(publicKeyHex);
      const contacts = getContacts();
      if (contacts.some((c) => c.onionAddress === onionAddress))
        throw new Error("Contact already exists");
      const contact: StoredContact = {
        id: Date.now(),
        onionAddress: onionAddress,
        publicKeyHex: publicKeyHex,
        x25519PublicHex: x25519Hex,
        localNickname: localNickname || "",
        safetyVerified: false,
        createdAt: new Date().toISOString(),
        safetyNumber: safetyNumber,
      };
      contacts.push(contact);
      saveContacts(contacts);
      return contact as T;
    }

    case "delete_contact": {
      const onionAddress = args?.onionAddress as string;
      const contacts = getContacts().filter((c) => c.onionAddress !== onionAddress);
      saveContacts(contacts);
      return undefined as T;
    }

    case "verify_contact": {
      const onionAddress = args?.onionAddress as string;
      const contacts = getContacts();
      const idx = contacts.findIndex((c) => c.onionAddress === onionAddress);
      if (idx === -1) throw new Error("Contact not found");
      contacts[idx] = { ...contacts[idx], safetyVerified: true };
      saveContacts(contacts);
      return contacts[idx] as T;
    }

    case "update_nickname": {
      const onionAddress = args?.onionAddress as string;
      const localNickname = args?.localNickname as string;
      const contacts = getContacts();
      const idx = contacts.findIndex((c) => c.onionAddress === onionAddress);
      if (idx === -1) throw new Error("Contact not found");
      contacts[idx] = { ...contacts[idx], localNickname: localNickname };
      saveContacts(contacts);
      return contacts[idx] as T;
    }

    case "resolve_contact_qr": {
      const qrData = args?.qrData as string;
      try {
        const parsed = JSON.parse(qrData);
        const onionAddress = parsed.onion as string;
        const pubkeyB64 = parsed.pubkey as string;
        const x25519B64 = parsed.x25519 as string;
        if (!onionAddress || !pubkeyB64)
          throw new Error("Missing 'onion' or 'pubkey' in QR data");
        const publicKeyHex = base64ToHex(pubkeyB64);
        const x25519Hex = x25519B64 ? base64ToHex(x25519B64) : "";
        const safetyNumber = await computeSafetyNumber(publicKeyHex);
        return {
          id: Date.now(),
          onionAddress: onionAddress,
          publicKeyHex: publicKeyHex,
          x25519PublicHex: x25519Hex,
          localNickname: "",
          safetyVerified: false,
          createdAt: new Date().toISOString(),
          safetyNumber: safetyNumber,
        } as T;
      } catch {
        const hasOnion = qrData.includes(".onion");
        throw new Error(
          hasOnion
            ? "This QR only contains an Onion address. Please share your Profile QR code instead (contains public key for secure addition)."
            : "Invalid QR data. Expected JSON with 'onion' and 'pubkey' fields.",
        );
      }
    }

    case "send_message": {
      const contactOnion = args?.contactOnion as string;
      const content = args?.content as string;
      if (!activeIdentity) throw new Error("No identity loaded");
      const msg: MessagePayload = {
        id: generateId(),
        contactOnion: contactOnion,
        content,
        senderOnion: activeIdentity.onionAddress,
        timestamp: Date.now(),
        isOutgoing: true,
        status: "sent",
      };
      const msgs = getMessages();
      msgs.push(msg);
      saveMessages(msgs);

      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: contactOnion,
            from: activeIdentity.onionAddress,
            content,
            timestamp: msg.timestamp,
          }),
        });
        if (res.ok) {
          msg.status = "delivered";
          const updated = getMessages().map((m) =>
            m.id === msg.id ? { ...m, status: "delivered" } : m,
          );
          saveMessages(updated);
        }
      } catch {
        msg.status = "failed";
        const updated = getMessages().map((m) =>
          m.id === msg.id ? { ...m, status: "failed" } : m,
        );
        saveMessages(updated);
      }
      return msg as T;
    }

    case "get_conversation": {
      const contactOnion = args?.contactOnion as string;
      const limit = (args?.limit as number) || 50;
      const beforeId = args?.beforeId as number | undefined;
      let msgs = getMessages().filter((m) => m.contactOnion === contactOnion);
      if (beforeId) msgs = msgs.filter((m) => m.id < beforeId);
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      return msgs.slice(-limit) as T;
    }

    case "get_recent_messages": {
      const contactOnion = args?.contactOnion as string;
      const afterTs = (args?.afterTimestamp as number) || 0;
      const msgs = getMessages()
        .filter((m) => m.contactOnion === contactOnion && m.timestamp > afterTs)
        .sort((a, b) => a.timestamp - b.timestamp);
      return msgs as T;
    }

    case "get_conversations": {
      const msgs = getMessages();
      const grouped: Record<string, MessagePayload[]> = {};
      for (const msg of msgs) {
        if (!grouped[msg.contactOnion]) grouped[msg.contactOnion] = [];
        grouped[msg.contactOnion].push(msg);
      }
      const convs: ConversationPayload[] = Object.entries(grouped).map(([onion, convMsgs]) => {
        convMsgs.sort((a, b) => b.timestamp - a.timestamp);
        return {
          contactOnion: onion,
          lastMessage: convMsgs[0].content,
          lastTimestamp: convMsgs[0].timestamp,
          unread: 0,
        };
      });
      convs.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
      return convs as T;
    }

    case "mark_conversation_read":
      return undefined as T;

    case "decrypt_message_content": {
      return args?.encryptedB64 as T;
    }

    case "import_encrypted_messages":
      return 0 as T;

    case "lock_identity":
      activeIdentity = null;
      return undefined as T;

    case "stop_session_timer":
      return undefined as T;

    default:
      console.warn(`[Tauri Web] Unhandled invoke: "${cmd}"`);
      throw new Error(`Tauri backend not available in web mode. Command: ${cmd}`);
  }
}
