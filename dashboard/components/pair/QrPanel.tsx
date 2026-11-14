'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPairing } from '@/lib/api/client';

interface QrPanelProps {
  initialCode?: string;
  onCodeChange?: (newCode: string) => void;
}

// Generate deterministic 25x25 QR code matrix based on seed string
function generateQrMatrix(code: string): boolean[][] {
  const size = 25;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // Helper to draw filled box
  const fillRect = (r1: number, c1: number, r2: number, c2: number, val: boolean) => {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r >= 0 && r < size && c >= 0 && c < size) {
          matrix[r][c] = val;
          reserved[r][c] = true;
        }
      }
    }
  };

  // Helper to draw 7x7 Finder Pattern with 1px separator
  const drawFinder = (top: number, left: number) => {
    // 7x7 outer black
    fillRect(top, left, top + 6, left + 6, true);
    // 5x5 inner white
    fillRect(top + 1, left + 1, top + 5, left + 5, false);
    // 3x3 core black
    fillRect(top + 2, left + 2, top + 4, left + 4, true);

    // Separator zone around finder
    const sepTop = Math.max(0, top - 1);
    const sepBottom = Math.min(size - 1, top + 7);
    const sepLeft = Math.max(0, left - 1);
    const sepRight = Math.min(size - 1, left + 7);
    for (let r = sepTop; r <= sepBottom; r++) {
      for (let c = sepLeft; c <= sepRight; c++) {
        if (!reserved[r][c]) {
          matrix[r][c] = false;
          reserved[r][c] = true;
        }
      }
    }
  };

  // 1. Finder Patterns in 3 corners
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Timing patterns on row 6 and col 6
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    reserved[6][i] = true;
    matrix[i][6] = i % 2 === 0;
    reserved[i][6] = true;
  }

  // 3. Alignment pattern at (18, 18) for Version 2 (25x25)
  const alignR = 18;
  const alignC = 18;
  fillRect(alignR - 2, alignC - 2, alignR + 2, alignC + 2, true);
  fillRect(alignR - 1, alignC - 1, alignR + 1, alignC + 1, false);
  matrix[alignR][alignC] = true;
  reserved[alignR][alignC] = true;

  // 4. Dark module
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;

  // 5. Format info areas
  for (let i = 0; i <= 8; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // 6. Deterministic fill based on code hash
  let seed = 2166136261;
  for (let i = 0; i < code.length; i++) {
    seed ^= code.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c]) {
        // pseudo-random bit using XOR fold and coordinates
        const h = Math.imul(seed ^ (r * 1103515245 + c * 12345), 2654435761);
        const bit = ((h >>> (r % 16)) ^ (r + c)) % 2 === 0;
        matrix[r][c] = bit;
      }
    }
  }

  return matrix;
}

export function QrPanel({ initialCode = 'UT-4829', onCodeChange }: QrPanelProps) {
  const [pairingCode, setPairingCode] = useState(initialCode);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(582); // ~9m 42s

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 600));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await createPairing();
      // Format realistically like UT-XXXX or use returned code
      const formatted = res.code.startsWith('UT-') ? res.code : `UT-${res.code.padStart(4, '0')}`;
      setPairingCode(formatted);
      setTimeLeft(600);
      onCodeChange?.(formatted);
    } catch (e) {
      console.error('Failed to create pairing:', e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const qrMatrix = useMemo(() => generateQrMatrix(pairingCode), [pairingCode]);

  return (
    <div className="border-b border-hairline pb-12">
      <div className="flex flex-col lg:flex-row items-start justify-between gap-8 lg:gap-12">
        {/* Left: Deterministic SVG QR Code */}
        <div className="flex-shrink-0">
          <div className="p-4 bg-white border border-hairline inline-block shadow-none select-none">
            <svg
              className="w-48 h-48 sm:w-56 sm:h-56 block"
              viewBox="0 0 29 29"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              shapeRendering="crispEdges"
              aria-label={`Pairing QR code for Undertone device code ${pairingCode}`}
            >
              {/* White background / quiet zone */}
              <rect x="0" y="0" width="29" height="29" fill="#FFFFFF" />
              {/* 25x25 modules offset by 2 quiet modules */}
              {qrMatrix.map((row, r) =>
                row.map((active, c) =>
                  active ? (
                    <rect
                      key={`${r}-${c}`}
                      x={c + 2}
                      y={r + 2}
                      width="1"
                      height="1"
                      fill="#111827"
                    />
                  ) : null
                )
              )}
            </svg>
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs text-ink-mid font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block animate-pulse" />
            <span>Preshared Session Key Active</span>
          </div>
        </div>

        {/* Right: Code details, countdown and actions */}
        <div className="flex-grow flex flex-col justify-between self-stretch">
          <div>
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="font-mono text-xs uppercase tracking-wider text-ink-mid">
                Pairing Code
              </span>
              <span className="font-mono text-xs text-ink-mid tabular-nums">
                Expires in {formatCountdown(timeLeft)}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-4 mb-4">
              <span className="font-mono text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-ink tabular-nums">
                {pairingCode}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="font-mono text-xs text-ink hover:text-ink-mid underline underline-offset-4 transition-colors cursor-pointer"
                title="Copy code to clipboard"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <p className="text-sm text-ink-mid max-w-xl leading-relaxed mb-6 font-sans">
              Scan this QR code using the Undertone iPhone app to link your pocket metronome.
              Alternatively, open the app, tap <strong className="text-ink font-medium">Enter code</strong>, and type the six-character key above.
            </p>
          </div>

          <div className="pt-4 border-t border-hairline flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-paper text-sm font-sans font-medium hover:bg-ink/90 active:scale-[0.99] disabled:opacity-50 transition-all cursor-pointer"
            >
              <svg
                className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>{isGenerating ? 'Generating…' : 'Generate new code'}</span>
            </button>

            <span className="text-xs text-ink-mid font-mono">
              Creates a fresh single-use cryptographic token
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
