'use client';

import { Check, CircleAlert } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ICON, ListeningMark, StatusWord, toast } from '@/components/ui';
import { ApiError } from '@/lib/api/results';
import { plainError } from '@/lib/api/settings-model';
import { enrolWearer, reprocessAll } from '@/lib/api/voices';
import {
  BAND_WORDS, ENROL_PASSAGE, ENROL_SECONDS, enrolCountdown, enrolFailure, reprocessWords, wearerWords,
  type BandReadiness, type WearerVoice,
} from '@/lib/api/voices-model';
import { motionPresets } from '@/lib/motion';

type Step =
  | { kind: 'idle' }
  | { kind: 'ready' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const TICK_MS = 250;

export interface VoiceStageProps {
  wearer: WearerVoice;
  /** Where the band stands; null while unknown. */
  band: BandReadiness | null;
  /** Read the voice state again after a change. */
  reload: () => Promise<void>;
  /** The "Forget my voice" control, shown beside the action once a voice is held. */
  forget: ReactNode;
}

/**
 * The guided voice step: a large listening mark beside the words for each stage. Idle shows the
 * state and one action; then a short explanation, fifteen seconds of reading aloud, and an honest result.
 */
export function VoiceStage({ wearer, band, reload, forget }: VoiceStageProps) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function start() {
    setStep({ kind: 'recording', startedAt: Date.now() });
    try {
      await enrolWearer(ENROL_SECONDS);
      if (!alive.current) return;
      setStep({ kind: 'done' });
      await reload();
    } catch (e) {
      if (!alive.current) return;
      const status = e instanceof ApiError ? e.status : -1;
      setStep({ kind: 'error', message: enrolFailure(status, e instanceof Error ? e.message : '') });
    }
  }

  const mark = step.kind === 'recording' ? 'listening' : step.kind === 'error' ? 'offline' : 'idle';
  return (
    <div className="calib-stage" data-step={step.kind}>
      <div className="calib-stage-visual" aria-hidden>
        <ListeningMark state={mark} size="lg" />
        {step.kind === 'done' ? <span className="calib-stage-check"><Check {...ICON} size={22} /></span> : null}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <m.div key={step.kind} variants={presets.enter} initial="hidden" animate="shown" exit="gone" className="calib-stage-body">
          {step.kind === 'idle' ? (
            <Idle wearer={wearer} onTeach={() => setStep({ kind: 'ready' })} forget={forget} />
          ) : null}
          {step.kind === 'ready' ? <Ready band={band} onStart={() => void start()} onCancel={() => setStep({ kind: 'idle' })} /> : null}
          {step.kind === 'recording' ? <Recording startedAt={step.startedAt} /> : null}
          {step.kind === 'done' ? <Learned /> : null}
          {step.kind === 'error' ? (
            <>
              <h4 className="text-title text-fg">Nothing was learned</h4>
              <p role="alert" className="inline-flex items-start gap-2 text-body text-danger text-pretty">
                <CircleAlert {...ICON} size={16} aria-hidden className="mt-1 shrink-0" />{step.message}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setStep({ kind: 'ready' })}>Try again</Button>
                <Button variant="ghost" onClick={() => setStep({ kind: 'idle' })}>Not now</Button>
              </div>
            </>
          ) : null}
        </m.div>
      </AnimatePresence>
    </div>
  );
}

function Idle({ wearer, onTeach, forget }: { wearer: WearerVoice; onTeach: () => void; forget: ReactNode }) {
  const words = wearerWords(wearer);
  const learned = wearer.state === 'enrolled';
  return (
    <>
      <StatusWord tone={words.tone} live>{words.word}</StatusWord>
      <h4 className="text-title text-fg text-balance">{learned ? 'Undertone knows your voice' : 'Teach Undertone your voice'}</h4>
      <p className="text-body text-muted text-pretty">{words.sentence}{words.heard ? ` ${words.heard}` : ''}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant={learned ? 'quiet' : 'primary'} onClick={onTeach}>{learned ? 'Teach it again' : 'Teach it my voice'}</Button>
        {forget}
      </div>
    </>
  );
}

function Ready({ band, onStart, onCancel }: { band: BandReadiness | null; onStart: () => void; onCancel: () => void }) {
  return (
    <>
      <h4 className="text-title text-fg text-balance">Speak on your own for {ENROL_SECONDS} seconds</h4>
      <p className="text-body text-muted text-pretty">
        Nobody else talking. A short passage appears for you to read aloud in your normal voice; keep the band on your wrist.
      </p>
      {band !== null && band !== 'listening' ? (
        <p className="text-body text-warn text-pretty">{BAND_WORDS[band].sentence}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary" onClick={onStart}>Start</Button>
        <Button variant="ghost" onClick={onCancel}>Not now</Button>
      </div>
    </>
  );
}

/** The countdown, the passage and a slow fill; after the speaking time, "Learning your voice". */
function Recording({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const { left, over } = enrolCountdown(now - startedAt);

  return (
    <div className="grid gap-4" role="timer">
      <div className="flex items-center justify-between gap-4">
        <p className="text-title text-fg" aria-live="polite">{over ? 'Learning your voice…' : 'Read this aloud'}</p>
        {over ? null : <span className="calib-count tabular" aria-label={`${left} seconds left`}>{left}</span>}
      </div>
      <blockquote className="calib-passage text-pretty" data-over={over || undefined}>{ENROL_PASSAGE}</blockquote>
      <div className="calib-track" aria-hidden data-over={over || undefined}>
        <span style={{ animationDuration: `${ENROL_SECONDS}s` }} />
      </div>
      <p className="text-caption text-muted">{over ? 'You can stop talking.' : 'If you finish early, start again from the top.'}</p>
    </div>
  );
}

/** Success, with the offer to re-label conversations recorded before. */
function Learned() {
  const [busy, setBusy] = useState(false);
  const [fixed, setFixed] = useState(false);
  async function fix() {
    setBusy(true);
    try {
      toast(reprocessWords(await reprocessAll()));
      setFixed(true);
    } catch (e) {
      toast.error(`Earlier conversations weren’t changed. ${plainError(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h4 role="status" className="text-title text-accent">Learned. Undertone knows your voice.</h4>
      <p className="text-body text-muted text-pretty">
        {fixed
          ? 'Earlier conversations are being fixed in the background.'
          : 'Conversations you had before may still mix up your words with other people’s.'}
      </p>
      {fixed ? null : (
        <div className="pt-1"><Button variant="primary" loading={busy} onClick={() => void fix()}>Fix earlier conversations</Button></div>
      )}
    </>
  );
}
