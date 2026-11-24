export { WebAuthnManager } from './WebAuthnManager';
export { verifyRegistrationAttestation } from './attestation';
export {
  getHardwareAuthenticator,
  isSoftwareAuthenticator,
  isVerifiedHardwareAaguid,
  HARDWARE_AAGUID_REGISTRY,
} from './aaguidRegistry';
export type {
  RegistrationOptions,
  RegistrationResult,
  AuthenticationResult,
  StoredCredential,
} from './WebAuthnManager';
export type { VerifiedAttestation } from './attestation';
