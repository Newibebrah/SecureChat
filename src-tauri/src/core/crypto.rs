use aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::ChaCha20Poly1305;
use chacha20poly1305::{Key, Nonce};
use ed25519_dalek::{Signer, Signature, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

pub const NONCE_LEN: usize = 12;
pub const EPHEMERAL_PUBKEY_LEN: usize = 32;
pub const ED25519_SIG_LEN: usize = 64;
pub const MESSAGE_HEADER_LEN: usize = EPHEMERAL_PUBKEY_LEN + ED25519_SIG_LEN + NONCE_LEN;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Decryption failed")]
    DecryptionFailed,
    #[error("Invalid key length")]
    InvalidKeyLength,
    #[error("Signature verification failed")]
    SignatureVerificationFailed,
}

pub fn ed25519_seed_to_x25519_keypair(seed: &[u8; 32]) -> (StaticSecret, PublicKey) {
    let hash = Sha256::digest(&[seed.as_slice(), b"anon-chat-x25519"].concat());
    let mut clamped = [0u8; 32];
    clamped.copy_from_slice(&hash);
    clamped[0] &= 248;
    clamped[31] &= 127;
    clamped[31] |= 64;
    let secret = StaticSecret::from(clamped);
    let public = PublicKey::from(&secret);
    (secret, public)
}

pub fn x25519_pubkey_from_seed(seed: &[u8; 32]) -> [u8; 32] {
    let (_, public) = ed25519_seed_to_x25519_keypair(seed);
    public.to_bytes()
}

pub fn encrypt_message_to_recipient(
    plaintext: &[u8],
    recipient_x25519_pubkey: &[u8; 32],
    my_ed25519_seed: &[u8; 32],
) -> Vec<u8> {
    // Ephemeral X25519 key for forward secrecy
    let mut ephemeral_seed = [0u8; 32];
    OsRng.fill_bytes(&mut ephemeral_seed);
    let (ephemeral_secret, ephemeral_public) = ed25519_seed_to_x25519_keypair(&ephemeral_seed);
    ephemeral_seed.zeroize();

    let their_x_pk = PublicKey::from(*recipient_x25519_pubkey);
    let shared = ephemeral_secret.diffie_hellman(&their_x_pk);
    let shared_bytes = shared.to_bytes();

    // Sign the ephemeral public key with our Ed25519 identity key
    let signing_key = SigningKey::from_bytes(my_ed25519_seed);
    let signature: Signature = signing_key.sign(&ephemeral_public.to_bytes());

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let key = Key::from_slice(&shared_bytes);
    let cipher = ChaCha20Poly1305::new(key);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .expect("ChaCha20Poly1305 encryption failed");

    let mut packet = Vec::with_capacity(MESSAGE_HEADER_LEN + ciphertext.len());
    packet.extend_from_slice(&ephemeral_public.to_bytes());
    packet.extend_from_slice(&signature.to_bytes());
    packet.extend_from_slice(&nonce_bytes);
    packet.extend_from_slice(&ciphertext);

    let mut shared_bytes = shared_bytes;
    shared_bytes.zeroize();
    packet
}

pub fn decrypt_message_from_sender(
    packet: &[u8],
    sender_ed25519_pubkey: &[u8; 32],
    my_ed25519_seed: &[u8; 32],
) -> Result<Vec<u8>, CryptoError> {
    if packet.len() < MESSAGE_HEADER_LEN {
        return Err(CryptoError::InvalidKeyLength);
    }

    let (my_x_secret, _) = ed25519_seed_to_x25519_keypair(my_ed25519_seed);

    let ephemeral_pk_bytes: [u8; 32] = packet[..EPHEMERAL_PUBKEY_LEN]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let sig_bytes: [u8; ED25519_SIG_LEN] =
        packet[EPHEMERAL_PUBKEY_LEN..EPHEMERAL_PUBKEY_LEN + ED25519_SIG_LEN]
            .try_into()
            .map_err(|_| CryptoError::InvalidKeyLength)?;

    // Verify sender's Ed25519 signature over the ephemeral public key
    let sender_pk = VerifyingKey::from_bytes(sender_ed25519_pubkey)
        .map_err(|_| CryptoError::SignatureVerificationFailed)?;
    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|_| CryptoError::SignatureVerificationFailed)?;

    sender_pk
        .verify(&ephemeral_pk_bytes, &signature)
        .map_err(|_| CryptoError::SignatureVerificationFailed)?;

    // Compute shared secret using our X25519 key + sender's ephemeral key
    let ephemeral_pk = PublicKey::from(ephemeral_pk_bytes);
    let shared = my_x_secret.diffie_hellman(&ephemeral_pk);
    let shared_bytes = shared.to_bytes();

    let nonce: [u8; NONCE_LEN] = packet
        [EPHEMERAL_PUBKEY_LEN + ED25519_SIG_LEN..MESSAGE_HEADER_LEN]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let ciphertext = &packet[MESSAGE_HEADER_LEN..];

    let key = Key::from_slice(&shared_bytes);
    let cipher = ChaCha20Poly1305::new(key);
    let nonce = Nonce::from_slice(&nonce);

    let result = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed);

    let mut shared_bytes = shared_bytes;
    shared_bytes.zeroize();
    result
}

