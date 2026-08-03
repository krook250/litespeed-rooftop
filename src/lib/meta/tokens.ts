/**
 * Rooftop Auto — encryption at rest for Meta access tokens.
 *
 * WHY THIS EXISTS AT ALL, when nothing else in the app encrypts a column.
 *
 * A Business Integration System User token **does not expire**. It is scoped to
 * a dealer's Page, ad account and catalog, and it can spend their money. Every
 * other secret we hold is either hashed one-way (`users.password`) or ours to
 * rotate in one place (`VERCEL_API_TOKEN`, `BETTER_AUTH_SECRET`). This one is
 * neither: it is a live, permanent, third-party credential belonging to someone
 * else, held in bulk, one row per dealer. A dump of `meta_connections` in
 * plaintext is standing access to every dealer's ad account until each of them
 * individually notices and revokes it.
 *
 * So the threat model is narrow and worth naming, because encrypting a column
 * with a key that sits in the same environment is often theatre: this protects
 * against a **database** compromise that is not also an application-server
 * compromise — a leaked connection string, a stolen backup, a Neon branch shared
 * with the wrong person, a log line with a query result in it. It does **not**
 * protect against an attacker who already has `META_TOKEN_KEY`. That is a real
 * and common enough class of incident to be worth the fifty lines.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly instead of
 * decrypting to garbage we would then send to Meta.
 *
 * Format: `v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>`. Versioned from the
 * start so a key rotation can decrypt v1 and write v2 without a flag day.
 */

import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const VERSION = 'v1';

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCryptoError';
  }
}

/**
 * Read and validate the key.
 *
 * Deliberately throws rather than falling back to a derived or empty key. An
 * app that silently "encrypts" with a default key is worse than one that
 * refuses to start the Meta feature, because it looks fine in the dashboard.
 */
function key(): Buffer {
  const raw = process.env.META_TOKEN_KEY;
  if (!raw) {
    throw new TokenCryptoError(
      'META_TOKEN_KEY is not set. Generate one with: openssl rand -base64 32',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new TokenCryptoError(
      `META_TOKEN_KEY must decode to 32 bytes, got ${buf.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return buf;
}

/** True when the Meta feature has everything it needs to hold a token. */
export function tokenCryptoConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

const b64 = (b: Buffer) => b.toString('base64url');

export function encryptToken(plain: string): string {
  if (!plain) throw new TokenCryptoError('Refusing to encrypt an empty token.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join('.');
}

export function decryptToken(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenCryptoError('Stored Meta token is not in a format this build understands.');
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Almost always a rotated or mismatched key. Do not echo any of the inputs.
    throw new TokenCryptoError(
      'Could not decrypt the stored Meta token. The encryption key may have changed — the dealer will need to reconnect.',
    );
  }
}

/**
 * Last four characters, for showing "…which token is this" in the UI without
 * putting a live credential on a screen or in a screenshot.
 */
export function tokenFingerprint(plain: string): string {
  return plain.length <= 4 ? '••••' : `••••${plain.slice(-4)}`;
}

/**
 * Constant-time compare for the feed URL secret.
 *
 * The feed endpoint is public — Meta fetches it unauthenticated — so its only
 * protection is that the secret is unguessable. Comparing with `===` there
 * leaks length and prefix through timing, which is exactly the kind of thing
 * that turns "unguessable" into "guessable in a weekend".
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
