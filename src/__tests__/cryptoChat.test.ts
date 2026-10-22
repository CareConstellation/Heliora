import {
  createChatEphemeralKeyPair,
  decryptChatMessage,
  deriveChatSessionKey,
  encryptChatMessage,
} from '@/lib/crypto';

describe('teleconsultation chat encryption', () => {
  it('derives the same session key for both ephemeral peers', async () => {
    const alice = await createChatEphemeralKeyPair();
    const bob = await createChatEphemeralKeyPair();
    const aliceKey = await deriveChatSessionKey(
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      'appointment-42',
    );
    const bobKey = await deriveChatSessionKey(
      bob.privateKey,
      bob.publicKey,
      alice.publicKey,
      'appointment-42',
    );
    const payload = await encryptChatMessage(
      'hello doctor',
      aliceKey,
      'appointment-42',
      alice.publicKey,
      0,
    );
    await expect(decryptChatMessage(payload, bobKey)).resolves.toBe('hello doctor');
  });

  it('rejects a modified encrypted payload', async () => {
    const alice = await createChatEphemeralKeyPair();
    const bob = await createChatEphemeralKeyPair();
    const key = await deriveChatSessionKey(
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      'appointment-42',
    );
    const payload = await encryptChatMessage('private', key, 'appointment-42', alice.publicKey, 0);
    payload.ciphertext = `${payload.ciphertext.slice(0, -2)}AA`;
    await expect(decryptChatMessage(payload, key)).rejects.toThrow();
  });

  it('binds ciphertext to its room and sequence metadata', async () => {
    const alice = await createChatEphemeralKeyPair();
    const bob = await createChatEphemeralKeyPair();
    const key = await deriveChatSessionKey(
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      'appointment-42',
    );
    const payload = await encryptChatMessage('private', key, 'appointment-42', alice.publicKey, 1);
    payload.sequence = 2;
    await expect(decryptChatMessage(payload, key)).rejects.toThrow();
    payload.sequence = 1;
    await expect(decryptChatMessage(payload, key, 'another-room')).rejects.toThrow();
  });
});
