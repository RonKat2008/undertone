import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { claimCode, parseQr } from '@/bus/socket-source';
import { useBus } from '@/bus/use-bus';
import { Button, Orb, Screen, T, TextButton } from '@/ui/kit';
import { C, F, GUTTER, R, S, SIZE } from '@/ui/theme';

const CODE_LENGTH = 6;
const ORB_SIZE = 140;
const PAIR_FAILED = 'Couldn’t pair. Check the code and that both are on the same Wi-Fi.';
const NOT_A_CODE = 'That isn’t an Undertone code. Try again or type it in.';
const CAMERA_OFF = 'Camera is off. Type the code in instead.';

/** In Expo Go the dev server runs on the laptop, so its address is a good first guess. */
function guessServer(): string {
  const host = (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  return host && host !== 'localhost' && host !== '127.0.0.1' ? `http://${host}:8000` : '';
}

const cleanCode = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);

export default function PairScreen() {
  const { pair } = useBus();
  const router = useRouter();
  const native = Platform.OS !== 'web';
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState(!native);
  const [server, setServer] = useState(guessServer);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanned = useRef(false);
  const camera = native && !manual && !!permission?.granted;

  async function askCamera() {
    setError(null);
    const granted = permission?.granted || (await requestPermission()).granted;
    if (!granted) { setError(CAMERA_OFF); setManual(true); }
  }

  function onScanned(text: string) {
    if (scanned.current) return;
    const p = parseQr(text);
    if (!p) { setError(NOT_A_CODE); return; }
    scanned.current = true;
    setError(null);
    pair(p).catch(() => { scanned.current = false; setError(PAIR_FAILED); });
  }

  async function submit() {
    if (busy || code.length !== CODE_LENGTH || !server.trim()) return;
    setBusy(true); setError(null);
    try { await pair(await claimCode(server, code)); } catch { setError(PAIR_FAILED); } finally { setBusy(false); }
  }

  const footer = (
    <View style={styles.footer}>
      <TextButton label="Not now" color={C.muted} onPress={() => router.replace('/')} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen footer={footer} glow={C.accent}>
        <View style={styles.orb}><Orb color={C.accent} energy={1} size={ORB_SIZE} /></View>
        <T v="title" accessibilityRole="header" style={styles.title}>Pair with your laptop</T>
        <T v="body" color={C.muted} style={styles.line}>Scan the code on your laptop, or type it in.</T>

        {camera ? (
          <View style={styles.camera}>
            <CameraView style={styles.fill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={(r) => onScanned(r.data)} />
          </View>
        ) : null}

        {native && !manual && !permission?.granted ? (
          <Button kind="primary" label="Scan code" wide onPress={() => void askCamera()} style={styles.block} />
        ) : null}

        {manual ? (
          <View style={styles.form}>
            <TextInput value={server} onChangeText={setServer} placeholder="Laptop address" placeholderTextColor={C.faint}
              autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="next"
              style={styles.input} accessibilityLabel="Laptop address" />
            <TextInput value={code} onChangeText={(t) => setCode(cleanCode(t))} placeholder="Code" placeholderTextColor={C.faint}
              autoCapitalize="characters" autoCorrect={false} maxLength={CODE_LENGTH} returnKeyType="go"
              style={[styles.input, styles.code]} accessibilityLabel="Pairing code" onSubmitEditing={() => void submit()} />
            <Button kind="primary" label="Pair" wide loading={busy} onPress={() => void submit()}
              disabled={code.length !== CODE_LENGTH || !server.trim()} style={styles.pair} />
          </View>
        ) : null}

        {error ? <T v="body" color={C.warn} style={styles.error} accessibilityLiveRegion="polite">{error}</T> : null}

        {native ? (
          <TextButton label={manual ? 'Scan instead' : 'Enter it instead'} style={styles.switch}
            onPress={() => { setError(null); setManual((m) => !m); }} />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  orb: { alignItems: 'center', marginTop: S[7] },
  title: { marginTop: S[6] },
  line: { marginTop: S[2] },
  camera: { marginTop: S[7], width: '100%', aspectRatio: 1, borderRadius: R.control, overflow: 'hidden', backgroundColor: C.surface },
  block: { marginTop: S[7] },
  form: { marginTop: S[7], gap: S[3] },
  input: {
    height: 52, borderRadius: R.control, backgroundColor: C.surface, color: C.text,
    paddingHorizontal: S[4], fontFamily: F.sans, fontSize: SIZE.body,
  },
  code: { fontVariant: ['tabular-nums'], letterSpacing: 2 },
  pair: { marginTop: S[2] },
  error: { marginTop: S[4] },
  switch: { marginTop: S[4] },
  footer: { paddingHorizontal: GUTTER, paddingBottom: S[4] },
});
