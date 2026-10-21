# WebAuthn / Passkey Support

This document describes the WebAuthn implementation for passwordless, seedless patient onboarding in Heliora.

## Overview

WebAuthn (Web Authentication) provides a modern, secure way to authenticate users without passwords. Patients can register their devices' biometric sensors (fingerprint, face recognition) or security keys as authentication factors.

### Key Benefits

- **Passwordless**: No passwords to remember or manage
- **Seedless**: No private keys to manage - biometric/device-based
- **Phishing-resistant**: Cryptographic proof of identity
- **HIPAA-compliant**: Can be integrated with existing auth flows
- **Cross-device**: Mobile and desktop support

## Terminology

- **Credential**: A public-private key pair registered with Heliora
- **Authenticator**: A device (computer, phone, security key) that creates and uses credentials
- **Registration**: Process of creating a new credential on a device
- **Authentication**: Process of proving you own a credential
- **Assertion**: The cryptographic proof of authentication

## Usage

### React Hook

```typescript
import { useWebAuthn } from '@/hooks/useWebAuthn';

export function OnboardingForm() {
  const { isAvailable, isLoading, error, register, authenticate } = useWebAuthn();

  const handleRegisterBiometric = async () => {
    const result = await register({
      userId: 'patient-123',
      userName: 'patient@hospital.org',
      userDisplayName: 'John Doe',
      attestation: 'direct', // Use 'none' for reduced attestation
    });

    if (result) {
      // Send result.response to server for verification
      await api.post('/auth/register-passkey', result);
      console.log('Passkey registered!');
    }
  };

  const handleAuthenticate = async () => {
    const result = await authenticate();

    if (result) {
      // Verify on server
      const { token } = await api.post('/auth/verify-passkey', result);
      setAuthToken(token);
    }
  };

  return (
    <div>
      {!isAvailable && <p>WebAuthn not supported</p>}
      {error && <p className="error">{error.message}</p>}
      <button onClick={handleRegisterBiometric} disabled={isLoading || !isAvailable}>
        {isLoading ? 'Setting up...' : 'Register Fingerprint/Face'}
      </button>
      <button onClick={handleAuthenticate} disabled={isLoading || !isAvailable}>
        Sign In with Biometric
      </button>
    </div>
  );
}
```

### Direct Usage

```typescript
import { WebAuthnManager } from '@/lib/auth/WebAuthnManager';

// Check if WebAuthn is available
if (WebAuthnManager.isAvailable()) {
  // Check for biometric support
  const bioSupported = await WebAuthnManager.isUserVerificationAvailable();

  // Register a new credential
  const credential = await WebAuthnManager.registerCredential({
    userId: 'patient-123',
    userName: 'user@hospital.org',
    userDisplayName: 'John Doe',
  });

  // Authenticate with credential
  const assertion = await WebAuthnManager.authenticateCredential();
}
```

## Server-Side Verification

WebAuthn registration and authentication results must be verified on the server to ensure security.

### Registration Verification

1. Decode `clientDataJSON` and `attestationObject`
2. Verify the challenge matches what was sent to client
3. Verify the origin matches your domain
4. Parse attestation object and extract public key
5. Store public key with user account
6. Verify attestation certificate chain (optional, depends on trust model)

### Authentication Verification

1. Decode `clientDataJSON`, `authenticatorData`, and `signature`
2. Verify the challenge matches
3. Verify the origin matches your domain
4. Extract the user handle
5. Use stored public key to verify the signature
6. Check signature counter to detect cloned authenticators

## Supported Authenticators

### Platform Authenticators (Built-in)
- **Windows Hello** - Windows 11/10 using TPM or software
- **Touch ID** - macOS and iOS
- **Face ID** - iOS and newer macOS
- **Android Biometric Framework** - Android 7+
- **Windows Biometric Framework** - Windows 10+

### Cross-Platform Authenticators (External Keys)
- Security keys (FIDO2 USB keys)
- Hardware wallets that support WebAuthn
- Mobile devices used from different machines

## Patient Onboarding Flow

### Recommended Flow for Healthcare

```
1. Patient initiates account creation
   ↓
2. System checks WebAuthn availability
   ↓
3. If available:
   - Offer biometric registration
   - Show "Set up fingerprint/face" prompt
   - Patient confirms with device biometric
   - System stores credential
   ↓
4. Account created and secured by biometric
   ↓
5. For future logins:
   - Patient selects "Sign in with biometric"
   - Authenticates with fingerprint/face
   - No password needed
```

### Fallback for Unsupported Devices

If WebAuthn is not available:
- Offer traditional password-based registration
- Can be upgraded to WebAuthn later when device supports it

## Security Considerations

### Best Practices

1. **Always use HTTPS**: WebAuthn only works on secure origins
2. **Verify on server**: Never trust client-side assertions
3. **Check origin**: Prevent phishing through origin verification
4. **Monitor sign-in counter**: Detect authenticator cloning
5. **Support credential management**: Allow users to manage registered devices
6. **Backup credentials**: Encourage users to register multiple devices
7. **Recovery methods**: Provide account recovery without WebAuthn

### Compliance

- **HIPAA**: WebAuthn helps meet authentication requirements
- **GDPR**: No password storage, minimal biometric data on server
- **PCI-DSS**: Strong multi-factor authentication option
- **SOC 2**: Supports cryptographic authentication controls

## Error Handling

```typescript
const { register, authenticate, error } = useWebAuthn();

// Handle registration errors
try {
  const result = await register(options);
} catch (err) {
  if (err.message.includes('not supported')) {
    // WebAuthn not available
  } else if (err.message.includes('cancelled')) {
    // User cancelled
  } else if (err.message.includes('timeout')) {
    // Authentication took too long
  }
}
```

## Limitations

1. **Browser support**: Older browsers may not support WebAuthn
2. **Authenticator availability**: Some devices don't have biometric sensors
3. **Domain-bound**: Credentials only work on registered domain
4. **No password fallback**: Requires account recovery method
5. **Attestation limitations**: May be privacy-sensitive in some regions

## Further Reading

- [MDN Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)
- [FIDO2 Specification](https://fidoalliance.org/fido2/)
- [WebAuthn Security Considerations](https://www.w3.org/TR/webauthn-2/#sctn-security-considerations)
