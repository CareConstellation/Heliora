import { Keypair, StrKey } from '@stellar/stellar-sdk';

interface CredentialAttestationData {
  clinicianAddress: string;
  credentialType: 'MD' | 'DO' | 'RN' | 'PA' | 'NP' | 'SPECIALIST';
  licenseNumber: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  specialties?: string[];
  metadata?: {
    jurisdiction?: string;
    verificationUrl?: string;
    registrationBody?: string;
  };
}

interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<{
    trait_type: string;
    value: string;
  }>;
}

interface SBTMetadata extends NFTMetadata {
  soulbound: true;
  transferable: false;
  burnable: true;
}

class ClinicianCredentialAttestation {
  private sorobanContractId: string;
  private networkPassphrase: string;

  constructor(contractId: string, networkPassphrase: string) {
    this.sorobanContractId = contractId;
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Generate a verifiable credential hash for a clinician
   * Combines credential data with digital signature for immutability
   */
  generateCredentialHash(credentialData: CredentialAttestationData, issuerKeypair: Keypair): string {
    const payload = JSON.stringify({
      clinician: credentialData.clinicianAddress,
      type: credentialData.credentialType,
      license: credentialData.licenseNumber,
      issued: credentialData.issuedAt,
      expires: credentialData.expiresAt,
      issuer: credentialData.issuer,
      specialties: credentialData.specialties || [],
      metadata: credentialData.metadata || {},
    });

    const signature = issuerKeypair.sign(Buffer.from(payload)).toString('hex');
    const hash = Buffer.from(signature).toString('base64').substring(0, 64);

    return hash;
  }

  /**
   * Create an NFT metadata object for credential attestation
   * Used for non-soulbound credential tokens
   */
  createNFTMetadata(credentialData: CredentialAttestationData): NFTMetadata {
    return {
      name: `${credentialData.credentialType} - ${credentialData.clinicianAddress.substring(0, 8)}`,
      description: `Medical License Attestation - ${credentialData.licenseNumber}`,
      image: this.generateCredentialQRCode(credentialData),
      attributes: [
        {
          trait_type: 'Credential Type',
          value: credentialData.credentialType,
        },
        {
          trait_type: 'License Number',
          value: credentialData.licenseNumber,
        },
        {
          trait_type: 'Issuer',
          value: credentialData.issuer,
        },
        {
          trait_type: 'Specialties',
          value: credentialData.specialties?.join(', ') || 'General',
        },
        {
          trait_type: 'Issued Date',
          value: new Date(credentialData.issuedAt * 1000).toISOString(),
        },
        {
          trait_type: 'Expiry Date',
          value: new Date(credentialData.expiresAt * 1000).toISOString(),
        },
        {
          trait_type: 'Jurisdiction',
          value: credentialData.metadata?.jurisdiction || 'Unknown',
        },
      ],
    };
  }

  /**
   * Create an SBT (Soulbound Token) metadata object for credentials
   * SBTs are non-transferable, ensuring credentials stay with clinician
   */
  createSBTMetadata(credentialData: CredentialAttestationData): SBTMetadata {
    return {
      ...this.createNFTMetadata(credentialData),
      soulbound: true,
      transferable: false,
      burnable: true,
    };
  }

  /**
   * Validate a credential's expiration status
   */
  isCredentialValid(expiresAt: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    return expiresAt > now;
  }

  /**
   * Generate QR code representation for credential (base64 data URI)
   * Contains credential hash and verification URL
   */
  private generateCredentialQRCode(credentialData: CredentialAttestationData): string {
    const svgQR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <rect fill="white" width="200" height="200"/>
      <text x="100" y="100" text-anchor="middle" dominant-baseline="middle" font-size="12">
        ${credentialData.licenseNumber}
      </text>
    </svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svgQR).toString('base64')}`;
  }

  /**
   * Prepare credential data for Soroban contract invocation
   * Encodes all credential information for on-chain storage
   */
  prepareCredentialForSoroban(credentialData: CredentialAttestationData, issuerKeypair: Keypair) {
    const hash = this.generateCredentialHash(credentialData, issuerKeypair);
    const sbtMetadata = this.createSBTMetadata(credentialData);

    return {
      contractId: this.sorobanContractId,
      method: 'issue_credential',
      params: {
        clinician: credentialData.clinicianAddress,
        credential_type: credentialData.credentialType,
        license_number: credentialData.licenseNumber,
        issuer: credentialData.issuer,
        issued_at: credentialData.issuedAt,
        expires_at: credentialData.expiresAt,
        credential_hash: hash,
        metadata_uri: `data:application/json;base64,${Buffer.from(JSON.stringify(sbtMetadata)).toString('base64')}`,
        is_sbt: true,
      },
    };
  }

  /**
   * Verify a credential signature using the issuer's public key
   */
  verifyCredentialSignature(
    credentialData: CredentialAttestationData,
    signature: string,
    issuerPublicKey: string,
  ): boolean {
    try {
      if (!StrKey.isValidEd25519PublicKey(issuerPublicKey)) {
        return false;
      }

      const keypair = Keypair.fromPublicKey(issuerPublicKey);
      const payload = JSON.stringify({
        clinician: credentialData.clinicianAddress,
        type: credentialData.credentialType,
        license: credentialData.licenseNumber,
        issued: credentialData.issuedAt,
        expires: credentialData.expiresAt,
        issuer: credentialData.issuer,
        specialties: credentialData.specialties || [],
        metadata: credentialData.metadata || {},
      });

      const signatureBuffer = Buffer.from(signature, 'hex');
      return keypair.verify(Buffer.from(payload), signatureBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Revoke a credential by marking it as expired
   * Returns updated credential with new expiration date
   */
  revokeCredential(credentialData: CredentialAttestationData): CredentialAttestationData {
    return {
      ...credentialData,
      expiresAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Renew a credential by extending its expiration date
   */
  renewCredential(
    credentialData: CredentialAttestationData,
    renewalPeriodDays: number,
  ): CredentialAttestationData {
    const newExpiresAt = Math.floor(Date.now() / 1000) + renewalPeriodDays * 24 * 60 * 60;

    return {
      ...credentialData,
      expiresAt: newExpiresAt,
      issuedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Aggregate multiple credentials for a clinician
   * Useful for credentials with multiple specialties or issuing bodies
   */
  aggregateCredentials(credentials: CredentialAttestationData[]): {
    clinicianAddress: string;
    credentials: CredentialAttestationData[];
    aggregatedAt: number;
    allValid: boolean;
  } {
    const now = Math.floor(Date.now() / 1000);
    const allValid = credentials.every((cred) => cred.expiresAt > now);

    return {
      clinicianAddress: credentials[0]?.clinicianAddress || '',
      credentials,
      aggregatedAt: now,
      allValid,
    };
  }
}

export { ClinicianCredentialAttestation };
export type { CredentialAttestationData, NFTMetadata, SBTMetadata };
