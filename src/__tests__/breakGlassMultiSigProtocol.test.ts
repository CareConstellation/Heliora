import { Keypair } from '@stellar/stellar-sdk';
import { BreakGlassMultiSigProtocol } from '@/lib/breakGlassMultiSigProtocol';

describe('BreakGlassMultiSigProtocol', () => {
  it('requires >=2 signatures before access is granted', () => {
    const protocol = new BreakGlassMultiSigProtocol();
    const initiator = Keypair.random();
    const signerA = Keypair.random();
    const signerB = Keypair.random();
    const keys = [
      protocol.initializeBreakGlassKey(signerA, 'hospital_director'),
      protocol.initializeBreakGlassKey(signerB, 'chief_medical_officer'),
    ];

    let request = protocol.createBreakGlassRequest(initiator, 'emergency_admin', Keypair.random().publicKey(), 'life_threatening', 2);
    const first = protocol.submitApproval(request, signerA, 'hospital_director');
    request = first.requestUpdated;
    expect(first.approved).toBe(false);

    const second = protocol.submitApproval(request, signerB, 'chief_medical_officer');
    request = second.requestUpdated;
    expect(second.approved).toBe(true);

    const exec = protocol.executeBreakGlassAccess(request, keys);
    expect(exec.accessGranted).toBe(true);
    expect(exec.accessToken).toContain('token_');
  });
});
