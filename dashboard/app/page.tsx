'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { TalkSpine } from '@/components/live/TalkSpine';
import { SessionTimeline } from '@/components/live/SessionTimeline';
import { TranscriptScript } from '@/components/live/TranscriptScript';
import { InstrumentsRail } from '@/components/live/InstrumentsRail';
import { NudgeTakeover, NudgeLog } from '@/components/live/NudgeTakeover';
import { StatusReplyPill } from '@/components/live/StatusReplyPill';
import { IdleState } from '@/components/live/IdleState';

export default function LivePage() {
  const { state } = useBus();
  const sessionStatus = state?.sessionStatus || 'idle';

  return (
    <div className="w-full min-h-[calc(100vh-57px)] bg-paper text-ink flex flex-col relative overflow-x-hidden">
      {/* Floating alert overlays: unmissable nudge takeover & status query pill */}
      <NudgeTakeover />
      <StatusReplyPill />

      {sessionStatus === 'idle' ? (
        /* Standby State: invites double-tap, displays coach rules & start trigger */
        <main className="flex-1 flex items-center justify-center py-6 sm:py-10 px-4 sm:px-6 lg:px-8">
          <IdleState />
        </main>
      ) : (
        /* Active / Live Session Score View */
        <main className="flex-1 flex flex-col w-full px-4 sm:px-6 lg:px-8">
          {/* Top Section: Talk Ratio Spine */}
          <TalkSpine />

          {/* Timeline Strip across entire session */}
          <SessionTimeline />

          {/* Main Body: Editorial Score (Script + Marginalia on left/center, Instruments on right rail) */}
          <div className="flex-1 w-full max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 min-h-0">
            {/* Play Script & Margin Notes (7 cols on lg, 8 cols on xl) */}
            <div className="lg:col-span-7 xl:col-span-8 flex flex-col border-b lg:border-b-0 lg:border-r border-hairline min-w-0">
              <div className="flex-1 min-h-[420px] lg:min-h-[600px]">
                <TranscriptScript className="h-full" />
              </div>

              {/* Compact Nudge Log at the base of the transcript column */}
              <div className="px-4 sm:px-6 py-4 bg-paper border-t border-hairline">
                <NudgeLog />
              </div>
            </div>

            {/* Instruments & Diagnostics Rail (5 cols on lg, 4 cols on xl) */}
            <div className="lg:col-span-5 xl:col-span-4 bg-paper-well/30 flex flex-col min-w-0">
              <InstrumentsRail className="h-full" />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
