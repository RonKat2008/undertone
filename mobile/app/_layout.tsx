import { Geist_400Regular, Geist_500Medium } from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PATTERN_ORDER, PATTERNS } from '@/bus/patterns';
import { isLive } from '@/bus/reducer';
import { BusProvider, useBus } from '@/bus/use-bus';
import { DebriefNotice } from '@/ui/DebriefNotice';
import { Glyph } from '@/ui/Glyph';
import { StayAwake } from '@/ui/Listening';
import { Btn, T } from '@/ui/kit';
import { C } from '@/ui/theme';

export default function RootLayout() {
  const [loaded] = useFonts({ Geist_400Regular, Geist_500Medium, GeistMono_400Regular, InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: C.ink }} />;
  return (
    <SafeAreaProvider>
      <BusProvider>
        <StatusBar style="light" />
        <Shell />
      </BusProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { mode, state, dismissNotice } = useBus();
  const path = usePathname();
  const router = useRouter();
  const [director, setDirector] = useState(false);
  const live = isLive(state);
  const sessionId = state.session?.id ?? null;
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (mode === 'unpaired' && path !== '/pair') router.replace('/pair');
    if ((mode === 'mock' || mode === 'live') && path === '/pair') router.replace('/');
  }, [mode, path, router]);

  // Always-on: a conversation that opens by itself takes the phone to the Live view, once per conversation.
  useEffect(() => {
    if (!state.alwaysOn || !live || !sessionId || shownFor.current === sessionId) return;
    shownFor.current = sessionId;
    if (path !== '/live' && path !== '/pair') router.replace('/live');
  }, [state.alwaysOn, live, sessionId, path, router]);

  // Reading the debrief is what the notice asks for: once there, it is done.
  useEffect(() => {
    if (path === '/debrief' && state.notice) dismissNotice();
  }, [path, state.notice, dismissNotice]);

  // The director panel: a three-finger tap on the phone, the backtick key on web.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === '`') setDirector((d) => !d); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (mode === 'loading') return <View style={{ flex: 1, backgroundColor: C.ink }} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }} onTouchStart={(e) => { if (e.nativeEvent.touches.length === 3) setDirector(true); }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ink }, animation: 'fade' }} />
      {/* always-on: the screen may sleep between conversations, but not during one */}
      {state.alwaysOn && live ? <StayAwake /> : null}
      {state.notice && path !== '/debrief' && path !== '/pair' ? (
        <DebriefNotice notice={state.notice} onDismiss={dismissNotice} onOpen={() => { dismissNotice(); router.push('/debrief'); }} />
      ) : null}
      <Director open={director} onClose={() => setDirector(false)} />
    </View>
  );
}

function Director({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { send, mode, alwaysOnDemo, setAlwaysOnDemo } = useBus();
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ marginBottom: 16 }}>
      <T v="caps" style={{ marginBottom: 8 }}>{title}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close the director panel" />
      <View style={{ backgroundColor: C.well, borderTopWidth: 1, borderTopColor: C.paper, padding: 20, paddingBottom: 36, maxHeight: '78%' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <T v="serif" size={28}>Director</T>
          <T v="caps">{mode === 'mock' ? 'mock feed' : 'live backend'}</T>
        </View>
        <ScrollView>
          {mode === 'mock' ? (
            <Group title="Demo feed">
              <Btn small solid={!alwaysOnDemo} label="Tap to start" onPress={() => setAlwaysOnDemo(false)} />
              <Btn small solid={alwaysOnDemo} label="Always-on day" onPress={() => setAlwaysOnDemo(true)} />
            </Group>
          ) : null}
          <Group title="Session">
            <Btn small label="Start regular" onPress={() => send({ cmd: 'start', mode: 'regular' })} />
            <Btn small label="Start practice" onPress={() => send({ cmd: 'start', mode: 'practice' })} />
            <Btn small label="Stop" onPress={() => send({ cmd: 'stop' })} />
            <Btn small label="Jump to debrief" onPress={() => send({ cmd: 'debrief' })} />
          </Group>
          <Group title="Nudge">
            {PATTERN_ORDER.filter((p) => PATTERNS[p].group === 'nudge').map((p) => (
              <Pressable key={p} onPress={() => send({ cmd: 'nudge', pattern: p })} accessibilityRole="button" accessibilityLabel={`Fire ${p}`}
                style={({ pressed }) => ({ height: 40, paddingHorizontal: 12, borderWidth: 1, borderColor: C.paper, borderRadius: 3, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.6 : 1 })}>
                <Glyph pattern={p} size={14} maxWidth={40} /><T v="small" color={C.paper}>{p}</T>
              </Pressable>
            ))}
          </Group>
          <Group title="How am I doing?">
            <Btn small label="1 · good" onPress={() => send({ cmd: 'status', verdict: 'good' })} />
            <Btn small label="2 · talking" onPress={() => send({ cmd: 'status', verdict: 'talking_too_much' })} />
            <Btn small label="3 · ask" onPress={() => send({ cmd: 'status', verdict: 'ask_question' })} />
          </Group>
          <Group title="Marks and hands">
            <Btn small label="Bookmark" onPress={() => send({ cmd: 'bookmark' })} />
            <Btn small label="Nerves" onPress={() => send({ cmd: 'signal', kind: 'nerves' })} />
            <Btn small label="Checked out" onPress={() => send({ cmd: 'signal', kind: 'checked_out' })} />
            <Btn small label="Still" onPress={() => send({ cmd: 'motion', state: 'still' })} />
            <Btn small label="Fidget" onPress={() => send({ cmd: 'motion', state: 'fidget' })} />
          </Group>
        </ScrollView>
        <Btn small label="Close" onPress={onClose} />
      </View>
    </Modal>
  );
}
