'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { TimelinePoint, HapticPattern } from '@/lib/bus/contracts';
import { Glyph } from '@/components/Glyph';

export interface TimelineEvent {
  t: number;
  type: 'nudge' | 'bookmark' | 'signal';
  label: string;
  pattern?: string;
  detail?: string;
}

interface VoiceBodyTimelineProps {
  timeline: TimelinePoint[];
  events?: TimelineEvent[];
}

function buildSvgPath(
  pts: TimelinePoint[],
  getX: (t: number) => number,
  getY: (pt: TimelinePoint) => number
) {
  if (pts.length === 0) return '';
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  return sorted
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(p.t).toFixed(1)} ${getY(p).toFixed(1)}`)
    .join(' ');
}

export function VoiceBodyTimeline({
  timeline,
  events = [],
}: VoiceBodyTimelineProps) {
  const [hoveredT, setHoveredT] = useState<number | null>(null);

  // Compute duration
  const maxT = useMemo(() => {
    if (!timeline || timeline.length === 0) return 90;
    const lastPointT = timeline[timeline.length - 1].t;
    const maxEventT = events.reduce((acc, ev) => Math.max(acc, ev.t), 0);
    return Math.max(90, lastPointT, maxEventT);
  }, [timeline, events]);

  // Coordinate mapping
  const width = 1000;
  const leftPad = 90;
  const rightPad = 40;
  const plotWidth = width - leftPad - rightPad;

  const getX = useCallback(
    (t: number) => leftPad + (Math.max(0, Math.min(t, maxT)) / maxT) * plotWidth,
    [leftPad, maxT, plotWidth]
  );

  // Trace 1: Pace (WPM) -> domain [80, 200], range [25, 105] (h=80)
  const getPaceY = (wpm: number) => {
    const clamped = Math.max(80, Math.min(wpm, 200));
    return 105 - ((clamped - 80) / 120) * 80;
  };

  // Trace 2: Volume (dB) -> domain [-35, -5], range [135, 215] (h=80)
  const getVolY = (db: number) => {
    const clamped = Math.max(-35, Math.min(db, -5));
    return 215 - ((clamped + 35) / 30) * 80;
  };

  // Trace 3: Hand Energy -> domain [0, 1], range [245, 325] (h=80)
  const getEnergyY = (energy: number) => {
    const clamped = Math.max(0, Math.min(energy, 1));
    return 325 - clamped * 80;
  };

  const pacePath = useMemo(
    () => buildSvgPath(timeline, getX, (p) => getPaceY(p.wpm)),
    [timeline, getX]
  );
  const volPath = useMemo(
    () => buildSvgPath(timeline, getX, (p) => getVolY(p.volume_db)),
    [timeline, getX]
  );
  const energyPath = useMemo(
    () => buildSvgPath(timeline, getX, (p) => getEnergyY(p.hand_energy)),
    [timeline, getX]
  );

  // Find interpolated values for hovered time
  const currentHoverData = useMemo(() => {
    if (hoveredT === null || timeline.length === 0) return null;
    const sorted = [...timeline].sort((a, b) => a.t - b.t);
    let closest = sorted[0];
    let minDiff = Math.abs(sorted[0].t - hoveredT);
    for (const p of sorted) {
      const diff = Math.abs(p.t - hoveredT);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }
    // Check nearby event
    const nearbyEvent = events.find((ev) => Math.abs(ev.t - hoveredT) <= 2.5);
    return {
      t: hoveredT,
      wpm: Math.round(closest.wpm),
      volume_db: Math.round(closest.volume_db),
      hand_energy: closest.hand_energy.toFixed(2),
      event: nearbyEvent,
    };
  }, [hoveredT, timeline, events]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - svgRect.left;
    const svgX = (clickX / svgRect.width) * width;
    if (svgX >= leftPad && svgX <= width - rightPad) {
      const t = ((svgX - leftPad) / plotWidth) * maxT;
      setHoveredT(Math.round(t * 10) / 10);
    }
  };

  const handleMouseLeave = () => {
    setHoveredT(null);
  };

  // Time ticks
  const ticks = [0, 15, 30, 45, 60, 75, 90].filter((t) => t <= maxT);
  if (maxT > 90 && !ticks.includes(Math.round(maxT))) {
    ticks.push(Math.round(maxT));
  }

  const formatSecs = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <section className="py-10 border-b border-hairline space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
            Voice & Body Timeline
          </h3>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Three aligned small-multiple traces across the conversation
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-ink-mid">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-ink inline-block" /> Pace / Volume / Hands
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-ink/10 inline-block border border-ink/20" /> Baseline / Target Zone
          </span>
        </div>
      </div>

      {/* Main SVG Timeline Container */}
      <div className="border border-hairline bg-paper-well/30 p-2 sm:p-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} 360`}
          className="w-full min-w-[720px] select-none text-ink font-mono"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Subtle baseline / comfort zones */}
          {/* Trace 1: Pace Baseline (135 - 155 WPM) */}
          <rect
            x={leftPad}
            y={getPaceY(155)}
            width={plotWidth}
            height={getPaceY(135) - getPaceY(155)}
            fill="currentColor"
            fillOpacity="0.05"
          />

          {/* Trace 2: Volume Comfort Zone (-20 to -14 dB) */}
          <rect
            x={leftPad}
            y={getVolY(-14)}
            width={plotWidth}
            height={getVolY(-20) - getVolY(-14)}
            fill="currentColor"
            fillOpacity="0.05"
          />

          {/* Trace 3: Natural Gesturing Zone (0.3 to 0.7 energy) */}
          <rect
            x={leftPad}
            y={getEnergyY(0.7)}
            width={plotWidth}
            height={getEnergyY(0.3) - getEnergyY(0.7)}
            fill="currentColor"
            fillOpacity="0.05"
          />

          {/* Hairline Grid Lines & Labels for Trace 1: Pace */}
          <text x="12" y="32" className="text-[10px] font-bold fill-ink tracking-wider">
            PACE
          </text>
          <text x="12" y="44" className="text-[9px] fill-ink-mid">
            (WPM)
          </text>
          <text x={leftPad - 8} y="30" textAnchor="end" className="text-[9px] fill-ink-mid">
            200
          </text>
          <text x={leftPad - 8} y="68" textAnchor="end" className="text-[9px] fill-ink-mid font-medium">
            140
          </text>
          <text x={leftPad - 8} y="107" textAnchor="end" className="text-[9px] fill-ink-mid">
            80
          </text>
          <line x1={leftPad} y1="25" x2={width - rightPad} y2="25" stroke="currentColor" strokeOpacity="0.1" />
          <line x1={leftPad} y1="65" x2={width - rightPad} y2="65" stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
          <line x1={leftPad} y1="105" x2={width - rightPad} y2="105" stroke="currentColor" strokeOpacity="0.2" />

          {/* Hairline Grid Lines & Labels for Trace 2: Volume */}
          <text x="12" y="142" className="text-[10px] font-bold fill-ink tracking-wider">
            VOLUME
          </text>
          <text x="12" y="154" className="text-[9px] fill-ink-mid">
            (dBFS)
          </text>
          <text x={leftPad - 8} y="140" textAnchor="end" className="text-[9px] fill-ink-mid">
            -5
          </text>
          <text x={leftPad - 8} y="178" textAnchor="end" className="text-[9px] fill-ink-mid font-medium">
            -20
          </text>
          <text x={leftPad - 8} y="217" textAnchor="end" className="text-[9px] fill-ink-mid">
            -35
          </text>
          <line x1={leftPad} y1="135" x2={width - rightPad} y2="135" stroke="currentColor" strokeOpacity="0.1" />
          <line x1={leftPad} y1="175" x2={width - rightPad} y2="175" stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
          <line x1={leftPad} y1="215" x2={width - rightPad} y2="215" stroke="currentColor" strokeOpacity="0.2" />

          {/* Hairline Grid Lines & Labels for Trace 3: Hand Energy */}
          <text x="12" y="252" className="text-[10px] font-bold fill-ink tracking-wider">
            HANDS
          </text>
          <text x="12" y="264" className="text-[9px] fill-ink-mid">
            (ENERGY)
          </text>
          <text x={leftPad - 8} y="250" textAnchor="end" className="text-[9px] fill-ink-mid">
            1.0
          </text>
          <text x={leftPad - 8} y="288" textAnchor="end" className="text-[9px] fill-ink-mid font-medium">
            0.5
          </text>
          <text x={leftPad - 8} y="327" textAnchor="end" className="text-[9px] fill-ink-mid">
            0.0
          </text>
          <line x1={leftPad} y1="245" x2={width - rightPad} y2="245" stroke="currentColor" strokeOpacity="0.1" />
          <line x1={leftPad} y1="285" x2={width - rightPad} y2="285" stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
          <line x1={leftPad} y1="325" x2={width - rightPad} y2="325" stroke="currentColor" strokeOpacity="0.2" />

          {/* Data Traces */}
          {pacePath && (
            <path d={pacePath} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          )}
          {volPath && (
            <path d={volPath} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          )}
          {energyPath && (
            <path d={energyPath} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          )}

          {/* Time axis ticks at bottom */}
          <line x1={leftPad} y1="330" x2={width - rightPad} y2="330" stroke="currentColor" strokeOpacity="0.3" />
          {ticks.map((tickSec) => {
            const x = getX(tickSec);
            return (
              <g key={tickSec}>
                <line x1={x} y1="330" x2={x} y2="336" stroke="currentColor" strokeOpacity="0.5" />
                <text x={x} y="348" textAnchor="middle" className="text-[10px] fill-ink-mid">
                  {formatSecs(tickSec)}
                </text>
              </g>
            );
          })}

          {/* Event Markers (Nudges, Bookmarks, Signals) */}
          {events.map((ev, i) => {
            const x = getX(ev.t);
            let color = '#111827';
            if (ev.pattern === 'interrupt') color = '#E03C31';
            else if (ev.pattern === 'wrap_up') color = '#D97706';
            else if (ev.pattern === 'filler') color = '#B48A14';
            else if (ev.pattern === 'still') color = '#7C3AED';
            else if (ev.pattern === 'success') color = '#16A34A';
            else if (ev.pattern === 'slow_down') color = '#2563EB';

            return (
              <g key={i} className="group">
                {/* Vertical hairline connecting all 3 traces */}
                <line
                  x1={x}
                  y1="18"
                  x2={x}
                  y2="330"
                  stroke={color}
                  strokeWidth="1.2"
                  strokeDasharray={ev.type === 'nudge' ? 'none' : '3 2'}
                  strokeOpacity={0.6}
                />

                {/* Marker flag at the top */}
                {ev.type === 'nudge' && (
                  <circle cx={x} cy="18" r="4.5" fill={color} />
                )}
                {ev.type === 'bookmark' && (
                  <polygon
                    points={`${x - 4},13 ${x + 4},13 ${x + 4},22 ${x},19 ${x - 4},22`}
                    fill="#111827"
                  />
                )}
                {ev.type === 'signal' && (
                  <rect x={x - 3.5} y="14" width="7" height="7" fill="#7C3AED" transform={`rotate(45 ${x} 17.5)`} />
                )}
              </g>
            );
          })}

          {/* Interactive Inspection Cursor */}
          {hoveredT !== null && (
            <g>
              <line
                x1={getX(hoveredT)}
                y1="15"
                x2={getX(hoveredT)}
                y2="330"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeOpacity="0.9"
              />
              <circle cx={getX(hoveredT)} cy={getPaceY(currentHoverData?.wpm ?? 140)} r="4" fill="currentColor" />
              <circle cx={getX(hoveredT)} cy={getVolY(currentHoverData?.volume_db ?? -18)} r="4" fill="currentColor" />
              <circle cx={getX(hoveredT)} cy={getEnergyY(Number(currentHoverData?.hand_energy ?? 0.5))} r="4" fill="currentColor" />
            </g>
          )}
        </svg>
      </div>

      {/* Synchronized Inspection Readout Bar */}
      <div className="border border-hairline bg-paper-well/60 px-4 py-3 flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
        <div className="flex items-center gap-4 sm:gap-6">
          <div>
            <span className="text-ink-mid text-[10px] uppercase tracking-wider block">Time</span>
            <span className="text-ink font-bold tabular-nums">
              {currentHoverData ? formatSecs(currentHoverData.t) : 'Hover timeline'}
            </span>
          </div>
          <div>
            <span className="text-ink-mid text-[10px] uppercase tracking-wider block">Pace</span>
            <span className="text-ink tabular-nums">
              {currentHoverData ? `${currentHoverData.wpm} wpm` : '—'}
            </span>
          </div>
          <div>
            <span className="text-ink-mid text-[10px] uppercase tracking-wider block">Volume</span>
            <span className="text-ink tabular-nums">
              {currentHoverData ? `${currentHoverData.volume_db} dB` : '—'}
            </span>
          </div>
          <div>
            <span className="text-ink-mid text-[10px] uppercase tracking-wider block">Hand Energy</span>
            <span className="text-ink tabular-nums">
              {currentHoverData ? currentHoverData.hand_energy : '—'}
            </span>
          </div>
        </div>

        {/* Hovered event description if cursor is near an event */}
        <div className="text-ink-mid flex items-center gap-2">
          {currentHoverData?.event ? (
            <span className="flex items-center gap-1.5 text-ink font-medium">
              <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-ink text-paper">
                {currentHoverData.event.type}
              </span>
              <span>{currentHoverData.event.label}</span>
              {currentHoverData.event.detail && (
                <span className="text-ink-mid">({currentHoverData.event.detail})</span>
              )}
            </span>
          ) : (
            <span className="text-[11px] text-ink-mid">
              Move cursor over graph to inspect moment-by-moment readings
            </span>
          )}
        </div>
      </div>

      {/* Event Reference Strip with Glyphs */}
      <div className="space-y-2 pt-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid">
          Nudges & Markers on this Axis
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {events.map((ev, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 border border-hairline px-2.5 py-1 text-xs bg-paper-well/40 hover:border-ink transition-colors cursor-pointer"
              onMouseEnter={() => setHoveredT(ev.t)}
              onMouseLeave={() => setHoveredT(null)}
            >
              {ev.pattern && (
                <div className="w-4 h-4 flex items-center justify-center shrink-0">
                  <Glyph pattern={ev.pattern as HapticPattern} size="xs" />
                </div>
              )}
              <span className="font-mono tabular-nums text-[11px] text-ink-mid">
                {formatSecs(ev.t)}
              </span>
              <span className="font-sans font-medium text-ink">
                {ev.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
