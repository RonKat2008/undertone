'use client';

import React, { useState } from 'react';

export interface TranscriptTurn {
  turn_id: string;
  speaker: 'me' | 'other' | string;
  text: string;
  start: number;
  end: number;
  wpm: number;
  fillers: string[];
}

interface NotesAndTranscriptProps {
  notes: string[];
  turns: TranscriptTurn[];
}

export function NotesAndTranscript({ notes = [], turns = [] }: NotesAndTranscriptProps) {
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);

  const formatSecs = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Highlight filler words in text
  const renderTurnText = (turn: TranscriptTurn) => {
    if (!turn.fillers || turn.fillers.length === 0 || turn.speaker !== 'me') {
      return turn.text;
    }

    // Split text keeping filler occurrences
    const regex = new RegExp(`\\b(${turn.fillers.join('|')})\\b`, 'gi');
    const parts = turn.text.split(regex);

    return parts.map((part, i) => {
      const isFiller = turn.fillers.some(
        (f) => f.toLowerCase() === part.toLowerCase()
      );
      if (isFiller) {
        return (
          <span
            key={i}
            className="underline decoration-[oklch(0.75_0.15_85)] decoration-2 underline-offset-4 text-ink font-medium"
            title={`Filler word: "${part}"`}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <section className="py-10 border-b border-hairline space-y-8">
      {/* 8a. Notes on what was discussed */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
            Discussion Notes & Key Topics
          </h3>
          <span className="font-mono text-xs text-ink-mid">
            {notes.length} points logged
          </span>
        </div>

        {notes.length > 0 ? (
          <ol className="divide-y divide-hairline border-y border-hairline">
            {notes.map((note, index) => (
              <li
                key={index}
                className="py-3 flex items-baseline gap-4 font-sans text-sm md:text-base text-ink leading-relaxed"
              >
                <span className="font-mono text-xs text-ink-mid tabular-nums shrink-0 w-6">
                  {(index + 1).toString().padStart(2, '0')}.
                </span>
                <span>{note}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="font-sans text-sm text-ink-mid italic py-2">
            No topic notes logged for this session.
          </p>
        )}
      </div>

      {/* 8b. Full transcript (collapsed by default, expandable) */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
              Full Conversation Transcript
            </h3>
            <p className="font-sans text-xs text-ink-mid mt-0.5">
              Script-formatted dialogue record with speaker indentations and filler markings
            </p>
          </div>

          <button
            onClick={() => setIsTranscriptExpanded((prev) => !prev)}
            className="font-mono text-xs px-3 py-1.5 border border-ink text-ink hover:bg-ink hover:text-paper transition-colors flex items-center gap-2"
            aria-expanded={isTranscriptExpanded}
          >
            <span>{isTranscriptExpanded ? '− Collapse' : '+ Expand'}</span>
            <span className="text-ink-mid tabular-nums">
              ({turns.length} {turns.length === 1 ? 'turn' : 'turns'})
            </span>
          </button>
        </div>

        {/* Expandable Script Area */}
        {isTranscriptExpanded && (
          <div className="border border-hairline bg-paper-well/30 p-4 sm:p-8 space-y-6 max-h-[650px] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-hairline text-[11px] font-mono text-ink-mid uppercase tracking-wider">
              <span>Time & Speaker</span>
              <span>Dialogue</span>
              <span>Pace</span>
            </div>

            {turns.length > 0 ? (
              <div className="space-y-6">
                {turns.map((turn) => {
                  const isMe = turn.speaker === 'me';
                  return (
                    <article
                      key={turn.turn_id}
                      className={`grid grid-cols-12 gap-3 items-baseline ${
                        isMe ? 'text-ink' : 'text-other'
                      }`}
                    >
                      {/* Left meta: Timestamp and speaker badge */}
                      <div className="col-span-3 sm:col-span-2 font-mono text-xs tabular-nums space-y-1">
                        <div className="text-ink-mid">
                          {formatSecs(turn.start)}
                        </div>
                        <div
                          className={`text-[10px] uppercase font-bold tracking-wider ${
                            isMe ? 'text-ink' : 'text-other'
                          }`}
                        >
                          {isMe ? 'ME' : 'OTHER'}
                        </div>
                      </div>

                      {/* Script speech turn: flush-left for ME, indented for OTHER */}
                      <div
                        className={`col-span-7 sm:col-span-9 leading-relaxed font-sans text-sm sm:text-base ${
                          isMe ? 'pl-0 font-normal text-ink' : 'pl-4 sm:pl-8 italic text-other border-l-2 border-hairline'
                        }`}
                      >
                        {renderTurnText(turn)}
                      </div>

                      {/* Right meta: WPM */}
                      <div className="col-span-2 sm:col-span-1 text-right font-mono text-xs tabular-nums text-ink-mid">
                        {Math.round(turn.wpm)} <span className="text-[10px]">wpm</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center font-sans text-sm text-ink-mid italic">
                No recorded turns available.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
