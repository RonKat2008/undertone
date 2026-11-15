'use client';

import { AudioLines, Hand, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { ICON, ListeningMark, Panel, Skeleton, StatusWord } from '@/components/ui';
import type { Load } from '@/components/settings/use-settings-data';
import type { BandResult } from '@/lib/api/settings';
import { plainError } from '@/lib/api/settings-model';
import { BAND_WORDS, bandReadiness, type BandReadiness } from '@/lib/api/voices-model';
import { HandsStep } from './hands-step';
import { VoiceStep } from './voice-step';
import './calibration.css';

export interface CalibrationSectionProps {
  /** The band status Settings already reads. */
  band: Load<BandResult>;
}

/** Where the band stands for calibrating, or null while unknown (loading or unreadable). */
function readiness(band: Load<BandResult>): BandReadiness | null {
  if (band.kind !== 'ok') return null;
  if (band.data.kind === 'none') return 'none';
  return band.data.kind === 'ok' ? bandReadiness(band.data.band) : null;
}

/** Settings' Calibration section: is the band ready, then your voice, then your hands. */
export function CalibrationSection({ band }: CalibrationSectionProps) {
  const ready = readiness(band);
  return (
    <section id="calibration" aria-labelledby="calibration-title" className="settings-block calib-layout">
      <div>
        <h2 id="calibration-title" className="qi-section-title mb-1">
          <SlidersHorizontal {...ICON} aria-hidden />Calibration
        </h2>
        <p className="text-body text-muted text-pretty">Teach Undertone what you sound like and how your hands move, so it can tell you apart.</p>
      </div>
      <BandLine band={band} ready={ready} />
      <Step n={1} id="calibration-voice" title="Your voice" icon={AudioLines}>
        <VoiceStep band={ready} />
      </Step>
      <Step n={2} id="calibration-hands" title="Your hands" icon={Hand}>
        <HandsStep />
      </Step>
    </section>
  );
}

function BandLine({ band, ready }: { band: Load<BandResult>; ready: BandReadiness | null }) {
  if (band.kind === 'loading') return <Skeleton shape="block" height={48} />;
  const words = band.kind === 'error' || ready === null
    ? { word: 'Band unknown', tone: 'warn' as const, sentence: `Couldn’t read the band. ${band.kind === 'error' ? plainError(band.error) : ''}`.trim() }
    : BAND_WORDS[ready];
  return (
    <div className="calib-band" role="status">
      {ready === 'listening' ? <ListeningMark state="listening" /> : null}
      <div className="min-w-0 flex-1">
        {ready === 'listening' ? <p className="text-body font-medium text-fg">{words.word}</p> : <StatusWord tone={words.tone}>{words.word}</StatusWord>}
        <p className="text-body text-muted text-pretty">{words.sentence}</p>
      </div>
    </div>
  );
}

function Step({ n, id, title, icon: Icon, children }: { n: number; id: string; title: string; icon: typeof Hand; children: ReactNode }) {
  return (
    <div id={id} className="grid gap-3">
      <h3 className="calib-step-title">
        <span aria-hidden className="calib-step-n tabular">{n}</span>
        <Icon {...ICON} size={16} aria-hidden />{title}
      </h3>
      <Panel>{children}</Panel>
    </div>
  );
}
