import { getHardwareAuthenticator, isSoftwareAuthenticator } from './aaguidRegistry';

export interface VerifiedAttestation {
  verified: boolean;
  hardwareBacked: boolean;
  aaguid: string;
  authenticatorName?: string;
  vendor?: string;
  fmt: string;
  reason?: string;
}

const textDecoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function uuidFromBytes(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type CborValue =
  | string
  | number
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | { [key: string]: CborValue };

function decodeCbor(bytes: Uint8Array, offset = 0): { value: CborValue; offset: number } {
  if (offset >= bytes.length) throw new Error('CBOR: unexpected end of input');
  const initial = bytes[offset]!;
  const major = initial >> 5;
  const ai = initial & 0x1f;
  offset += 1;

  const readLength = (additional: number, pos: number): { length: number; offset: number } => {
    if (additional < 24) return { length: additional, offset: pos };
    if (additional === 24) return { length: bytes[pos]!, offset: pos + 1 };
    if (additional === 25) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { length: view.getUint16(pos, false), offset: pos + 2 };
    }
    if (additional === 26) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { length: view.getUint32(pos, false), offset: pos + 4 };
    }
    throw new Error('CBOR: unsupported length encoding');
  };

  if (major === 0) {
    const { length, offset: next } = readLength(ai, offset);
    return { value: length, offset: next };
  }
  if (major === 1) {
    const { length, offset: next } = readLength(ai, offset);
    return { value: -1 - length, offset: next };
  }
  if (major === 2) {
    const { length, offset: next } = readLength(ai, offset);
    return { value: bytes.slice(next, next + length), offset: next + length };
  }
  if (major === 3) {
    const { length, offset: next } = readLength(ai, offset);
    return { value: textDecoder.decode(bytes.slice(next, next + length)), offset: next + length };
  }
  if (major === 4) {
    const { length, offset: nextStart } = readLength(ai, offset);
    const arr: CborValue[] = [];
    let next = nextStart;
    for (let i = 0; i < length; i++) {
      const decoded = decodeCbor(bytes, next);
      arr.push(decoded.value);
      next = decoded.offset;
    }
    return { value: arr, offset: next };
  }
  if (major === 5) {
    const { length, offset: nextStart } = readLength(ai, offset);
    const map: { [key: string]: CborValue } = {};
    let next = nextStart;
    for (let i = 0; i < length; i++) {
      const keyDecoded = decodeCbor(bytes, next);
      const valDecoded = decodeCbor(bytes, keyDecoded.offset);
      map[String(keyDecoded.value)] = valDecoded.value;
      next = valDecoded.offset;
    }
    return { value: map, offset: next };
  }
  if (major === 7) {
    if (ai === 20) return { value: false, offset };
    if (ai === 21) return { value: true, offset };
    if (ai === 22) return { value: null, offset };
  }
  throw new Error(`CBOR: unsupported type major=${major} ai=${ai}`);
}

function parseAuthenticatorData(authData: Uint8Array): { aaguid: string } {
  if (authData.length < 37) throw new Error('Invalid authenticator data');
  const flags = authData[32]!;
  const hasAttestedCredential = (flags & 0x40) !== 0;
  if (!hasAttestedCredential) throw new Error('Attestation missing credential data');
  const aaguidBytes = authData.slice(37, 53);
  return { aaguid: uuidFromBytes(aaguidBytes) };
}

function getAttestationObject(attestationObjectBase64: string): {
  fmt: string;
  authData: Uint8Array;
} {
  const decoded = decodeCbor(base64ToBytes(attestationObjectBase64)).value;
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('Invalid attestation object');
  }
  const obj = decoded as Record<string, CborValue>;
  const fmt = obj.fmt;
  const authData = obj.authData;
  if (typeof fmt !== 'string' || !(authData instanceof Uint8Array)) {
    throw new Error('Invalid attestation object fields');
  }
  return { fmt, authData };
}

export async function verifyRegistrationAttestation(
  attestationObjectBase64: string,
): Promise<VerifiedAttestation> {
  try {
    const { fmt, authData } = getAttestationObject(attestationObjectBase64);
    const { aaguid } = parseAuthenticatorData(authData);

    if (fmt === 'none') {
      return {
        verified: false,
        hardwareBacked: false,
        aaguid,
        fmt,
        reason: 'Attestation format "none" is not accepted; direct attestation required.',
      };
    }

    if (isSoftwareAuthenticator(aaguid)) {
      return {
        verified: false,
        hardwareBacked: false,
        aaguid,
        fmt,
        reason: 'Software authenticators are not accepted for this security level.',
      };
    }

    const hardware = getHardwareAuthenticator(aaguid);
    if (!hardware) {
      return {
        verified: false,
        hardwareBacked: false,
        aaguid,
        fmt,
        reason: 'Authenticator AAGUID is not in the verified hardware registry.',
      };
    }

    return {
      verified: true,
      hardwareBacked: true,
      aaguid,
      authenticatorName: hardware.name,
      vendor: hardware.vendor,
      fmt,
    };
  } catch (error) {
    return {
      verified: false,
      hardwareBacked: false,
      aaguid: 'unknown',
      fmt: 'unknown',
      reason: error instanceof Error ? error.message : 'Attestation verification failed',
    };
  }
}
