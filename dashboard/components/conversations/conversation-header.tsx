'use client';

/** The conversation's headline in the coach's serif, then when, how long and who (tag or change the person). */
import { UserPlus } from 'lucide-react';
import { PersonDialog } from '@/components/conversations/person-dialog';
import { Avatar, Button, ICON, Prose } from '@/components/ui';
import type { DebriefPayload } from '@/lib/api/client';
import type { Person } from '@/lib/bus/contracts';
import { hiddenReason, lengthLabel, shownHeadline, whenLabel } from '@/lib/conversations/display';
import type { LibrarySession, SessionTranscript } from '@/lib/conversations/types';

interface ConversationHeaderProps {
  t: SessionTranscript;
  summary: LibrarySession | null;
  debrief: DebriefPayload | null;
  stillGoing: boolean;
  length: number | null;
  person: Person | null;
  people: readonly Person[];
  onTagged: (p: Person) => void;
}

export function ConversationHeader({ t, summary, debrief, stillGoing, length, person, people, onTagged }: ConversationHeaderProps) {
  const headline = shownHeadline(debrief?.data.headline_fact) ?? shownHeadline(summary?.headline_fact);
  const reason = summary ? hiddenReason(summary) : null;
  const facts = [whenLabel(t.started_at, new Date().toISOString()), stillGoing ? 'Still going' : lengthLabel(length)].filter(Boolean);

  const trigger = person ? (
    <button type="button" aria-label={`With ${person.name}. Change who this was with`}
      className="-ml-1 inline-flex min-h-11 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-body font-medium transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-accent">
      <Avatar name={person.name} size="sm" />{person.name}
    </button>
  ) : (
    <Button variant="ghost" size="small" className="-ml-2"><UserPlus {...ICON} size={16} aria-hidden />Who was this with?</Button>
  );

  return (
    <header className="mt-2">
      {headline ? (
        <Prose as="h1" size="display" className="max-w-[26ch]">{headline}</Prose>
      ) : (
        <h1 className="qi-display text-muted">{stillGoing ? 'A conversation in progress' : 'No debrief for this one'}</h1>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-muted">
        <span className="tabular">{facts.join(' · ')}</span>
        <PersonDialog sessionId={t.session_id} people={people} currentId={person?.person_id ?? null} trigger={trigger} onTagged={onTagged} />
        {reason ? <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-caption text-fg">Hidden: {reason}</span> : null}
      </div>
    </header>
  );
}
