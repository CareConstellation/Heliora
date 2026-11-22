import { resolveAddressInput } from '@/lib/addressBook';

type ContactLike = Parameters<typeof resolveAddressInput>[0][number];
import {
  FederationError,
  isFederatedAddress,
  resolveWalletAddress,
  type FederationResolution,
} from '@/lib/stellar';

export async function resolveInputAddress(
  text: string,
  contacts: ContactLike[] = [],
): Promise<FederationResolution | null> {
  const value = text.trim();
  if (!value) return null;
  const local = resolveAddressInput(value, contacts);
  if (local) return { address: value, publicKey: local, memoType: null, memo: null };
  if (isFederatedAddress(value)) return resolveWalletAddress(value);
  return null;
}

export function federationErrorMessage(err: unknown): string {
  return err instanceof FederationError || err instanceof Error
    ? err.message
    : 'Could not resolve that federated address.';
}
