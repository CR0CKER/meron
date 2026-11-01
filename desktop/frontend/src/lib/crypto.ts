// End-to-end encryption (OpenPGP) as the UI sees it. The core decides every
// fact (meron-core `openpgp::mime::view_json`); this file only maps them to
// what is drawn: which icon, which colour, which strip.

export type Trust = 'verified' | 'known' | 'unconfirmed'

export type CryptoProblem =
  | 'no_key'
  | 'integrity'
  | 'too_large'
  | 'unreadable'
  | 'invalid_signature'
  | 'signer_mismatch'
  | 'partly_encrypted'
  | 'inline_in_html'

/** A message's OpenPGP status, from `thread_message_json`. */
export type MessageCrypto = {
  encrypted: boolean
  signed: boolean
  trust: Trust
  /** Fingerprint of the key whose signature verified. */
  signer?: string | null
  /** Issuer named by a signature we couldn't verify. */
  issuer?: string | null
  partial: boolean
  weak_hash: boolean
  problem?: CryptoProblem | null
  key_changed: boolean
  /** A new key for a contact whose earlier key the user verified. */
  verified_conflict: boolean
  on_list: boolean
  /** Signed with one of the user's own keys. */
  own: boolean
  /** The signer's key is stored for the sender (so it can be verified). */
  signer_stored: boolean
  /** Show "turn on encryption" for this sender. */
  offer: boolean
}

/** Icon shape says what the message is; tone says how far the key is trusted. */
export type IndicatorKind = 'lock' | 'signature'
export type IndicatorTone = 'verified' | 'known' | 'unconfirmed' | 'danger'

export type Indicator = { kind: IndicatorKind; tone: IndicatorTone }

const DECRYPT_FAILURES: CryptoProblem[] = ['no_key', 'integrity', 'too_large', 'unreadable']
const DANGER: CryptoProblem[] = [...DECRYPT_FAILURES, 'invalid_signature', 'signer_mismatch']

/**
 * The header indicator for a message, or null for ordinary mail (Nils: plain,
 * unsigned mail shows nothing at all).
 */
export function indicatorFor(crypto?: MessageCrypto | null): Indicator | null {
  if (!crypto || (!crypto.encrypted && !crypto.signed)) return null
  const kind: IndicatorKind = crypto.encrypted ? 'lock' : 'signature'
  if (crypto.problem && DANGER.includes(crypto.problem)) return { kind, tone: 'danger' }
  if (crypto.verified_conflict) return { kind, tone: 'danger' }
  return { kind, tone: crypto.trust }
}

/** Tailwind colour per tone. Emerald and amber are what Meron already uses
 * for success and warning; contrast is checked on each theme's surface. */
export const TONE_CLASS: Record<IndicatorTone, string> = {
  verified: 'text-emerald-600 dark:text-emerald-400',
  known: 'text-secondary',
  unconfirmed: 'text-amber-600 dark:text-amber-400',
  danger: 'text-rose-600 dark:text-rose-400',
}

export type StripKind =
  | { kind: 'problem'; problem: CryptoProblem; danger: boolean }
  | { kind: 'key_changed'; danger: boolean }
  | { kind: 'offer' }

/** What, if anything, goes in the strip above the body. One at a time,
 * most important first. */
export function stripFor(crypto?: MessageCrypto | null): StripKind | null {
  if (!crypto) return null
  if (crypto.problem) {
    const neutral = crypto.problem === 'inline_in_html'
    return { kind: 'problem', problem: crypto.problem, danger: !neutral }
  }
  if (crypto.key_changed) return { kind: 'key_changed', danger: crypto.verified_conflict }
  if (crypto.offer) return { kind: 'offer' }
  return null
}

/** Whether decryption failed, so there is no body to show. */
export function decryptFailed(crypto?: MessageCrypto | null): boolean {
  return !!crypto?.problem && DECRYPT_FAILURES.includes(crypto.problem)
}

/** Upper-case hex, no spaces: the form fingerprints are compared in. */
export function normalizeFingerprint(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

/** 40 hex digits as ten groups of four, the way users read them aloud. */
export function fingerprintGroups(fingerprint: string): string[] {
  return normalizeFingerprint(fingerprint).match(/.{1,4}/g) ?? []
}

export function formatFingerprint(fingerprint: string): string {
  return fingerprintGroups(fingerprint).join(' ')
}

/** The last 16 hex digits, enough to tell keys apart in a list. */
export function shortFingerprint(fingerprint: string): string {
  return fingerprintGroups(normalizeFingerprint(fingerprint).slice(-16)).join(' ')
}

/** A pasted fingerprint matches the key's (spaces, case and separators ignored). */
export function fingerprintsMatch(pasted: string, fingerprint: string): boolean {
  const a = normalizeFingerprint(pasted)
  return a.length >= 32 && a === normalizeFingerprint(fingerprint)
}

/** Key facts from the core (`openpgp::keys::KeyInfo`). */
export type KeyInfo = {
  fingerprint: string
  user_ids: string[]
  emails: string[]
  created: number
  expires?: number | null
  algorithm: string
  has_secret: boolean
  can_encrypt: boolean
  supports_seipd_v2: boolean
  unusable?: 'revoked' | 'expired' | 'invalid_bindings' | 'no_encryption_key' | 'secret_on_card' | null
}

export type AccountEncryptionState = {
  enabled: boolean
  key?: KeyInfo | null
  previous: KeyInfo[]
}

export type PeerKeySource = 'autocrypt' | 'gossip' | 'attachment' | 'imported'

export type PeerRow = {
  addr: string
  source: PeerKeySource
  verified: boolean
  first_seen: number
  last_seen: number
  info: KeyInfo
  conflicts_with_verified: boolean
}

export type ImportPreview = {
  ready: KeyInfo[]
  skipped: { info: KeyInfo; reason: 'expired' | 'revoked' | 'invalid_bindings' | 'no_encryption_key' | 'no_email' }[]
  already_present: KeyInfo[]
  replaces_unverified: string[]
  conflicts_with_verified: string[]
  unreadable: number
}

export type ImportOwnResult =
  | { status: 'imported'; key: KeyInfo; address_matches: boolean }
  | { status: 'choose'; keys: KeyInfo[] }
  | { status: 'needs_passphrase'; key: KeyInfo }
  | { status: 'on_card' }
  | { status: 'no_secret_key' }

export type MissingKey = { addr: string; reason: 'none' | 'unusable' | 'new_key_unverified' }

export type RecipientKeys = {
  enabled: boolean
  own_key_unusable: boolean
  missing: MissingKey[]
}

/** Whether a decrypted message's quote may go into an unencrypted reply. It
 * may not: quoting it would send the plaintext in the clear ("Re: What's up
 * Johnny?", security notes §4). */
export function mayQuoteInto(original: { crypto?: MessageCrypto | null } | null | undefined, encrypting: boolean) {
  return encrypting || !original?.crypto?.encrypted
}
