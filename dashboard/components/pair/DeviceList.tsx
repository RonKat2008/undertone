'use client';

import React, { useEffect, useState } from 'react';
import { listDevices } from '@/lib/api/client';
import { useBus } from '@/lib/bus/use-bus';

interface DeviceItem {
  id: string;
  name: string;
  category: 'phone' | 'band' | 'simulator';
  connected: boolean;
  transport: string;
  batteryPct: number | null;
  lastActive: string;
  latencyMs: number;
}

export function DeviceList() {
  const { state, fireNudge } = useBus();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pingingId, setPingingId] = useState<string | null>(null);

  useEffect(() => {
    let isSubscribed = true;

    async function fetchDevices() {
      try {
        const raw = await listDevices();
        if (!isSubscribed) return;

        // Build list combining API results with bus state
        const busPhone = state?.deviceStatus;
        const busBand = state?.bandStatus;

        const defaultPhone: DeviceItem = {
          id: busPhone?.device_id || 'dev_phone_15pro',
          name: busPhone?.name || 'iPhone 15 Pro (Primary)',
          category: 'phone',
          connected: busPhone ? busPhone.connected : true,
          transport: 'WebRTC / LAN',
          batteryPct: 84,
          lastActive: 'Active now',
          latencyMs: 14,
        };

        const defaultBand: DeviceItem = {
          id: 'dev_band_01',
          name: 'Undertone Wristband v1',
          category: 'band',
          connected: busBand?.connected ?? true,
          transport: busBand?.transport ? busBand.transport.toUpperCase() : 'BLE',
          batteryPct: busBand?.battery_pct ?? 92,
          lastActive: busBand?.mic_on ? 'Mic listening' : 'Idle',
          latencyMs: 8,
        };

        const list: DeviceItem[] = [defaultPhone, defaultBand];

        // Merge any extra devices from raw API if not already represented
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item.device_id && !list.some((d) => d.id === item.device_id)) {
              list.push({
                id: item.device_id,
                name: item.name || 'External Device',
                category: item.name?.toLowerCase().includes('phone') ? 'phone' : 'band',
                connected: Boolean(item.connected),
                transport: 'BLE',
                batteryPct: 78,
                lastActive: '5m ago',
                latencyMs: 22,
              });
            }
          }
        }

        setDevices(list);
      } catch (err) {
        console.error('Failed to list devices:', err);
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    fetchDevices();

    return () => {
      isSubscribed = false;
    };
  }, [state?.deviceStatus, state?.bandStatus]);

  const handlePingHaptic = (deviceId: string) => {
    setPingingId(deviceId);
    // Fire light test tick
    fireNudge('tap', 'Test haptic tap from dashboard');
    setTimeout(() => {
      setPingingId(null);
    }, 1500);
  };

  const handleToggleConnect = (deviceId: string) => {
    setDevices((prev) =>
      prev.map((d) => (d.id === deviceId ? { ...d, connected: !d.connected } : d))
    );
  };

  return (
    <div className="border-b border-hairline pb-12">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 mb-6">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-mid block mb-1">
            01 / Hardware
          </span>
          <h3 className="font-serif text-2xl text-ink font-normal">Connected Phones & Peripherals</h3>
        </div>
        <span className="font-mono text-xs text-ink-mid">
          {devices.filter((d) => d.connected).length} of {devices.length} devices online
        </span>
      </div>

      {loading ? (
        <div className="py-8 font-mono text-sm text-ink-mid animate-pulse">
          Querying local bus and device registry…
        </div>
      ) : (
        <div className="border-t border-hairline divide-y divide-hairline">
          {devices.map((device) => (
            <div
              key={device.id}
              className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                {/* Status indicator dot */}
                <div className="pt-1.5">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      device.connected ? 'bg-emerald-600' : 'bg-neutral-300'
                    }`}
                    title={device.connected ? 'Connected' : 'Offline'}
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-sans font-medium text-ink text-base">
                      {device.name}
                    </span>
                    <span className="font-mono text-xs text-ink-mid">
                      {device.id}
                    </span>
                    <span className="font-mono text-xs px-1.5 py-0.5 border border-hairline text-ink-mid uppercase">
                      {device.category}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-ink-mid font-mono">
                    <span>Transport: {device.transport}</span>
                    <span>·</span>
                    <span>
                      Battery:{' '}
                      <span className="text-ink font-medium">
                        {device.batteryPct !== null ? `${device.batteryPct}%` : 'N/A'}
                      </span>
                    </span>
                    <span>·</span>
                    <span>Latency: {device.latencyMs} ms</span>
                    <span>·</span>
                    <span>{device.lastActive}</span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 self-end md:self-center">
                {device.connected && (
                  <button
                    type="button"
                    onClick={() => handlePingHaptic(device.id)}
                    disabled={pingingId === device.id}
                    className="px-3 py-1.5 text-xs font-mono border border-hairline text-ink hover:bg-paper-well transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {pingingId === device.id ? 'Pinging…' : 'Test Haptic'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleToggleConnect(device.id)}
                  className={`px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                    device.connected
                      ? 'text-ink-mid hover:text-p-interrupt hover:border-p-interrupt border border-hairline'
                      : 'border border-ink text-ink hover:bg-ink hover:text-paper'
                  }`}
                >
                  {device.connected ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
