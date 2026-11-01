//! OpenPGP keys on top of rPGP: generate, parse, unlock, validate.
//!
//! rPGP is a toolkit, not a policy (its README): expiry, revocation, key flags
//! and algorithm choices are the caller's job. This module is that policy, kept
//! in one place so every other part of Meron asks the same questions.

use std::io::{BufReader, Cursor};

use anyhow::{Context as _, Result, anyhow, bail};
use pgp::composed::{
    EncryptionCaps, KeyType, PublicOrSecret, SecretKeyParamsBuilder, SignedPublicKey,
    SignedPublicSubKey, SignedSecretKey, SubkeyParamsBuilder,
};
use pgp::crypto::ecc_curve::ECCCurve;
use pgp::crypto::hash::HashAlgorithm;
use pgp::crypto::sym::SymmetricKeyAlgorithm;
use pgp::packet::Signature;
use pgp::types::{CompressionAlgorithm, KeyDetails as _, Password};
use serde::Serialize;
use smallvec::smallvec;

/// SHA-1 binding signatures made after this moment are rejected (2023-02-01,
/// the cut-off Sequoia's standard policy uses). Older keys keep working.
pub const SHA1_BINDING_CUTOFF: u32 = 1_675_209_600;

/// Largest key file we parse. A big keyring export is a few MiB; anything far
/// larger is a mistake or an attack on the parser.
pub const MAX_KEY_FILE_BYTES: usize = 16 * 1024 * 1024;

/// Seconds since the epoch, as rPGP counts time.
pub fn now() -> u32 {
    u32::try_from(chrono::Utc::now().timestamp()).unwrap_or(u32::MAX)
}

/// Upper-case hex fingerprint, the form stored and shown everywhere.
pub fn fingerprint_hex(key: &impl pgp::types::KeyDetails) -> String {
    hex_upper(key.fingerprint().as_bytes())
}

fn hex_upper(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// Why a key (or a whole certificate) can't be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Unusable {
    Revoked,
    Expired,
    /// No valid self-signature binding a user ID (or the bindings use a weak hash).
    InvalidBindings,
    /// No subkey that may encrypt.
    NoEncryptionKey,
    /// Only a GnuPG stub: the secret part lives on a smartcard or elsewhere.
    SecretOnCard,
}

/// A key's facts for the UI and the store. Never holds secret material.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KeyInfo {
    pub fingerprint: String,
    pub user_ids: Vec<String>,
    /// Lower-cased e-mail addresses from the user IDs.
    pub emails: Vec<String>,
    pub created: i64,
    pub expires: Option<i64>,
    pub algorithm: String,
    pub has_secret: bool,
    pub can_encrypt: bool,
    pub supports_seipd_v2: bool,
    pub unusable: Option<Unusable>,
}

/// Generates a new key for `addrs` (the first is the primary user ID): an
/// Ed25519 primary for certifying and signing plus a Cv25519 encryption
/// subkey, v4 so GnuPG 2.4 can use it, no expiry and no passphrase (the key is
/// stored inside the encrypted database). Same profile as Delta Chat's, except
/// that it does not advertise SEIPDv2: users may export the key to GnuPG 2.4,
/// which can't read SEIPDv2 (found by the GnuPG interop test), so peers keep
/// sending SEIPDv1 with MDC, which every client reads.
pub fn generate(addrs: &[String]) -> Result<SignedSecretKey> {
    let first = addrs.first().context("a key needs at least one address")?;
    let mut params = SecretKeyParamsBuilder::default();
    params
        .key_type(KeyType::Ed25519Legacy)
        .can_certify(true)
        .can_sign(true)
        .feature_seipd_v2(false)
        .primary_user_id(format!("<{first}>"))
        .passphrase(None)
        .preferred_symmetric_algorithms(smallvec![
            SymmetricKeyAlgorithm::AES256,
            SymmetricKeyAlgorithm::AES192,
            SymmetricKeyAlgorithm::AES128,
        ])
        .preferred_hash_algorithms(smallvec![
            HashAlgorithm::Sha256,
            HashAlgorithm::Sha384,
            HashAlgorithm::Sha512,
        ])
        .preferred_compression_algorithms(smallvec![
            CompressionAlgorithm::ZLIB,
            CompressionAlgorithm::ZIP,
        ])
        .subkey(
            SubkeyParamsBuilder::default()
                .key_type(KeyType::ECDH(ECCCurve::Curve25519Legacy))
                .can_encrypt(EncryptionCaps::All)
                .passphrase(None)
                .build()
                .context("subkey parameters")?,
        );
    for addr in addrs.iter().skip(1) {
        params.user_id(format!("<{addr}>"));
    }
    let params = params.build().context("key parameters")?;
    let mut rng = rand::thread_rng();
    let key = params.generate(&mut rng).context("generate key")?;
    key.verify_bindings().context("generated key failed its own check")?;
    Ok(key)
}

