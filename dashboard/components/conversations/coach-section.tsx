'use client';

/**
 * The primary thing on a conversation page: the one thing to try (the fix and its if-then
 * plan) in the coach's voice, then what worked, and the spoken recap when there is one.
 * Without a debrief it says why in one plain line.
 */
import { Check } from 'lucide-react';
import { RecapButton } from '@/components/conversations/recap-button';
import { Button, CoachNote, ICON, ListeningMark, Panel, Prose } from '@/components/ui';
import type { Debrief } from '@/lib/bus/contracts';

interface CoachSectionProps {
  debrief: Debrief | null;
  recap: string | null;
  stillGoing: boolean;
  failed: boolean;
  hidden: boolean;
  onRetry: () => void;
}

export function CoachSection({ debrief, recap, stillGoing, failed, hidden, onRetry }: CoachSectionProps) {
  if (!debrief) {
    const line = stillGoing ? 'This conversation is still going. Its debrief appears when it ends.'
      : failed ? 'The debrief didn’t load.'
        : hidden ? 'This one was set aside, so your coach didn’t write a debrief.'
          : 'Your coach didn’t write a debrief for this one.';
    return (
      <Panel tone={stillGoing ? 'moment' : 'default'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`flex items-center gap-3 text-body ${stillGoing ? 'text-fg' : 'text-muted'}`}>
            {stillGoing ? <ListeningMark state="listening" /> : null}{line}
          </p>
          {failed ? <Button size="small" onClick={onRetry}>Try again</Button> : null}
        </div>
      </Panel>
    );
  }
  const fix = debrief.one_fix.trim();
  const plan = debrief.if_then.trim();
  const worked = debrief.strength.trim();
  return (
    <div>
      <CoachNote from="One thing to try" size="lead">
        {fix ? <p>{fix}</p> : null}
        {plan ? <p>Next time: <mark>{plan}</mark></p> : null}
      </CoachNote>
      {worked || recap ? (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-1">
          {worked ? (
            <div className="flex min-w-0 flex-1 gap-3">
              <span aria-hidden className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--kind-habit)_20%,transparent)] text-habit">
                <Check {...ICON} size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-caption font-medium text-habit">What worked</p>
                <Prose size="body" as="p">{worked}</Prose>
              </div>
            </div>
          ) : <span />}
          {recap ? <RecapButton src={recap} /> : null}
        </div>
      ) : null}
    </div>
  );
}
