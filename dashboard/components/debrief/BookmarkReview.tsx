'use client';

import React, { useState } from 'react';
import { BookmarkReview as BookmarkReviewType } from '@/lib/bus/contracts';

interface BookmarkReviewProps {
  bookmarks: BookmarkReviewType[];
}

export function BookmarkReview({ bookmarks }: BookmarkReviewProps) {
  const [completedItems, setCompletedItems] = useState<Record<number, boolean>>({});

  const toggleComplete = (idx: number) => {
    setCompletedItems((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const formatTs = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <section className="py-10 border-b border-hairline space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
            Bookmark Review
          </h3>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Key moments captured by phone tap or identified as spoken commitments
          </p>
        </div>
        <span className="font-mono text-xs text-ink-mid tabular-nums">
          {bookmarks?.length || 0} {bookmarks?.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {(!bookmarks || bookmarks.length === 0) ? (
        <div className="py-8 text-center border border-dashed border-hairline">
          <p className="font-sans text-sm text-ink-mid italic">
            No bookmarks or verbal promises flagged during this session.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-hairline border-y border-hairline">
          {bookmarks.map((bm, idx) => {
            const isCompleted = !!completedItems[idx];
            const isPromise = bm.source === 'promise';

            return (
              <div
                key={idx}
                className="py-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-start"
              >
                {/* Meta column: timestamp and source pill */}
                <div className="md:col-span-3 space-y-2">
                  <div className="font-mono text-base font-bold tabular-nums text-ink">
                    {formatTs(bm.ts)}
                  </div>
                  <div>
                    {isPromise ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-ink text-paper font-medium">
                        <span className="w-1.5 h-1.5 bg-paper rounded-full" />
                        Spoken Promise
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border border-ink text-ink bg-paper-well font-medium">
                        <span className="w-1.5 h-1.5 bg-ink rounded-full" />
                        Phone Tap
                      </span>
                    )}
                  </div>
                </div>

                {/* Content column: snippet and what happened */}
                <div className="md:col-span-5 space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mid">
                    Transcript Snippet
                  </div>
                  <blockquote className="font-serif italic text-lg sm:text-xl text-ink leading-snug">
                    &ldquo;{bm.snippet}&rdquo;
                  </blockquote>
                  <p className="font-sans text-xs text-ink-mid leading-relaxed pt-1">
                    <span className="font-medium text-ink">What occurred:</span> {bm.what_happened}
                  </p>
                </div>

                {/* Follow-up column */}
                <div className="md:col-span-4 bg-paper-well/50 p-3 sm:p-4 border border-hairline space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mid">
                    Follow-up Action
                  </div>
                  {bm.follow_up ? (
                    <div className="space-y-3">
                      <p
                        className={`font-sans text-sm font-medium transition-all ${
                          isCompleted ? 'line-through text-ink-mid' : 'text-ink'
                        }`}
                      >
                        {bm.follow_up}
                      </p>
                      <button
                        onClick={() => toggleComplete(idx)}
                        className={`text-[11px] font-mono px-2 py-1 border transition-colors flex items-center gap-2 ${
                          isCompleted
                            ? 'border-hairline text-ink-mid bg-paper'
                            : 'border-ink text-ink hover:bg-ink hover:text-paper'
                        }`}
                      >
                        <span className="w-3 h-3 border border-current flex items-center justify-center text-[10px]">
                          {isCompleted ? '✓' : ''}
                        </span>
                        <span>{isCompleted ? 'Marked complete' : 'Mark as done'}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="font-sans text-xs text-ink-mid italic">
                      No explicit action item required.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
