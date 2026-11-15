'use client';

/**
 * The first screen. Left: the state in plain words (serif), the coach's latest line, one primary
 * and one secondary action. Right: the living orb with real moments orbiting it, a little parallax
 * on pointer move. Every word and moment comes from live state or the wearer's own data.
 */
import { ArrowRight, Feather, RotateCw } from 'lucide-react';
import { m, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { Avatar, Button, KindDot, PatternMark, Prose } from '@/components/ui';
import { HERO_HEADLINE, HERO_LINE, relativeWhen, type HeroState } from '@/lib/api/home-model';
import { isLive } from '@/lib/bus/reducer';
import { useBus } from '@/lib/bus/use-bus';
import { EASE, SPRING } from '@/lib/motion';
import { HeroOrb } from './hero-orb';
import type { HomeData } from './use-home-data';

export interface HeroProps {
  data: HomeData & { retry: () => void };
  state: HeroState;
}

function greeting(hour: number): string {
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Hero({ data, state }: HeroProps) {
  const reduced = useReducedMotion() ?? false;
  const { state: bus } = useBus();
  const [hello, setHello] = useState<string | null>(null);
  useEffect(() => setHello(greeting(new Date().getHours())), []);

  // Pointer parallax: the orb drifts a little, the moments a little more.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const orbX = useTransform(sx, (v) => v * 10);
  const orbY = useTransform(sy, (v) => v * 10);
  const chipX = useTransform(sx, (v) => v * 22);
  const chipY = useTransform(sy, (v) => v * 22);
  function onPointerMove(e: PointerEvent<HTMLElement>) {
    if (reduced || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    py.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  }
  function onPointerLeave() {
    px.set(0);
    py.set(0);
  }

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE.out, delay: reduced ? 0 : delay },
  });

  const moments = useMoments(data, state);

  return (
    <section
      aria-labelledby="hero-title"
      className={`home-hero relative grid items-center gap-6 pb-10 pt-6 sm:pt-10 lg:min-h-[calc(100dvh-150px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-4 lg:pb-16`}
      data-state={state}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span className="home-glow" style={{ '--glow': 'var(--coach)', '--glow-strength': '9%', width: 'min(560px, 100%)', height: 520, left: 0, top: -80 } as CSSProperties} aria-hidden />

      <div className="relative z-[1] order-2 grid justify-items-start gap-6 lg:order-1">
        {hello ? <m.p {...rise(0)} className="text-[13px] font-medium leading-[18px] text-muted">{hello}</m.p> : <p className="h-[18px]" />}
        <m.h1 {...rise(0.06)} id="hero-title" className={`home-headline max-w-[14ch]`} aria-live="polite">
          {HERO_HEADLINE[state]}
        </m.h1>
        <m.p {...rise(0.12)} className="qi-lead max-w-[46ch] text-pretty text-muted">{HERO_LINE[state]}</m.p>
        {state !== 'unreachable' ? <m.div {...rise(0.18)} className="w-full max-w-[46ch]"><CoachLine data={data} /></m.div> : null}
        <m.div {...rise(0.24)} className="flex flex-wrap items-center gap-3 pt-1">
          <Actions data={data} state={state} />
        </m.div>
      </div>

      <div className="relative order-1 mx-auto aspect-square w-full max-w-[340px] sm:max-w-[440px] lg:order-2 lg:max-w-[520px]">
        <m.div className="absolute inset-0" style={{ x: orbX, y: orbY }}
          initial={{ opacity: 0, scale: reduced ? 1 : 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, ease: EASE.out }}>
          <HeroOrb state={state} pulseKey={isLive(bus) ? bus.turns.length : 0} />
        </m.div>
        {moments.length > 0 ? (
          <m.ul className="absolute inset-0" style={{ x: chipX, y: chipY }} aria-label="Recent moments">
            {moments.map((mo, i) => (
              <m.li key={mo.key} className={`absolute ${i === 3 ? 'max-sm:hidden' : ''}`} style={SPOTS[i]}
                initial={{ opacity: 0, scale: reduced ? 1 : 0.85, y: reduced ? 0 : 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ ...SPRING, delay: reduced ? 0 : 0.5 + i * 0.12 }}>
                <div className="home-float" data-i={i}>
                  <div className="home-moment">{mo.node}</div>
                </div>
              </m.li>
            ))}
          </m.ul>
        ) : null}
      </div>
    </section>
  );
}

