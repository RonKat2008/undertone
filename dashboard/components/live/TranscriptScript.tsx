'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { MarginNotes } from './MarginNotes';

export interface TranscriptScriptProps {
  className?: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTime(seconds: number): string {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function renderScriptText(text: string, fillers: string[], isMe: boolean) {
  if (!isMe || !fillers || fillers.length === 0) {
    return <span>{text}</span>;
  }

  const cleanFillers = Array.from(
    new Set(fillers.map((f) => f.trim().toLowerCase()).filter((f) => f.length > 0))
  );

  if (cleanFillers.length === 0) {
    return <span>{text}</span>;
  }

  cleanFillers.sort((a, b) => b.length - a.length);

  const regex = new RegExp(`\\b(${cleanFillers.map(escapeRegExp).join('|')})\\b`, 'gi');
  const tokens = text.split(regex);

  return (
    <span>
      {tokens.map((token, i) => {
        const isFiller = cleanFillers.includes(token.toLowerCase());
        if (isFiller) {
          return (
            <span
              key={i}
              className="underline decoration-p-filler decoration-2 underline-offset-4 text-ink"
              style={{
                textDecoration: 'underline',
                textDecorationColor: 'var(--p-filler, #B48A14)',
                textDecorationThickness: '2px',
                textUnderlineOffset: '3px',
              }}
              title="Filler word"
            >
              {token}
            </span>
          );
        }
        return <span key={i}>{token}</span>;
      })}
    </span>
  );
}

export function TranscriptScript({ className = '' }: TranscriptScriptProps = {}) {
  const { state } = useBus();
  const turns = state?.turns || [];
  const partial = state?.partialTranscript;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsUserScrolledUp(distance > 60);
  };

  const scrollToBottom = (smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  useEffect(() => {
    if (!isUserScrolledUp) {
      scrollToBottom(true);
    }
  }, [turns.length, partial?.text, isUserScrolledUp]);

  return (
    <section
      aria-label="Conversation Script"
      className={`relative flex flex-col w-full h-full min-h-[360px] ${className}`}
    >
      {/* Two-column editorial header */}
      <div className="grid grid-cols-[1fr_140px] sm:grid-cols-[1fr_220px] lg:grid-cols-[1fr_260px] gap-x-4 sm:gap-x-6 pb-2.5 mb-2 border-b border-hairline text-[11px] font-mono uppercase tracking-widest text-ink-mid select-none shrink-0">
        <div>Script</div>
        <div className="pl-3 sm:pl-4 border-l border-hairline">Marginalia</div>
      </div>

      {/* Scrollable transcript manuscript */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto pr-1 sm:pr-2 focus-visible:outline-none"
        tabIndex={0}
      >
        {turns.length === 0 && !partial && (
          <div className="py-20 text-center flex flex-col items-center justify-center">
            <p className="font-serif italic text-xl text-ink-mid max-w-md">
              The conversation score will appear here as speech begins.
            </p>
            <p className="font-mono text-[11px] text-ink-mid/60 mt-3 uppercase tracking-widest">
              ME flush left · THEM indented · Marginalia in right column
            </p>
          </div>
        )}

        {/* Play-script turns */}
        <div className="flex flex-col">
          {turns.map((turn) => {
            const isMe = turn.speaker === 'me';

            return (
              <article
                key={turn.turn_id}
                className="grid grid-cols-[1fr_140px] sm:grid-cols-[1fr_220px] lg:grid-cols-[1fr_260px] gap-x-4 sm:gap-x-6 py-3.5 border-b border-hairline/40 items-start"
              >
                {/* Script column */}
                <div className={`min-w-0 ${isMe ? '' : 'pl-6 sm:pl-10 md:pl-12'}`}>
                  {/* Speaker label & turn meta */}
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span
                      className={`font-mono text-xs uppercase tracking-widest font-semibold ${
                        isMe ? 'text-ink' : 'text-other'
                      }`}
                      style={{ fontVariant: 'all-small-caps' }}
                    >
                      {isMe ? 'ME' : 'THEM'}
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-ink-mid/80">
                      {formatTime(turn.start)}
                      {isMe && typeof turn.wpm === 'number' && turn.wpm > 0 && (
                        <span> · {Math.round(turn.wpm)} wpm</span>
                      )}
                    </span>
                  </div>

                  {/* Speech text */}
                  <p
                    className={`font-sans text-base sm:text-[17px] leading-relaxed m-0 ${
                      isMe ? 'text-ink font-normal' : 'text-other font-normal'
                    }`}
                  >
                    {renderScriptText(turn.text, turn.fillers, isMe)}
                  </p>
                </div>

                {/* Marginalia column */}
                <div className="min-w-0 pl-3 sm:pl-4 border-l border-hairline self-stretch pt-0.5">
                  <MarginNotes
                    turnId={turn.turn_id}
                    tsStart={turn.start}
                    tsEnd={turn.end}
                  />
                </div>
              </article>
            );
          })}

          {/* Typing partial transcript */}
          {partial && partial.text && (
            <article className="grid grid-cols-[1fr_140px] sm:grid-cols-[1fr_220px] lg:grid-cols-[1fr_260px] gap-x-4 sm:gap-x-6 py-3.5 border-b border-hairline/40 items-start bg-paper-well/30 transition-colors">
              <div
                className={`min-w-0 ${
                  partial.speaker === 'other' ? 'pl-6 sm:pl-10 md:pl-12' : ''
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`font-mono text-xs uppercase tracking-widest font-semibold ${
                      partial.speaker === 'other' ? 'text-other' : 'text-ink'
                    }`}
                    style={{ fontVariant: 'all-small-caps' }}
                  >
                    {partial.speaker === 'other' ? 'THEM' : 'ME'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-ink-mid">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    live
                  </span>
                </div>
                <p
                  className={`font-sans text-base sm:text-[17px] leading-relaxed m-0 ${
                    partial.speaker === 'other' ? 'text-other' : 'text-ink'
                  }`}
                >
                  {partial.text}
                  <span
                    aria-hidden="true"
                    className="inline-block w-1.5 h-4 ml-1 bg-ink align-middle animate-pulse"
                    style={{ animationDuration: '0.8s' }}
                  />
                </p>
              </div>

              <div className="min-w-0 pl-3 sm:pl-4 border-l border-hairline self-stretch pt-0.5 flex items-start">
                <span className="text-[10px] font-mono text-ink-mid/50 uppercase tracking-widest">
                  transcribing…
                </span>
              </div>
            </article>
          )}
        </div>
      </div>

      {/* Floating button to jump back to latest turn if user scrolled up */}
      {isUserScrolledUp && (
        <button
          type="button"
          onClick={() => {
            setIsUserScrolledUp(false);
            scrollToBottom(true);
          }}
          className="absolute bottom-3 right-6 z-10 px-2.5 py-1 text-xs font-mono border border-hairline bg-paper text-ink hover:bg-paper-well transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          aria-label="Scroll to latest turn"
        >
          <span>Latest</span>
          <span aria-hidden="true">&darr;</span>
        </button>
      )}
    </section>
  );
}
