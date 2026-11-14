/**
 * Everything on a debrief past the one thing to try, behind the screen's single "More".
 * Each part renders only when it has something in it.
 */
import { StyleSheet, View } from 'react-native';
import { mediaUrl, type DebriefView } from '@/api/client';
import { usePlayback } from '@/audio/player';
import { useBus } from '@/bus/use-bus';
import { NumbersList } from '@/ui/debrief/Numbers';
import { TagPerson } from '@/ui/debrief/TagPerson';
import { Card, Disclosure, Prose, Row, Section, T, clock } from '@/ui/kit';
import { PlayLine } from '@/ui/PlayerBar';
import { C, S } from '@/ui/theme';
import { IconWell } from '@/ui/visuals';

type BetterVersion = NonNullable<DebriefView['better_version']>;

function Better({ b }: { b: BetterVersion }) {
  const url = mediaUrl(b.audio_url);
  return (
    <Section label="A better way to say it">
      <Card>
        {b.original ? <T v="small">You said “{b.original}”</T> : null}
        <Prose size="body" style={styles.gapS}>{b.rewritten}</Prose>
        {url ? <BetterPlay url={url} /> : null}
      </Card>
    </Section>
  );
}

function BetterPlay({ url }: { url: string }) {
  const pb = usePlayback(url);
  return <View style={styles.gapM}><PlayLine pb={pb} label="Hear it" what="the better version" /></View>;
}

export function More({ d, sessionId }: { d: DebriefView; sessionId: string }) {
  const { state } = useBus();
  const baseline = state.metrics?.baseline_wpm;
  const usualWpm = typeof baseline === 'number' && Number.isFinite(baseline) && baseline > 0 ? baseline : null;
  const better = d.better_version && d.better_version.rewritten.trim() ? d.better_version : null;
  return (
    <Disclosure label="More" style={styles.more}>
      <NumbersList numbers={d.numbers} timeline={d.timeline} usualWpm={usualWpm} />
      {d.vs_last_time ? (
        <Section label="Against last time"><Card><Prose size="body">{d.vs_last_time}</Prose></Card></Section>
      ) : null}
      {d.best_moment_quote ? (
        <Section label="Your best moment">
          <Card tint={C.warmSoft}><Prose size="body" italic color={C.warm}>“{d.best_moment_quote}”</Prose></Card>
        </Section>
      ) : null}
      {d.notes.length > 0 ? (
        <Section label="What you talked about">
          <Card>
            {d.notes.map((n, i) => <Prose key={`${i}-${n}`} size="body" style={i > 0 ? styles.gapS : undefined}>{n}</Prose>)}
          </Card>
        </Section>
      ) : null}
      {d.bookmarks.length > 0 ? (
        <Section label="Bookmarks">
          <Card list>
            {d.bookmarks.map((b, i) => (
              <Row key={`${b.ts}-${i}`} serif title={b.what_happened || `Bookmark at ${clock(b.ts)}`}
                detail={b.follow_up ? `Follow up: ${b.follow_up}` : undefined} meta={clock(b.ts)}
                leading={<IconWell name="bookmark" color={C.warm} size={36} />} />
            ))}
          </Card>
        </Section>
      ) : null}
      {better ? <Better b={better} /> : null}
      <Section label="Who was this with?"><TagPerson sessionId={sessionId} /></Section>
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  more: { marginTop: S[8] },
  gapS: { marginTop: S[2] },
  gapM: { marginTop: S[3] },
});
