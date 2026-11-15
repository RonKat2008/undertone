'use client';

import { useState } from 'react';
import { Button, EmptyState, List, ListRow, Skeleton, StatusWord, toast } from '@/components/ui';
import { approveApp, revokeApp, type AppInfo } from '@/lib/api/client';
import { appMeta, plainError, sortApps } from '@/lib/api/settings-model';
import { useBus } from '@/lib/bus/use-bus';
import type { Load } from './use-settings-data';

export interface AppsSectionProps {
  apps: Load<AppInfo[]>;
  reload: () => Promise<void>;
}

/** Apps asking to buzz your phone: pending ones first with Approve / Decline, approved ones with Remove. */
export function AppsSection({ apps, reload }: AppsSectionProps) {
  const { resolveApp } = useBus();
  const [busy, setBusy] = useState<string | null>(null);

  if (apps.kind === 'loading') return <Skeleton shape="block" height={112} />;
  if (apps.kind === 'error') return <p role="alert" className="px-1 py-2 text-body text-danger">Couldn’t read connected apps. {plainError(apps.error)}</p>;

  const { pending, approved } = sortApps(apps.data);
  if (pending.length + approved.length === 0) {
    return <EmptyState mark="none">No apps have asked to connect.</EmptyState>;
  }

  async function act(app: AppInfo, action: 'approve' | 'decline' | 'remove') {
    setBusy(`${app.app_id}:${action}`);
    try {
      await (action === 'approve' ? approveApp(app.app_id) : revokeApp(app.app_id));
      resolveApp(app.app_id);
      toast(action === 'approve' ? `${app.name} can buzz your phone` : action === 'decline' ? `${app.name} declined` : `${app.name} removed`);
      await reload();
    } catch (e) {
      toast.error(plainError(e));
    } finally {
      setBusy(null);
    }
  }

  const is = (app: AppInfo, action: string) => busy === `${app.app_id}:${action}`;

  return (
    <List label="Connected apps">
      {[
        ...pending.map((a) => (
          <div key={a.app_id} className="flex flex-wrap items-center gap-x-[14px] gap-y-3 px-[14px] py-3">
            <AppTile name={a.name} pending />
            <span className="min-w-0 flex-1 basis-[12rem]">
              <span className="block text-body font-medium text-fg">{a.name}</span>
              <span className="block text-caption text-muted">
                <StatusWord tone="coach">Wants to buzz your phone</StatusWord><span className="ml-2">{appMeta(a)}</span>
              </span>
            </span>
            <span className="flex gap-2 pl-[50px] sm:pl-0">
              <Button size="small" variant="ghost" loading={is(a, 'decline')} onClick={() => void act(a, 'decline')}>Decline</Button>
              <Button size="small" loading={is(a, 'approve')} onClick={() => void act(a, 'approve')}>Approve</Button>
            </span>
          </div>
        )),
        ...approved.map((a) => (
          <ListRow key={a.app_id} title={a.name} meta={appMeta(a)} leading={<AppTile name={a.name} />}
            trailing={<Button size="small" variant="ghost" loading={is(a, 'remove')} onClick={() => void act(a, 'remove')}>Remove</Button>} />
        )),
      ]}
    </List>
  );
}

function AppTile({ name, pending = false }: { name: string; pending?: boolean }) {
  return (
    <span aria-hidden data-pending={pending || undefined} className="settings-app-tile grid size-9 place-items-center rounded-[10px] text-body font-medium">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
