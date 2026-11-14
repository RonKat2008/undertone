import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { claimCode, parseQr } from '@/bus/socket-source';
import { useBus } from '@/bus/use-bus';
import { Btn, Screen, T } from '@/ui/kit';
import { C, F } from '@/ui/theme';

/** In Expo Go the dev server runs on the laptop, so its address is a good first guess. */
function guessServer(): string {
  const host = (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  return host && host !== 'localhost' && host !== '127.0.0.1' ? `http://${host}:8000` : '';
}

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const s = 28;
  return <View pointerEvents="none" style={{
    position: 'absolute', width: s, height: s, borderColor: C.paper,
    top: pos[0] === 't' ? 0 : undefined, bottom: pos[0] === 'b' ? 0 : undefined,
    left: pos[1] === 'l' ? 0 : undefined, right: pos[1] === 'r' ? 0 : undefined,
    borderTopWidth: pos[0] === 't' ? 2 : 0, borderBottomWidth: pos[0] === 'b' ? 2 : 0,
    borderLeftWidth: pos[1] === 'l' ? 2 : 0, borderRightWidth: pos[1] === 'r' ? 2 : 0,
  }} />;
}

export default function PairScreen() {
  const { pair } = useBus();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [server, setServer] = useState(guessServer);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = Platform.OS !== 'web';

  async function startScan() {
    setError(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (granted) setScanning(true);
    else setError('Camera access is off. Enter the code instead.');
  }

  function onScanned(text: string) {
    const p = parseQr(text);
    if (!p) { setError('That is not an Undertone pairing code.'); return; }
    setScanning(false);
    void pair(p);
  }

  async function submit() {
    setBusy(true); setError(null);
    try { await pair(await claimCode(server, code)); } catch (e) { setError(e instanceof Error ? e.message : 'Pairing failed.'); } finally { setBusy(false); }
  }

  const input = { fontFamily: F.mono, color: C.paper, fontSize: 18, borderBottomWidth: 1, borderBottomColor: C.paper2, paddingVertical: 10 } as const;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <T v="caps" style={{ marginTop: 12 }}>Undertone</T>
        <T v="serif" size={46} style={{ marginTop: 4 }}>Pair with the laptop.</T>
        <T v="small" style={{ marginTop: 8 }}>Open “Pair” on the dashboard and point this phone at the code. Both must be on the same Wi-Fi.</T>

        <View style={{ marginTop: 22, aspectRatio: 1, width: '100%', maxWidth: 330, alignSelf: 'center', backgroundColor: C.well, overflow: 'hidden' }}>
          {scanning && native ? (
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => onScanned(r.data)} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <T v="serif" size={26} color={C.paper2} style={{ textAlign: 'center' }}>{native ? 'The code goes here' : 'Scanning needs the phone'}</T>
              <T v="small" style={{ textAlign: 'center', marginTop: 6 }}>{native ? 'The camera is used only to read the pairing code.' : 'In a browser, enter the code instead.'}</T>
            </View>
          )}
          <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
        </View>

        {error ? <T v="small" color="#F0603F" style={{ marginTop: 12 }} accessibilityLiveRegion="polite">{error}</T> : null}

        <View style={{ marginTop: 18, gap: 10 }}>
          {native ? <Btn label={scanning ? 'Stop scanning' : 'Scan the code'} solid={!scanning} onPress={() => (scanning ? setScanning(false) : void startScan())} /> : null}
          {manual ? (
            <View style={{ gap: 6, marginTop: 4 }}>
              <T v="caps">Laptop address</T>
              <TextInput value={server} onChangeText={setServer} placeholder="192.168.1.20:8000" placeholderTextColor={C.paper3} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} accessibilityLabel="Laptop address" />
              <T v="caps" style={{ marginTop: 10 }}>Code from the dashboard</T>
              <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="K7M2QX" placeholderTextColor={C.paper3} autoCapitalize="characters" autoCorrect={false} maxLength={6}
                style={[input, { fontSize: 34, letterSpacing: 6 }]} accessibilityLabel="Six character pairing code" onSubmitEditing={submit} />
              <Btn label={busy ? 'Pairing…' : 'Pair'} solid onPress={submit} disabled={busy || code.length !== 6 || !server.trim()} style={{ marginTop: 10 }} />
            </View>
          ) : (
            <Btn label="Enter code instead" onPress={() => { setManual(true); setScanning(false); }} />
          )}
          <Btn label="Not now" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} color={C.paper2} />
          <T v="small" style={{ textAlign: 'center' }}>Nothing shows until this phone is paired. You can pair from any tab.</T>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
