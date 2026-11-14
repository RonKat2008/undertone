import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView } from 'react-native';
import { useBus } from '../bus/use-bus';
import { COLORS, FONTS } from '../theme/tokens';
import { HapticPattern, MotionState } from '../../../contracts/events';

interface DirectorPanelProps {
  visible: boolean;
  onClose: () => void;
}

const NUDGES: HapticPattern[] = ['interrupt', 'wrap_up', 'filler', 'still', 'slow_down', 'success', 'tap', 'approve'];

export const DirectorPanel: React.FC<DirectorPanelProps> = ({ visible, onClose }) => {
  const bus = useBus();

  const emit = (event: any) => {
    if (bus && typeof bus.injectEvent === 'function') {
      bus.injectEvent(event);
    }
  };

  const fireNudge = (pattern: HapticPattern) => {
    emit({
      type: 'nudge',
      rule_id: `test_${pattern}`,
      haptic: pattern,
      message: `Test nudge: ${pattern}`,
      reason: 'Director panel triggered',
      confidence: 1.0,
      latency_ms: 150,
      budget_left: 5,
      ts: bus.state.elapsedS || 0,
    });
  };

  const fireStatusReply = (verdict: 'good' | 'talking_too_much' | 'ask_question') => {
    let haptic: HapticPattern = 'status_good';
    if (verdict === 'talking_too_much') haptic = 'status_talking';
    if (verdict === 'ask_question') haptic = 'status_ask';
    
    emit({
      type: 'status.reply',
      verdict,
      haptic,
      ts: bus.state.elapsedS || 0,
    });
  };

  const fireSignal = (kind: 'nerves' | 'checked_out') => {
    emit({
      type: 'signal',
      kind,
      detail: `Director triggered ${kind}`,
      ts: bus.state.elapsedS || 0,
    });
  };

  const changeMotion = (state: MotionState) => {
    bus.setMotionState(state);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Director</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Section title="Session">
              <Row>
                <Button label="Start Session" onPress={() => bus.startSession()} />
                <Button label="Stop Session" onPress={() => bus.stopSession()} />
              </Row>
            </Section>

            <Section title="Nudges">
              <Row wrap>
                {NUDGES.map(nudge => (
                  <Button key={nudge} label={nudge} onPress={() => fireNudge(nudge)} />
                ))}
              </Row>
            </Section>

            <Section title="Status Reply">
              <Row wrap>
                <Button label="Good" onPress={() => fireStatusReply('good')} />
                <Button label="Talking Too Much" onPress={() => fireStatusReply('talking_too_much')} />
                <Button label="Ask Question" onPress={() => fireStatusReply('ask_question')} />
              </Row>
            </Section>

            <Section title="Signals & Events">
              <Row wrap>
                <Button label="Add Bookmark" onPress={() => bus.addBookmark()} />
                <Button label="Signal: Nerves" onPress={() => fireSignal('nerves')} />
                <Button label="Signal: Checked Out" onPress={() => fireSignal('checked_out')} />
              </Row>
            </Section>

            <Section title="Motion State">
              <Row wrap>
                <Button label="Still" onPress={() => changeMotion('still')} />
                <Button label="Gesture" onPress={() => changeMotion('gesture')} />
                <Button label="Fidget" onPress={() => changeMotion('fidget')} />
              </Row>
            </Section>

            <Section title="Mock Controls">
              <Row wrap>
                <Button label="Jump to Debrief" onPress={() => bus.jumpToDebrief()} />
                <Button label="Reset Mock" onPress={() => bus.resetMock()} />
              </Row>
            </Section>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Row: React.FC<{ children: React.ReactNode; wrap?: boolean }> = ({ children, wrap }) => (
  <View style={[styles.row, wrap && styles.rowWrap]}>{children}</View>
);

const Button: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <TouchableOpacity style={styles.button} onPress={onPress}>
    <Text style={styles.buttonText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.ink,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  title: {
    color: COLORS.paper,
    fontFamily: FONTS.ui,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
  },
  closeText: {
    color: COLORS.inkMid,
    fontFamily: FONTS.ui,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: COLORS.inkMid,
    fontFamily: FONTS.mono,
    fontSize: 12,
    textTransform: 'uppercase',
    marginBottom: 12,
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowWrap: {
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    backgroundColor: '#F3F4F6', // Using raw color since there is no paperWell in tokens, or maybe use surface? I'll use paper
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  buttonText: {
    color: COLORS.ink,
    fontFamily: FONTS.ui,
    fontSize: 14,
  },
});
