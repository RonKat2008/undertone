/**
 * Debrief: the headline, the one thing to try, the spoken recap, then everything else behind "More".
 * Opened as /debrief?id=… ; with no id it shows the debrief the laptop just pushed, or else the
 * latest conversation's.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { getDebrief, getTranscript, listSessions, mediaUrl, type DebriefPayload, type DebriefView, type Load, type TranscriptResult } from '@/api/client';
import { isNum, isStr, parseDebrief, type SessionListItem } from '@/api/parse';
import { usePlayback } from '@/audio/player';
import type { Debrief } from '@/bus/contracts';
import { useBus } from '@/bus/use-bus';
import { More } from '@/ui/debrief/More';
import { Header } from '@/ui/Header';
import { Appear, Card, EmptyState, Prose, Screen, T, TextButton, howLong, when } from '@/ui/kit';
import { IconWell } from '@/ui/visuals';
import { PlayLine } from '@/ui/PlayerBar';
import { Failed, Fetching, NotPaired } from '@/ui/States';
import { C, HUES, S } from '@/ui/theme';

type Fetched = Load<DebriefPayload> | { kind: 'no-sessions' };

/** No id: the latest conversation's debrief. A conversation that closed quietly has none. */
async function readDebrief(id: string | undefined): Promise<Fetched> {
  if (id) return getDebrief(id);
  const list = await listSessions();
  if (list.kind !== 'ok') return list;
  const latest = list.data[0];
  return latest ? getDebrief(latest.session_id) : { kind: 'no-sessions' };
}

/** parseDebrief drops better_version; a pushed debrief may carry one, so keep it when it is well formed. */
function betterFrom(raw: Debrief): DebriefView['better_version'] {
  const b: unknown = raw.better_version;
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  if (!isStr(o.rewritten) || !o.rewritten.trim()) return null;
  return { original: isStr(o.original) ? o.original : '', rewritten: o.rewritten, audio_url: isStr(o.audio_url) && o.audio_url ? o.audio_url : null };
}

export default function DebriefScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, mode } = useBus();
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);

  const live = state.debrief && (!id || id === state.debrief.session_id) ? state.debrief : null;
  const fromLive = useMemo<DebriefPayload | null>(() => {
    const data = live ? parseDebrief(live.data) : null;
    return live && data ? { session_id: live.session_id, data: { ...data, better_version: betterFrom(live.data) }, audio_url: live.audio_url || null } : null;
  }, [live]);

  useEffect(() => {
    if (fromLive || mode === 'unpaired') return;
    let on = true;
    setFetched(null);
    readDebrief(id).then(
      (r) => { if (on) setFetched(r); },
      () => { if (on) setFetched({ kind: 'error', message: '', unreachable: true }); },
    );
    return () => { on = false; };
  }, [id, fromLive, mode, attempt]);

  // When and how long: the debrief itself does not carry them; the conversation list does.
  useEffect(() => {
    if (mode === 'unpaired') return;
    let on = true;
    listSessions().then((s) => { if (on && s.kind === 'ok') setSessions(s.data); }, () => undefined);
    return () => { on = false; };
  }, [mode]);

  const retry = () => setAttempt((n) => n + 1);
  const payload = fromLive ?? (fetched?.kind === 'ok' ? fetched.data : null);
  const row = payload ? sessions.find((s) => s.session_id === payload.session_id) : undefined;

  const body = mode === 'unpaired' ? <NotPaired />
    : payload ? <Body p={payload} row={row} />
      : !fetched ? <Fetching />
        : fetched.kind === 'no-sessions' ? <EmptyState icon="talk" title="No conversations yet" line="A debrief appears here after a conversation ends." />
          : fetched.kind === 'none' ? <EmptyState icon="talk" title="No debrief for this one" line="Very short conversations close without one." />
            : fetched.kind === 'error' ? <Failed unreachable={fetched.unreachable} onRetry={retry} />
              : <NotPaired />;

  return (
    <Screen glow={C.warm}>
      <Header />
      {body}
    </Screen>
  );
}

function meta(row: SessionListItem | undefined): string {
  if (!row) return '';
  const at = when(row.started_at);
  const long = isNum(row.duration_s) ? howLong(row.duration_s) : '';
  return [at, long].filter(Boolean).join(', ');
}

function Body({ p, row }: { p: DebriefPayload; row: SessionListItem | undefined }) {
  const router = useRouter();
  const d = p.data;
  const recap = mediaUrl(p.audio_url);
  const line = meta(row);
  const transcript = useTranscriptExists(p.session_id);
  const hasTry = Boolean(d.one_fix || d.if_then);

  return (
    <View>
      <Appear index={0}>
        {d.headline_fact ? <Prose size="title" accessibilityRole="header" style={styles.headline}>{d.headline_fact}</Prose> : null}
        {line ? <T v="small" num style={styles.meta}>{line}</T> : null}
      </Appear>

      {hasTry ? (
        <Appear index={1} style={styles.block}>
          <Card tint={C.accentSoft}>
            <T v="caption" strong color={C.accent} accessibilityRole="header">Try next time</T>
            {d.one_fix ? <Prose size="body" style={styles.capGap}>{d.one_fix}</Prose> : null}
            {d.if_then ? (
              <Prose size="lead" italic color={C.warm} style={d.one_fix ? styles.plan : styles.capGap}
                accessibilityLabel={`Your plan for next time: ${d.if_then}`}>{d.if_then}</Prose>
            ) : null}
          </Card>
        </Appear>
      ) : null}

      {d.strength ? (
        <Appear index={2} style={styles.blockS}>
          <Card>
            <View style={styles.worked}>
              <IconWell name="check" color={HUES[2]} size={32} />
              <T v="caption" strong>What worked</T>
            </View>
            <Prose size="body" style={styles.capGap}>{d.strength}</Prose>
          </Card>
        </Appear>
      ) : null}

      {recap || transcript ? (
        <Appear index={3} style={styles.block}>
          {recap ? <Card><Recap url={recap} /></Card> : null}
          {transcript ? (
            <TextButton label="Read transcript" style={recap ? styles.read : undefined}
              onPress={() => router.push({ pathname: '/transcript', params: { id: p.session_id } })} />
          ) : null}
        </Appear>
      ) : null}

      <Appear index={4}>
        <More d={d} sessionId={p.session_id} />
      </Appear>
    </View>
  );
}

function Recap({ url }: { url: string }) {
  const pb = usePlayback(url);
  return <PlayLine pb={pb} label="Hear the recap" what="the recap" big />;
}

/** Hide "Read transcript" only when the laptop says it has nothing; while unsure, offer it. */
function useTranscriptExists(sessionId: string): boolean {
  const [t, setT] = useState<TranscriptResult | null>(null);
  useEffect(() => {
    let on = true;
    getTranscript(sessionId).then((r) => { if (on) setT(r); }, () => undefined);
    return () => { on = false; };
  }, [sessionId]);
  return t?.kind !== 'not-found';
}

const styles = StyleSheet.create({
  headline: { marginTop: S[2] },
  meta: { marginTop: S[3] },
  plan: { marginTop: S[4] },
  block: { marginTop: S[7] },
  blockS: { marginTop: S[4] },
  capGap: { marginTop: S[2] },
  worked: { flexDirection: 'row', alignItems: 'center', gap: S[3] },
  read: { marginTop: S[2] },
});
