import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { Newsreader_400Regular_Italic } from '@expo-google-fonts/newsreader/400Regular_Italic';
import { useFonts } from 'expo-font';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { isLive } from '@/bus/reducer';
import { BusProvider, useBus } from '@/bus/use-bus';
import { useKeepAwakeWhile } from '@/ui/Listening';
import { C } from '@/ui/theme';

// Keep the splash up until the four faces and the stored pairing are ready: no blank flash.
SplashScreen.preventAutoHideAsync().catch(() => { /* already hidden (web, fast refresh) */ });

export default function RootLayout() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Newsreader_400Regular, Newsreader_400Regular_Italic });
  // A font that fails to load falls back to the system face rather than holding the splash forever.
  if (!loaded && !error) return null;
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

  useEffect(() => {
    if (mode !== 'loading') SplashScreen.hideAsync().catch(() => { /* already hidden */ });
  }, [mode]);

  // Unpaired at launch, or just unpaired: offer the Pair screen once. "Not now" leaves it;
  // Now then shows the pairing entry itself.
  useEffect(() => {
    const was = prevMode.current;
    prevMode.current = mode;
    if (mode === 'unpaired' && was !== 'unpaired' && path !== '/pair') router.replace('/pair');
    if (mode === 'live' && was !== 'live' && path === '/pair') router.replace('/');
  }, [mode, path, router]);

  // Always-on: a conversation that opens by itself brings Now forward, once per conversation.
  useEffect(() => {
    if (!state.alwaysOn || !live || !sessionId || shownFor.current === sessionId) return;
    shownFor.current = sessionId;
    if (path !== '/' && path !== '/pair') router.navigate('/');
  }, [state.alwaysOn, live, sessionId, path, router]);

  // Opening the debrief is what "Debrief ready" asks for: once there, it is read.
  useEffect(() => {
    if (path === '/debrief' && state.notice) dismissNotice();
  }, [path, state.notice, dismissNotice]);

  if (mode === 'loading') return <View style={styles.page} />;
  return (
    <View style={styles.page}>
      <Stack screenOptions={{ headerShown: false, contentStyle: styles.page }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="pair" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
});
