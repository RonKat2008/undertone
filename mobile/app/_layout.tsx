import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_400Regular_Italic } from '@expo-google-fonts/ibm-plex-mono/400Regular_Italic';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { Newsreader_300Light } from '@expo-google-fonts/newsreader/300Light';
import { Newsreader_300Light_Italic } from '@expo-google-fonts/newsreader/300Light_Italic';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { Newsreader_400Regular_Italic } from '@expo-google-fonts/newsreader/400Regular_Italic';
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
import { useKeepAwakeWhile } from '@/ui/Listening';
import { Btn, T } from '@/ui/kit';
import { C, R, S } from '@/ui/theme';

export default function RootLayout() {
  const [loaded] = useFonts({
    Newsreader_300Light, Newsreader_300Light_Italic, Newsreader_400Regular, Newsreader_400Regular_Italic,
    IBMPlexMono_400Regular, IBMPlexMono_400Regular_Italic, IBMPlexMono_500Medium,
    // Ronzino (Collletttivo, SIL OFL 1.1), self-hosted: assets/fonts/Ronzino-OFL.txt
    Ronzino_400: require('../assets/fonts/Ronzino-Regular.otf'),
    Ronzino_500: require('../assets/fonts/Ronzino-Medium.otf'),
    Ronzino_400_Oblique: require('../assets/fonts/Ronzino-Oblique.otf'),
  });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
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
  // always-on: the screen may sleep between conversations, but not during one
  useKeepAwakeWhile(state.alwaysOn && live, 'undertone-conversation');

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

  if (mode === 'loading') return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }} onTouchStart={(e) => { if (e.nativeEvent.touches.length === 3) setDirector(true); }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'fade' }} />
      {state.notice && path !== '/debrief' && path !== '/pair' ? (
        <DebriefNotice notice={state.notice} onDismiss={dismissNotice} onOpen={() => { dismissNotice(); router.push('/debrief'); }} />
      ) : null}
      <Director open={director} onClose={() => setDirector(false)} />
    </View>
  );
}

/** Rehearsal panel: one of the two things allowed to sit above the page (§4.5). */
function Director({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { send, mode, alwaysOnDemo, setAlwaysOnDemo } = useBus();
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ marginBottom: S[5] }}>
      <T v="label" style={{ marginBottom: S[2] }}>{title}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S[2] }}>{children}</View>
    </View>
  );
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close the director panel" />
      <View style={{
        backgroundColor: C.well, borderTopWidth: 1, borderTopColor: C.ruleStrong, padding: 20, paddingBottom: 36, maxHeight: '78%',
        shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 16, shadowOffset: { width: 0, height: -4 },
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: S[4] }}>
          <T v="displayM">Director</T>
          <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: C.ruleStrong, paddingHorizontal: 6, paddingBottom: 2 }}>
            <T v="label" size={13}>{mode === 'mock' ? 'mock feed' : 'live backend'}</T>
          </View>
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
                style={({ pressed }) => ({ height: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: C.ruleStrong, borderRadius: R.key, backgroundColor: pressed ? C.rule : C.bg, flexDirection: 'row', alignItems: 'center', gap: 8 })}>
                <Glyph pattern={p} size={18} maxWidth={44} /><T v="numS" color={C.fg}>{p}</T>
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
