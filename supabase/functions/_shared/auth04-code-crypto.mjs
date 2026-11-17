/**
 * AUTH-04 final corrective: recoverable Admin-only invitation envelopes.
 * The AES key exists only in an Edge Function secret, never in SQL or a browser.
 */
import { DomainError, buildInvitationLink, hmacHex, normalizeCode, validateUuid } from './auth02-core.mjs';

export const CODE_ENVELOPE_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

function bytesToBase64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

function base64urlToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DomainError('CODE_INTEGRITY_FAILED',503);
  }
  try {
    const raw=atob(value.replaceAll('-','+').replaceAll('_','/') + '='.repeat((4-value.length%4)%4));
    return Uint8Array.from(raw,char=>char.charCodeAt(0));
  } catch { throw new DomainError('CODE_INTEGRITY_FAILED',503); }
}

async function encryptionKey(keyHex,webCrypto) {
  // Exactly 256 random bits; HMAC and AES MUST NOT reuse the same key.
  if (typeof keyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new DomainError('CODE_ENCRYPTION_NOT_CONFIGURED',503);
  }
  const keyBytes=Uint8Array.from(keyHex.match(/../g),pair=>parseInt(pair,16));
  return webCrypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}

function associatedData(id) {
  return encoder.encode(`ai-or-human:activation-code:v1:${validateUuid(id)}`);
}

export async function encryptIssuedCode(code,id,keyHex,webCrypto=globalThis.crypto) {
  const plaintext=normalizeCode(code);
  const key=await encryptionKey(keyHex,webCrypto);
  const nonce=webCrypto.getRandomValues(new Uint8Array(12));
  const encrypted=await webCrypto.subtle.encrypt({
    name:'AES-GCM',iv:nonce,additionalData:associatedData(id),tagLength:128
  },key,encoder.encode(plaintext));
  return {
    id, key_version:CODE_ENVELOPE_VERSION,
    nonce:bytesToBase64url(nonce),
    ciphertext:bytesToBase64url(new Uint8Array(encrypted))
  };
}

export async function decryptIssuedCode(row,keyHex,hmacSecret,webCrypto=globalThis.crypto) {
  if (!row || row.key_version!==CODE_ENVELOPE_VERSION || typeof row.code_digest!=='string') {
    throw new DomainError('CODE_INTEGRITY_FAILED',503);
  }
  const nonce=base64urlToBytes(row.nonce);
  const encrypted=base64urlToBytes(row.ciphertext);
  if (nonce.length!==12 || encrypted.length<32 || encrypted.length>256) {
    throw new DomainError('CODE_INTEGRITY_FAILED',503);
  }
  const key=await encryptionKey(keyHex,webCrypto);
  let code;
  try {
    const plain=await webCrypto.subtle.decrypt({
      name:'AES-GCM',iv:nonce,additionalData:associatedData(row.id),tagLength:128
    },key,encrypted);
    code=normalizeCode(decoder.decode(plain));
  } catch { throw new DomainError('CODE_INTEGRITY_FAILED',503); }
  const digest=await hmacHex(hmacSecret,`code:${code}`,webCrypto);
  // The envelope must match the database registration authority.
  if (digest!==row.code_digest || code.slice(-4)!==row.code_hint) {
    throw new DomainError('CODE_INTEGRITY_FAILED',503);
  }
  return {code,link:buildInvitationLink(code)};
}
