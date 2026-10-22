/**
 * End-to-end encryption primitives for appointment live chat.
 *
 * Each browser tab creates a fresh P-256 ECDH key pair for the appointment.
 * The peer public key is exchanged over the room WebSocket; the relay only
 * sees public keys and AES-GCM envelopes, never chat plaintext or session keys.
 */

const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
const CHAT_LABEL = 'heliora/teleconsultation-chat/v1';
const IV_BYTES = 12;

export interface ChatEphemeralKeyPair {
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}

export interface EncryptedChatPayload {
  version: 1;
  sessionId: string;
  senderKey: JsonWebKey;
  sequence: number;
  iv: string;
  ciphertext: string;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function publicKeyBytes(key: JsonWebKey): Uint8Array {
  if (key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y || key.d) {
    throw new Error('Chat key must be a public P-256 EC JWK.');
  }
  const decode = (value: string) => {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return decodeBase64(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  };
  const x = decode(key.x);
  const y = decode(key.y);
  const result = new Uint8Array(65);
  result[0] = 4;
  result.set(x, 1);
  result.set(y, 33);
  return result;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function importPeerKey(publicKey: JsonWebKey): Promise<CryptoKey> {
  publicKeyBytes(publicKey);
  return crypto.subtle.importKey('jwk', publicKey, CURVE, false, []);
}

/** Creates a fresh, tab-scoped key pair. It is intentionally never persisted. */
export async function createChatEphemeralKeyPair(): Promise<ChatEphemeralKeyPair> {
  const pair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y! },
  };
}

/** Derives a non-extractable AES-256-GCM room key from both ephemeral keys. */
export async function deriveChatSessionKey(
  localPrivateKey: CryptoKey,
  localPublicKey: JsonWebKey,
  peerPublicKey: JsonWebKey,
  sessionId: string,
): Promise<CryptoKey> {
  const peer = await importPeerKey(peerPublicKey);
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peer },
    localPrivateKey,
    256,
  );
  const salt = await crypto.subtle.digest('SHA-256', utf8(sessionId));
  const localBytes = publicKeyBytes(localPublicKey);
  const peerBytes = publicKeyBytes(peerPublicKey);
  const orderedKeys = [localBytes, peerBytes].sort((a, b) =>
    Array.from(a).join(',').localeCompare(Array.from(b).join(',')),
  );
  const info = new Uint8Array(
    utf8(CHAT_LABEL).length + orderedKeys[0]!.length + orderedKeys[1]!.length,
  );
  info.set(utf8(CHAT_LABEL));
  info.set(orderedKeys[0]!, utf8(CHAT_LABEL).length);
  info.set(orderedKeys[1]!, utf8(CHAT_LABEL).length + orderedKeys[0]!.length);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts one message with a unique nonce and authenticated room metadata. */
export async function encryptChatMessage(
  plaintext: string,
  key: CryptoKey,
  sessionId: string,
  senderKey: JsonWebKey,
  sequence: number,
): Promise<EncryptedChatPayload> {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid chat sequence.');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aad = utf8(`${sessionId}:${sequence}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    utf8(plaintext),
  );
  return {
    version: 1,
    sessionId,
    senderKey,
    sequence,
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
  };
}

/** Authenticates and decrypts a room message; forged or modified frames fail closed. */
export async function decryptChatMessage(
  payload: EncryptedChatPayload,
  key: CryptoKey,
  expectedSessionId?: string,
): Promise<string> {
  if (
    payload.version !== 1 ||
    !payload.sessionId ||
    (expectedSessionId !== undefined && payload.sessionId !== expectedSessionId) ||
    !payload.senderKey
  ) {
    throw new Error('Invalid encrypted chat payload.');
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decodeBase64(payload.iv),
      additionalData: utf8(`${payload.sessionId}:${payload.sequence}`),
    },
    key,
    decodeBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

/** Best-effort cleanup for the in-memory session reference. CryptoKeys are non-extractable. */
export function destroyChatSession(session: { key: CryptoKey | null }): void {
  session.key = null;
}
