'use client';

/** Three illustrated steps that explain the product. Shown with or without data. */
import { useInView } from 'motion/react';
import { useRef, type ComponentType, type CSSProperties } from 'react';
import { Panel } from '@/components/ui';
import { BandArt, PageArt, PhoneArt, type HowArtProps } from './how-art';
import { Reveal, Stagger, StaggerItem } from './reveal';

const STEPS: { title: string; text: string; Art: ComponentType<HowArtProps>; glow: string }[] = [
  { title: 'Your band listens', text: 'Wear it through your day. It picks up your conversations as they happen.', Art: BandArt, glow: 'var(--accent)' },
  { title: 'Your phone nudges you', text: 'When a nudge would help, your phone buzzes once: slow down, let them finish.', Art: PhoneArt, glow: 'var(--kind-promise)' },
  { title: 'Your coach writes back', text: 'After each conversation you get a short debrief and one thing to try next time.', Art: PageArt, glow: 'var(--coach)' },
];

function Step({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const { Art } = step;
  return (
    <StaggerItem className="h-full">
      <Panel className="relative h-full overflow-hidden">
        <div ref={ref} className="relative grid h-[148px] place-items-center">
          <span className="home-glow" style={{ '--glow': step.glow, '--glow-strength': '22%', width: 220, height: 160, zIndex: 0 } as CSSProperties} aria-hidden />
          <div className="relative w-full max-w-[200px]"><Art active={inView} /></div>
        </div>
        <div className="mt-4 flex items-center gap-2.5">
          <span className="home-step-num" aria-hidden>{index + 1}</span>
          <h3 className="text-[17px] font-medium leading-[26px]">{step.title}</h3>
        </div>
        <p className="mt-2 text-muted">{step.text}</p>
      </Panel>
    </StaggerItem>
  );
}

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="relative scroll-mt-24">
      <Reveal className="mb-6 grid gap-2">
        <h2 id="how-title" className="font-voice text-[32px] leading-[38px] text-balance">How Undertone works</h2>
        <p className="max-w-[56ch] text-muted">Three quiet steps, from the moment you speak to the debrief afterwards.</p>
      </Reveal>
      <Stagger className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => <Step key={s.title} step={s} index={i} />)}
      </Stagger>
    </section>
  );
}
