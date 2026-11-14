/**
 * Quiet Ink primitives. Screens compose these; they do not restyle them inline.
 * See mobile/DESIGN.md for when to use each one.
 */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_OUT, useReduceMotion } from './motion';
import { C, DUR, F, GUTTER, R, S, SIZE, TOUCH } from './theme';

// ---------- text ----------

/**
 * display  the Now state word ("Listening", "Rushing"). One per screen.
 * title    a screen title, or a state headline that is a sentence.
 * lead     a section's one important line; also the serif size for the coach's voice.
 * body     reading text and controls.
 * small    secondary lines: when, how long, a row's detail.
 * caption  the quietest line: a section label, a footnote.
 */
export type Variant = 'display' | 'title' | 'lead' | 'body' | 'small' | 'caption';

const type = StyleSheet.create({
  display: { fontFamily: F.sansMedium, fontSize: SIZE.display, lineHeight: 58, letterSpacing: -1.6, color: C.text },
  title: { fontFamily: F.sansMedium, fontSize: SIZE.title, lineHeight: 40, letterSpacing: -0.8, color: C.text },
  lead: { fontFamily: F.sansMedium, fontSize: SIZE.lead, lineHeight: 28, letterSpacing: -0.3, color: C.text },
  body: { fontFamily: F.sans, fontSize: SIZE.body, lineHeight: 24, color: C.text },
  small: { fontFamily: F.sans, fontSize: SIZE.small, lineHeight: 20, color: C.muted },
  caption: { fontFamily: F.sans, fontSize: SIZE.caption, lineHeight: 18, color: C.muted },
  medium: { fontFamily: F.sansMedium },
  num: { fontVariant: ['tabular-nums'] },
});

export interface TProps extends TextProps {
  v?: Variant;
  color?: string;
  /** Inter Medium at body sizes: a row title, a button label. */
  strong?: boolean;
  /** Tabular numerals: times, counts, anything that updates. */
  num?: boolean;
}

export function T({ v = 'body', color, strong, num, style, ...rest }: TProps) {
  return <Text {...rest} style={[type[v], strong && type.medium, num && type.num, color ? { color } : null, style]} />;
}

/** The coach's voice: debrief lines, the mission, the plan. Serif; never used for facts or controls. */
export function Prose({ size = 'lead', italic, color, style, ...rest }: TextProps & { size?: 'body' | 'lead' | 'title'; italic?: boolean; color?: string }) {
  return <Text {...rest} style={[prose.base, prose[size], italic && prose.italic, color ? { color } : null, style]} />;
}

const prose = StyleSheet.create({
  base: { fontFamily: F.serif, color: C.text },
  body: { fontSize: SIZE.body, lineHeight: 25 },
  lead: { fontSize: SIZE.lead, lineHeight: 30 },
  title: { fontSize: SIZE.title, lineHeight: 41, letterSpacing: -0.4 },
  italic: { fontFamily: F.serifItalic },
});

// ---------- layout ----------

interface ScreenProps {
  children: ReactNode;
  /** A tab's title. Pushed screens use <Header> instead. */
  title?: string;
  /** Beside the title: one quiet control at most. */
  right?: ReactNode;
  scroll?: boolean;
  /** Pinned under the content, above the home indicator (a player bar, a primary action). */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Every screen: the page colour, the top safe area, the gutter. Tabs handle the bottom inset. */
export function Screen({ children, title, right, scroll = true, footer, contentStyle }: ScreenProps) {
  const head = title ? <Title right={right}>{title}</Title> : null;
  return (
    <SafeAreaView style={layout.page} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[layout.scroll, contentStyle]} showsVerticalScrollIndicator={false}>
          {head}{children}
        </ScrollView>
      ) : (
        <View style={[layout.fill, contentStyle]}>{head}{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function Title({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={layout.title}>
      <T v="title" accessibilityRole="header" style={layout.flex}>{children}</T>
      {right}
    </View>
  );
}

/** A hairline. The only divider in the app. */
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[layout.rule, style]} />;
}

/** A quiet sentence-case label over a group. No caps, no tracking, no boxes. */
export function Section({ label, children, style }: { label?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[layout.section, style]}>
      {label ? <T v="caption" strong accessibilityRole="header" style={layout.sectionLabel}>{label}</T> : null}
      {children}
    </View>
  );
}

