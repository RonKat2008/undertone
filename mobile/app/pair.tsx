import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { claimCode, parseQr } from '@/bus/socket-source';
import { useBus } from '@/bus/use-bus';
import { Btn, Label, Link, Screen, StateMark, T } from '@/ui/kit';
import { C, F, R, S } from '@/ui/theme';

/** In Expo Go the dev server runs on the laptop, so its address is a good first guess. */
function guessServer(): string {
  const host = (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  return host && host !== 'localhost' && host !== '127.0.0.1' ? `http://${host}:8000` : '';
}

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const s = 28;
  return <View pointerEvents="none" style={{
    position: 'absolute', width: s, height: s, borderColor: C.fg,
    top: pos[0] === 't' ? 0 : undefined, bottom: pos[0] === 'b' ? 0 : undefined,
    left: pos[1] === 'l' ? 0 : undefined, right: pos[1] === 'r' ? 0 : undefined,
    borderTopWidth: pos[0] === 't' ? 2 : 0, borderBottomWidth: pos[0] === 'b' ? 2 : 0,
    borderLeftWidth: pos[1] === 'l' ? 2 : 0, borderRightWidth: pos[1] === 'r' ? 2 : 0,
  }} />;
}

export default function PairScreen() {
  const { pair } = useBus();
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

  // Inputs: Plex Mono on the well, a 1 px rule-strong border (interactive), the key radius.
  const input = { fontFamily: F.mono, color: C.fg, fontSize: 18, backgroundColor: C.well, borderWidth: 1, borderColor: C.ruleStrong, borderRadius: R.key, paddingVertical: 12, paddingHorizontal: 14 } as const;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <T v="displayS" style={{ marginTop: S[5] }}>Undertone</T>
        <T v="displayL" style={{ marginTop: S[6] }}>Pair with the laptop.</T>
        <T v="body" color={C.fg2} style={{ marginTop: S[3] }}>Open “Pair” on the dashboard and point this phone at the code. Both must be on the same Wi-Fi.</T>

        <View style={{ marginTop: S[5], aspectRatio: 1.25, width: '100%', backgroundColor: C.well, overflow: 'hidden' }}>
          {scanning && native ? (
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => onScanned(r.data)} />
          ) : (
            <View style={{ flex: 1, justifyContent: 'flex-end', padding: S[5] }}>
              <T v="displayS" color={C.fg2}>{native ? 'The code goes here' : 'Scanning needs the phone'}</T>
              <T v="small" style={{ marginTop: S[1] }}>{native ? 'The camera is used only to read the pairing code.' : 'In a browser, enter the code or use the demo.'}</T>
            </View>
          )}
          <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
        </View>

        {error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[3] }} accessibilityLiveRegion="polite">
            <StateMark kind="fault" /><T v="body" style={{ fontFamily: F.sansMedium, flex: 1 }}>{error}</T>
          </View>
        ) : null}

        <View style={{ marginTop: S[5], gap: S[3] }}>
          {native ? <Btn label={scanning ? 'Stop scanning' : 'Scan the code'} solid={!scanning} onPress={() => (scanning ? setScanning(false) : void startScan())} /> : null}
          {manual ? (
            <View style={{ gap: S[2], marginTop: S[1] }}>
              <Label>Laptop address</Label>
              <TextInput value={server} onChangeText={setServer} placeholder="192.168.1.20:8000" placeholderTextColor={C.fg3} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} accessibilityLabel="Laptop address" />
              <Label style={{ marginTop: S[3] }}>Dashboard code</Label>
              <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="K7M2QX" placeholderTextColor={C.fg3} autoCapitalize="characters" autoCorrect={false} maxLength={6}
                style={[input, { fontSize: 34, letterSpacing: 6 }]} accessibilityLabel="Six character pairing code" onSubmitEditing={submit} />
              <Btn label={busy ? 'Pairing…' : 'Pair'} solid onPress={submit} disabled={busy || code.length !== 6 || !server.trim()} style={{ marginTop: S[2] }} />
            </View>
          ) : (
            <Btn label="Enter code instead" solid={!native} onPress={() => { setManual(true); setScanning(false); }} />
          )}
        </View>
        <Link label="Use demo pairing" onPress={() => void pair('demo')} style={{ marginTop: S[4] }} />
        <T v="small">The demo plays a scripted conversation. Nothing leaves the phone.</T>
      </KeyboardAvoidingView>
    </Screen>
  );
}
