use argon2::Argon2;
use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng},
    ChaCha20Poly1305, Key, Nonce,
};
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::RngCore;
use sha2::Sha256;
use sha3::{Digest, Sha3_256};
use zeroize::Zeroize;

/// Length of the Ed25519 seed (32 bytes = 256 bits).
pub const ED25519_SEED_LEN: usize = 32;
/// Length of the Argon2id salt.
pub const SALT_LEN: usize = 16;
/// Length of the ChaCha20Poly1305 nonce.
pub const NONCE_LEN: usize = 12;
/// Length of the AEAD tag appended by ChaCha20Poly1305.
pub const AEAD_TAG_LEN: usize = 16;
/// Serialized plaintext: seed (32) + public key (32) = 64 bytes.
pub const PLAINTEXT_LEN: usize = ED25519_SEED_LEN + 32;
/// Serialized ciphertext: nonce (12) + encrypted payload (64 + 16) = 92 bytes.
pub const CIPHERTEXT_LEN: usize = NONCE_LEN + PLAINTEXT_LEN + AEAD_TAG_LEN;

/// Argon2id memory cost in KiB.
const ARGON2_MEM_COST: u32 = 19456; // 19 MiB
/// Argon2id time cost (iterations).
const ARGON2_TIME_COST: u32 = 2;
/// Argon2id parallelism.
const ARGON2_PARALLELISM: u32 = 1;

/// Errors specific to identity operations.
#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("Wrong password or corrupted data")]
    DecryptionFailed,
    #[error("Crypto error: {0}")]
    Crypto(String),
    #[error("Encoding error: {0}")]
    Encoding(String),
}

/// A full identity: the decrypted keypair and its public onion address.
#[derive(Clone)]
pub struct Identity {
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub onion_address: String,
}

impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Identity")
            .field("verifying_key", &hex::encode(self.verifying_key.to_bytes()))
            .field("onion_address", &self.onion_address)
            .field("signing_key", &"[REDACTED]")
            .finish()
    }
}

/// Derive a 256-bit encryption key from a password and salt using Argon2id.
pub fn derive_key(password: &str, salt: &[u8; SALT_LEN]) -> [u8; 32] {
    let mut key = [0u8; 32];
    let argon = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(ARGON2_MEM_COST, ARGON2_TIME_COST, ARGON2_PARALLELISM, Some(32))
            .expect("Invalid Argon2 parameters"),
    );
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .expect("Argon2id hashing failed");
    key
}

/// Generate a random salt.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Generate a new Ed25519 keypair and return it with the onion address.
pub fn generate_identity() -> Identity {
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let verifying_key = signing_key.verifying_key();
    let onion_address = compute_onion_address(&verifying_key);

    Identity {
        signing_key,
        verifying_key,
        onion_address,
    }
}

/// Encrypt the identity keypair (seed + public key) with a password-derived key.
///
/// Returns the ciphertext blob: nonce (12) || encrypted_payload (80).
pub fn encrypt_identity(identity: &Identity, password: &str, salt: &[u8; SALT_LEN]) -> Vec<u8> {
    let key = derive_key(password, salt);
    let cipher_key = Key::from_slice(&key);
    let cipher = ChaCha20Poly1305::new(cipher_key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let seed = identity.signing_key.to_bytes();
    let pk_bytes = identity.verifying_key.to_bytes();

    let mut plaintext = Vec::with_capacity(PLAINTEXT_LEN);
    plaintext.extend_from_slice(&seed);
    plaintext.extend_from_slice(&pk_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .expect("ChaCha20Poly1305 encryption failed");

    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);

    // Zeroize ephemeral key material
    let mut key = key;
    key.zeroize();

    blob
}

/// Decrypt an identity keypair blob.
///
/// Returns the Identity on success, or an error on wrong password / corruption.
pub fn decrypt_identity(blob: &[u8], password: &str, salt: &[u8; SALT_LEN]) -> Result<Identity, IdentityError> {
    if blob.len() < NONCE_LEN {
        return Err(IdentityError::DecryptionFailed);
    }

    let key = derive_key(password, salt);
    let cipher_key = Key::from_slice(&key);
    let cipher = ChaCha20Poly1305::new(cipher_key);

    let (nonce_bytes, encrypted) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, encrypted)
        .map_err(|_| IdentityError::DecryptionFailed)?;

    if plaintext.len() != PLAINTEXT_LEN {
        return Err(IdentityError::DecryptionFailed);
    }

    let (seed_bytes, pk_bytes) = plaintext.split_at(ED25519_SEED_LEN);

    // Reconstruct keypair from seed
    let seed_array: [u8; ED25519_SEED_LEN] = seed_bytes
        .try_into()
        .map_err(|_| IdentityError::DecryptionFailed)?;

    let signing_key = SigningKey::from_bytes(&seed_array);

    // Verify the public key matches
    let expected_pk: [u8; 32] = pk_bytes
        .try_into()
        .map_err(|_| IdentityError::DecryptionFailed)?;
    let verifying_key = signing_key.verifying_key();

    if verifying_key.to_bytes() != expected_pk {
        return Err(IdentityError::DecryptionFailed);
    }

    let onion_address = compute_onion_address(&verifying_key);

    let mut key = key;
    key.zeroize();

    Ok(Identity {
        signing_key,
        verifying_key,
        onion_address,
    })
}

