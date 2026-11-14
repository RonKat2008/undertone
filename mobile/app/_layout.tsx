import { Geist_400Regular, Geist_500Medium } from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { isLive } from '@/bus/reducer';
import { BusProvider, useBus } from '@/bus/use-bus';
import { DebriefNotice } from '@/ui/DebriefNotice';
import { useKeepAwakeWhile } from '@/ui/Listening';
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
  const live = isLive(state);
  const sessionId = state.session?.id ?? null;
  const shownFor = useRef<string | null>(null);
  const prevMode = useRef<typeof mode>('loading');
  // always-on: the screen may sleep between conversations, but not during one
  useKeepAwakeWhile(state.alwaysOn && live, 'undertone-conversation');

  // Unpaired at launch, or just unpaired: offer the Pair screen once. The wearer may leave it
  // ("Not now"); every tab then says it is not paired and leads back here.
  useEffect(() => {
    const was = prevMode.current;
    prevMode.current = mode;
    if (mode === 'unpaired' && was !== 'unpaired' && path !== '/pair') router.replace('/pair');
    if (mode === 'live' && was !== 'live' && path === '/pair') router.replace('/');
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

  if (mode === 'loading') return <View style={{ flex: 1, backgroundColor: C.ink }} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ink }, animation: 'fade' }} />
      {state.notice && path !== '/debrief' && path !== '/pair' ? (
        <DebriefNotice notice={state.notice} onDismiss={dismissNotice} onOpen={() => { dismissNotice(); router.push('/debrief'); }} />
      ) : null}
    </View>
  );
}