const layout = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1, paddingHorizontal: GUTTER },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: S[8] },
  title: { flexDirection: 'row', alignItems: 'center', gap: S[3], paddingTop: S[4], paddingBottom: S[6], minHeight: TOUCH },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  section: { marginTop: S[8] },
  sectionLabel: { marginBottom: S[3] },
});

// ---------- controls ----------

export type ButtonKind = 'primary' | 'quiet' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** primary: the accent; the one thing to do. quiet: everything else. danger: destroys something. */
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  /** Fill the row. Default is to fit the label. */
  wide?: boolean;
  /** Taller key for in-conversation use (Bookmark). */
  large?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Feedback on press-in: a 0.97 scale on the UI thread, cut to nothing under Reduce Motion. */
function usePress() {
  const reduce = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const motion: ViewStyle = {
    transform: [{ scale: pressed && !reduce ? 0.97 : 1 }],
    transitionProperty: 'transform',
    transitionDuration: reduce ? 0 : DUR.press,
    transitionTimingFunction: 'ease-out',
  } as ViewStyle;
  return { pressed, motion, onPressIn: () => setPressed(true), onPressOut: () => setPressed(false) };
}

export function Button({ label, onPress, kind = 'quiet', disabled, loading, wide, large, accessibilityLabel, style }: ButtonProps) {
  const { pressed, motion, onPressIn, onPressOut } = usePress();
  const off = disabled || loading;
  const fill = kind === 'primary' ? (off ? C.surface : C.accent) : kind === 'quiet' ? (pressed ? C.pressed : C.surface) : 'transparent';
  const ink = off ? C.faint : kind === 'primary' ? C.onAccent : kind === 'danger' ? C.danger : C.text;
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={off}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={[wide ? controls.wide : controls.fit, style]}>
      <Animated.View style={[controls.button, large && controls.large, { backgroundColor: fill }, kind === 'primary' && pressed && controls.dim, motion]}>
        {loading ? <ActivityIndicator color={ink} /> : <T v="body" strong color={ink} numberOfLines={1}>{label}</T>}
      </Animated.View>
    </Pressable>
  );
}

/** Inline text action ("Read transcript", "Not now"). Still 44 pt tall. */
export function TextButton({ label, onPress, color = C.accent, style, accessibilityLabel }: { label: string; onPress: () => void; color?: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} hitSlop={4}
      style={({ pressed }) => [controls.text, pressed && controls.dim, style]}>
      <T v="body" strong color={color}>{label}</T>
    </Pressable>
  );
}

interface RowProps {
  title: string;
  /** One line under the title: when, how long, the "next time" line. */
  detail?: string;
  /** Right side, small: a count, a plain-word status. */
  meta?: string;
  /** A coach-written title (a debrief headline) is set in the serif. */
  serif?: boolean;
  onPress?: () => void;
  /** Mark the row as new (accent dot before the title). */
  unread?: boolean;
  right?: ReactNode;
  accessibilityLabel?: string;
}

/** A list row: full width, hairline below, highlights its background on press (rows do not scale). */
export function Row({ title, detail, meta, serif, onPress, unread, right, accessibilityLabel }: RowProps) {
  const body = (
    <>
      <View style={controls.rowText}>
        <View style={controls.rowTitle}>
          {unread ? <View style={controls.unread} accessibilityLabel="New" /> : null}
          {serif ? <Prose size="body" numberOfLines={2} style={layout.flex}>{title}</Prose> : <T v="body" strong numberOfLines={2} style={layout.flex}>{title}</T>}
        </View>
        {detail ? <T v="small" numberOfLines={2} style={controls.rowDetail}>{detail}</T> : null}
      </View>
      {meta ? <T v="small" num style={controls.rowMeta}>{meta}</T> : null}
      {right}
    </>
  );
  if (!onPress) return <View style={controls.row}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? [title, detail, meta].filter(Boolean).join(', ')}
      style={({ pressed }) => [controls.row, pressed && controls.rowPressed]}>
      {body}
    </Pressable>
  );
}

