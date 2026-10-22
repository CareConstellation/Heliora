import { appendDictation, parseDictation } from '@/lib/dictation';

describe('parseDictation', () => {
  it('applies spoken punctuation and capitalises sentences', () => {
    expect(parseDictation('patient is afebrile period lungs clear comma no wheeze period')).toBe(
      'Patient is afebrile. Lungs clear, no wheeze.',
    );
  });

  it('handles line and paragraph commands', () => {
    expect(
      parseDictation('assessment colon stable next line plan colon follow up new paragraph signed'),
    ).toBe('Assessment: stable\nPlan: follow up\n\nSigned');
  });

  it('handles parentheses, slashes and question marks', () => {
    expect(
      parseDictation('BP 120 slash 80 open paren seated close paren any pain question mark'),
    ).toBe('BP 120/80 (seated) any pain?');
  });
});

describe('appendDictation', () => {
  it('starts empty notes with the dictated text', () => {
    expect(appendDictation('', 'Stable.')).toBe('Stable.');
  });

  it('continues mid-sentence in lower case but keeps acronyms', () => {
    expect(appendDictation('History of', 'Hypertension.')).toBe('History of hypertension.');
    expect(appendDictation('History of', 'COPD.')).toBe('History of COPD.');
  });

  it('keeps the capital after a finished sentence', () => {
    expect(appendDictation('Stable.', 'Plan to discharge.')).toBe('Stable. Plan to discharge.');
  });
});
