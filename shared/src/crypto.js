// Crypto helpers shared by server and worker (Node side).
//
// IMPORTANT: signatures use tweetnacl on BOTH the browser and Node so the
// semantics are guaranteed identical (the browser cannot use WebCrypto:
// crypto.subtle is undefined in non-secure contexts, and this demo is served
// over plain HTTP from a bare IP).

import { createHash, createHmac, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';

export function toB64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

export function fromB64(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function utf8Bytes(str) {
  return new Uint8Array(Buffer.from(str, 'utf8'));
}

/** Lowercase hex SHA-256 of a string (UTF-8) or byte array. */
export function sha256Hex(data) {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  return createHash('sha256').update(input).digest('hex');
}

/** HMAC-SHA256 (lowercase hex) — used to pseudonymize emails before OrbitDB. */
export function hmacSha256Hex(message, secret) {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/** Generate an Ed25519 keypair; returns base64 strings. */
export function generateKeypair() {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: toB64(kp.publicKey),
    secretKey: toB64(kp.secretKey), // 64 bytes: seed || pubkey (nacl format)
  };
}

/** Detached Ed25519 signature over the UTF-8 bytes of `message`. */
export function signDetachedB64(message, secretKeyB64) {
  const sig = nacl.sign.detached(utf8Bytes(message), fromB64(secretKeyB64));
  return toB64(sig);
}

/** Verify a detached Ed25519 signature over the UTF-8 bytes of `message`. */
export function verifyDetachedB64(message, sigB64, publicKeyB64) {
  try {
    const pub = fromB64(publicKeyB64);
    const sig = fromB64(sigB64);
    if (pub.length !== nacl.sign.publicKeyLength) return false;
    if (sig.length !== nacl.sign.signatureLength) return false;
    return nacl.sign.detached.verify(utf8Bytes(message), sig, pub);
  } catch {
    return false;
  }
}

/** Random bytes as base64 (challenges, nonces). */
export function randomB64(n) {
  return randomBytes(n).toString('base64');
}

/** Is this a plausible base64 Ed25519 public key? */
export function isValidPubkeyB64(s) {
  if (typeof s !== 'string' || s.length > 64) return false;
  try {
    return fromB64(s).length === nacl.sign.publicKeyLength;
  } catch {
    return false;
  }
}
