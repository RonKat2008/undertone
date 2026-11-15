'use client';

/** The coach that is listening now, and the closing invitation at the foot of Home. */
import { ArrowRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Avatar, Button, ListeningMark, Panel, PatternMark, Prose, TextLink } from '@/components/ui';
import type { ActiveCoach } from '@/lib/api/home';
import { Reveal, Stagger, StaggerItem } from './reveal';

export function CoachTeaser({ coach }: { coach: ActiveCoach | null }) {
  if (!coach) return null;
  const rules = coach.rules.slice(0, 3);
  return (
    <Reveal as="section" className="relative">
      <span className="home-glow" style={{ '--glow': 'var(--coach)', width: 'min(520px, 100%)', height: 300, left: 0, top: -40 } as CSSProperties} aria-hidden />
      <Panel tone="coach" className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={coach.name} tone="coach" size="lg" />
            <div className="grid">
              <span className="text-[13px] leading-[18px] text-coach">Your coach</span>
              <h2 className="text-[22px] font-medium leading-[28px]">{coach.name}</h2>
            </div>
          </div>
          {coach.goal ? <Prose size="body" as="p">{coach.goal}</Prose> : null}
          <TextLink href="/coach" tone="muted" className="justify-self-start">Change or tune your coach</TextLink>
        </div>
        {rules.length > 0 ? (
          <div className="grid gap-2">
            <span className="text-[13px] leading-[18px] text-muted">It nudges you when it hears a moment to</span>
            <Stagger className="grid gap-2">
              {rules.map((r) => (
                <StaggerItem key={r.id} className="flex min-h-11 items-center gap-3 rounded-[12px] bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-3.5">
                  <span className="text-coach"><PatternMark pattern={r.haptic} withLabel={false} size={14} /></span>
                  <span className="font-medium">{r.message}</span>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        ) : null}
      </Panel>
    </Reveal>
  );
}

export interface ClosingProps {
  hasHistory: boolean;
  paired: boolean | null;
}

export function Closing({ hasHistory, paired }: ClosingProps) {
  const arrow = <ArrowRight size={16} strokeWidth={1.5} aria-hidden />;
  const [line, action] = hasHistory
    ? ['Everyone and everything you talk about, in one picture.', <Button key="a" href="/insights" variant="primary">Open insights{arrow}</Button>]
    : paired
      ? ['Your phone is paired. Put your band on and talk to someone; the rest happens by itself.', <Button key="a" href="/settings">Check your band</Button>]
      : ['Pair your phone so nudges can reach you in the moment.', <Button key="a" href="/settings" variant="primary">Pair your phone{arrow}</Button>];
  return (
    <Reveal as="section" className="relative">
      <span className="home-glow" style={{ '--glow': 'var(--accent)', '--glow-strength': '18%', width: '100%', height: 360, left: 0, top: -60 } as CSSProperties} aria-hidden />
      <Panel tone="moment" className="grid justify-items-center gap-5 px-6 py-12 text-center sm:py-16">
        <ListeningMark state="listening" size="lg" />
        <p className="max-w-[26ch] font-voice text-[28px] leading-[36px] text-balance sm:text-[32px] sm:leading-[40px]">{line}</p>
        {action}
      </Panel>
    </Reveal>
  );
}
