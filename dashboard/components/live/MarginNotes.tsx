'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { Glyph } from '@/components/Glyph';
import { HapticPattern, JudgeAnswer } from '@/lib/bus/contracts';

export interface MarginNotesProps {
  turnId: string;
  tsStart: number;
  tsEnd: number;
}

interface FormattedVerdict {
  key: string;
  text: string;
  confDisplay: string | null;
  isLowConf: boolean;
}

function formatVerdict(key: string, answer: JudgeAnswer): FormattedVerdict {
  const conf = answer.confidence;
  const isLowConf = typeof conf === 'number' && conf < 0.7;
  const confFormatted = typeof conf === 'number' ? conf.toFixed(2) : null;

  let text = key;
  let confDisplay = confFormatted;

  if (answer.kind === 'score') {
    const scoreVal = Number.isInteger(answer.score)
      ? answer.score.toString()
      : answer.score.toFixed(1);
    text = `${key} ${scoreVal}/${answer.max}`;
    confDisplay = confFormatted;
  } else if (answer.kind === 'choice') {
    const choiceLower = answer.choice.toLowerCase();
    if (choiceLower === 'true' || choiceLower === 'yes') {
      text = key;
      confDisplay = confFormatted;
    } else if (choiceLower === 'false' || choiceLower === 'no') {
      text = `no ${key}`;
      confDisplay = confFormatted;
    } else {
      text = `${key}: ${answer.choice}`;
      confDisplay = confFormatted;
    }
  } else if (answer.kind === 'noul') {
    text = key;
    confDisplay = typeof conf === 'number' ? confFormatted : (typeof answer.p === 'number' ? answer.p.toFixed(2) : null);
  }

  return { key, text, confDisplay, isLowConf };
}

export function MarginNotes({ turnId, tsStart, tsEnd }: MarginNotesProps) {
  const { state } = useBus();

  const verdicts = state?.judgeByTurnId?.[turnId];
  const quietNudges = state?.quietNudges || [];
  const signals = state?.signals || [];
  const bookmarks = state?.bookmarks || [];

  const verdictEntries = verdicts ? Object.entries(verdicts) : [];
  const tags: FormattedVerdict[] = verdictEntries.map(([k, a]) => formatVerdict(k, a));

  // Determine source mark: rules vs decisions
  const isRuleBased = verdictEntries.length > 0 && verdictEntries.every(([k]) =>
    k === 'interrupted' || k === 'monologue' || k === 'wpm' || k === 'pace' || k === 'volume'
  );
  const sourceLabel = isRuleBased ? 'rules' : 'decisions · 212 ms';

  // Find quiet nudges near [tsStart, tsEnd]
  const startWindow = tsStart - 1.0;
  const endWindow = tsEnd + 2.0;

  const relevantQuietNudges = quietNudges.filter(
    (q) => typeof q.ts === 'number' && q.ts >= startWindow && q.ts <= endWindow
  );

  // Find signals near turn timestamp
  const relevantSignals = signals.filter(
    (s) => typeof s.ts === 'number' && s.ts >= startWindow && s.ts <= endWindow
  );

  // Find bookmarks near turn timestamp
  const relevantBookmarks = bookmarks.filter(
    (b) => typeof b.ts === 'number' && b.ts >= startWindow && b.ts <= endWindow
  );

  const hasContent =
    tags.length > 0 ||
    relevantQuietNudges.length > 0 ||
    relevantSignals.length > 0 ||
    relevantBookmarks.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <aside
      aria-label={`Marginalia for turn ${turnId}`}
      className="flex flex-col gap-2 text-xs font-sans text-ink select-text"
    >
      {/* Judge verdicts */}
      {tags.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {/* Source mark */}
          <div className="text-[10px] font-mono text-ink-mid/70 tabular-nums uppercase tracking-widest leading-none">
            {sourceLabel}
          </div>

          {/* Verdict tags */}
          <div className="flex flex-wrap gap-1.5 items-center">
            {tags.map((tag) => (
              <span
                key={tag.key}
                className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 border border-hairline bg-paper-well text-[11px] leading-tight text-ink ${
                  tag.isLowConf ? 'opacity-50' : 'opacity-100'
                }`}
                title={tag.isLowConf ? 'Low confidence verdict (< 0.70)' : undefined}
              >
                <span className="font-sans lowercase">{tag.text}</span>
                {tag.confDisplay && (
                  <span className="font-mono tabular-nums text-[10px] text-ink-mid">
                    {tag.confDisplay}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quiet marks for non-focus slips */}
      {relevantQuietNudges.length > 0 && (
        <div className="flex flex-col gap-1 pt-1 border-t border-hairline/60">
          {relevantQuietNudges.map((q, idx) => (
            <div
              key={`quiet-${q.rule_id || idx}-${q.ts}`}
              className="flex items-center gap-1.5 text-[11px] text-ink-mid"
              title={`Quiet slip: ${q.reason || q.message}`}
            >
              <Glyph
                pattern={(q.haptic as HapticPattern) || 'tap'}
                size="xs"
                className="shrink-0 opacity-70"
              />
              <span className="font-sans truncate">{q.message}</span>
              <span className="font-mono tabular-nums text-[9px] text-ink-mid/60 uppercase tracking-wider shrink-0">
                slip
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Calm nerves / checked_out signal notes */}
      {relevantSignals.length > 0 && (
        <div className="flex flex-col gap-1 pt-1 border-t border-hairline/60">
          {relevantSignals.map((s, idx) => (
            <div
              key={`signal-${s.kind}-${idx}`}
              className="border-l-2 border-hairline pl-1.5 py-0.5 flex flex-col text-[11px]"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mid font-medium">
                signal · {s.kind === 'nerves' ? 'nerves' : 'checked out'}
              </span>
              <span className="font-sans text-ink-mid leading-snug">
                {s.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Bookmarked moments near this turn */}
      {relevantBookmarks.length > 0 && (
        <div className="flex flex-col gap-1 pt-1 border-t border-hairline/60">
          {relevantBookmarks.map((b, idx) => (
            <div
              key={`bm-${idx}`}
              className="border-l-2 border-p-wrap-up/60 pl-1.5 py-0.5 flex flex-col text-[11px]"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mid font-medium">
                bookmark · {b.source}
              </span>
              {b.text && (
                <span className="font-sans italic text-ink-mid leading-snug">
                  &ldquo;{b.text}&rdquo;
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
