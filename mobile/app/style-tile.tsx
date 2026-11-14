import React from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView } from 'react-native';
import { COLORS, FONTS } from '../src/theme/tokens';
import { Glyph } from '../src/components/Glyph';
import { HapticPattern } from '../../contracts/events';

const ALL_PATTERNS: HapticPattern[] = [
  'tap', 'interrupt', 'filler', 'wrap_up', 'slow_down', 
  'still', 'success', 'approve', 'status_good', 
  'status_talking', 'status_ask'
];

export default function StyleTile() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Style Tile</Text>

        <Section title="Palette">
          <View style={styles.paletteRow}>
            <ColorSwatch color={COLORS.paper} label="Paper" darkText />
            <ColorSwatch color={COLORS.surface} label="Surface" darkText />
            <ColorSwatch color={COLORS.ink} label="Ink" />
            <ColorSwatch color={COLORS.inkMid} label="Ink Mid" />
            <ColorSwatch color={COLORS.hairline} label="Hairline" darkText />
            <ColorSwatch color={COLORS.other} label="Other" darkText />
          </View>
          <View style={styles.paletteRow}>
            <ColorSwatch color={COLORS.patterns.interrupt} label="Interrupt" />
            <ColorSwatch color={COLORS.patterns.wrap_up} label="Wrap Up" />
            <ColorSwatch color={COLORS.patterns.filler} label="Filler" />
            <ColorSwatch color={COLORS.patterns.slow_down} label="Slow Down" />
            <ColorSwatch color={COLORS.patterns.still} label="Still" />
            <ColorSwatch color={COLORS.patterns.success} label="Success" />
          </View>
        </Section>

        <Section title="Type Scale">
          <Text style={[styles.typeSpec, { fontFamily: FONTS.display, fontSize: 48 }]}>
            Instrument Serif
          </Text>
          <Text style={[styles.typeSpec, { fontFamily: FONTS.ui, fontSize: 24 }]}>
            Geist (UI Text)
          </Text>
          <Text style={[styles.typeSpec, { fontFamily: FONTS.mono, fontSize: 24 }]}>
            Geist Mono 0123456789
          </Text>
        </Section>

        <Section title="Glyphs (Static & Playing)">
          {ALL_PATTERNS.map((pattern) => (
            <View key={pattern} style={styles.glyphRow}>
              <Text style={styles.glyphLabel}>{pattern}</Text>
              <View style={styles.glyphBox}>
                <Glyph pattern={pattern} playing={false} />
                <Text style={styles.glyphSubLabel}>Static</Text>
              </View>
              <View style={styles.glyphBox}>
                <Glyph pattern={pattern} playing={true} />
                <Text style={styles.glyphSubLabel}>Playing</Text>
              </View>
            </View>
          ))}
        </Section>

        <Section title="Nudge Takeover Preview">
          <View style={[styles.takeoverPreview, { backgroundColor: COLORS.patterns.interrupt }]}>
            <View style={styles.takeoverGlyph}>
               <Glyph pattern="interrupt" playing={true} />
            </View>
            <Text style={styles.takeoverMessage}>Let them finish</Text>
            <Text style={styles.takeoverMeta}>interrupted 0.91 · slip → tap 1.2 s</Text>
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
  </View>
);

const ColorSwatch: React.FC<{ color: string; label: string; darkText?: boolean }> = ({ color, label, darkText }) => (
  <View style={styles.swatchContainer}>
    <View style={[styles.swatch, { backgroundColor: color }]} />
    <Text style={styles.swatchLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.paper,
  },
  content: {
    padding: 24,
  },
  title: {
    fontFamily: FONTS.display,
    fontSize: 40,
    color: COLORS.ink,
    marginBottom: 32,
  },
  section: {
    marginBottom: 48,
  },
  sectionHeader: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingBottom: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 16,
  },
  swatchContainer: {
    alignItems: 'center',
    width: 64,
  },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  swatchLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.inkMid,
    textAlign: 'center',
  },
  typeSpec: {
    color: COLORS.ink,
    marginBottom: 16,
  },
  glyphRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  glyphLabel: {
    flex: 1,
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.ink,
  },
  glyphBox: {
    alignItems: 'center',
    width: 100,
  },
  glyphSubLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.inkMid,
    marginTop: 8,
  },
  takeoverPreview: {
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
  },
  takeoverGlyph: {
    marginBottom: 24,
    transform: [{ scale: 1.5 }],
  },
  takeoverMessage: {
    fontFamily: FONTS.display,
    fontSize: 48,
    color: '#FAFAFA',
    textAlign: 'center',
    marginBottom: 16,
  },
  takeoverMeta: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: 'rgba(250,250,250,0.8)',
    textAlign: 'center',
  },
});
