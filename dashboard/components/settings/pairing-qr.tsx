import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * Phone cameras read dark modules on a light ground most reliably, so the code is always drawn
 * dark on light (the light theme's surface and text), whichever theme the page is in.
 */
const QR_LIGHT = 'oklch(99.5% 0.005 80)';
const QR_DARK = 'oklch(24% 0.02 55)';

export interface PairingQrProps {
  text: string;
  size: number;
}

export function PairingQr({ text, size }: PairingQrProps) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, d };
  }, [text]);
  const pad = 3;
  return (
    <svg width={size} height={size} viewBox={`${-pad} ${-pad} ${cells.n + pad * 2} ${cells.n + pad * 2}`}
      role="img" aria-label="Pairing code for your phone's camera" shapeRendering="crispEdges"
      className="block rounded-[14px] shadow-[var(--shadow-lift)]">
      <rect x={-pad} y={-pad} width={cells.n + pad * 2} height={cells.n + pad * 2} fill={QR_LIGHT} rx={2.5} />
      <path d={cells.d} fill={QR_DARK} />
    </svg>
  );
}
