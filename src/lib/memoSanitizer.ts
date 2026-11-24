/**
 * Sanitizes free text before it becomes a Stellar `MEMO_TEXT` (issue #203).
 *
 * A text memo holds at most 28 bytes of UTF-8, not 28 characters, so a long
 * string, an emoji, or accented text overflows it and the SDK throws while the
 * transaction is being built. Control and invisible formatting characters are
 * also removed: they render as nothing or reorder text, which makes a memo
 * look different from what is actually signed.
 */

/** Stellar `MEMO_TEXT` limit, in UTF-8 bytes. */
export const MAX_TEXT_MEMO_BYTES = 28

/**
 * Characters that are not shown as a glyph or change how text is laid out:
 * C0/C1 controls, DEL, soft hyphen, zero-width and directional marks and
 * isolates/embeddings, line/paragraph separators, BOM and the interlinear
 * annotation marks.
 */
const NON_PRINTABLE = /[\u0000-\u001F\u007F-\u009F­؜᠎​-‏ -‮⁠-⁯﻿￹-￻]/gu

const encoder = new TextEncoder()

export interface SanitizedMemo {
  /** The memo to put in the transaction: printable, at most 28 UTF-8 bytes. */
  memo: string
  /** True when characters were cut to fit the byte limit. */
  truncated: boolean
  /** True when non-printable characters were removed. */
  stripped: boolean
  /** Length in UTF-8 bytes of the input, so a UI can say how much was lost. */
  originalBytes: number
}

/** Byte length of `text` in UTF-8. */
export function utf8Length(text: string): number {
  return encoder.encode(text).length
}

/**
 * Strips non-printable characters, trims, and cuts the text to
 * {@link MAX_TEXT_MEMO_BYTES} UTF-8 bytes on a code-point boundary, so a
 * multi-byte character is dropped whole and never split into invalid UTF-8.
 */
export function sanitizeTextMemo(input: string, maxBytes: number = MAX_TEXT_MEMO_BYTES): SanitizedMemo {
  const originalBytes = utf8Length(input)
  // NFC first, so "e" + combining acute becomes one 2-byte character instead of 3 bytes.
  const normalized = input.normalize('NFC')
  const printable = normalized.replace(NON_PRINTABLE, '')
  const stripped = printable.length !== normalized.length
  const trimmed = printable.trim()

  let memo = ''
  let bytes = 0
  let truncated = false
  for (const char of trimmed) {
    const size = utf8Length(char)
    if (bytes + size > maxBytes) {
      truncated = true
      break
    }
    memo += char
    bytes += size
  }
  // Cutting can leave trailing whitespace; it is not meaningful in a memo.
  return { memo: memo.trimEnd(), truncated, stripped, originalBytes }
}

/** A short, user-facing note about what changed, or null when the memo was used as typed. */
export function memoAlert(result: SanitizedMemo): string | null {
  if (result.truncated) {
    return `Memo shortened to ${result.memo === '' ? 0 : utf8Length(result.memo)} of ${MAX_TEXT_MEMO_BYTES} bytes allowed (it was ${result.originalBytes} bytes).`
  }
  if (result.stripped) return 'Hidden or non-printable characters were removed from the memo.'
  return null
}
