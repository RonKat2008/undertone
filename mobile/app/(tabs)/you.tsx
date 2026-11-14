import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { listApps } from '@/api/client';
import { okData, useLoad } from '@/api/use-load';
import { useBus, type BusApi } from '@/bus/use-bus';
import { Appear, Button, Card, IconWell, Orb, Row, Screen, Section, Sheet, T } from '@/ui/kit';
import { C, HUES, S } from '@/ui/theme';

interface Status { word: string; line: string; lost?: boolean; on?: boolean }

/** The connection in plain words: one word, one line. No addresses, no ids. */
function statusOf(mode: BusApi['mode'], state: BusApi['state']): Status {
  if (mode === 'unpaired') return { word: 'Not paired', line: 'Pair with your laptop to start.' };
  if (mode === 'loading' || state.status === 'connecting') return { word: 'Connecting', line: 'Looking for your laptop.' };
  if (state.status === 'offline') return { word: 'Not listening', line: 'Can’t reach your laptop.', lost: true };
  if (!state.band?.connected) return { word: 'Band off', line: 'Nothing is being heard.' };
  // Tap to start opens the mic only during a conversation, so a closed mic is only news when always on.
  if (state.alwaysOn && !state.band.mic_on) return { word: 'Mic off', line: 'Your band’s microphone is off.' };
  const listening = state.alwaysOn || (state.session !== null && state.session.endedAt === null);
  return { word: 'Connected', line: listening ? 'Your band is listening.' : 'Ready when you start a conversation.', on: true };
}

export default function YouScreen() {
  const router = useRouter();
  const { mode, state, unpair } = useBus();
  const [confirming, setConfirming] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const paired = mode === 'live';
  const [apps] = useLoad(listApps, `${mode}|${state.resync}|${state.appRequests.length}`);
  const pendingIds = new Set([
    ...state.appRequests.map((a) => a.app_id),
    ...(okData(apps) ?? []).filter((a) => a.status === 'pending').map((a) => a.app_id),
  ]);
  const waiting = paired ? pendingIds.size : 0;
  const status = statusOf(mode, state);

  async function confirmUnpair() {
    setUnpairing(true);
    try { await unpair(); setConfirming(false); } finally { setUnpairing(false); }
  }

  return (
    <Screen title="You">
      <Appear index={0}>
        <Card style={styles.status}>
          <Orb color={status.on ? C.accent : C.muted} energy={status.on ? 1 : 0} size={ORB_SIZE} />
          <View style={styles.statusText} accessibilityLiveRegion="polite">
            <T v="lead" color={status.lost ? C.warn : C.text}>{status.word}</T>
            <T v="small" style={styles.line}>{status.line}</T>
          </View>
        </Card>
      </Appear>

      <Section>
        <Appear index={1}>
          <Card list>
            <Row title="Connected apps" onPress={() => router.push('/apps')}
              leading={<IconWell name="apps" color={HUES[3]} />}
              meta={waiting ? `${waiting} waiting` : undefined} metaColor={C.warn}
              accessibilityLabel={waiting ? `Connected apps, ${waiting} waiting` : 'Connected apps'} />
            <Row title="Buzz patterns" onPress={() => router.push('/patterns')}
              leading={<IconWell name="pulse" color={HUES[4]} />} />
          </Card>
        </Appear>
      </Section>

      <View style={styles.spacer} />

      <View style={styles.bottom}>
        {mode === 'unpaired'
          ? <Button kind="primary" label="Pair" wide onPress={() => router.push('/pair')} />
          : paired ? <Button kind="danger" label="Unpair this phone" onPress={() => setConfirming(true)} /> : null}
        <T v="caption" style={styles.foot}>Keep Undertone open during a conversation so buzzes reach you.</T>
      </View>

      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Unpair this phone?">
        <T v="small">You’ll need to pair again to get buzzes.</T>
        <View style={styles.sheetActions}>
          <Button kind="danger" label="Unpair" wide loading={unpairing} onPress={() => void confirmUnpair()} />
          <Button label="Cancel" wide onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

const ORB_SIZE = 72;

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: S[4] },
  statusText: { flex: 1 },
  line: { marginTop: S[1] },
  spacer: { flexGrow: 1, minHeight: S[8] },
  bottom: { gap: S[3] },
  foot: { marginTop: S[2] },
  sheetActions: { gap: S[3], marginTop: S[5] },
});
