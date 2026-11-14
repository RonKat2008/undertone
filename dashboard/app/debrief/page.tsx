'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { getDebrief } from '@/lib/api/client';
import { Debrief } from '@/lib/bus/contracts';
import {
  defaultDebrief,
  defaultTimelinePoints,
  defaultBookmarks,
} from '@/components/debrief/mock-data';
import { HeadlineAndStrength } from '@/components/debrief/HeadlineAndStrength';
import { OneThingToFix } from '@/components/debrief/OneThingToFix';
import { KeyMetrics } from '@/components/debrief/KeyMetrics';
import { RecapAudioPlayer } from '@/components/debrief/RecapAudioPlayer';
import { VoiceBodyTimeline, TimelineEvent } from '@/components/debrief/VoiceBodyTimeline';
import { BookmarkReview } from '@/components/debrief/BookmarkReview';
import { NotesAndTranscript, TranscriptTurn } from '@/components/debrief/NotesAndTranscript';
import { EditorialPullQuote } from '@/components/debrief/EditorialPullQuote';
import { HearBetterVersion } from '@/components/debrief/HearBetterVersion';

export default function DebriefPage() {
  const { state } = useBus();
  const [fetchedDebrief, setFetchedDebrief] = useState<{ data: Debrief; audio_url: string | null } | null>(null);

  // Fetch debrief fallback if bus state does not already have it
  useEffect(() => {
    let active = true;
    if (!state?.debrief) {
      getDebrief(state?.sessionId || 's1')
        .then((res) => {
          if (active) {
            setFetchedDebrief(res);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [state?.debrief, state?.sessionId]);

  // Active debrief data resolution: state.debrief -> fetchedDebrief -> defaultDebrief
  const rawDebrief: Debrief = state?.debrief?.data || fetchedDebrief?.data || defaultDebrief;
  const audioUrl: string | null = state?.debrief?.audio_url || fetchedDebrief?.audio_url || null;

  // Active coach name and meta
  const coachName = state?.activeCoach?.name || defaultDebrief.sessionMeta.coachName;
  const sessionDate = defaultDebrief.sessionMeta.date;

  // 1. Headline fact & 2. Strength
  const headlineFact = rawDebrief.headline_fact || defaultDebrief.headline_fact;
  const strength = rawDebrief.strength || defaultDebrief.strength;

  // 3. One thing to fix & if_then plan
  const oneFix = rawDebrief.one_fix || defaultDebrief.one_fix;
  const ifThen = rawDebrief.if_then || defaultDebrief.if_then;

  // 4. Five numbers & vs_last_time
  const numbers = rawDebrief.numbers || defaultDebrief.numbers;
  const vsLastTime = rawDebrief.vs_last_time;

  // 6. Timeline data & marked events
  const timelinePoints = useMemo(() => {
    if (rawDebrief.timeline && rawDebrief.timeline.length >= 2) {
      return rawDebrief.timeline;
    }
    return defaultTimelinePoints;
  }, [rawDebrief]);

  // Combine live bus events with default events
  const timelineEvents = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];

    // Add nudges from bus if available
    if (state?.nudges && state.nudges.length > 0) {
      state.nudges.forEach((n) => {
        events.push({
          t: n.ts,
          type: 'nudge',
          label: n.message,
          pattern: n.haptic,
          detail: n.reason,
        });
      });
    }

    // Add bookmarks from bus if available
    if (state?.bookmarks && state.bookmarks.length > 0) {
      state.bookmarks.forEach((bm) => {
        events.push({
          t: bm.ts,
          type: 'bookmark',
          label: bm.text || 'Bookmark',
          pattern: bm.source,
          detail: bm.source === 'promise' ? 'Promise detected' : 'Phone tap',
        });
      });
    }

    // Add signals from bus if available
    if (state?.signals && state.signals.length > 0) {
      state.signals.forEach((sig) => {
        events.push({
          t: sig.ts,
          type: 'signal',
          label: sig.kind === 'nerves' ? 'Nerves' : 'Checked out',
          detail: sig.detail,
        });
      });
    }

    // If no live events were recorded, fallback to rich defaults
    if (events.length === 0) {
      return defaultDebrief.timelineEvents;
    }

    return events.sort((a, b) => a.t - b.t);
  }, [state]);

  // 7. Bookmarks
  const bookmarks = useMemo(() => {
    if (rawDebrief.bookmarks && rawDebrief.bookmarks.length > 0) {
      return rawDebrief.bookmarks;
    }
    return defaultBookmarks;
  }, [rawDebrief]);

  // 8. Notes & full transcript
  const notes = useMemo(() => {
    if (rawDebrief.notes && rawDebrief.notes.length > 0) {
      return rawDebrief.notes;
    }
    return defaultDebrief.notes;
  }, [rawDebrief]);

  const transcriptTurns = useMemo<TranscriptTurn[]>(() => {
    if (state?.turns && state.turns.length > 0) {
      return state.turns.map((t) => ({
        turn_id: t.turn_id,
        speaker: t.speaker,
        text: t.text,
        start: t.start,
        end: t.end,
        wpm: t.wpm,
        fillers: t.fillers,
      }));
    }
    return defaultDebrief.transcriptTurns;
  }, [state]);

  // 9. Best-moment quote
  const bestMomentQuote = rawDebrief.best_moment_quote || defaultDebrief.best_moment_quote;

  // 10. Better version
  const betterVersion = rawDebrief.better_version ?? defaultDebrief.better_version;

  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-ink selection:text-paper pb-24">
      <article className="max-w-5xl mx-auto px-4 sm:px-8 md:px-12 py-8 sm:py-12">
        {/* 
          EXACT READING ORDER PER PROMPT:
          1. Headline fact as a large Instrument Serif sentence.
          2. One specific strength, stated plainly.
        */}
        <HeadlineAndStrength
          headlineFact={headlineFact}
          strength={strength}
          coachName={coachName}
          date={sessionDate}
        />

        {/* 
          3. One thing to fix, given the most emphasis on the page,
             followed by the if_then plan set like a line to memorise.
        */}
        <OneThingToFix
          oneFix={oneFix}
          ifThen={ifThen}
        />

        {/* 
          4. The five numbers (talk_ratio, interruptions, questions, fillers_per_min, wpm)
             set large in Geist Mono tabular-nums with small labels,
             and vs_last_time as a quiet comparison with the wearer's own past (handle null).
        */}
        <KeyMetrics
          numbers={numbers}
          vsLastTime={vsLastTime}
        />

        {/* 
          5. An interactive audio player, styled to match,
             for the 20-second spoken recap.
        */}
        <RecapAudioPlayer
          audioUrl={audioUrl}
        />

        {/* 
          6. Voice and body timeline: pace, volume, and hand energy
             across the whole conversation as three aligned small-multiple
             SVG traces on one time axis, with nudges (Glyph), bookmarks,
             and signals marked.
        */}
        <VoiceBodyTimeline
          timeline={timelinePoints}
          events={timelineEvents}
        />

        {/* 
          7. Bookmark review: each bookmarked moment with snippet,
             what_happened, and follow_up, distinguishing 'phone' vs 'promise' source.
        */}
        <BookmarkReview
          bookmarks={bookmarks}
        />

        {/* 
          8. Notes on what was discussed, and the full transcript
             (collapsed by default, expandable).
        */}
        <NotesAndTranscript
          notes={notes}
          turns={transcriptTurns}
        />

        {/* 
          9. Best-moment quote as an editorial pull quote.
        */}
        <EditorialPullQuote
          quote={bestMomentQuote}
        />

        {/* 
          10. "Hear the better version": weakest answer beside its rewrite
              with a simulated play control (handle null).
        */}
        <HearBetterVersion
          betterVersion={betterVersion}
        />

        {/* Closing folio rule */}
        <footer className="mt-16 pt-8 border-t border-hairline flex flex-col sm:flex-row items-center justify-between text-xs font-mono text-ink-mid gap-4">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-ink rounded-full" />
            <span>Undertone Conversation Score</span>
          </div>
          <div>
            <span>Objective behavioral feedback · No trait judgements</span>
          </div>
        </footer>
      </article>
    </div>
  );
}
