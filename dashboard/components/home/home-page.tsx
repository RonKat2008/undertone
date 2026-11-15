'use client';

/**
 * Home: a living hero that says where things stand, then a few calm sections built from the
 * wearer's own data (each hidden when there is nothing to show), with the illustrated how-it-works
 * always there so a first visit never looks bare. No graph here: that lives in Insights.
 */
import { useEffect, useState } from 'react';
import { getBandAlwaysOn } from '@/lib/api/client';
import { heroState } from '@/lib/api/home-model';
import { isLive } from '@/lib/bus/reducer';
import { useBus } from '@/lib/bus/use-bus';
import { Closing, CoachTeaser } from './coach-and-close';
import { Hero } from './hero';
import { HowItWorks } from './how-it-works';
import { LatestConversation } from './latest-conversation';
import { PeopleTopics } from './people-topics';
import { useHomeData } from './use-home-data';
import { WeekStrip } from './week-strip';
import './home.css';

export function HomePage() {
  const { state: bus } = useBus();
  const data = useHomeData();
  const band = bus.band;
  // "Listening all day" is only on GET /band/status; re-read it when the band changes.
  const [alwaysOn, setAlwaysOn] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    getBandAlwaysOn().then((v) => {
      if (on) setAlwaysOn(v);
    });
    return () => {
      on = false;
    };
  }, [band?.connected, band?.mic_on, bus.status]);

  const state = heroState({
    busStatus: data.phase === 'unreachable' ? 'offline' : bus.status,
    bandConnected: band ? band.connected : null,
    micOn: band?.mic_on ?? false,
    alwaysOn: alwaysOn ?? data.alwaysOn,
    inSession: isLive(bus),
  });
  const ready = data.phase === 'ready';

  return (
    <div className="[overflow-x:clip]">
      <Hero data={data} state={state} />
      {ready ? (
        <div className="grid gap-[var(--gap-section)] pb-24 pt-6">
          <WeekStrip overview={data.overview} />
          <LatestConversation latest={data.latest} debrief={data.debrief} people={data.people} />
          <PeopleTopics people={data.people} topics={data.overview?.topTopics ?? []} />
          <HowItWorks />
          <CoachTeaser coach={data.coach} />
          <Closing hasHistory={data.latest !== null} paired={data.paired} />
        </div>
      ) : (
        <div className="grid gap-[var(--gap-section)] pb-24 pt-6">
          <HowItWorks />
        </div>
      )}
    </div>
  );
}
