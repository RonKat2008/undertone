import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';
import { listPeople, tagPerson } from '../../api/client';
import { Person } from '../../bus/contracts';

const DEFAULT_PEOPLE: Person[] = [
  { person_id: 'p1', name: 'Alex', sessions: 6, pattern: 'You interrupt Alex 3x more than anyone', brief: 'Last time you talked 70%. Ask about his trip.' },
  { person_id: 'p2', name: 'Sam', sessions: 4, pattern: 'High pace when defending cost models', brief: 'Pause for 2 seconds before answering financial questions.' },
  { person_id: 'p3', name: 'Maya', sessions: 3, pattern: 'Balanced talk ratio', brief: 'Keep up the open questions on roadmap items.' },
  { person_id: 'p4', name: 'Jordan', sessions: 2, pattern: 'Higher filler rate in opening minutes', brief: 'Begin with a silent pause instead of saying basically.' },
];

export function TagPersonPicker() {
  const [people, setPeople] = useState<Person[]>(DEFAULT_PEOPLE);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    listPeople()
      .then((res) => {
        if (mounted && res && res.length > 0) {
          setPeople(res);
        }
      })
      .catch(() => {
        // fallback to default people
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectPerson = async (personId: string, name: string) => {
    if (selectedPersonId === personId) {
      // Toggle off
      setSelectedPersonId(null);
      setStatusMessage(null);
      return;
    }

    setSelectedPersonId(personId);
    setStatusMessage(`Tagged with ${name} · Pre-meeting brief linked`);
    try {
      await tagPerson(personId);
    } catch {
      // quiet fallback in mock mode
    }
  };

  const handleAddCustom = async () => {
    const trimmed = customName.trim();
    if (!trimmed) return;

    const newId = `p_custom_${Date.now()}`;
    const newPerson: Person = {
      person_id: newId,
      name: trimmed,
      sessions: 1,
      pattern: 'Initial conversation profile building',
      brief: 'Focus on balanced talk ratio and open inquiry.',
    };

    setPeople((prev) => [...prev, newPerson]);
    setSelectedPersonId(newId);
    setCustomName('');
    setStatusMessage(`Tagged with ${trimmed} · Pre-meeting brief linked`);

    try {
      await tagPerson(newId);
    } catch {
      // quiet fallback
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>TAG WHO THIS WAS WITH</Text>
      <Text style={styles.subtext}>
        Links this session to the partner’s profile and shapes your next pre-meeting brief.
      </Text>

      {/* Quick selection pills */}
      <View style={styles.pillsWrap}>
        {people.map((person) => {
          const isSelected = selectedPersonId === person.person_id;
          return (
            <Pressable
              key={person.person_id}
              onPress={() => handleSelectPerson(person.person_id, person.name)}
              style={({ pressed }) => [
                styles.personPill,
                isSelected && styles.personPillSelected,
                pressed && styles.personPillPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Tag with ${person.name}`}
            >
              <Text
                style={[
                  styles.pillText,
                  isSelected && styles.pillTextSelected,
                ]}
              >
                {person.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Custom name input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          placeholder="Or type a new name..."
          placeholderTextColor={COLORS.other}
          value={customName}
          onChangeText={setCustomName}
          returnKeyType="done"
          onSubmitEditing={handleAddCustom}
        />
        {customName.trim().length > 0 && (
          <Pressable
            style={styles.addButton}
            onPress={handleAddCustom}
            accessibilityRole="button"
            accessibilityLabel="Add person"
          >
            <Text style={styles.addButtonText}>TAG</Text>
          </Pressable>
        )}
      </View>

      {/* Confirmation feedback */}
      {statusMessage && (
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
  },
  sectionHeader: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  subtext: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.other,
    marginBottom: SPACING.md,
    textAlign: 'left',
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  personPill: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
  },
  personPillSelected: {
    backgroundColor: COLORS.paper,
    borderColor: COLORS.paper,
  },
  personPillPressed: {
    opacity: 0.8,
  },
  pillText: {
    fontFamily: FONTS.uiMedium,
    fontSize: 14,
    color: COLORS.paper,
  },
  pillTextSelected: {
    color: COLORS.ink,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  textInput: {
    flex: 1,
    height: 40,
    backgroundColor: COLORS.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.hairline,
    paddingHorizontal: SPACING.md,
    fontFamily: FONTS.ui,
    fontSize: 14,
    color: COLORS.paper,
  },
  addButton: {
    marginLeft: SPACING.sm,
    paddingHorizontal: SPACING.md,
    height: 40,
    backgroundColor: COLORS.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1,
    color: COLORS.ink,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.patterns.success,
    marginRight: SPACING.sm,
  },
  statusText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.patterns.success,
  },
});
