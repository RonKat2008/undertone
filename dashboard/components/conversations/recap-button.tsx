'use client';

import { Pause, Volume2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, ICON } from '@/components/ui';

/** "Play recap": the coach's short spoken summary, on its own small control next to the coach's note. */
export function RecapButton({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setFailed(true)); else el.pause();
  }

  if (failed) return <p className="text-caption text-muted">The spoken recap didn’t load.</p>;
  return (
    <>
      <audio ref={audio} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setFailed(true); }} />
      <Button size="small" variant="quiet" onClick={toggle} aria-pressed={playing}>
        {playing ? <Pause {...ICON} size={16} aria-hidden /> : <Volume2 {...ICON} size={16} aria-hidden />}
        {playing ? 'Pause recap' : 'Play recap'}
      </Button>
    </>
  );
}
