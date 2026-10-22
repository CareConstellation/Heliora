'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import {
  createChatEphemeralKeyPair,
  decryptChatMessage,
  deriveChatSessionKey,
  destroyChatSession,
  encryptChatMessage,
} from '@/lib/crypto';
import type { ChatEphemeralKeyPair, EncryptedChatPayload } from '@/lib/crypto';

interface Props {
  appointmentId: string;
}

interface ChatMessage {
  id: string;
  text: string;
  mine: boolean;
}

type RoomFrame =
  | { type: 'chat_key'; appointmentId: string; participantId: string; publicKey: JsonWebKey }
  | { type: 'chat_message'; appointmentId: string; payload: EncryptedChatPayload }
  | { type: 'chat_end'; appointmentId: string };

function chatSocketUrl(appointmentId: string): string {
  const configured = process.env.NEXT_PUBLIC_CHAT_WS_URL;
  if (configured)
    return `${configured.replace(/\/$/, '')}/appointments/${encodeURIComponent(appointmentId)}/chat`;
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (api) {
    const url = new URL(api);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${url.toString().replace(/\/$/, '')}/appointments/${encodeURIComponent(appointmentId)}/chat`;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/appointments/${encodeURIComponent(appointmentId)}/chat`;
  }
  return '';
}

function samePublicKey(a: JsonWebKey, b: JsonWebKey): boolean {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

export default function EncryptedChat({ appointmentId }: Props) {
  const walletAddress = useAuthStore((state) => state.walletAddress);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'connecting' | 'waiting' | 'ready' | 'ended' | 'error'>(
    'connecting',
  );
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const keyPairRef = useRef<ChatEphemeralKeyPair | null>(null);
  const sessionRef = useRef<{ key: CryptoKey | null }>({ key: null });
  const peerKeyRef = useRef<JsonWebKey | null>(null);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);

  const destroy = useCallback(
    (notifyPeer: boolean) => {
      if (notifyPeer && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({ type: 'chat_end', appointmentId } satisfies RoomFrame),
        );
      }
      destroyChatSession(sessionRef.current);
      keyPairRef.current = null;
      peerKeyRef.current = null;
      sequenceRef.current = 0;
      setMessages([]);
      setDraft('');
      setStatus('ended');
      socketRef.current?.close(1000, 'consultation ended');
      socketRef.current = null;
    },
    [appointmentId],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const url = chatSocketUrl(appointmentId);
    if (!url) {
      setStatus('error');
      setError('Encrypted chat is not configured.');
      return () => {
        mountedRef.current = false;
      };
    }

    void (async () => {
      try {
        const keyPair = await createChatEphemeralKeyPair();
        if (cancelled) return;
        keyPairRef.current = keyPair;
        const socket = new WebSocket(url);
        socketRef.current = socket;
        socket.onopen = () => {
          if (!mountedRef.current) return;
          setStatus('waiting');
          socket.send(
            JSON.stringify({
              type: 'chat_key',
              appointmentId,
              participantId: walletAddress ?? 'anonymous',
              publicKey: keyPair.publicKey,
            } satisfies RoomFrame),
          );
        };
        socket.onmessage = (event) => {
          try {
            const frame = JSON.parse(String(event.data)) as RoomFrame;
            if (
              frame.appointmentId !== appointmentId ||
              (frame.type === 'chat_key' && frame.participantId === (walletAddress ?? 'anonymous'))
            )
              return;
            if (frame.type === 'chat_end') {
              destroyChatSession(sessionRef.current);
              setMessages([]);
              setDraft('');
              setStatus('ended');
              socket.close(1000, 'peer ended consultation');
              return;
            }
            if (frame.type === 'chat_key') {
              if (!keyPairRef.current) return;
              peerKeyRef.current = frame.publicKey;
              void deriveChatSessionKey(
                keyPairRef.current.privateKey,
                keyPairRef.current.publicKey,
                frame.publicKey,
                appointmentId,
              )
                .then((key) => {
                  if (!mountedRef.current) return;
                  sessionRef.current.key = key;
                  setStatus('ready');
                  setError(null);
                })
                .catch(() => setError('Could not establish the encrypted chat session.'));
              return;
            }
            if (frame.type === 'chat_message') {
              const sessionKey = sessionRef.current.key;
              const peerKey = peerKeyRef.current;
              if (!sessionKey || !peerKey || !samePublicKey(frame.payload.senderKey, peerKey))
                return;
              void decryptChatMessage(frame.payload, sessionKey, appointmentId)
                .then((text) => {
                  if (mountedRef.current)
                    setMessages((current) => [
                      ...current,
                      {
                        id: `${frame.payload.sequence}-${frame.payload.sessionId}`,
                        text,
                        mine: false,
                      },
                    ]);
                })
                .catch(() => setError('A chat message failed authentication and was discarded.'));
            }
          } catch {
            setError('Received an invalid chat frame.');
          }
        };
        socket.onerror = () => {
          if (mountedRef.current) {
            setStatus('error');
            setError('Encrypted chat connection failed.');
          }
        };
        socket.onclose = () => {
          if (mountedRef.current && status !== 'ended') {
            destroyChatSession(sessionRef.current);
            setStatus('ended');
            setMessages([]);
          }
        };
      } catch {
        if (mountedRef.current) {
          setStatus('error');
          setError('Could not initialize encrypted chat.');
        }
      }
    })();

    const onEnded = () => destroy(false);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'consultation-ended' || event.data?.type === 'call-ended') onEnded();
    };
    window.addEventListener('consultation-ended', onEnded);
    window.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener('consultation-ended', onEnded);
      window.removeEventListener('message', onMessage);
      destroy(false);
    };
    // The socket's close handler intentionally uses the current room lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, walletAddress]);

  async function sendMessage() {
    const text = draft.trim();
    const keyPair = keyPairRef.current;
    const sessionKey = sessionRef.current.key;
    const socket = socketRef.current;
    if (!text || !keyPair || !sessionKey || !socket || socket.readyState !== WebSocket.OPEN) return;
    const sequence = sequenceRef.current++;
    const payload = await encryptChatMessage(
      text,
      sessionKey,
      appointmentId,
      keyPair.publicKey,
      sequence,
    );
    socket.send(
      JSON.stringify({ type: 'chat_message', appointmentId, payload } satisfies RoomFrame),
    );
    setMessages((current) => [
      ...current,
      { id: `${sequence}-${appointmentId}`, text, mine: true },
    ]);
    setDraft('');
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-surface-card"
      aria-label="Encrypted consultation chat"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text-1">Live chat</h3>
          <p className="text-[11px] text-text-3">
            {status === 'ready'
              ? 'End-to-end encrypted'
              : status === 'waiting'
                ? 'Waiting for the other participant…'
                : status === 'ended'
                  ? 'Chat ended; messages destroyed'
                  : 'Establishing secure session…'}
          </p>
        </div>
        <span
          className={`h-2 w-2 rounded-full ${status === 'ready' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-amber-400'}`}
        />
      </div>
      {error && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-center text-xs text-text-3">
            Messages are held only in memory and disappear when the call ends.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}
          >
            <p
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${message.mine ? 'bg-green-100 text-green-950' : 'bg-surface-hover text-text-1'}`}
            >
              {message.text}
            </p>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={status !== 'ready'}
          placeholder="Type a secure message…"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm text-text-1 outline-none focus:border-green"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={status !== 'ready' || !draft.trim()}
          className="rounded-md bg-green px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