/// Everything found in an imported file.
#[derive(Debug, Default)]
pub struct Parsed {
    pub public: Vec<SignedPublicKey>,
    pub secret: Vec<SignedSecretKey>,
    /// Keys that could not be parsed at all (count only: the bytes are untrusted).
    pub unreadable: usize,
}

/// Parses one or many keys, armored or binary, public or secret. A text file
/// may hold several armor blocks (concatenated exports).
pub fn parse_keys(data: &[u8]) -> Result<Parsed> {
    if data.len() > MAX_KEY_FILE_BYTES {
        bail!("key file is too large");
    }
    let mut out = Parsed::default();
    let text = std::str::from_utf8(data).ok();
    let blocks: Vec<&[u8]> = match text {
        Some(t) if t.contains("-----BEGIN PGP") => split_armor_blocks(t),
        _ => vec![data],
    };
    for block in blocks {
        guarded(|| {
            let (iter, _headers) = PublicOrSecret::from_reader_many(BufReader::new(Cursor::new(block)))?;
            let mut found = Vec::new();
            for item in iter {
                found.push(item);
            }
            Ok(found)
        })
        .map(|items| {
            for item in items {
                match item {
                    Ok(PublicOrSecret::Public(k)) => out.public.push(k),
                    Ok(PublicOrSecret::Secret(k)) => out.secret.push(k),
                    Err(_) => out.unreadable += 1,
                }
            }
        })
        .unwrap_or_else(|_| out.unreadable += 1);
    }
    Ok(out)
}

fn split_armor_blocks(text: &str) -> Vec<&[u8]> {
    let mut blocks = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("-----BEGIN PGP") {
        let tail = &rest[start..];
        let end = tail
            .find("-----END PGP")
            .and_then(|e| tail[e..].find('\n').map(|nl| e + nl + 1).or(Some(tail.len())))
            .unwrap_or(tail.len());
        blocks.push(tail[..end].as_bytes());
        rest = &tail[end..];
    }
    blocks
}

/// Runs a closure that calls into rPGP and turns a panic into an error: rPGP
/// has panicked on crafted input before (CVE-2024-53856), and one bad mail
/// or key file must not take down the sidecar.
pub fn guarded<T>(f: impl FnOnce() -> pgp::errors::Result<T> + std::panic::UnwindSafe) -> Result<T> {
    match std::panic::catch_unwind(f) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(anyhow!("{e}")),
        Err(_) => Err(anyhow!("OpenPGP library panicked on this input")),
    }
}

/// The result of opening an imported secret key with its passphrase.
#[derive(Debug)]
pub enum Unlock {
    Ok(SignedSecretKey),
    /// The key has a passphrase and none (or the wrong one) was given.
    NeedsPassphrase,
    /// A GnuPG stub without the secret primary key (smartcard, offline primary).
    OnCard,
}

