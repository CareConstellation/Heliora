/**
 * Minimal (k,n) Shamir Secret Sharing over GF(256), split byte-by-byte
 * (issue #36). Guardian key-assignment UI and encrypted-share transport are
 * not covered here - this is just the split/combine primitive.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // Generator 0x03 (x XOR xtime(x)), not 0x02 - 2 is not a primitive
    // element of this field and would leave LOG entries unfilled.
    const xtime = (x & 0x80 ? (x << 1) ^ 0x11b : x << 1) & 0xff;
    x = xtime ^ x;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

export interface Share { x: number; ys: Uint8Array }

/** Splits secret into n shares, any k of which reconstruct it. */
export function splitSecret(secret: Uint8Array, k: number, n: number): Share[] {
  const shares: Share[] = Array.from({ length: n }, (_, i) => ({ x: i + 1, ys: new Uint8Array(secret.length) }));
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs = [secret[byteIdx], ...Array.from({ length: k - 1 }, () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0)];
    for (const share of shares) {
      let y = 0;
      for (let c = coeffs.length - 1; c >= 0; c--) y = gfMul(y, share.x) ^ coeffs[c]!;
      share.ys[byteIdx] = y;
    }
  }
  return shares;
}

/** Reconstructs the secret from k or more shares via Lagrange interpolation at x=0. */
export function combineShares(shares: Share[]): Uint8Array {
  const len = shares[0]!.ys.length;
  const out = new Uint8Array(len);
  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1, den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = gfMul(num, shares[j]!.x);
        den = gfMul(den, shares[i]!.x ^ shares[j]!.x);
      }
      acc ^= gfMul(gfMul(shares[i]!.ys[byteIdx]!, num), EXP[(255 - LOG[den]!) % 255]!);
    }
    out[byteIdx] = acc;
  }
  return out;
}
