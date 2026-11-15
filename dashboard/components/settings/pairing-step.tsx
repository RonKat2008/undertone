'use client';

import { useEffect, useRef } from 'react';
import { Button, ListeningMark } from '@/components/ui';
import { listDevices, type DeviceInfo, type Pairing } from '@/lib/api/client';
import { groupCode, typedAddress } from '@/lib/api/settings-model';
import { PairingQr } from './pairing-qr';

const POLL_MS = 1500;

export interface PairingStepProps {
  pairing: Pairing;
  /** Called once, when the phone this code was made for connects. */
  onConnected: (phone: DeviceInfo) => void;
  onCancel: () => void;
}

/** The revealed pairing step: QR, the code to type, the laptop address and two short steps. */
export function PairingStep({ pairing, onConnected, onCancel }: PairingStepProps) {
  const done = useRef(false);
  const notify = useRef(onConnected);
  useEffect(() => {
    notify.current = onConnected;
  }, [onConnected]);

  // wait for the phone: GET /devices until this pairing's device is connected
  useEffect(() => {
    let current = true;
    const check = async () => {
      try {
        const phone = (await listDevices()).find((d) => d.device_id === pairing.device_id && d.connected);
        if (phone && current && !done.current) {
          done.current = true;
          notify.current(phone);
        }
      } catch {
        // a missed poll is retried on the next tick; the page's own status shows an unreachable server
      }
    };
    const id = setInterval(() => void check(), POLL_MS);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [pairing.device_id]);

  const code = groupCode(pairing.code);

  return (
    <div className="grid gap-6 border-t border-line pt-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8">
      <div className="justify-self-center sm:justify-self-start">
        <PairingQr text={pairing.qr} size={200} />
      </div>
      <div className="grid content-start gap-5">
        <ol className="grid gap-3">
          {[
            'Open Undertone on your phone. Keep it on the same Wi-Fi as this laptop.',
            'Tap Scan the code and point the camera here. Or tap Enter code instead and type the code below.',
          ].map((text, i) => (
            <li key={i} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3 text-body text-fg">
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-[var(--accent-wash)] text-caption font-medium text-accent tabular">
                {i + 1}
              </span>
              <span className="pt-0.5 text-pretty">{text}</span>
            </li>
          ))}
        </ol>
        <div>
          <p className="text-caption text-muted" id="pair-code-label">Pairing code</p>
          <p aria-labelledby="pair-code-label" aria-label={pairing.code.split('').join(' ')}
            className="mt-1 flex items-center gap-1.5 font-medium tabular text-fg">
            {code.split('').map((ch, i) =>
              ch === ' ' ? (
                <span key={i} aria-hidden className="w-2" />
              ) : (
                <span key={i} aria-hidden className="grid h-12 w-10 place-items-center rounded-[10px] bg-surface-2 text-[26px] leading-none sm:h-14 sm:w-11 sm:text-[30px]">
                  {ch}
                </span>
              ),
            )}
          </p>
          <p className="mt-3 text-caption text-muted">
            Typing it? The phone also asks for this laptop’s address: <span className="font-medium text-fg tabular">{typedAddress(pairing.server_url)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-2 text-caption text-muted" role="status">
            <ListeningMark state="listening" />
            Waiting for your phone
          </span>
          <Button size="small" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