/// Removes the passphrase from every secret part of `key`, so it can be stored
/// inside the encrypted database and used without prompts. Then self-tests it.
pub fn unlock(mut key: SignedSecretKey, passphrase: Option<&str>) -> Result<Unlock> {
    if is_stub(&key) {
        return Ok(Unlock::OnCard);
    }
    let pw = Password::from(passphrase.unwrap_or(""));
    if key.primary_key.remove_password(&pw).is_err() {
        return Ok(Unlock::NeedsPassphrase);
    }
    for sub in &mut key.secret_subkeys {
        if sub.key.remove_password(&pw).is_err() {
            return Ok(Unlock::NeedsPassphrase);
        }
    }
    self_test(&key)?;
    Ok(Unlock::Ok(key))
}

/// GnuPG marks a missing secret with the private S2K extension 101
/// ("gnu-dummy" or "divert-to-card"). rPGP keeps it as an encrypted part it
/// can never open, which looks like a wrong passphrase unless detected here.
fn is_stub(key: &SignedSecretKey) -> bool {
    use pgp::types::SecretParams;
    match key.primary_key.secret_params() {
        SecretParams::Encrypted(enc) => format!("{:?}", enc.string_to_key_params()).contains("Private"),
        SecretParams::Plain(_) => false,
    }
}

/// Signs a nonce with every signing-capable secret part and verifies it with
/// the matching public part. Catches a corrupted key, or one whose public half
/// was swapped (the "key overwriting" attack), before it is ever used.
pub fn self_test(key: &SignedSecretKey) -> Result<()> {
    key.verify_bindings().context("key bindings")?;
    let public = key.to_public_key();
    let nonce = uuid::Uuid::new_v4();
    let mut rng = rand::thread_rng();
    let sig = pgp::composed::DetachedSignature::sign_binary_data(
        &mut rng,
        &key.primary_key,
        &Password::empty(),
        HashAlgorithm::Sha256,
        nonce.as_bytes().as_slice(),
    )
    .context("self-test signature")?;
    sig.verify(&public, nonce.as_bytes().as_slice())
        .context("self-test signature didn't verify: the key is damaged")?;
    Ok(())
}

/// Exports `key` armored, protected with `passphrase` (iterated+salted S2K
/// with CFB, which GnuPG, Thunderbird and OpenKeychain all read).
pub fn export_protected(key: &SignedSecretKey, passphrase: &str) -> Result<String> {
    if passphrase.is_empty() {
        bail!("a passphrase is required to export a secret key");
    }
    let mut key = key.clone();
    let pw = Password::from(passphrase);
    let mut rng = rand::thread_rng();
    key.primary_key.set_password(&mut rng, &pw).context("protect primary key")?;
    for sub in &mut key.secret_subkeys {
        sub.key.set_password(&mut rng, &pw).context("protect subkey")?;
    }
    Ok(key.to_armored_string(Default::default())?)
}

/// Armored public key.
pub fn armored_public(key: &SignedPublicKey) -> Result<String> {
    Ok(key.to_armored_string(Default::default())?)
}

/// Binary (unarmored) public key, as Autocrypt's `keydata` wants it.
pub fn binary_public(key: &SignedPublicKey) -> Result<Vec<u8>> {
    use pgp::ser::Serialize as _;
    let mut out = Vec::new();
    key.to_writer(&mut out)?;
    Ok(out)
}

/// Parses one public key from armored or binary bytes.
pub fn parse_public(data: &[u8]) -> Result<SignedPublicKey> {
    let parsed = parse_keys(data)?;
    if let Some(k) = parsed.public.into_iter().next() {
        return Ok(k);
    }
    if let Some(k) = parsed.secret.into_iter().next() {
        return Ok(k.to_public_key());
    }
    bail!("no OpenPGP key found")
}

/// Parses one stored (unprotected) secret key.
pub fn parse_secret(data: &[u8]) -> Result<SignedSecretKey> {
    parse_keys(data)?.secret.into_iter().next().context("no secret key found")
}

/// Serialises a secret key for storage (binary, unprotected: it lives inside
/// SQLCipher).
pub fn binary_secret(key: &SignedSecretKey) -> Result<zeroize::Zeroizing<Vec<u8>>> {
    use pgp::ser::Serialize as _;
    let mut out = zeroize::Zeroizing::new(Vec::new());
    key.to_writer(&mut *out)?;
    Ok(out)
}

