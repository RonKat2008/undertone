'use client';

/** The voice memory state for Settings: read once on mount and again after every change. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoices } from '@/lib/api/voices';
import type { VoiceList } from '@/lib/api/voices-model';
import type { Load } from '@/components/settings/use-settings-data';

export interface VoicesData {
  voices: Load<VoiceList>;
  reload: () => Promise<void>;
}

export function useVoices(): VoicesData {
  const [voices, setVoices] = useState<Load<VoiceList>>({ kind: 'loading' });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const data = await getVoices();
      if (alive.current) setVoices({ kind: 'ok', data });
    } catch (error) {
      if (alive.current) setVoices({ kind: 'error', error });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(() => void reload(), 0);
    return () => {
      alive.current = false;
      clearTimeout(first);
    };
  }, [reload]);

  return { voices, reload };
}
