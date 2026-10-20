import { Blob as NodeBlob } from 'node:buffer';
import { ReadableStream, TransformStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

// jsdom lacks Web Streams and a stream-capable Blob; use Node's spec-compliant implementations.
Object.assign(globalThis, {
  Blob: NodeBlob,
  ReadableStream,
  TransformStream,
  TextEncoder,
  TextDecoder,
});

import {
  ENVELOPE_CHUNK_BYTES,
  MAX_ENVELOPE_FILE_BYTES,
  addEnvelopeRecipient,
  decryptEnvelopeBody,
  encryptFileToEnvelope,
  exportRecipientPublicKey,
  parseEnvelope,
  removeEnvelopeRecipient,
  serializeEnvelope,
  unwrapDataKey,
  type EnvelopeHeader,
} from '@/lib/crypto';

const CHUNK_CIPHERTEXT = ENVELOPE_CHUNK_BYTES + 16;

async function recipient(id: string) {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  return { id, keyPair, publicKey: await exportRecipientPublicKey(keyPair) };
}

function patterned(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return bytes;
}

async function readAll(
  stream: globalThis.ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value);
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

async function decrypt(
  header: EnvelopeHeader,
  body: Blob,
  who: Awaited<ReturnType<typeof recipient>>,
) {
  const dek = await unwrapDataKey(header, who.id, who.keyPair);
  return readAll(decryptEnvelopeBody(body.stream(), header, dek));
}

describe('streaming envelope encryption (#24)', () => {
  it.each([
    ['empty file', 0],
    ['smaller than one chunk', 1000],
    ['exact multiple of the chunk size', ENVELOPE_CHUNK_BYTES * 3],
    ['partial final chunk', ENVELOPE_CHUNK_BYTES * 2 + 123],
  ])('round-trips a %s', async (_label, size) => {
    const alice = await recipient('GALICE');
    const plaintext = patterned(size);

    const { header, body } = await encryptFileToEnvelope(new Blob([plaintext]), [alice]);

    const chunks = Math.max(1, Math.ceil(size / ENVELOPE_CHUNK_BYTES));
    expect(body.size).toBe(size + chunks * 16); // one 16-byte GCM tag per 64 KiB chunk
    expect(header.chunkSize).toBe(ENVELOPE_CHUNK_BYTES);
    expect(await decrypt(header, body, alice)).toEqual(plaintext);
  });

  it('reports granular, monotonic progress ending at 100%', async () => {
    const alice = await recipient('GALICE');
    const progress: number[] = [];

    await encryptFileToEnvelope(new Blob([patterned(ENVELOPE_CHUNK_BYTES * 4)]), [alice], (p) =>
      progress.push(p),
    );

    expect(progress).toEqual([25, 50, 75, 100]);
  });

  it('derives the content hash from the per-chunk ciphertext digests', async () => {
    const alice = await recipient('GALICE');
    const { body, contentHash } = await encryptFileToEnvelope(
      new Blob([patterned(ENVELOPE_CHUNK_BYTES + 5)]),
      [alice],
    );

    const bytes = new Uint8Array(await body.arrayBuffer());
    const digests = await Promise.all(
      [bytes.slice(0, CHUNK_CIPHERTEXT), bytes.slice(CHUNK_CIPHERTEXT)].map((c) =>
        crypto.subtle.digest('SHA-256', c),
      ),
    );
    const expected = await crypto.subtle.digest(
      'SHA-256',
      await new NodeBlob(digests).arrayBuffer(),
    );
    expect(contentHash).toBe(Buffer.from(expected).toString('hex'));
  });

  it('rejects files over 250 MB without reading them', async () => {
    const huge = { size: MAX_ENVELOPE_FILE_BYTES + 1 } as Blob;
    await expect(encryptFileToEnvelope(huge, [await recipient('GALICE')])).rejects.toThrow(
      '250 MB',
    );
  });

  it('detects truncation, reordering and tampering', async () => {
    const alice = await recipient('GALICE');
    const { header, body } = await encryptFileToEnvelope(
      new Blob([patterned(ENVELOPE_CHUNK_BYTES * 3)]),
      [alice],
    );
    const bytes = new Uint8Array(await body.arrayBuffer());

    const truncated = new Blob([bytes.slice(0, CHUNK_CIPHERTEXT * 2)]);
    const reordered = new Blob([
      bytes.slice(CHUNK_CIPHERTEXT, CHUNK_CIPHERTEXT * 2),
      bytes.slice(0, CHUNK_CIPHERTEXT),
      bytes.slice(CHUNK_CIPHERTEXT * 2),
    ]);
    const tampered = bytes.slice();
    tampered[10] = (tampered[10] ?? 0) ^ 0x01;

    await expect(decrypt(header, truncated, alice)).rejects.toThrow();
    await expect(decrypt(header, reordered, alice)).rejects.toThrow();
    await expect(decrypt(header, new Blob([tampered]), alice)).rejects.toThrow();
  });
});

describe('multi-recipient key encapsulation (#25)', () => {
  it('wraps one DEK for every recipient using ECDH P-256 ephemeral keys', async () => {
    const [alice, bob] = await Promise.all([recipient('GALICE'), recipient('GBOB')]);
    const plaintext = patterned(70_000);

    const { header, body } = await encryptFileToEnvelope(new Blob([plaintext]), [alice, bob]);

    expect(header.kem).toBe('ECDH-P256+HKDF-SHA256+A256KW');
    expect(header.recipients.map((r) => r.id)).toEqual(['GALICE', 'GBOB']);
    expect(header.recipients[0]!.epk).toEqual(expect.objectContaining({ kty: 'EC', crv: 'P-256' }));
    expect(header.recipients[0]!.epk).not.toEqual(header.recipients[1]!.epk);
    expect(atob(header.recipients[0]!.wrappedKey)).toHaveLength(40); // AES-KW of a 256-bit key
    expect(await decrypt(header, body, alice)).toEqual(plaintext);
    expect(await decrypt(header, body, bob)).toEqual(plaintext);
  });

  it('adds and removes recipients by editing only the header', async () => {
    const [alice, carol] = await Promise.all([recipient('GALICE'), recipient('GCAROL')]);
    const plaintext = patterned(100_000);
    const { header, body } = await encryptFileToEnvelope(new Blob([plaintext]), [alice]);

    const dek = await unwrapDataKey(header, alice.id, alice.keyPair);
    const withCarol = await addEnvelopeRecipient(header, dek, carol);

    expect(withCarol.recipients.map((r) => r.id)).toEqual(['GALICE', 'GCAROL']);
    expect({ ...withCarol, recipients: [] }).toEqual({ ...header, recipients: [] });
    expect(await decrypt(withCarol, body, carol)).toEqual(plaintext);

    const withoutCarol = removeEnvelopeRecipient(withCarol, 'GCAROL');
    await expect(unwrapDataKey(withoutCarol, carol.id, carol.keyPair)).rejects.toThrow(
      'not a recipient',
    );
    expect(() => removeEnvelopeRecipient(withoutCarol, 'GALICE')).toThrow('last recipient');
  });

  it("binds each wrapped key to its recipient, so another key pair can't unwrap it", async () => {
    const [alice, mallory] = await Promise.all([recipient('GALICE'), recipient('GMALLORY')]);
    const { header } = await encryptFileToEnvelope(new Blob([patterned(10)]), [alice]);

    await expect(unwrapDataKey(header, 'GALICE', mallory.keyPair)).rejects.toThrow();
  });

  it('rejects private JWKs as recipient keys', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

    await expect(
      encryptFileToEnvelope(new Blob([]), [{ id: 'GX', publicKey: privateJwk }]),
    ).rejects.toThrow('public P-256');
  });
});

describe('envelope container format', () => {
  it('serializes as magic ‖ header length ‖ JSON header ‖ body and parses back', async () => {
    const alice = await recipient('GALICE');
    const plaintext = patterned(1234);
    const { header, body } = await encryptFileToEnvelope(new Blob([plaintext]), [alice]);

    const container = serializeEnvelope(header, body);
    const prefix = new Uint8Array(await container.slice(0, 8).arrayBuffer());

    expect(new TextDecoder().decode(prefix.subarray(0, 4))).toBe('HLE1');
    const parsed = await parseEnvelope(container);
    expect(parsed.header).toEqual(header);
    expect(await decrypt(parsed.header, parsed.body, alice)).toEqual(plaintext);
  });

  it('rejects unknown formats and inconsistent headers', async () => {
    const alice = await recipient('GALICE');
    const { header, body } = await encryptFileToEnvelope(new Blob([patterned(10)]), [alice]);

    await expect(parseEnvelope(new Blob(['not an envelope']))).rejects.toThrow('unrecognised');
    await expect(
      parseEnvelope(serializeEnvelope({ ...header, plaintextSize: 11 }, body)),
    ).rejects.toThrow('corrupted');
  });
});