/// Lower-cased address inside a user ID such as `Name <a@b>` or `<a@b>`.
pub fn email_of_user_id(uid: &str) -> Option<String> {
    let addr = match (uid.rfind('<'), uid.rfind('>')) {
        (Some(s), Some(e)) if e > s => &uid[s + 1..e],
        _ => uid.trim(),
    };
    (addr.contains('@') && !addr.contains(char::is_whitespace)).then(|| addr.to_ascii_lowercase())
}

/// Policy check for one self-signature: a SHA-1/MD5 binding is only accepted
/// when it is old (see [`SHA1_BINDING_CUTOFF`]).
fn binding_hash_ok(sig: &Signature) -> bool {
    match sig.hash_alg() {
        Some(HashAlgorithm::Md5) | Some(HashAlgorithm::Ripemd160) => false,
        Some(HashAlgorithm::Sha1) => sig.created().map(|t| t.as_secs() < SHA1_BINDING_CUTOFF).unwrap_or(false),
        _ => true,
    }
}

/// Whether a data signature's hash is acceptable today.
pub fn data_hash_ok(alg: Option<HashAlgorithm>) -> bool {
    !matches!(alg, Some(HashAlgorithm::Md5) | Some(HashAlgorithm::Sha1) | Some(HashAlgorithm::Ripemd160) | None)
}

fn newest<'a>(sigs: impl Iterator<Item = &'a Signature>) -> Option<&'a Signature> {
    sigs.max_by_key(|s| s.created().map(|t| t.as_secs()).unwrap_or(0))
}

/// User IDs whose newest self-certification verifies and passes the hash policy.
fn valid_user_ids(key: &SignedPublicKey) -> Vec<String> {
    key.details
        .users
        .iter()
        .filter(|u| {
            let valid: Vec<&Signature> = u
                .signatures
                .iter()
                .filter(|s| s.verify_certification(&key.primary_key, pgp::types::Tag::UserId, &u.id).is_ok())
                .collect();
            newest(valid.into_iter()).is_some_and(binding_hash_ok)
        })
        .filter_map(|u| u.id.as_str().map(str::to_string))
        .collect()
}

/// When the primary key expires, from its newest valid user-ID binding
/// (or direct-key signature), as an absolute timestamp.
fn primary_expiry(key: &SignedPublicKey) -> Option<i64> {
    let created = i64::from(key.primary_key.created_at().as_secs());
    let sigs = key
        .details
        .users
        .iter()
        .flat_map(|u| u.signatures.iter())
        .chain(key.details.direct_signatures.iter());
    let sig = newest(sigs)?;
    sig.key_expiration_time()
        .filter(|d| d.as_secs() != 0)
        .map(|d| created + i64::from(d.as_secs()))
}

fn is_revoked(key: &SignedPublicKey) -> bool {
    key.details
        .revocation_signatures
        .iter()
        .any(|s| s.verify_key(&key.primary_key).is_ok())
}

/// The subkey to encrypt to now, chosen like Delta Chat and the Autocrypt v2
/// draft: valid binding, encrypt flag, not expired, not revoked; of several,
/// the one expiring soonest.
pub fn encryption_subkey(key: &SignedPublicKey, now: u32) -> Option<&SignedPublicSubKey> {
    key.public_subkeys
        .iter()
        .filter(|sub| sub.key.algorithm().can_encrypt())
        .filter_map(|sub| {
            let valid: Vec<&Signature> = sub
                .signatures
                .iter()
                .filter(|s| s.verify_subkey_binding(&key.primary_key, &sub.key).is_ok())
                .collect();
            let binding = newest(valid.iter().copied())?;
            if binding.typ() == Some(pgp::packet::SignatureType::SubkeyRevocation) {
                return None;
            }
            if !binding_hash_ok(binding) {
                return None;
            }
            let flags = binding.key_flags();
            if !(flags.encrypt_comms() || flags.encrypt_storage()) {
                return None;
            }
            let expires = binding
                .key_expiration_time()
                .filter(|d| d.as_secs() != 0)
                .map(|d| sub.key.created_at().as_secs().saturating_add(d.as_secs()));
            if expires.is_some_and(|e| now > e) {
                return None;
            }
            Some((sub, expires.unwrap_or(u32::MAX)))
        })
        .min_by_key(|(_, exp)| *exp)
        .map(|(sub, _)| sub)
}

