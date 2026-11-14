import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';
import { createPairing } from '../../api/client';

interface PairingCodeInputProps {
  onSuccess: (code: string) => void;
  onCancel?: () => void;
}

export function PairingCodeInput({ onSuccess, onCancel }: PairingCodeInputProps) {
  const [code, setCode] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Normalize code to uppercase and strip invalid characters
  const handleCodeChange = (text: string) => {
    setErrorMessage(null);
    let cleaned = text.toUpperCase().replace(/[^A-Z0-9-]/g, '');

    // If user is typing digits without "UT-", allow typing up to 7 chars (e.g. UT-4829)
    if (!cleaned.startsWith('UT-') && cleaned.replace(/-/g, '').length <= 4 && /^\d+$/.test(cleaned)) {
      cleaned = `UT-${cleaned}`;
    }

    if (cleaned.length > 7) {
      cleaned = cleaned.slice(0, 7);
    }

    setCode(cleaned);
  };

  const handleConnect = async () => {
    const trimmed = code.trim();
    if (trimmed.length < 5) {
      setErrorMessage('Please enter a valid code (e.g. UT-4829)');
      return;
    }

    try {
      setIsConnecting(true);
      setErrorMessage(null);
      await createPairing();
      onSuccess(trimmed);
    } catch {
      setErrorMessage('Unable to pair. Check code and band proximity.');
    } finally {
      setIsConnecting(false);
    }
  };

  const isComplete = code.length >= 6;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Enter Pairing Code</Text>
        <Text style={styles.subtitle}>
          Type the 6-character identifier stamped on your band clasp or shown on your desktop screen.
        </Text>
      </View>

      <View style={styles.inputContainer}>
        <View
          style={[
            styles.inputBox,
            isFocused && styles.inputBoxFocused,
            errorMessage ? styles.inputBoxError : null,
          ]}
        >
          <TextInput
            style={styles.textInput}
            value={code}
            onChangeText={handleCodeChange}
            placeholder="UT-4829"
            placeholderTextColor={COLORS.hairline}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={7}
            keyboardType="default"
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            selectionColor={COLORS.paper}
            accessibilityLabel="Pairing code input"
          />
        </View>

        {errorMessage ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : (
          <Text style={styles.helperText}>Format: UT-#### or 6-character alphanumeric</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.connectButton,
            !isComplete && styles.connectButtonDisabled,
            pressed && styles.connectButtonPressed,
          ]}
          onPress={handleConnect}
          disabled={!isComplete || isConnecting}
          accessibilityRole="button"
          accessibilityLabel="Connect band with code"
        >
          {isConnecting ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={COLORS.ink} style={{ marginRight: 8 }} />
              <Text style={styles.connectButtonText}>CONNECTING...</Text>
            </View>
          ) : (
            <Text style={styles.connectButtonText}>CONNECT</Text>
          )}
        </Pressable>

        {onCancel && (
          <Pressable
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
            ]}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Return to optical scan"
          >
            <Text style={styles.cancelButtonText}>Back to optical scan</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: SPACING.md,
  },
  header: {
    marginBottom: SPACING.lg,
  },
  title: {
    fontFamily: FONTS.uiMedium,
    fontSize: 18,
    color: COLORS.paper,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.inkMid,
  },
  inputContainer: {
    marginBottom: SPACING.lg,
  },
  inputBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBoxFocused: {
    borderColor: COLORS.paper,
  },
  inputBoxError: {
    borderColor: COLORS.patterns.interrupt,
  },
  textInput: {
    fontFamily: FONTS.mono,
    fontSize: 28,
    letterSpacing: 4,
    color: COLORS.paper,
    textAlign: 'center',
    width: '100%',
  },
  helperText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: FONTS.ui,
    fontSize: 12,
    color: COLORS.patterns.interrupt,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  actions: {
    gap: SPACING.sm,
  },
  connectButton: {
    backgroundColor: COLORS.paper,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  connectButtonDisabled: {
    opacity: 0.35,
  },
  connectButtonPressed: {
    opacity: 0.85,
  },
  connectButtonText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 14,
    letterSpacing: 1.5,
    color: COLORS.ink,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  cancelButtonPressed: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.inkMid,
  },
  cancelButtonText: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: COLORS.inkMid,
  },
});
