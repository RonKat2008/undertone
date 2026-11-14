'use client';

import React, { useEffect, useState } from 'react';
import { listApps, approveApp, revokeApp } from '@/lib/api/client';
import { useBus } from '@/lib/bus/use-bus';

interface AppItem {
  app_id: string;
  name: string;
  approved: boolean;
  last_used?: string;
  description?: string;
  scope?: string;
}

interface PendingRequest {
  app_id: string;
  name: string;
  requestedAt: string;
  scope: string;
}

export function AppAccessList() {
  const { state } = useBus();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Initialize apps and pending requests
  useEffect(() => {
    let isSubscribed = true;

    async function fetchApps() {
      try {
        const raw = await listApps();
        if (!isSubscribed) return;

        // Base registered apps with editorial detail
        const baseApps: AppItem[] = [
          {
            app_id: 'a1',
            name: 'Case Interview Timer',
            approved: true,
            last_used: 'Today, 09:14',
            description: 'Dispatches soft pacing taps for timed case structure segments.',
            scope: 'Haptic patterns: tap, slow_down',
          },
          {
            app_id: 'a2',
            name: 'Keynote Speaker Prompter',
            approved: true,
            last_used: 'Yesterday, 16:40',
            description: 'Sends silent wrap-up cue when slide budget expires.',
            scope: 'Haptic patterns: wrap_up',
          },
          {
            app_id: 'a3',
            name: 'Deep Breath Metronome',
            approved: false,
            last_used: 'Nov 12, 11:20',
            description: 'Pre-meeting grounding pulses for nervous regulation.',
            scope: 'Haptic patterns: still',
          },
        ];

        // Merge raw API items if not existing
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (item.app_id && !baseApps.some((a) => a.app_id === item.app_id)) {
              baseApps.unshift({
                app_id: item.app_id,
                name: item.name || 'Third-Party App',
                approved: Boolean(item.approved),
                last_used: item.last_used ? new Date(item.last_used).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never',
                description: 'External speech assistant integration.',
                scope: 'Haptic patterns: tap',
              });
            }
          }
        }

        setApps(baseApps);

        // Preload default pending request if none in bus, or merge from state.pendingAppRequests
        const initialPending: PendingRequest[] = [
          {
            app_id: 'app_pending_cal',
            name: 'Google Meet Coach Integration',
            requestedAt: '4 minutes ago',
            scope: 'Direct haptic alert dispatch during video conferences',
          },
        ];

        if (state?.pendingAppRequests && state.pendingAppRequests.length > 0) {
          const busPending = state.pendingAppRequests.map((req) => ({
            app_id: req.app_id,
            name: req.name,
            requestedAt: 'Just now',
            scope: 'Permission to dispatch haptic vibrations to phone',
          }));
          setPendingRequests(busPending);
        } else {
          setPendingRequests(initialPending);
        }
      } catch (err) {
        console.error('Failed to load apps:', err);
      } finally {
        if (isSubscribed) setLoading(false);
      }
    }

    fetchApps();

    return () => {
      isSubscribed = false;
    };
  }, [state?.pendingAppRequests]);

  const handleApprove = async (appId: string, name?: string) => {
    setActioningId(appId);
    try {
      await approveApp(appId);
      // Remove from pending
      setPendingRequests((prev) => prev.filter((p) => p.app_id !== appId));
      // Update or add to apps
      setApps((prev) => {
        const existing = prev.find((a) => a.app_id === appId);
        if (existing) {
          return prev.map((a) => (a.app_id === appId ? { ...a, approved: true, last_used: 'Just now' } : a));
        }
        return [
          {
            app_id: appId,
            name: name || 'Authorized App',
            approved: true,
            last_used: 'Just now',
            description: 'Newly authorized third-party haptic integration.',
            scope: 'Haptic patterns: tap, wrap_up',
          },
          ...prev,
        ];
      });
    } catch (err) {
      console.error('Failed to approve app:', err);
    } finally {
      setActioningId(null);
    }
  };

  const handleRevoke = async (appId: string) => {
    setActioningId(appId);
    try {
      await revokeApp(appId);
      setApps((prev) =>
        prev.map((a) => (a.app_id === appId ? { ...a, approved: false } : a))
      );
    } catch (err) {
      console.error('Failed to revoke app:', err);
    } finally {
      setActioningId(null);
    }
  };

  const handleDenyPending = (appId: string) => {
    setPendingRequests((prev) => prev.filter((p) => p.app_id !== appId));
  };

  return (
    <div className="border-b border-hairline pb-12">
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 mb-6">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-ink-mid block mb-1">
            02 / Integrations
          </span>
          <h3 className="font-serif text-2xl text-ink font-normal">Connected Applications</h3>
        </div>
        <span className="text-xs text-ink-mid font-mono">
          Third-party apps authorized to buzz the phone
        </span>
      </div>

      {/* Pending Access Requests Callout (Top) */}
      {pendingRequests.length > 0 && (
        <div className="mb-8 border border-hairline bg-paper-well p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-p-wrap-up inline-block" />
            <span className="font-mono text-xs uppercase tracking-wider text-ink font-semibold">
              Pending Access Authorization ({pendingRequests.length})
            </span>
          </div>

          <div className="divide-y divide-hairline">
            {pendingRequests.map((req) => (
              <div
                key={req.app_id}
                className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-sans font-medium text-ink text-base">
                      {req.name}
                    </span>
                    <span className="font-mono text-xs text-ink-mid">
                      {req.requestedAt}
                    </span>
                  </div>
                  <p className="text-xs text-ink-mid font-sans mt-0.5">
                    {req.scope}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleApprove(req.app_id, req.name)}
                    disabled={actioningId === req.app_id}
                    className="px-3.5 py-1.5 bg-ink text-paper text-xs font-mono font-medium hover:bg-ink/90 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {actioningId === req.app_id ? 'Authorizing…' : 'Approve Access'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDenyPending(req.app_id)}
                    className="px-3 py-1.5 border border-hairline text-ink-mid hover:text-ink text-xs font-mono transition-colors cursor-pointer"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Authorized Apps Table */}
      {loading ? (
        <div className="py-8 font-mono text-sm text-ink-mid animate-pulse">
          Loading authorized integrations…
        </div>
      ) : (
        <div className="border-t border-hairline divide-y divide-hairline">
          {apps.map((app) => (
            <div
              key={app.app_id}
              className="py-4 flex flex-col md:flex-row md:items-start justify-between gap-4"
            >
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-sans font-medium text-ink text-base">
                    {app.name}
                  </span>
                  <span
                    className={`font-mono text-xs px-1.5 py-0.5 border ${
                      app.approved
                        ? 'border-emerald-700/30 text-emerald-800 bg-emerald-500/10'
                        : 'border-hairline text-ink-mid bg-neutral-100'
                    }`}
                  >
                    {app.approved ? 'Authorized' : 'Revoked'}
                  </span>
                  <span className="font-mono text-xs text-ink-mid">
                    Last active: <span className="tabular-nums text-ink">{app.last_used}</span>
                  </span>
                </div>

                {app.description && (
                  <p className="text-sm text-ink-mid mt-1 font-sans">
                    {app.description}
                  </p>
                )}

                {app.scope && (
                  <div className="mt-1.5 font-mono text-xs text-ink-mid">
                    Scope: <span className="text-ink">{app.scope}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 self-end md:self-start pt-1">
                {app.approved ? (
                  <button
                    type="button"
                    onClick={() => handleRevoke(app.app_id)}
                    disabled={actioningId === app.app_id}
                    className="px-3 py-1.5 text-xs font-mono border border-hairline text-ink-mid hover:text-p-interrupt hover:border-p-interrupt transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {actioningId === app.app_id ? 'Updating…' : 'Revoke'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleApprove(app.app_id, app.name)}
                    disabled={actioningId === app.app_id}
                    className="px-3 py-1.5 text-xs font-mono border border-ink text-ink hover:bg-ink hover:text-paper transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {actioningId === app.app_id ? 'Updating…' : 'Re-authorize'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
