'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MEDICAL_VOCABULARY, parseDictation } from '@/lib/dictation';

// Minimal Web Speech API typings (not in TypeScript's DOM lib).
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  grammars?: unknown;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => Recognition;
type GrammarListCtor = new () => { addFromString: (grammar: string, weight: number) => void };

const speechWindow = () =>
  (typeof window === 'undefined' ? {} : window) as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
    SpeechGrammarList?: GrammarListCtor;
    webkitSpeechGrammarList?: GrammarListCtor;
  };

export type DictationStatus = 'idle' | 'listening' | 'paused';

/**
 * Browser speech-to-text for clinical notes. Final phrases are parsed for spoken
 * formatting commands and handed to `onText`; `interim` previews the phrase in progress.
 */
export function useDictation(onText: (text: string) => void) {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const statusRef = useRef<DictationStatus>('idle');
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const setBoth = (s: DictationStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    const w = speechWindow();
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSupported(!!Ctor);
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    const GrammarList = w.SpeechGrammarList ?? w.webkitSpeechGrammarList;
    if (GrammarList) {
      const list = new GrammarList();
      list.addFromString(
        `#JSGF V1.0; grammar medical; public <term> = ${MEDICAL_VOCABULARY.join(' | ')} ;`,
        1,
      );
      rec.grammars = list;
    }

    rec.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) onTextRef.current(parseDictation(r[0].transcript.trim()));
        else pending += r[0].transcript;
      }
      setInterim(pending);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(
        e.error === 'not-allowed' ? 'Microphone permission denied.' : `Dictation error: ${e.error}`,
      );
      setBoth('idle');
    };
    // Browsers end continuous sessions after silence; keep going until the user pauses or stops.
    rec.onend = () => {
      setInterim('');
      if (statusRef.current === 'listening') rec.start();
    };
    recRef.current = rec;
    return () => {
      statusRef.current = 'idle';
      rec.onend = null;
      rec.stop();
    };
  }, []);

  const start = useCallback(() => {
    setError(null);
    if (statusRef.current === 'listening') return;
    setBoth('listening');
    recRef.current?.start();
  }, []);

  const halt = useCallback((next: DictationStatus) => {
    const wasListening = statusRef.current === 'listening';
    setBoth(next);
    if (wasListening) recRef.current?.stop();
  }, []);

  const pause = useCallback(() => halt('paused'), [halt]);
  const stop = useCallback(() => halt('idle'), [halt]);

  return { supported, status, interim, error, start, pause, resume: start, stop };
}
