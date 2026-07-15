interface IdentityPayload {
  onion_address: string;
  public_key: string;
  fingerprint: string;
}

interface StoredContact {
  id: number;
  onion_address: string;
  public_key_hex: string;
  local_nickname: string;
  safety_verified: boolean;
  created_at: string;
  safety_number: string;
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
    onion_address: onionAddr,
    public_key: pubkeyHex,
    fingerprint: "ABCD EFGH IJKL MNOP",
  };
}

async function finalizeIdentity(identity: IdentityPayload): Promise<IdentityPayload> {
  identity.fingerprint = await computeFingerprint(identity.public_key);
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
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(password),
  );
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
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(pubkeyHex),
  );
  const first8 = new Uint8Array(hashBuffer).slice(0, 8);
  const hex = Array.from(first8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.replace(/(.{4})/g, "$1 ").trim().toUpperCase();
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  console.debug(`[Tauri Web] invoke("${cmd}")`, args);

  switch (cmd) {
    case "database_exists": {
      return (getStoredIdentity() !== null) as T;
    }

    case "get_active_identity": {
      return activeIdentity as T;
    }

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

    case "get_tor_status": {
      return {
        status: "ready",
        progress: 1.0,
        message: "Connected (web demo)",
      } as T;
    }

    case "generate_own_qr_code": {
      if (!activeIdentity) throw new Error("No identity loaded");
      return JSON.stringify({
        onion: activeIdentity.onion_address,
        pubkey: hexToBase64(activeIdentity.public_key),
      }) as T;
    }

    case "list_contacts": {
      return getContacts() as T;
    }

    case "add_contact": {
      const onionAddress = args?.onionAddress as string;
      const publicKeyB64 = args?.publicKeyB64 as string;
      const localNickname = args?.localNickname as string;
      if (!onionAddress || !publicKeyB64)
        throw new Error("onionAddress and publicKeyB64 are required");

      const publicKeyHex = base64ToHex(publicKeyB64);
      const safetyNumber = await computeSafetyNumber(publicKeyHex);
      const contacts = getContacts();

      if (contacts.some((c) => c.onion_address === onionAddress))
        throw new Error("Contact already exists");

      const contact: StoredContact = {
        id: Date.now(),
        onion_address: onionAddress,
        public_key_hex: publicKeyHex,
        local_nickname: localNickname || "",
        safety_verified: false,
        created_at: new Date().toISOString(),
        safety_number: safetyNumber,
      };
      contacts.push(contact);
      saveContacts(contacts);
      return contact as T;
    }

    case "delete_contact": {
      const onionAddress = args?.onionAddress as string;
      const contacts = getContacts().filter(
        (c) => c.onion_address !== onionAddress,
      );
      saveContacts(contacts);
      return undefined as T;
    }

    case "verify_contact": {
      const onionAddress = args?.onionAddress as string;
      const contacts = getContacts();
      const idx = contacts.findIndex(
        (c) => c.onion_address === onionAddress,
      );
      if (idx === -1) throw new Error("Contact not found");
      contacts[idx] = { ...contacts[idx], safety_verified: true };
      saveContacts(contacts);
      return contacts[idx] as T;
    }

    case "update_nickname": {
      const onionAddress = args?.onionAddress as string;
      const localNickname = args?.localNickname as string;
      const contacts = getContacts();
      const idx = contacts.findIndex(
        (c) => c.onion_address === onionAddress,
      );
      if (idx === -1) throw new Error("Contact not found");
      contacts[idx] = { ...contacts[idx], local_nickname: localNickname };
      saveContacts(contacts);
      return contacts[idx] as T;
    }

    case "resolve_contact_qr": {
      const qrData = args?.qrData as string;
      try {
        const parsed = JSON.parse(qrData);
        const onionAddress = parsed.onion as string;
        const pubkeyB64 = parsed.pubkey as string;
        if (!onionAddress || !pubkeyB64)
          throw new Error("Missing 'onion' or 'pubkey' in QR data");
        const publicKeyHex = base64ToHex(pubkeyB64);
        const safetyNumber = await computeSafetyNumber(publicKeyHex);
        return {
          id: Date.now(),
          onion_address: onionAddress,
          public_key_hex: publicKeyHex,
          local_nickname: "",
          safety_verified: false,
          created_at: new Date().toISOString(),
          safety_number: safetyNumber,
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
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: contactOnion,
          from: activeIdentity.onion_address,
          content,
          timestamp: Date.now(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send message");
      }
      return undefined as T;
    }

    default:
      console.warn(`[Tauri Web] Unhandled invoke: "${cmd}"`);
      throw new Error(
        `Tauri backend not available in web mode. Command: ${cmd}`,
      );
  }
}