/// Compute the Tor v3 onion address from an Ed25519 public key.
///
/// Format: base32(pubkey[32] || checksum[2] || version[1]) + ".onion"
/// where checksum = SHA3-256(".onion checksum" || pubkey || version)[:2]
/// and version = 0x03
pub fn compute_onion_address(verifying_key: &VerifyingKey) -> String {
    let pubkey = verifying_key.to_bytes();
    let version: u8 = 0x03;

    let mut hasher = Sha3_256::new();
    hasher.update(b".onion checksum");
    hasher.update(&pubkey);
    hasher.update(&[version]);
    let checksum_full = hasher.finalize();
    let checksum = &checksum_full[..2];

    let mut address_bytes = Vec::with_capacity(35);
    address_bytes.extend_from_slice(&pubkey);
    address_bytes.extend_from_slice(checksum);
    address_bytes.push(version);

    let encoded = base32::encode(base32::Alphabet::Rfc4648 { padding: false }, &address_bytes);
    encoded.to_lowercase() + ".onion"
}

/// Generate a human-readable safety number / fingerprint for visual verification.
/// Uses SHA-256 of the public key, displayed as hex words.
pub fn fingerprint(verifying_key: &VerifyingKey) -> String {
    let pk = verifying_key.to_bytes();
    let hash = Sha256::digest(&pk);
    let hex_str = hex::encode(&hash[..8]);
    // Split into groups of 4 chars
    hex_str
        .as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or("????"))
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_encrypt_roundtrip() {
        let identity = generate_identity();
        let password = "test_password_123!";
        let salt = generate_salt();

        let blob = encrypt_identity(&identity, password, &salt);

        let decrypted = decrypt_identity(&blob, password, &salt).unwrap();
        assert_eq!(decrypted.onion_address, identity.onion_address);
        assert_eq!(
            decrypted.verifying_key.to_bytes(),
            identity.verifying_key.to_bytes()
        );
    }

    #[test]
    fn test_wrong_password_fails() {
        let identity = generate_identity();
        let password = "correct_password";
        let wrong_password = "wrong_password";
        let salt = generate_salt();

        let blob = encrypt_identity(&identity, password, &salt);
        let result = decrypt_identity(&blob, wrong_password, &salt);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), IdentityError::DecryptionFailed));
    }

    #[test]
    fn test_onion_address_format() {
        let identity = generate_identity();
        let addr = &identity.onion_address;
        assert!(addr.ends_with(".onion"));
        // 56 base32 chars + 6 for ".onion" = 62
        assert_eq!(addr.len(), 62);
        // All chars before ".onion" should be lowercase base32
        let host_part = &addr[..56];
        assert!(host_part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    }

    #[test]
    fn test_fingerprint_format() {
        let identity = generate_identity();
        let fp = fingerprint(&identity.verifying_key);
        // Format: XXXX-XXXX-XXXX-XXXX (19 chars with 3 hyphens)
        assert_eq!(fp.len(), 19);
        assert_eq!(fp.chars().filter(|&c| c == '-').count(), 3);
    }

    #[test]
    fn test_derive_key_deterministic() {
        let salt = [0xABu8; SALT_LEN];
        let key1 = derive_key("password", &salt);
        let key2 = derive_key("password", &salt);
        assert_eq!(key1, key2);

        let key3 = derive_key("different", &salt);
        assert_ne!(key1, key3);
    }
}
