'use client';

import { useEffect, useState } from 'react';
import { Spark } from '@/components/spark';
import { calibrateMotion, swapSpeakers } from '@/lib/api/client';
import { useBus } from '@/lib/bus/use-bus';

const MOTION_STEPS = [
  { id: 'still', title: 'Hold still', hint: 'Rest your hand on the table.' },
  { id: 'gesture', title: 'Gesture', hint: 'Talk with your hands, the way you would explaining something.' },
  { id: 'fidget', title: 'Fidget', hint: 'Tap, twist a pen, bounce your wrist.' },
] as const;
const STEP_MS = 5000;

function Ring({ fraction, label }: { fraction: number; label: string }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label={label}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--rule)" strokeWidth="2" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--ink)" strokeWidth="6" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, fraction))} transform="rotate(-90 64 64)" />
      <text x="64" y="74" textAnchor="middle" className="num" fontSize="30" fill="var(--ink)">{label}</text>
    </svg>
  );
}

function useCountdown(running: boolean, totalMs: number, onDone: () => void): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - start;
      setElapsed(e);
      if (e >= totalMs) { clearInterval(id); onDone(); }
    }, 100);
    return () => { clearInterval(id); setElapsed(0); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, totalMs]);
  return running ? elapsed : 0;
}

export default function CalibrationPage() {
  const { state } = useBus();
  const [failed, setFailed] = useState<string | null>(null);
  // voice
  const [voice, setVoice] = useState<'idle' | 'listening' | 'done'>('idle');
  const [swapped, setSwapped] = useState(false);
  const voiceMs = useCountdown(voice === 'listening', 3000, () => setVoice('done'));
  // motion
  const [step, setStep] = useState(-1); // -1 idle, 0..2 running, 3 done
  const running = step >= 0 && step < MOTION_STEPS.length;
  const stepMs = useCountdown(running, STEP_MS, () => setStep((s) => s + 1));

  // the backend may also drive these with `calibration` events
  const remoteVoice = state.calibration.speaker?.done;
  const remoteMotion = state.calibration.motion;
  useEffect(() => { if (remoteVoice) setVoice('done'); }, [remoteVoice]);
  useEffect(() => { if (remoteMotion?.done) setStep(MOTION_STEPS.length); }, [remoteMotion?.done]);

  const fail = (e: unknown) => setFailed(e instanceof Error ? e.message : 'The backend did not answer.');

  function startMotion() {
    setFailed(null);
    setStep(0);
    void calibrateMotion().catch((e: unknown) => { fail(e); setStep(-1); });
  }

  const energy = state.motion?.hand_energy ?? 0;
  const calibrated = voice === 'done' && step >= MOTION_STEPS.length;

  return (
    <div className="pt-8">
      <div className="caps mb-4">Calibration · about twenty seconds, once per room</div>
      {failed && <p role="alert" className="mb-4 text-[13px] text-vermilion">{failed}</p>}
      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-2">
        <section aria-label="Voice calibration">
          <h2 className="serif border-b border-ink pb-2 text-[40px] leading-none">1 · Whose voice is yours</h2>
          <div className="grid grid-cols-[128px_1fr] items-center gap-x-8 pt-6">
            <Ring fraction={voice === 'done' ? 1 : voiceMs / 3000} label={voice === 'done' ? 'ok' : voice === 'listening' ? String(Math.max(1, Math.ceil((3000 - voiceMs) / 1000))) : '3'} />
            <div>
              {voice === 'idle' && <><p className="serif text-[30px] leading-tight">Say your name.</p><p className="mt-1 text-[13px] text-ink-2">The first voice after the double-tap is treated as you. The mic is on your wrist, so you are also the louder one.</p><button className="btn btn-solid mt-4" onClick={() => setVoice('listening')}>Start</button></>}
              {voice === 'listening' && <><p className="serif text-[30px] leading-tight">Listening…</p><p className="mt-1 text-[13px] text-ink-2">Keep talking for three seconds.</p></>}
              {voice === 'done' && (
                <>
                  <p className="serif text-[30px] leading-tight">You are the {swapped ? 'second' : 'first'} voice.</p>
                  <p className="mt-1 text-[13px] text-ink-2">If the transcript shows your words under “Them”, swap. You can do this mid-conversation too.</p>
                  <div className="mt-4 flex gap-2">
                    <button className="btn" onClick={() => { setSwapped((s) => !s); setFailed(null); void swapSpeakers().catch(fail); }}>Swap speakers</button>
                    <button className="btn btn-quiet" onClick={() => setVoice('idle')}>Redo</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section aria-label="Motion calibration">
          <h2 className="serif border-b border-ink pb-2 text-[40px] leading-none">2 · How your hands move</h2>
          <div className="grid grid-cols-[128px_1fr] items-center gap-x-8 pt-6">
            <Ring fraction={step >= MOTION_STEPS.length ? 1 : running ? stepMs / STEP_MS : 0}
              label={step >= MOTION_STEPS.length ? 'ok' : running ? String(Math.max(1, Math.ceil((STEP_MS - stepMs) / 1000))) : '5'} />
            <div>
              {step < 0 && <><p className="serif text-[30px] leading-tight">Three moves, five seconds each.</p><p className="mt-1 text-[13px] text-ink-2">Still, gesture, fidget. The thresholds are stored for this band.</p><button className="btn btn-solid mt-4" onClick={startMotion}>Start</button></>}
              {running && <><div className="caps">Step {step + 1} of 3</div><p className="serif text-[44px] leading-none">{MOTION_STEPS[step].title}</p><p className="mt-2 text-[13px] text-ink-2">{MOTION_STEPS[step].hint}</p></>}
              {step >= MOTION_STEPS.length && <><p className="serif text-[30px] leading-tight">Thresholds stored.</p><button className="btn btn-quiet mt-4" onClick={() => setStep(-1)}>Redo</button></>}
            </div>
          </div>
          <ol className="mt-6 grid grid-cols-3 gap-px">
            {MOTION_STEPS.map((s, i) => (
              <li key={s.id} className={`border-t-2 pt-2 ${i < step ? 'border-ink' : i === step ? 'border-ink' : 'border-rule text-ink-3'}`}>
                <span className="caps">{i < step ? 'done' : i === step ? 'now' : 'next'}</span>
                <div className="serif text-[22px] leading-none">{s.title}</div>
              </li>
            ))}
          </ol>
          <div className="mt-6 border-t border-rule pt-3">
            <div className="flex items-baseline justify-between"><span className="caps">Live motion</span><span className="num text-[13px]">{state.motion ? `${state.motion.state} · ${energy.toFixed(2)}` : 'no signal from the band'}</span></div>
            <Spark className="mt-2 w-full" values={state.history.energy.slice(-60)} capacity={60} width={560} height={48} min={0} max={1} band={[0.3, 0.7]} />
          </div>
        </section>
      </div>

      <div className={`mt-12 border-t-[3px] pt-4 ${calibrated ? 'border-green' : 'border-rule'}`} role="status">
        <span className={`serif text-[clamp(40px,5vw,72px)] leading-none ${calibrated ? 'text-green' : 'text-ink-3'}`}>{calibrated ? 'Calibrated.' : 'Not calibrated yet.'}</span>
        <p className="mt-2 text-[13px] text-ink-2">{calibrated ? 'Double-tap the band to start a conversation.' : 'Finish both steps. Until then the coach uses general thresholds.'}</p>
      </div>
    </div>
  );
}