const SPOTS: CSSProperties[] = [
  { left: '0%', top: '12%' },
  { right: '0%', top: '30%' },
  { left: '4%', bottom: '14%' },
  { right: '6%', bottom: '4%' },
];

interface Moment { key: string; node: ReactNode }

function Caption({ children }: { children: ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

/** Real things to float around the orb: the latest nudge, the latest person, the top topic, what the coach listens for. */
function useMoments(data: HomeData, state: HeroState): Moment[] {
  const { state: bus } = useBus();
  if (data.phase !== 'ready' || state === 'unreachable') return [];
  const out: Moment[] = [];
  const nudge = bus.lastNudge;
  if (nudge?.pattern) {
    out.push({ key: `nudge-${nudge.id}`, node: <><PatternMark pattern={nudge.pattern} withLabel={false} size={12} playKey={nudge.id} /><span className="font-medium">{nudge.title}</span><Caption>just now</Caption></> });
  }
  const person = data.latest?.person_id ? data.people.find((p) => p.personId === data.latest?.person_id) : data.people[0];
  if (person) {
    out.push({ key: `person-${person.personId}`, node: <><Avatar name={person.name} size="sm" /><span className="font-medium">{person.name}</span>{person.relationship ? <Caption>{person.relationship}</Caption> : null}</> });
  }
  const topic = data.overview?.topTopics[0];
  if (topic) {
    out.push({ key: `topic-${topic.nodeId}`, node: <><span className="pl-1.5"><KindDot kind="topic" /></span><span className="font-medium">{capitalise(topic.label)}</span></> });
  }
  const rule = data.coach?.rules[0];
  if (rule && !nudge) {
    out.push({ key: `rule-${rule.id}`, node: <><span className="pl-1.5" /><Caption>Listening for</Caption><span className="font-medium">{rule.message}</span></> });
  }
  return out.slice(0, 4);
}

const capitalise = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());

function CoachLine({ data }: { data: HomeData }) {
  if (data.phase === 'loading') return <div className="h-[52px]" />;
  const latest = data.latest;
  const who = latest?.person_id ? data.people.find((p) => p.personId === latest.person_id)?.name : null;
  if (latest?.headline_fact) {
    const when = relativeWhen(latest.started_at);
    return (
      <figure className="grid gap-1.5 border-l-2 border-coach/60 pl-4">
        <figcaption className="flex items-center gap-1.5 text-[13px] font-medium leading-[18px] text-coach">
          <Feather size={14} strokeWidth={1.5} aria-hidden />
          {who ? `With ${who}` : 'Your last conversation'}{when ? `, ${when}` : ''}
        </figcaption>
        <Prose size="lead" as="blockquote">{latest.headline_fact}</Prose>
      </figure>
    );
  }
  const highlight = data.overview?.highlights[0];
  if (highlight) {
    return (
      <figure className="grid gap-1.5 border-l-2 border-coach/60 pl-4">
        <figcaption className="text-[13px] font-medium leading-[18px] text-coach">This week</figcaption>
        <Prose size="lead" as="blockquote">{highlight}</Prose>
      </figure>
    );
  }
  return (
    <Prose size="lead" as="p" className="text-muted">
      Wear your band and talk to someone. Your first debrief will appear here.
    </Prose>
  );
}

function Actions({ data, state }: HeroProps) {
  const arrow = <ArrowRight size={16} strokeWidth={1.5} aria-hidden />;
  if (state === 'unreachable') {
    return (
      <>
        <Button variant="primary" onClick={data.retry} loading={data.phase === 'loading'}>
          <RotateCw size={16} strokeWidth={1.5} aria-hidden />Try again
        </Button>
        <Button href="/settings" variant="ghost">Open settings</Button>
      </>
    );
  }
  if (data.latest) {
    return (
      <>
        <Button href={`/conversations/view?session=${encodeURIComponent(data.latest.session_id)}`} variant="primary">
          Read your latest debrief{arrow}
        </Button>
        <Button href="/insights" variant="ghost">Open insights</Button>
      </>
    );
  }
  if (data.phase !== 'ready') return <div className="h-11" />;
  return (
    <>
      {data.paired ? null : <Button href="/settings" variant="primary">Pair your phone{arrow}</Button>}
      <Button href="#how" variant={data.paired ? 'quiet' : 'ghost'}>See how it works</Button>
    </>
  );
}
