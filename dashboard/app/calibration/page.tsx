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

/** A progress rule that fills linearly: time, drawn as time. */
function Progress({ fraction, label }: { fraction: number; label: string }) {
  return (
    <div className="relative h-[2px] w-full bg-rule" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, fraction) * 100)}>
      <div className="absolute inset-0 origin-left bg-ink" style={{ transform: `scaleX(${Math.min(1, fraction)})`, transition: 'transform 100ms linear' }} />
    </div>
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
  const left = (ms: number, total: number) => Math.max(1, Math.ceil((total - ms) / 1000));

  return (
    <div className="pt-8">
      <div className="mb-8 flex flex-wrap items-baseline gap-x-3"><span className="label">Calibration</span><span className="text-s text-ink-2">about twenty seconds, once per room</span></div>
      {failed && <p role="alert" className="text-m mb-6 flex items-center gap-2 font-medium text-ink"><span className="state state-fault" aria-hidden />{failed}</p>}
      <div className="grid gap-x-6 gap-y-14 xl:grid-cols-12">
        <section aria-label="Voice calibration" className="xl:col-span-5">
          <h2 className="display-m relative border-b border-ink pb-3"><span className="num-m absolute right-full mr-4 hidden pt-2 text-ink-3 md:block">1</span>Whose voice is yours</h2>
          <div className="pt-6">
            {voice === 'idle' && <><p className="display-s">Say your name.</p><p className="text-m mt-2 max-w-[48ch] text-ink-2">The first voice after the double-tap is treated as you. The mic is on your wrist, so you are also the louder one.</p><button className="btn btn-solid mt-5" onClick={() => setVoice('listening')}>Start</button></>}
            {voice === 'listening' && <><p className="display-s caret">Listening</p><p className="text-m mt-2 text-ink-2">Keep talking for three seconds.</p></>}
            {voice === 'done' && (
              <>
                <p className="display-s">You are the {swapped ? 'second' : 'first'} voice.</p>
                <p className="text-m mt-2 max-w-[48ch] text-ink-2">If the transcript shows your words under “Them”, swap. You can do this mid-conversation too.</p>
                <div className="mt-5 flex gap-2">
                  <button className="btn" onClick={() => { setFailed(null); void swapSpeakers().then(() => setSwapped((s) => !s), fail); }}>Swap speakers</button>
                  <button className="btn btn-quiet" onClick={() => setVoice('idle')}>Redo</button>
                </div>
              </>
            )}
            <div className="mt-8 grid grid-cols-[minmax(0,1fr)_3ch] items-center gap-x-4">
              <Progress fraction={voice === 'done' ? 1 : voiceMs / 3000} label="Voice calibration progress" />
              <span className="num-s text-right text-ink-2">{voice === 'done' ? 'ok' : voice === 'listening' ? `${left(voiceMs, 3000)} s` : '3 s'}</span>
            </div>
          </div>
        </section>

        <section aria-label="Motion calibration" className="xl:col-span-6 xl:col-start-7">
          <h2 className="display-m relative border-b border-ink pb-3"><span className="num-m absolute right-full mr-4 hidden pt-2 text-ink-3 md:block">2</span>How your hands move</h2>
          <div className="pt-6">
            {step < 0 && <><p className="display-s">Three moves, five seconds each.</p><p className="text-m mt-2 text-ink-2">Still, gesture, fidget. The thresholds are stored for this band.</p><button className="btn btn-solid mt-5" onClick={startMotion}>Start</button></>}
            {running && <p className="text-m text-ink-2">Step <span className="num-s text-ink">{step + 1}</span> of 3. {MOTION_STEPS[step].hint}</p>}
            {step >= MOTION_STEPS.length && <><p className="display-s">Thresholds stored.</p><button className="btn btn-quiet mt-5" onClick={() => setStep(-1)}>Redo</button></>}
          </div>
          <ol className="mt-6 border-t border-rule">
            {MOTION_STEPS.map((s, i) => {
              const done = i < step;
              const now = i === step;
              return (
                <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5ch] items-center gap-x-5 border-b border-rule py-3.5">
                  <span className={`display-s ${done || now ? 'text-ink' : 'text-ink-3'}`}>{s.title}</span>
                  <Progress fraction={done ? 1 : now ? stepMs / STEP_MS : 0} label={`${s.title} progress`} />
                  <span className="num-s text-right text-ink-2">{done ? 'done' : now ? `${left(stepMs, STEP_MS)} s` : '5 s'}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-8">
            <div className="flex items-baseline justify-between"><span className="label">Live motion</span><span className="num-s text-ink-2">{state.motion ? `${state.motion.state} ${energy.toFixed(2)}` : 'no signal from the band'}</span></div>
            <Spark className="mt-3 w-full" values={state.history.energy.slice(-60)} capacity={60} width={640} height={56} min={0} max={1} band={[0.3, 0.7]} />
          </div>
        </section>
      </div>

      <div className={`mt-16 pt-5 ${calibrated ? 'border-t-2 border-ink' : 'border-t border-rule'}`} role="status">
        <span className={`display-m ${calibrated ? 'text-ink' : 'text-ink-2'}`}>{calibrated ? 'Calibrated.' : 'Not calibrated yet.'}</span>
        <p className="text-m mt-2 text-ink-2">{calibrated ? 'Double-tap the band to start a conversation.' : 'Finish both steps. Until then the coach uses general thresholds.'}</p>
      </div>
    </div>
  );
}
