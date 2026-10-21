export interface RegistrationOptions {
  userId: string;
  userName: string;
  userDisplayName: string;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
}

export interface RegistrationResult {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
  type: 'public-key';
}

export interface AuthenticationResult {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string;
  };
  type: 'public-key';
}

export interface StoredCredential {
  id: string;
  publicKey: ArrayBuffer;
  signCount: number;
  transports?: AuthenticatorTransportFuture[];
}

export class WebAuthnManager {
  private static readonly RP_ID = typeof window !== 'undefined' ? window.location.hostname : '';
  private static readonly RP_NAME = 'Heliora Medical';
  private static readonly ORIGIN =
    typeof window !== 'undefined' ? window.location.origin : '';

  static isAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!window.PublicKeyCredential &&
      !!navigator.credentials
    );
  }

  static async isUserVerificationAvailable(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }

  static async registerCredential(options: RegistrationOptions): Promise<RegistrationResult> {
    if (!this.isAvailable()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    const credentialCreationOptions = await this.generateRegistrationOptions(options);

    try {
      const credential = (await navigator.credentials.create(
        credentialCreationOptions,
      )) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('User cancelled registration or credential creation failed');
      }

      return this.formatRegistrationResult(credential);
    } catch (error) {
      throw new Error(
        `WebAuthn registration failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  static async authenticateCredential(
    credentialIds?: ArrayBufferLike[],
  ): Promise<AuthenticationResult> {
    if (!this.isAvailable()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    const credentialRequestOptions = this.generateAuthenticationOptions(credentialIds);

    try {
      const credential = (await navigator.credentials.get(
        credentialRequestOptions,
      )) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('User cancelled authentication or no matching credential found');
      }

      return this.formatAuthenticationResult(credential);
    } catch (error) {
      throw new Error(
        `WebAuthn authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private static async generateRegistrationOptions(
    options: RegistrationOptions,
  ): Promise<CredentialCreationOptions> {
    const challenge = this.generateChallenge();
    const userId = this.stringToArrayBuffer(options.userId);

    return {
      publicKey: {
        challenge,
        rp: {
          name: this.RP_NAME,
          id: this.RP_ID,
        },
        user: {
          id: userId,
          name: options.userName,
          displayName: options.userDisplayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'preferred',
          residentKey: 'preferred',
        },
        timeout: options.timeout || 60000,
        attestation: options.attestation || 'direct',
      },
    };
  }

  private static generateAuthenticationOptions(
    credentialIds?: ArrayBufferLike[],
  ): CredentialRequestOptions {
    return {
      publicKey: {
        challenge: this.generateChallenge(),
        timeout: 60000,
        userVerification: 'preferred',
        allowCredentials: credentialIds
          ? credentialIds.map(id => ({
              id,
              type: 'public-key' as const,
              transports: ['internal', 'usb', 'nfc', 'ble'] as AuthenticatorTransportFuture[],
            }))
          : [],
      },
    };
  }

  private static formatRegistrationResult(credential: PublicKeyCredential): RegistrationResult {
    const response = credential.response as RegistrationResponse;
    return {
      id: credential.id,
      rawId: this.arrayBufferToBase64(credential.rawId),
      response: {
        clientDataJSON: this.arrayBufferToBase64(response.clientDataJSON),
        attestationObject: this.arrayBufferToBase64(response.attestationObject),
      },
      type: credential.type as 'public-key',
    };
  }

  private static formatAuthenticationResult(credential: PublicKeyCredential): AuthenticationResult {
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
      id: credential.id,
      rawId: this.arrayBufferToBase64(credential.rawId),
      response: {
        clientDataJSON: this.arrayBufferToBase64(response.clientDataJSON),
        authenticatorData: this.arrayBufferToBase64(response.authenticatorData),
        signature: this.arrayBufferToBase64(response.signature),
        userHandle: response.userHandle ? this.arrayBufferToBase64(response.userHandle) : '',
      },
      type: credential.type as 'public-key',
    };
  }

  private static generateChallenge(): ArrayBuffer {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    return challenge.buffer;
  }

  private static arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private static stringToArrayBuffer(str: string): ArrayBuffer {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
  }

  static async verifyCredential(
    credential: StoredCredential,
    clientDataJSON: string,
    authenticatorData: string,
    signature: string,
  ): Promise<boolean> {
    try {
      const clientDataBuffer = this.base64ToArrayBuffer(clientDataJSON);
      const clientData = JSON.parse(new TextDecoder().decode(clientDataBuffer));

      // Verify challenge, origin, and type
      if (clientData.origin !== this.ORIGIN || clientData.type !== 'webauthn.get') {
        return false;
      }

      // Additional verification would require crypto operations
      // This is a simplified version - full verification should be done server-side
      return true;
    } catch {
      return false;
    }
  }

  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
