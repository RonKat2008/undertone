import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listPeople } from '../src/api/client';
import { Person } from '../src/bus/contracts';
import { COLORS, FONTS, SPACING } from '../src/theme/tokens';
import { PersonRow, SampleBadge, QuickLinks, SAMPLE_PEOPLE } from '../src/components/people';

/**
 * Controls whether the designed "sample" badge is displayed.
 */
export const SHOW_SAMPLE_BADGE = true;

export default function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<Person[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadPeople = async () => {
    try {
      const data = await listPeople();
      if (data && data.length > 0) {
        setPeople(data);
      } else {
        // Fallback to sample people if client returns empty list
        setPeople(SAMPLE_PEOPLE);
      }
    } catch (_err) {
      setPeople(SAMPLE_PEOPLE);
    }
  };

  useEffect(() => {
    loadPeople();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPeople();
    setRefreshing(false);
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 24) }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 24) + SPACING.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.paper}
          />
        }>
        {/* Header section */}
        <View style={styles.header}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>CONVERSATION PARTNERS</Text>
            {SHOW_SAMPLE_BADGE && <SampleBadge visible={SHOW_SAMPLE_BADGE} />}
          </View>

          <Text style={styles.title}>People</Text>
          <Text style={styles.subtitle}>
            Recurring patterns and pre-meeting briefs across your regular conversation partners.
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {people.length} {people.length === 1 ? 'PROFILE' : 'PROFILES'} · SORTED BY FREQUENCY
            </Text>
          </View>
        </View>

        {/* List of people separated by hairline rules */}
        <View style={styles.list}>
          {people.map((person, index) => (
            <PersonRow
              key={person.person_id}
              person={person}
              isFirst={index === 0}
            />
          ))}
        </View>

        {/* Quick links to settings screens */}
        <QuickLinks />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
  },
  header: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  eyebrowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  eyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: COLORS.other,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 44,
    lineHeight: 48,
    color: COLORS.paper,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontFamily: FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.inkMid,
    marginBottom: SPACING.md,
  },
  metaRow: {
    paddingTop: SPACING.xs,
  },
  metaText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.other,
    textTransform: 'uppercase',
  },
  list: {
    marginTop: SPACING.xs,
  },
});