/// Whether the key's features advertise SEIPDv2 (RFC 9580 AEAD).
pub fn supports_seipd_v2(key: &SignedPublicKey) -> bool {
    key.details
        .users
        .iter()
        .flat_map(|u| u.signatures.iter())
        .chain(key.details.direct_signatures.iter())
        .filter_map(|s| s.features())
        .any(|f| f.seipd_v2())
}

/// Checks a public key against Meron's policy at `now`.
pub fn check(key: &SignedPublicKey, now: u32) -> Option<Unusable> {
    if is_revoked(key) {
        return Some(Unusable::Revoked);
    }
    if valid_user_ids(key).is_empty() {
        return Some(Unusable::InvalidBindings);
    }
    if primary_expiry(key).is_some_and(|e| i64::from(now) > e) {
        return Some(Unusable::Expired);
    }
    if encryption_subkey(key, now).is_none() {
        return Some(Unusable::NoEncryptionKey);
    }
    None
}

/// Describes a public key.
pub fn info(key: &SignedPublicKey, has_secret: bool, now: u32) -> KeyInfo {
    let user_ids = valid_user_ids(key);
    let mut emails: Vec<String> = user_ids.iter().filter_map(|u| email_of_user_id(u)).collect();
    emails.sort();
    emails.dedup();
    KeyInfo {
        fingerprint: fingerprint_hex(&key.primary_key),
        user_ids,
        emails,
        created: i64::from(key.primary_key.created_at().as_secs()),
        expires: primary_expiry(key),
        algorithm: format!("{:?}", key.primary_key.algorithm()),
        has_secret,
        can_encrypt: encryption_subkey(key, now).is_some(),
        supports_seipd_v2: supports_seipd_v2(key),
        unusable: check(key, now),
    }
}

