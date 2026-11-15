'use client';

import { ArrowLeft } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import {
  Button, EmptyState, ICON, InlineStat, KindDot, List, ListRow, Prose, Skeleton, SkeletonLines, type Kind,
} from '@/components/ui';
import { dayWords, minutesWords, splitNumbers, type ReportConversation } from '@/lib/api/reports-model';

/** A report's own sentence in the coach's serif, its numbers set as InlineStats. */
export function CoachSentence({ text, size = 'body', tone = 'coach' }: { text: string; size?: 'body' | 'lead'; tone?: 'coach' | 'accent' | Kind }) {
  return (
    <Prose as="p" size={size}>
      {splitNumbers(text).map((part, i) => (
        <Fragment key={i}>
          {'text' in part ? part.text : (
            <InlineStat value={part.value} suffix={part.suffix} tone={tone}
              format={{ minimumFractionDigits: part.decimals, maximumFractionDigits: part.decimals }} />
          )}
        </Fragment>
      ))}
    </Prose>
  );
}

/** The report column while it loads: a heading line and a few rows. */
export function ReportSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-5" role="status" aria-label="Loading">
      <div className="grid gap-2"><Skeleton width="85%" /><Skeleton width="60%" /></div>
      <div className="grid gap-3 rounded-panel bg-surface p-4 shadow-[var(--shadow-panel)]">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton shape="circle" height={32} />
            <div className="grid flex-1 gap-1"><Skeleton width="45%" /><Skeleton width="75%" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3"><Skeleton shape="circle" height={48} /><Skeleton width="40%" /></div>
      <SkeletonLines lines={3} />
    </div>
  );
}

/** A read that failed: plain words and one way to try again. */
export function LoadFailure({ unreachable, onRetry, what }: { unreachable: boolean; onRetry: () => void; what: string }) {
  return (
    <EmptyState mark="offline" action={<Button onClick={onRetry}>Try again</Button>}>
      {unreachable
        ? `Undertone can't reach your laptop, so ${what} can't load. Check that it's on and Undertone is running.`
        : `Your laptop answered, but ${what} came back in a form this page can't read. Trying again usually helps.`}
    </EmptyState>
  );
}

/** Back from a person, topic or habit to its list. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="small" onClick={onClick} className="-ml-2 justify-self-start">
      <ArrowLeft {...ICON} size={16} aria-hidden />{label}
    </Button>
  );
}

export function conversationHref(sessionId: string): string {
  return `/conversations/view?session=${encodeURIComponent(sessionId)}`;
}

/** Conversations as rows that open the conversation page. */
export function ConversationRows({ items, now, label, limit = 6 }: { items: ReportConversation[]; now: number; label: string; limit?: number }) {
  return (
    <List label={label}>
      {items.slice(0, limit).map((c) => (
        <ListRow key={c.session_id} wrap href={conversationHref(c.session_id)} leading={<KindDot kind="conversation" />}
          title={c.headline || 'A conversation'}
          meta={`${capital(dayWords(c.started_at, now))}, ${minutesWords(c.minutes)}`} />
      ))}
    </List>
  );
}

/** A small titled block inside a detail panel. Not a Section: it sits inside a Panel. */
export function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-caption font-medium text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

export const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
