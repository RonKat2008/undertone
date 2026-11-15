'use client';

import { AppWindow, HardDrive, Palette, Smartphone, Watch } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { BandStatusPanel } from '@/components/band-status';
import { Button, EmptyState, ICON, Page, Panel, ThemeToggle } from '@/components/ui';
import { AppsSection } from './apps-section';
import { BuzzSection } from './buzz-section';
import { PhoneSection } from './phone-section';
import { useSettingsData } from './use-settings-data';
import './settings.css';

const SECTIONS = [
  { id: 'phone', title: 'Phone', icon: Smartphone },
  { id: 'band', title: 'Band', icon: Watch },
  { id: 'apps', title: 'Connected apps', icon: AppWindow },
  { id: 'appearance', title: 'Appearance', icon: Palette },
  { id: 'data', title: 'Your data', icon: HardDrive },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function Block({ id, title, icon: Icon, padding = 'normal', children }: {
  id: SectionId; title: string; icon: typeof Watch; padding?: 'normal' | 'list'; children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="settings-block">
      <h2 id={`${id}-title`} className="qi-section-title mb-3">
        <Icon {...ICON} aria-hidden />{title}
      </h2>
      <Panel padding={padding}>{children}</Panel>
    </section>
  );
}

/** Which section is on screen, for the side list. */
function useCurrentSection(): SectionId {
  const [current, setCurrent] = useState<SectionId>('phone');
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => e !== null);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = SECTIONS.find((s) => seen.get(s.id));
      if (first) setCurrent(first.id);
    }, { rootMargin: '-96px 0px -55% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return current;
}

export function SettingsView() {
  const data = useSettingsData();
  const current = useCurrentSection();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await data.reload();
    setRetrying(false);
  }

  return (
    <Page title="Settings" lede="Your phone, your band, and the apps allowed to buzz you." width="wide">
      <div className="settings-layout">
        <nav aria-label="Settings sections" className="settings-nav">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={current === s.id ? 'location' : undefined}>
                  <s.icon {...ICON} size={16} aria-hidden />{s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="settings-main">
          {data.unreachable ? (
            <div id="phone" className="settings-block"><Panel>
              <EmptyState mark="offline" action={<Button loading={retrying} onClick={() => void retry()}>Try again</Button>}>
                Undertone can’t reach the server on this laptop, so your phone, band and apps can’t be shown.
              </EmptyState>
            </Panel></div>
          ) : (
            <>
              <Block id="phone" title="Phone" icon={Smartphone}>
                <PhoneSection devices={data.devices} reload={data.reload} />
                <div className="mt-5">
                  <BuzzSection />
                </div>
              </Block>
              <Block id="band" title="Band" icon={Watch}>
                <BandStatusPanel band={data.band} />
              </Block>
              <Block id="apps" title="Connected apps" icon={AppWindow} padding="list">
                <p className="px-[14px] pb-1 pt-2 text-body text-muted">Other apps can ask to buzz your phone. Nothing reaches you until you approve it.</p>
                <AppsSection apps={data.apps} reload={data.reload} />
              </Block>
            </>
          )}

          <Block id="appearance" title="Appearance" icon={Palette}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-[44ch] text-body text-muted">Dark is easy on the eyes in a dim room; light reads better in daylight.</p>
              <ThemeToggle />
            </div>
          </Block>

          <Block id="data" title="Your data" icon={HardDrive}>
            <div className="grid gap-2 text-body text-muted">
              <p>
                <span className="text-fg">Your recordings, transcripts and debriefs are stored on this laptop.</span>{' '}
                When the recordings folder fills up, the oldest recordings are removed to make room; transcripts and debriefs are kept.
              </p>
              <p>Conversations you hide are not deleted. They stay stored on this laptop.</p>
            </div>
          </Block>
        </div>
      </div>
    </Page>
  );
}
