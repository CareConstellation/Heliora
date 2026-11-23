import { MAX_TEXT_MEMO_BYTES, memoAlert, sanitizeTextMemo, utf8Length } from '@/lib/memoSanitizer'

describe('sanitizeTextMemo', () => {
  it('passes a short printable memo through unchanged', () => {
    expect(sanitizeTextMemo('Consult 2026-11-23')).toEqual({
      memo: 'Consult 2026-11-23',
      truncated: false,
      stripped: false,
      originalBytes: 18,
    })
  })

  it('accepts exactly 28 bytes and truncates 29', () => {
    const exact = 'a'.repeat(MAX_TEXT_MEMO_BYTES)
    expect(sanitizeTextMemo(exact)).toMatchObject({ memo: exact, truncated: false })
    const over = sanitizeTextMemo(exact + 'b')
    expect(over.memo).toBe(exact)
    expect(over.truncated).toBe(true)
  })

  it('counts bytes, not characters, for multi-byte text', () => {
    // "é" is 2 bytes: 14 of them fill the memo, the 15th must go.
    const result = sanitizeTextMemo('é'.repeat(15))
    expect(result.memo).toBe('é'.repeat(14))
    expect(utf8Length(result.memo)).toBe(28)
    expect(result.truncated).toBe(true)
  })

  it('never splits a multi-byte character at the boundary', () => {
    // 27 ASCII bytes + a 2-byte char would be 29: the char is dropped whole.
    const result = sanitizeTextMemo('a'.repeat(27) + 'é')
    expect(result.memo).toBe('a'.repeat(27))
    expect(result.memo).not.toContain('�')
    // 26 ASCII bytes + 2-byte char = 28: it fits.
    expect(sanitizeTextMemo('a'.repeat(26) + 'é').memo).toBe('a'.repeat(26) + 'é')
  })

  it('does not split a 4-byte emoji (surrogate pair)', () => {
    const result = sanitizeTextMemo('a'.repeat(25) + '😀')
    expect(result.memo).toBe('a'.repeat(25))
    expect(sanitizeTextMemo('a'.repeat(24) + '😀').memo).toBe('a'.repeat(24) + '😀')
    expect(utf8Length(sanitizeTextMemo('😀'.repeat(10)).memo)).toBeLessThanOrEqual(28)
  })

  it('handles CJK text at 3 bytes per character', () => {
    const result = sanitizeTextMemo('診察予約'.repeat(5))
    expect(utf8Length(result.memo)).toBeLessThanOrEqual(28)
    expect(result.memo).toBe('診察予約'.repeat(2) + '診')
    expect(result.truncated).toBe(true)
  })

  it('normalizes combining marks so they cost fewer bytes', () => {
    const decomposed = 'é'.repeat(14) // 3 bytes each = 42 bytes raw, 28 once composed
    const result = sanitizeTextMemo(decomposed)
    expect(result.memo).toBe('é'.repeat(14))
    expect(result.truncated).toBe(false)
    expect(result.originalBytes).toBe(42)
  })

  it('strips control characters, zero-width and bidi characters', () => {
    const result = sanitizeTextMemo('Pay\u0000ment​ ‮ok⁦﻿\n\t')
    expect(result.memo).toBe('Payment ok')
    expect(result.stripped).toBe(true)
  })

  it('trims whitespace and returns an empty memo for blank input', () => {
    expect(sanitizeTextMemo('   ').memo).toBe('')
    expect(sanitizeTextMemo('').memo).toBe('')
    expect(sanitizeTextMemo('  hi  ').memo).toBe('hi')
  })

  it('does not leave trailing whitespace after truncation', () => {
    expect(sanitizeTextMemo('a'.repeat(27) + ' b').memo).toBe('a'.repeat(27))
  })

  it('honours a custom byte limit', () => {
    expect(sanitizeTextMemo('abcdef', 4).memo).toBe('abcd')
  })
})

describe('memoAlert', () => {
  it('is null when nothing changed', () => {
    expect(memoAlert(sanitizeTextMemo('hello'))).toBeNull()
  })

  it('reports truncation with the byte counts', () => {
    const alert = memoAlert(sanitizeTextMemo('a'.repeat(40)))
    expect(alert).toContain('28 of 28')
    expect(alert).toContain('40 bytes')
  })

  it('reports stripped characters when nothing was truncated', () => {
    expect(memoAlert(sanitizeTextMemo('hi​'))).toMatch(/non-printable/)
  })
})