/// Describes a secret key (from its public half).
pub fn secret_info(key: &SignedSecretKey, now: u32) -> KeyInfo {
    let mut info = info(&key.to_public_key(), true, now);
    if is_stub(key) {
        info.unusable = Some(Unusable::SecretOnCard);
    }
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/openpgp/testdata").join(name))
            .expect("fixture")
    }

    #[test]
    fn generated_key_is_v4_ed25519_with_an_encryption_subkey_and_no_seipd_v2() {
        let key = generate(&["me@example.org".into(), "alias@example.org".into()]).unwrap();
        let info = secret_info(&key, now());
        assert_eq!(info.emails, vec!["alias@example.org", "me@example.org"]);
        assert!(info.can_encrypt);
        assert!(!info.supports_seipd_v2, "GnuPG 2.4 can't read SEIPDv2");
        assert_eq!(info.expires, None);
        assert_eq!(info.unusable, None);
        assert_eq!(key.primary_key.version(), pgp::types::KeyVersion::V4);
        self_test(&key).unwrap();
    }

    #[test]
    fn gnupg_secret_key_without_passphrase_unlocks_and_self_tests() {
        let parsed = parse_keys(&fixture("alice-secret.asc")).unwrap();
        assert_eq!(parsed.secret.len(), 1);
        let Unlock::Ok(key) = unlock(parsed.secret.into_iter().next().unwrap(), None).unwrap() else {
            panic!("expected an unlocked key");
        };
        assert_eq!(secret_info(&key, now()).emails, vec!["alice@example.org"]);
    }

    #[test]
    fn protected_rsa_key_needs_the_right_passphrase() {
        let key = parse_keys(&fixture("bob-secret-protected.asc")).unwrap().secret.remove(0);
        assert!(matches!(unlock(key.clone(), None).unwrap(), Unlock::NeedsPassphrase));
        assert!(matches!(unlock(key.clone(), Some("wrong")).unwrap(), Unlock::NeedsPassphrase));
        assert!(matches!(unlock(key, Some("correct horse battery staple")).unwrap(), Unlock::Ok(_)));
    }

    #[test]
    fn subkeys_only_export_is_reported_as_on_card() {
        let key = parse_keys(&fixture("alice-secret-subkeys-only.asc")).unwrap().secret.remove(0);
        assert!(matches!(unlock(key, None).unwrap(), Unlock::OnCard));
    }

    #[test]
    fn a_file_with_two_secret_keys_yields_both() {
        assert_eq!(parse_keys(&fixture("two-secret-keys.asc")).unwrap().secret.len(), 2);
    }

    #[test]
    fn contacts_keyring_flags_expired_and_revoked_keys() {
        let parsed = parse_keys(&fixture("contacts-keyring.asc")).unwrap();
        assert_eq!(parsed.public.len(), 5);
        let by_email = |e: &str| {
            parsed
                .public
                .iter()
                .find(|k| info(k, false, now()).emails.iter().any(|x| x == e) || k.details.users.iter().any(|u| u.id.as_str().is_some_and(|s| s.contains(e))))
                .map(|k| check(k, now()))
                .expect(e)
        };
        assert_eq!(by_email("carol@example.com"), None);
        assert_eq!(by_email("bob@example.net"), None);
        assert_eq!(by_email("erin@example.com"), Some(Unusable::Expired));
        assert_eq!(by_email("rex@example.com"), Some(Unusable::Revoked));
    }

    #[test]
    fn binary_keyring_parses_like_the_armored_one() {
        assert_eq!(parse_keys(&fixture("contacts-keyring.gpg")).unwrap().public.len(), 3);
    }

    #[test]
    fn concatenated_armor_blocks_are_all_read() {
        let mut both = fixture("carol-public.asc");
        both.extend_from_slice(&fixture("mallory-public.asc"));
        assert_eq!(parse_keys(&both).unwrap().public.len(), 2);
    }

    #[test]
    fn garbage_is_reported_not_panicked_on() {
        let parsed = parse_keys(b"-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAAAA\n-----END PGP PUBLIC KEY BLOCK-----\n").unwrap();
        assert!(parsed.public.is_empty());
    }

    #[test]
    fn protected_export_round_trips_with_the_new_passphrase() {
        let key = generate(&["me@example.org".into()]).unwrap();
        let armored = export_protected(&key, "export pass").unwrap();
        let reparsed = parse_keys(armored.as_bytes()).unwrap().secret.remove(0);
        assert!(matches!(unlock(reparsed.clone(), None).unwrap(), Unlock::NeedsPassphrase));
        assert!(matches!(unlock(reparsed, Some("export pass")).unwrap(), Unlock::Ok(_)));
        assert!(export_protected(&key, "").is_err());
    }

    #[test]
    fn stored_secret_round_trips() {
        let key = generate(&["me@example.org".into()]).unwrap();
        let bytes = binary_secret(&key).unwrap();
        let back = parse_secret(&bytes).unwrap();
        assert_eq!(fingerprint_hex(&back.primary_key), fingerprint_hex(&key.primary_key));
    }

    #[test]
    fn email_of_user_id_handles_names_and_bare_addresses() {
        assert_eq!(email_of_user_id("Carol Example <Carol@Example.com>").as_deref(), Some("carol@example.com"));
        assert_eq!(email_of_user_id("<a@b.org>").as_deref(), Some("a@b.org"));
        assert_eq!(email_of_user_id("a@b.org").as_deref(), Some("a@b.org"));
        assert_eq!(email_of_user_id("No Address"), None);
    }

    #[test]
    fn sha1_and_md5_data_signatures_are_rejected() {
        assert!(!data_hash_ok(Some(HashAlgorithm::Sha1)));
        assert!(!data_hash_ok(Some(HashAlgorithm::Md5)));
        assert!(data_hash_ok(Some(HashAlgorithm::Sha256)));
    }
}