// Legacy decrypt that derives sender X25519 pubkey from packet header (backward compat)
pub fn legacy_decrypt_message_from_sender(
    packet: &[u8],
    my_ed25519_seed: &[u8; 32],
) -> Result<Vec<u8>, CryptoError> {
    // old format: sender_x25519_pubkey(32) || nonce(12) || ciphertext
    let old_header_len = 32 + 12;
    if packet.len() < old_header_len {
        return Err(CryptoError::InvalidKeyLength);
    }
    let (my_x_secret, _) = ed25519_seed_to_x25519_keypair(my_ed25519_seed);
    let sender_x_pk_bytes: [u8; 32] = packet[..32]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let sender_x_pk = PublicKey::from(sender_x_pk_bytes);
    let shared = my_x_secret.diffie_hellman(&sender_x_pk);
    let shared_bytes = shared.to_bytes();
    let nonce: [u8; 12] = packet[32..44]
        .try_into()
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    let ciphertext = &packet[44..];
    let key = Key::from_slice(&shared_bytes);
    let cipher = ChaCha20Poly1305::new(key);
    let nonce = Nonce::from_slice(&nonce);
    let result = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed);
    let mut shared_bytes = shared_bytes;
    shared_bytes.zeroize();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    #[test]
    fn test_message_encrypt_decrypt_roundtrip() {
        let alice = SigningKey::generate(&mut OsRng);
        let bob = SigningKey::generate(&mut OsRng);

        let alice_seed = alice.to_bytes();
        let bob_x_pk = x25519_pubkey_from_seed(&bob.to_bytes());
        let bob_pk_bytes = bob.verifying_key().to_bytes();

        let plaintext = b"Hello, this is a secret message!";
        let packet = encrypt_message_to_recipient(plaintext, &bob_x_pk, &alice_seed);
        let decrypted =
            decrypt_message_from_sender(&packet, &alice.verifying_key().to_bytes(), &bob.to_bytes())
                .unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let alice = SigningKey::generate(&mut OsRng);
        let bob = SigningKey::generate(&mut OsRng);
        let eve = SigningKey::generate(&mut OsRng);

        let bob_x_pk = x25519_pubkey_from_seed(&bob.to_bytes());
        let alice_pk_bytes = alice.verifying_key().to_bytes();
        let eve_seed = eve.to_bytes();

        let plaintext = b"Secret";
        let packet = encrypt_message_to_recipient(plaintext, &bob_x_pk, &alice.to_bytes());
        let result = decrypt_message_from_sender(&packet, &alice_pk_bytes, &eve_seed);
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_sender_key_fails() {
        let alice = SigningKey::generate(&mut OsRng);
        let bob = SigningKey::generate(&mut OsRng);
        let mallory = SigningKey::generate(&mut OsRng);

        let bob_x_pk = x25519_pubkey_from_seed(&bob.to_bytes());
        let mallory_pk_bytes = mallory.verifying_key().to_bytes();

        // Mallory tries to impersonate Alice by signing with her own key
        let plaintext = b"Secret";
        let packet = encrypt_message_to_recipient(plaintext, &bob_x_pk, &mallory.to_bytes());

        // Bob tries to verify with Alice's key - should fail
        let result =
            decrypt_message_from_sender(&packet, &alice.verifying_key().to_bytes(), &bob.to_bytes());
        assert!(result.is_err());
    }

    #[test]
    fn test_key_derivation_deterministic() {
        let seed = [0x42u8; 32];
        let pk1 = x25519_pubkey_from_seed(&seed);
        let pk2 = x25519_pubkey_from_seed(&seed);
        assert_eq!(pk1, pk2);
    }
}