/** Two or three peers ("All / People"). Selection is a lighter segment, not a colour. */
export function Segmented<K extends string>({ options, value, onChange, style }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[controls.track, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[controls.segment, on && controls.segmentOn]}>
            <T v="small" strong color={on ? C.text : C.muted}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const controls = StyleSheet.create({
  fit: { alignSelf: 'flex-start' },
  wide: { alignSelf: 'stretch' },
  button: { minHeight: 52, paddingHorizontal: S[6], borderRadius: R.control, alignItems: 'center', justifyContent: 'center' },
  large: { minHeight: 88 },
  dim: { opacity: 0.8 },
  text: { minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: S[4], minHeight: 64, paddingVertical: S[4], marginHorizontal: -GUTTER, paddingHorizontal: GUTTER, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  rowPressed: { backgroundColor: C.pressed },
  rowText: { flex: 1 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: S[2] },
  rowDetail: { marginTop: S[1] },
  rowMeta: { alignSelf: 'flex-start', marginTop: 2 },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
  track: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: R.control, padding: 3 },
  segment: { flex: 1, minHeight: 38, borderRadius: R.control - 3, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: C.lineStrong },
});

// ---------- states ----------

/**
 * One big word, one supporting line, at most one action. The Now tab's whole vocabulary.
 * `moment` sets the word in the accent: it is the wearer's moment to act ("Rushing").
 */
export function StateWord({ word, line, moment, children, style }: { word: string; line?: string; moment?: boolean; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style} accessibilityLiveRegion="polite">
      <T v="display" accessibilityRole="header" color={moment ? C.accent : C.text}>{word}</T>
      {line ? <T v="body" color={C.muted} style={states.line}>{line}</T> : null}
      {children}
    </View>
  );
}

/** Nothing here yet, or nothing can be shown. A title-sized sentence, a line, an optional action. */
export function EmptyState({ title, line, action, style }: { title: string; line?: string; action?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[states.empty, style]}>
      <T v="lead">{title}</T>
      {line ? <T v="small" style={states.emptyLine}>{line}</T> : null}
      {action ? <View style={states.action}>{action}</View> : null}
    </View>
  );
}

/** "More": the second (and last) level of disclosure. Collapsed by default. */
export function Disclosure({ label = 'More', children, style }: { label?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const reduce = useReduceMotion();
  return (
    <View style={style}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => [states.disclosure, pressed && controls.dim]}>
        <T v="body" strong>{label}</T>
        <T v="body" color={C.muted}>{open ? 'Hide' : 'Show'}</T>
      </Pressable>
      {open ? <Animated.View entering={reduce ? undefined : FadeIn.duration(DUR.enter).easing(EASE_OUT)}>{children}</Animated.View> : null}
    </View>
  );
}

/** A bottom sheet for a short task (tag a person, pick a mission). Dismiss by tapping outside or "Done". */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={states.scrim} entering={reduce ? undefined : FadeIn.duration(DUR.state)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[states.sheet, { paddingBottom: Math.max(insets.bottom, S[4]) + S[2] }]}
        entering={reduce ? undefined : SlideInDown.duration(DUR.enter + 60).easing(EASE_OUT)}>
        <View style={states.sheetHead}>
          <T v="lead" style={layout.flex} accessibilityRole="header">{title}</T>
          <TextButton label="Done" onPress={onClose} color={C.text} />
        </View>
        {children}
      </Animated.View>
    </Modal>
  );
}

const states = StyleSheet.create({
  line: { marginTop: S[2] },
  empty: { paddingVertical: S[6] },
  emptyLine: { marginTop: S[2] },
  action: { marginTop: S[5] },
  disclosure: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.surface, borderTopLeftRadius: R.sheet, borderTopRightRadius: R.sheet, paddingHorizontal: GUTTER, paddingTop: S[3], maxHeight: '85%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
});

// ---------- formatting ----------

/** 0:34, 12:05, 1:02:10. */
export function clock(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "Under a minute", "12 min", "1 h 5 min". */
export function howLong(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 60) return 'Under a minute';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today 14:05", "Yesterday 09:30", "Tuesday 18:10", "3 Nov". Plain, local time. */
export function when(iso: string | null | undefined, now: Date = new Date()): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  if (diff > 1 && diff < 7) return `${DAYS[d.getDay()]} ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
