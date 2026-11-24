export interface HardwareAuthenticator {
  name: string;
  vendor: string;
}

export const HARDWARE_AAGUID_REGISTRY: Record<string, HardwareAuthenticator> = {
  'cb69481e-8ff7-4039-93ec-0a2729a154a8': { name: 'YubiKey 5 Series', vendor: 'Yubico' },
  'ee882879-721c-4913-9775-3dfcce97072a': { name: 'YubiKey 5 Series', vendor: 'Yubico' },
  'fa2b99dc-9e39-4257-8f92-4a30d23c4118': { name: 'YubiKey 5 NFC', vendor: 'Yubico' },
  '2fc0579f-8113-47ea-b116-bb5a8db9202a': { name: 'YubiKey 5 NFC', vendor: 'Yubico' },
  'c5ef55ff-ad9a-4b9f-b580-adebafe026d0': { name: 'YubiKey 5Ci', vendor: 'Yubico' },
  '73bb0cd4-e502-49b8-9c6f-b59445bf720b': { name: 'YubiKey 5 FIPS', vendor: 'Yubico' },
  'c1f9a0bc-1dd2-404a-b27f-8e29047a43fd': { name: 'YubiKey 5 FIPS with NFC', vendor: 'Yubico' },
  'a25342c0-3cdc-4414-8e46-f4807fca511c': { name: 'YubiKey 5 NFC', vendor: 'Yubico' },
  'd8522d9f-575b-4866-88a9-ba99fa02f35b': { name: 'YubiKey Bio', vendor: 'Yubico' },
  'f8a011f3-8c0a-4d15-8006-17111f9edc7d': { name: 'Security Key by Yubico', vendor: 'Yubico' },
  'b92c3f9a-c014-4056-887f-140a2501163b': { name: 'Security Key by Yubico', vendor: 'Yubico' },
  '6d44ba9b-f6ec-2e49-b930-0c8fe920cb73': { name: 'Security Key NFC', vendor: 'Yubico' },
  '149a2021-8ef6-4133-96b8-81f8d5b7f1f5': { name: 'Security Key NFC', vendor: 'Yubico' },
  '0bb43545-fd2c-4185-87dd-feb0b2916ace': { name: 'Security Key NFC - Enterprise', vendor: 'Yubico' },
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': { name: 'Google Password Manager', vendor: 'Google' },
  'adce0002-35bc-c60a-648b-0b25f1f05503': { name: 'Chrome on Mac', vendor: 'Google' },
  '08987058-cadc-4b81-b6e1-30de50dcbe96': { name: 'Windows Hello', vendor: 'Microsoft' },
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': { name: 'Windows Hello', vendor: 'Microsoft' },
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': { name: 'Windows Hello', vendor: 'Microsoft' },
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': { name: 'iCloud Keychain', vendor: 'Apple' },
  '531126d6-e717-415c-9320-3d9aa6981239': { name: 'Dashlane', vendor: 'Dashlane' },
  'bada5566-a7aa-401f-bd96-45619a55120d': { name: '1Password', vendor: '1Password' },
  'b84e4048-15dc-4dd0-8640-f4f60813c8af': { name: 'NordPass', vendor: 'NordPass' },
  '0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6': { name: 'Keeper', vendor: 'Keeper' },
  'f3809540-7f14-49c1-a8b3-8f813b225541': { name: 'Enpass', vendor: 'Enpass' },
};

const SOFTWARE_AAGUIDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'adce0002-35bc-c60a-648b-0b25f1f05503',
  '08987058-cadc-4b81-b6e1-30de50dcbe96',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4',
  '531126d6-e717-415c-9320-3d9aa6981239',
  'bada5566-a7aa-401f-bd96-45619a55120d',
  'b84e4048-15dc-4dd0-8640-f4f60813c8af',
  '0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6',
  'f3809540-7f14-49c1-a8b3-8f813b225541',
]);

export function isSoftwareAuthenticator(aaguid: string): boolean {
  return SOFTWARE_AAGUIDS.has(aaguid.toLowerCase());
}

export function getHardwareAuthenticator(aaguid: string): HardwareAuthenticator | undefined {
  return HARDWARE_AAGUID_REGISTRY[aaguid.toLowerCase()];
}

export function isVerifiedHardwareAaguid(aaguid: string): boolean {
  const normalized = aaguid.toLowerCase();
  return !isSoftwareAuthenticator(normalized) && Boolean(HARDWARE_AAGUID_REGISTRY[normalized]);
}
