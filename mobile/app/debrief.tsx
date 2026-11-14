import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { useBus } from '../src/bus/use-bus';
import { getDebrief } from '../src/api/client';
import { Debrief } from '../src/bus/contracts';
import { COLORS, FONTS, SPACING } from '../src/theme/tokens';

import { HeadlineSection } from '../src/components/debrief/HeadlineSection';
import { StrengthSection } from '../src/components/debrief/StrengthSection';
import { FixSection } from '../src/components/debrief/FixSection';
import { NumbersSection } from '../src/components/debrief/NumbersSection';
import { RecapPlayer } from '../src/components/debrief/RecapPlayer';
import { TimelineTraces } from '../src/components/debrief/TimelineTraces';
import { BookmarkReview } from '../src/components/debrief/BookmarkReview';
import { NotesAndQuote } from '../src/components/debrief/NotesAndQuote';
import { TagPersonPicker } from '../src/components/debrief/TagPersonPicker';
import { FALLBACK_DEBRIEF } from '../src/components/debrief/mock-debrief';

export default function DebriefScreen() {
  const router = useRouter();
  const { state } = useBus();
  const [debriefData, setDebriefData] = useState<Debrief | null>(state.debrief);

  useEffect(() => {
    if (state.debrief) {
      setDebriefData(state.debrief);
      return;
    }

    let isMounted = true;
    const fetchDebrief = async () => {
      try {
        const fetched = await getDebrief(state.sessionId || 's1');
        if (isMounted) {
          setDebriefData(fetched || FALLBACK_DEBRIEF);
        }
      } catch {
        if (isMounted) {
          setDebriefData(FALLBACK_DEBRIEF);
        }
      }
    };

    fetchDebrief();
    return () => {
      isMounted = false;
    };
  }, [state.debrief, state.sessionId]);

  const data = debriefData || FALLBACK_DEBRIEF;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Editorial top masthead */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path
              d="M19 12H5M12 19l-7-7 7-7"
              stroke={COLORS.paper}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={styles.backText}>CLOSE</Text>
        </Pressable>

        <Text style={styles.mastheadTitle}>UNDERTONE</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Headline fact in large Instrument Serif */}
        <HeadlineSection headlineFact={data.headline_fact} />

        {/* 2. One specific strength, stated plainly */}
        <StrengthSection strength={data.strength} />

        {/* 3. One thing to fix (strongest emphasis) + if_then plan set like a line to memorise */}
        <FixSection oneFix={data.one_fix} ifThen={data.if_then} />

        {/* 4. The five numbers in large Geist Mono tabular-nums with small labels, and vs_last_time */}
        <NumbersSection numbers={data.numbers} vsLastTime={data.vs_last_time} />

        {/* 5. Play button for the 20-second spoken recap */}
        <RecapPlayer />

        {/* 6. Three-trace timeline: pace, volume, and hand energy */}
        <TimelineTraces timeline={data.timeline} bookmarks={data.bookmarks} />

        {/* 7. Bookmark review: snippet, what_happened, follow_up, distinguishing phone vs promise */}
        <BookmarkReview bookmarks={data.bookmarks} />

        {/* 8. Notes on what was discussed, and best-moment quote as a pull quote */}
        <NotesAndQuote notes={data.notes} bestMomentQuote={data.best_moment_quote} />

        {/* 9. Ends with "Tag who this was with" */}
        <TagPersonPicker />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    paddingRight: SPACING.sm,
  },
  backText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.2,
    color: COLORS.paper,
    marginLeft: SPACING.xs,
  },
  mastheadTitle: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 2,
    color: COLORS.inkMid,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
});
