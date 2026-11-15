'use client';

/**
 * Everything the Settings page reads from the backend: phones, connected apps and the band.
 * Loads once, re-reads every few seconds and whenever the live bus says something changed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, listApps, listDevices, type AppInfo, type DeviceInfo } from '@/lib/api/client';
import { getBandStatus, type BandResult } from '@/lib/api/settings';
import { useBus } from '@/lib/bus/use-bus';

export type Load<T> = { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'error'; error: unknown };

export interface SettingsData {
  devices: Load<DeviceInfo[]>;
  apps: Load<AppInfo[]>;
  band: Load<BandResult>;
  /** True when the server on this laptop did not answer at all. */
  unreachable: boolean;
  reload: () => Promise<void>;
}

const REFRESH_MS = 5000;

async function settle<T>(p: Promise<T>): Promise<Load<T>> {
  try {
    return { kind: 'ok', data: await p };
  } catch (error) {
    return { kind: 'error', error };
  }
}

const isUnreachable = (e: unknown) => e instanceof ApiError && e.status === 0;

export function useSettingsData(): SettingsData {
  const { state } = useBus();
  const [devices, setDevices] = useState<Load<DeviceInfo[]>>({ kind: 'loading' });
  const [apps, setApps] = useState<Load<AppInfo[]>>({ kind: 'loading' });
  const [band, setBand] = useState<Load<BandResult>>({ kind: 'loading' });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const [d, a, b] = await Promise.all([settle(listDevices()), settle(listApps()), getBandStatus()]);
    if (!alive.current) return;
    setDevices(d);
    setApps(a);
    setBand(b.kind === 'error' ? { kind: 'error', error: b.error } : { kind: 'ok', data: b });
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(() => void reload(), 0);
    const id = setInterval(() => void reload(), REFRESH_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [reload]);

  // a phone connecting, the band changing or an app asking: read again straight away
  const busKey = [
    Object.values(state.devices).map((d) => `${d.device_id}:${d.connected}`).join(','),
    state.band ? `${state.band.connected}:${state.band.mic_on}:${state.band.battery_pct}` : '-',
    state.appRequests.length,
  ].join('|');
  const firstKey = useRef(busKey);
  useEffect(() => {
    if (busKey === firstKey.current) return;
    firstKey.current = busKey;
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [busKey, reload]);

  const unreachable =
    devices.kind === 'error' && isUnreachable(devices.error) &&
    apps.kind === 'error' && isUnreachable(apps.error) &&
    band.kind === 'error' && isUnreachable(band.error);

  return { devices, apps, band, unreachable, reload };
}
