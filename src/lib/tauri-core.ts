interface IdentityPayload {
  onion_address: string;
  public_key: string;
  fingerprint: string;
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
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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
      return getStoredIdentity() as T;
    }

    case "create_identity": {
      const password = args?.password as string;
      if (!password) throw new Error("Password required");
      const hash = await hashPassword(password);
      setStoredPasswordHash(hash);
      const identity: IdentityPayload = {
        onion_address: "demo.onion",
        public_key: "mock-public-key-for-demo-purposes-only",
        fingerprint: "ABCD EFGH IJKL MNOP",
      };
      setStoredIdentity(identity);
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
      const identity = getStoredIdentity();
      return (identity?.onion_address || "demo.onion") as T;
    }

    case "list_contacts": {
      return [] as T;
    }

    case "add_contact": {
      return args as T;
    }

    case "delete_contact": {
      return undefined as T;
    }

    case "verify_contact": {
      return args as T;
    }

    case "update_nickname": {
      return args as T;
    }

    case "resolve_contact_qr": {
      const qrData = args?.qrData as string;
      try {
        const parsed = JSON.parse(qrData);
        return {
          id: Date.now(),
          onion_address: parsed.onion || "unknown.onion",
          public_key_hex: parsed.pubkey || "",
          local_nickname: "",
          safety_verified: false,
          created_at: new Date().toISOString(),
          safety_number: "ABCD EFGH IJKL MNOP QRST UVWX YZ12 3456",
        } as T;
      } catch {
        throw new Error("Invalid QR data format");
      }
    }

    default:
      console.warn(`[Tauri Web] Unhandled invoke: "${cmd}"`);
      throw new Error(
        `Tauri backend not available in web mode. Command: ${cmd}`,
      );
  }
}
