'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchEncounterNote, saveEncounterNote } from '@/services/api.service';

interface Props {
  appointmentId: string;
  initialDraftContent?: string | undefined;
}

const AUTOSAVE_DELAY_MS = 2000;

export default function EncounterNotes({ appointmentId, initialDraftContent }: Props) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mutateRef = useRef<(text: string) => void>(undefined);

  const { data: existing, isLoading } = useQuery({
    queryKey: ['encounter-note', appointmentId],
    queryFn: () => fetchEncounterNote(appointmentId),
    enabled: !!appointmentId,
    retry: false,
  });

  useEffect(() => {
    if (existing?.content) {
      setContent(existing.content);
      setLastSaved(existing.updatedAt);
    } else if (initialDraftContent && !content) {
      setContent(initialDraftContent);
      debouncedSave(initialDraftContent);
    }
  }, [existing, initialDraftContent]);

  const saveMutation = useMutation({
    mutationFn: (text: string) => saveEncounterNote(appointmentId, text),
    onSuccess: (data) => {
      setLastSaved(data.updatedAt);
      queryClient.setQueryData(['encounter-note', appointmentId], data);
    },
  });

  mutateRef.current = (text: string) => saveMutation.mutate(text);

  const debouncedSave = useCallback((text: string) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (text.trim()) mutateRef.current?.(text);
    }, AUTOSAVE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  function handleChange(value: string) {
    setContent(value);
    debouncedSave(value);
  }

  if (isLoading) {
    return <div className="animate-pulse h-48 m-4 rounded-lg bg-surface-card" />;
  }

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text-1">Encounter Notes</h3>
        <span className="text-xs text-text-3">
          {saveMutation.isPending
            ? 'Saving...'
            : lastSaved
              ? `Saved ${new Date(lastSaved).toLocaleTimeString()}`
              : 'Not saved'}
        </span>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Document findings, observations, and treatment plan..."
        className="flex-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-text-1 resize-none focus:outline-none focus:ring-2 focus:ring-border-focus"
      />
    </div>
  );
}
