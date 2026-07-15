# Anon-Chat

A **privacy-preserving, anonymous chat application** over the Tor network.

Built with [Tauri v2](https://v2.tauri.app/) (Rust backend + React/TypeScript frontend) and the [Arti](https://arti.torproject.org/) Tor implementation.

## Features

- **Tor-native** — Embedded Arti Tor client. All traffic routed through Tor. No clearnet connections allowed.
- **Anonymous identities** — Each user gets a unique Ed25519 keypair and Tor v3 onion address.
- **Encrypted key storage** — Identity keys are encrypted with Argon2id + ChaCha20Poly1305. Decrypted only in-memory.
- **Password-based auth** — Your identity is locked with a password. Unlock to use the app.
- **QR code contact exchange** — Share your onion + public key via QR code. Add contacts by scanning or pasting.
- **Safety numbers** — Compare safety numbers out-of-band (in person, phone call, etc.) to verify contact authenticity.
- **Dark theme** — Privacy-focused dark UI.

## Architecture

```
┌────────────────────────────────────┐
│  Frontend (React + TypeScript)     │
│  ┌──────────────────────────────┐  │
│  │  Components (React)          │  │
│  │  Stores (Zustand)            │  │
│  │  Tauri API (@tauri-apps/api) │  │
│  └──────────┬───────────────────┘  │
└─────────────┼──────────────────────┘
              │ invoke / events
┌─────────────┼──────────────────────┐
│  Backend (Rust / Tauri v2)        │
│  ┌──────────┴───────────────────┐  │
│  │  commands.rs — Tauri IPC     │  │
│  │  core/identity.rs — Crypto   │  │
│  │  storage/*.rs — SQLite DB    │  │
│  │  tor_manager/*.rs — Tor      │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

## Prerequisites

- **Linux**: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`
- **Node.js** >= 18
- **npm** >= 9
- **Rust** stable (install via [rustup](https://rustup.rs/))

See `requirements.txt` for full system dependency details.

## Development

```bash
# Install frontend dependencies
npm install

# Run in development mode (Vite dev server + Tauri window)
npm run tauri dev
```

This will:
1. Start the Vite dev server on `http://localhost:1420`
2. Compile and launch the Tauri desktop app
3. The app bootstraps an embedded Tor client on startup

## Build

```bash
npm run tauri build
```

Produces a release binary in `src-tauri/target/release/`.

## Project Structure

```
anon-chat/
├── src/                        # Frontend (React + TypeScript)
│   ├── App.tsx                 # Root component, route logic
│   ├── App.css                 # Global styles (dark theme)
│   ├── main.tsx                # Entry point
│   ├── components/             # React components
│   │   ├── TorStatus.tsx       # Tor bootstrap status screen
│   │   ├── IdentitySetup.tsx   # First-time password + key generation
│   │   ├── UnlockScreen.tsx    # Password unlock screen
│   │   ├── Layout.tsx          # Main app layout (sidebar + content)
│   │   ├── ContactList.tsx     # Saved contacts
│   │   ├── AddContact.tsx      # Add via paste or QR scan
│   │   ├── SafetyVerification.tsx  # Out-of-band safety verification
│   │   └── ProfileScreen.tsx   # Own identity / QR sharing
│   ├── stores/                 # Zustand state stores
│   │   ├── identityStore.ts    # Identity lifecycle (create/unlock/check)
│   │   ├── torStore.ts         # Tor status events
│   │   └── contactStore.ts     # Contact CRUD
│   └── index.html
├── src-tauri/                  # Backend (Rust)
│   ├── Cargo.toml              # Rust dependencies
│   ├── src/
│   │   ├── main.rs             # Entry point
│   │   ├── lib.rs              # Tauri app setup, Tor bootstrap
│   │   ├── commands.rs         # Tauri IPC commands
│   │   ├── core/
│   │   │   └── identity.rs     # Ed25519 keys, encryption, onion addr
│   │   ├── storage/
│   │   │   ├── database.rs     # SQLite schema & migrations
│   │   │   ├── identity_repo.rs # Encrypted identity CRUD
│   │   │   └── contacts_repo.rs # Contact CRUD
│   │   └── tor_manager/
│   │       ├── mod.rs
│   │       ├── client.rs       # Arti Tor client bootstrap
│   │       ├── kill_switch.rs  # Network guard (rejects clearnet)
│   │       └── status.rs       # TorStatus enum
│   └── icons/
└── package.json
```

## Security

- **Encryption**: Ed25519 signing keys encrypted with Argon2id (19 MiB, 2 iterations) + ChaCha20Poly1305 AEAD.
- **Key isolation**: Decrypted keys live only in process memory. SQLite stores only the encrypted blob.
- **Tor only**: The `NetworkGuard` kill-switch refuses any non-`.onion` connection.
- **Safety numbers**: SHA-256 fingerprint of the public key, verified out-of-band.
- **Memory**: `zeroize` used on ephemeral key material.

## Status

Phase 1 is complete: identity creation, password unlock, Tor bootstrap, and contact management with safety verification. Messaging (Phase 2+) is not yet implemented.
