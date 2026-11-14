import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, SPACING } from '../src/theme/tokens';
import { useBus } from '../src/bus/use-bus';
import { createPairing } from '../src/api/client';
import { ViewfinderFrame } from '../src/components/pair/ViewfinderFrame';
import { PairingCodeInput } from '../src/components/pair/PairingCodeInput';

export default function PairScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { injectEvent, state } = useBus();

  const [mode, setMode] = useState<'viewfinder' | 'code'>('viewfinder');
  const [isDemoPairing, setIsDemoPairing] = useState(false);
  const [pairSuccess, setPairSuccess] = useState(false);

  const handlePairSuccess = async (pairedCode?: string) => {
    setPairSuccess(true);

    // Inject band and device status events into the bus
    injectEvent({
      type: 'band.status',
      connected: true,
      transport: 'ble',
      battery_pct: 98,
      mic_on: false,
    });

    injectEvent({
      type: 'device.status',
      device_id: pairedCode || 'UT-4829',
      name: 'Undertone Band (UT-01)',
      connected: true,
    });

    // Brief delay to let the success confirmation render cleanly, then navigate to Today
    setTimeout(() => {
      router.replace('/');
    }, 450);
  };

  const handleDemoPair = async () => {
    try {
      setIsDemoPairing(true);
      await createPairing();
      await handlePairSuccess('UT-DEMO');
    } catch {
      // In mock environment createPairing succeeds
      await handlePairSuccess('UT-DEMO');
    } finally {
      setIsDemoPairing(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Editorial Masthead */}
        <View style={styles.masthead}>
          <View style={styles.topRow}>
            <Text style={styles.systemTag}>HARDWARE LINK // BLE 5.3</Text>
            <View style={styles.statusIndicator}>
              <View
                style={[
                  styles.statusDot,
                  state.bandConnected && styles.statusDotConnected,
                ]}
              />
              <Text style={styles.statusText}>
                {state.bandConnected ? 'PAIRED' : 'DISCONNECTED'}
              </Text>
            </View>
          </View>

          <Text style={styles.headline}>Pair Wristband</Text>
          <Text style={styles.description}>
            Connect the tactile sensor to measure voice cadence, hand gestures, and deliver discrete haptic nudges.
          </Text>
        </View>

        {/* Divider hairline */}
        <View style={styles.hairlineRule} />

        {/* Pairing Interaction Area */}
        <View style={styles.interactionArea}>
          {pairSuccess ? (
            <View style={styles.successCard}>
              <View style={styles.successDot} />
              <Text style={styles.successTitle}>WRISTBAND CONNECTED</Text>
              <Text style={styles.successBody}>
                Calibrated to UT-01 sensor. Directing to Today dashboard...
              </Text>
            </View>
          ) : mode === 'viewfinder' ? (
            <View style={styles.viewfinderContainer}>
              <ViewfinderFrame
                statusText="OPTICAL SEEK // READY"
                subtext="Hold the inside clasp of the wristband up to your phone display."
              />

              <Pressable
                style={({ pressed }) => [
                  styles.toggleModeButton,
                  pressed && styles.toggleModeButtonPressed,
                ]}
                onPress={() => setMode('code')}
                accessibilityRole="button"
                accessibilityLabel="Enter pairing code manually"
              >
                <Text style={styles.toggleModeButtonText}>Enter code instead</Text>
              </Pressable>
            </View>
          ) : (
            <PairingCodeInput
              onSuccess={(code) => handlePairSuccess(code)}
              onCancel={() => setMode('viewfinder')}
            />
          )}
        </View>

        {/* Bottom Seam: Large Demo Pairing Action */}
        <View style={styles.bottomSection}>
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>OR USE DEMO HARDWARE</Text>
            <View style={styles.orLine} />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.demoButton,
              pressed && styles.demoButtonPressed,
              isDemoPairing && styles.demoButtonDisabled,
            ]}
            onPress={handleDemoPair}
            disabled={isDemoPairing || pairSuccess}
            accessibilityRole="button"
            accessibilityLabel="Use demo pairing"
          >
            {isDemoPairing ? (
              <View style={styles.buttonRow}>
                <ActivityIndicator size="small" color={COLORS.ink} style={{ marginRight: 10 }} />
                <Text style={styles.demoButtonText}>PAIRING DEMO BAND...</Text>
              </View>
            ) : (
              <View style={styles.buttonRow}>
                <Text style={styles.demoButtonText}>USE DEMO PAIRING</Text>
                <Text style={styles.demoButtonSub}>Instant Link (UT-DEMO)</Text>
              </View>
            )}
          </Pressable>

          <Text style={styles.footerNote}>
            Target: iPhone 390×844 • Sensor transport: Simulated BLE stream
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  masthead: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  systemTag: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.other,
  },
  statusDotConnected: {
    backgroundColor: COLORS.patterns.success,
  },
  statusText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: COLORS.inkMid,
  },
  headline: {
    fontFamily: FONTS.display,
    fontSize: 38,
    lineHeight: 42,
    color: COLORS.paper,
    marginBottom: SPACING.xs,
  },
  description: {
    fontFamily: FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.inkMid,
  },
  hairlineRule: {
    height: 1,
    backgroundColor: COLORS.hairline,
    width: '100%',
    marginVertical: SPACING.sm,
  },
  interactionArea: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  viewfinderContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleModeButton: {
    marginTop: SPACING.lg,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  toggleModeButtonPressed: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.inkMid,
  },
  toggleModeButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    letterSpacing: 1.2,
    color: COLORS.paper,
    textTransform: 'uppercase',
  },
  successCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.patterns.success,
    padding: SPACING.lg,
    alignItems: 'center',
  },
  successDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.patterns.success,
    marginBottom: SPACING.sm,
  },
  successTitle: {
    fontFamily: FONTS.monoMedium,
    fontSize: 14,
    letterSpacing: 1.5,
    color: COLORS.patterns.success,
    marginBottom: SPACING.xs,
  },
  successBody: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: COLORS.inkMid,
    textAlign: 'center',
  },
  bottomSection: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.md,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.hairline,
  },
  orText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.other,
  },
  demoButton: {
    backgroundColor: COLORS.paper,
    minHeight: 56, // Large touch target
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  demoButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  demoButtonDisabled: {
    opacity: 0.4,
  },
  buttonRow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoButtonText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 14,
    letterSpacing: 1.5,
    color: COLORS.ink,
  },
  demoButtonSub: {
    fontFamily: FONTS.ui,
    fontSize: 11,
    color: COLORS.surface,
    marginTop: 2,
  },
  footerNote: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.other,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
