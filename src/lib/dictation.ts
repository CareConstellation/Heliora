/**
 * Clinical dictation helpers: turns raw speech-recognition transcripts into
 * formatted notes by applying spoken punctuation/formatting commands.
 */

/** Terms passed to the recogniser as hints so it prefers medical spellings. */
export const MEDICAL_VOCABULARY = [
  'hypertension',
  'tachycardia',
  'bradycardia',
  'dyspnea',
  'edema',
  'auscultation',
  'bilateral',
  'afebrile',
  'normocephalic',
  'erythema',
  'myocardial infarction',
  'atrial fibrillation',
  'COPD',
  'metformin',
  'lisinopril',
  'amoxicillin',
  'ibuprofen',
  'milligrams',
  'PRN',
  'BID',
  'TID',
  'QID',
  'subcutaneous',
  'intravenous',
];

// Order matters: multi-word commands before the words they contain.
const COMMANDS: Array<[RegExp, string]> = [
  [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
  [/\s*\b(?:next|new) line\b\s*/gi, '\n'],
  [/\s*\bfull stop\b/gi, '.'],
  [/\s*\bperiod\b/gi, '.'],
  [/\s*\bcomma\b/gi, ','],
  [/\s*\bcolon\b/gi, ':'],
  [/\s*\bsemicolon\b/gi, ';'],
  [/\s*\bquestion mark\b/gi, '?'],
  [/\s*\bhyphen\b\s*/gi, '-'],
  [/\s*\bslash\b\s*/gi, '/'],
  [/\bopen paren(?:thesis)?\b\s*/gi, '('],
  [/\s*\bclose paren(?:thesis)?\b/gi, ')'],
];

/** Applies spoken commands ("period", "next line", …) and capitalises sentence starts. */
export function parseDictation(transcript: string): string {
  let text = transcript;
  for (const [pattern, replacement] of COMMANDS) text = text.replace(pattern, replacement);
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/([.?!:;,)])(?=[^\s\n.?!:;,)])/g, '$1 ')
    .replace(/(^|[.?!]\s+|\n)([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n');
}

/** Joins dictated text onto existing notes with a single separating space where needed. */
export function appendDictation(existing: string, dictated: string): string {
  if (!dictated) return existing;
  // Continuing mid-sentence: undo the sentence-start capital ("Bilateral" → "bilateral"), but keep acronyms.
  if (existing && !/[.?!\n]\s*$/.test(existing) && /^[A-Z][a-z]/.test(dictated))
    dictated = dictated[0]!.toLowerCase() + dictated.slice(1);
  if (!existing || /\s$/.test(existing) || dictated.startsWith('\n')) return existing + dictated;
  return `${existing} ${dictated}`;
}
