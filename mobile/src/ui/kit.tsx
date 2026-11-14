/**
 * Quiet Ink primitives (warm). Screens compose these; they do not restyle them inline.
 * See mobile/DESIGN.md for when to use each one. Visual pieces live in ./visuals and are re-exported here.
 */
import { Children, isValidElement, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextProps, type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_OUT, useReduceMotion } from './motion';
import { C, DUR, F, GUTTER, R, S, SHADOW, SIZE, TOUCH } from './theme';
import { Ambient, Icon, IconWell, type IconName } from './visuals';

export { Ambient, Avatar, Icon, IconWell, Meter, Orb, Sparkline, type IconName } from './visuals';

// ---------- text ----------

/**
 * display  the Now state word ("Listening", "Rushing"). One per screen.
 * title    a screen title, or a state headline that is a sentence.
 * lead     a card's heading, an empty-state sentence, a sheet title.
 * body     reading text and controls.
 * small    secondary lines: when, how long, a row's detail.
 * caption  the quietest line: a footnote, a meta value.
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
  /** Inter Medium: a row title, a button label, a heading. */
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
  /** The ambient glow colour at the top of the page (default teal). */
  glow?: string;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Every screen: the warm page, a soft glow at the top, the top safe area, the gutter. */
export function Screen({ children, title, right, scroll = true, footer, glow = C.accent, contentStyle }: ScreenProps) {
  const head = title ? <Title right={right}>{title}</Title> : null;
  return (
    <View style={layout.page}>
      <Ambient color={glow} strength={0.16} />
      <SafeAreaView style={layout.flex} edges={['top', 'left', 'right']}>
        {scroll ? (
          <ScrollView contentContainerStyle={[layout.scroll, contentStyle]} showsVerticalScrollIndicator={false}>
            {head}{children}
          </ScrollView>
        ) : (
          <View style={[layout.fill, contentStyle]}>{head}{children}</View>
        )}
        {footer}
      </SafeAreaView>
    </View>
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

/** A hairline. Only between rows inside a list card. */
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[layout.rule, style]} />;
}

/** A group with a sentence-case heading. */
export function Section({ label, children, style, right }: { label?: string; children: ReactNode; style?: StyleProp<ViewStyle>; right?: ReactNode }) {
  return (
    <View style={[layout.section, style]}>
      {label ? (
        <View style={layout.sectionHead}>
          <T v="small" strong color={C.text} accessibilityRole="header" style={layout.flex}>{label}</T>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * A soft rounded surface, one level deep. `list` puts rows edge to edge with hairlines between them;
 * otherwise it pads its content. `tint` washes the card in a meaning colour (teal: your moment; amber: the coach).
 */
export function Card({ children, list, tint, style }: { children: ReactNode; list?: boolean; tint?: string; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children).filter(isValidElement);
  const body = list
    ? items.map((child, i) => (
      <View key={child.key ?? i}>
        {i > 0 ? <Rule style={layout.listRule} /> : null}
        {child}
      </View>
    ))
    : children;
  return <View style={[layout.card, list ? layout.cardList : layout.cardPad, tint ? { backgroundColor: tint } : null, style]}>{body}</View>;
}

/** Staggered entrance for list items and cards: a short rise and fade, index by index. */
export function Appear({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  return (
    <Animated.View style={style} entering={reduce ? undefined : FadeInDown.duration(DUR.enter).delay(Math.min(index, 8) * DUR.stagger).easing(EASE_OUT)}>
      {children}
    </Animated.View>
  );
}

const CARD_PAD = S[4];

const layout = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1, paddingHorizontal: GUTTER },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: S[8] },
  title: { flexDirection: 'row', alignItems: 'center', gap: S[3], paddingTop: S[4], paddingBottom: S[5], minHeight: TOUCH },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  listRule: { marginLeft: 0 },
  section: { marginTop: S[7] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: S[3], minHeight: 24 },
  card: { backgroundColor: C.surface, borderRadius: R.card, ...SHADOW },
  cardPad: { padding: CARD_PAD + S[1] },
  cardList: { paddingHorizontal: CARD_PAD, overflow: 'hidden' },
});

// ---------- controls ----------

export type ButtonKind = 'primary' | 'quiet' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** primary: teal fill, the one thing to do. quiet: a raised fill, anything else. danger: destroys something. */
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** Fill the row. Default is to fit the label. */
  wide?: boolean;
  /** Taller key for in-conversation use (Bookmark). */
  large?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Feedback on press-in: a small scale on the UI thread (CSS transition), none under Reduce Motion. */
function usePress(scale = 0.97) {
  const reduce = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const motion = {
    transform: [{ scale: pressed && !reduce ? scale : 1 }],
    transitionProperty: 'transform',
    transitionDuration: reduce ? 0 : DUR.press,
    transitionTimingFunction: 'ease-out',
  } as ViewStyle;
  return { pressed, motion, onPressIn: () => setPressed(true), onPressOut: () => setPressed(false) };
}

const FILL: Record<ButtonKind, [string, string]> = {
  primary: [C.accent, C.accent],
  quiet: [C.raised, C.pressed],
  danger: [C.raised, C.pressed],
};

export function Button({ label, onPress, kind = 'quiet', icon, disabled, loading, wide, large, accessibilityLabel, style }: ButtonProps) {
  const { pressed, motion, onPressIn, onPressOut } = usePress();
  const off = disabled || loading;
  const fill = off ? C.surface : FILL[kind][pressed ? 1 : 0];
  const ink = off ? C.faint : kind === 'primary' ? C.onAccent : kind === 'danger' ? C.danger : C.text;
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={off}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={[wide ? controls.wide : controls.fit, style]}>
      <Animated.View style={[controls.button, large && controls.large, { backgroundColor: fill }, kind === 'primary' && !off && controls.glow, kind === 'primary' && pressed && controls.dim, motion]}>
        {loading ? <ActivityIndicator color={ink} /> : (
          <View style={controls.buttonInner}>
            {icon ? <Icon name={icon} size={20} color={ink} /> : null}
            <T v="body" strong color={ink} numberOfLines={1}>{label}</T>
          </View>
        )}
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
  metaColor?: string;
  /** A coach-written title (a debrief headline) is set in the serif. */
  serif?: boolean;
  /** Leading visual: an <Avatar>, an <IconWell>, a colour dot. */
  leading?: ReactNode;
  onPress?: () => void;
  /** Mark the row as new (teal dot before the title). */
  unread?: boolean;
  right?: ReactNode;
  /** Rows that act in place (play a buzz) rather than open a screen pass false. */
  chevron?: boolean;
  accessibilityLabel?: string;
}

/** A list row. Lives inside <Card list>. Pressable rows show a chevron and highlight while pressed. */
export function Row({ title, detail, meta, metaColor, serif, leading, onPress, unread, right, chevron = true, accessibilityLabel }: RowProps) {
  const body = (pressed: boolean) => (
    <View style={[controls.row, pressed && controls.rowPressed]}>
      {leading}
      <View style={controls.rowText}>
        <View style={controls.rowTitle}>
          {unread ? <View style={controls.unread} accessibilityLabel="New" /> : null}
          {serif ? <Prose size="body" numberOfLines={2} style={layout.flex}>{title}</Prose> : <T v="body" strong numberOfLines={2} style={layout.flex}>{title}</T>}
        </View>
        {detail ? <T v="small" numberOfLines={2} style={controls.rowDetail}>{detail}</T> : null}
      </View>
      {meta ? <T v="small" num color={metaColor} style={controls.rowMeta}>{meta}</T> : null}
      {right}
      {onPress && chevron ? <Icon name="chevron" size={18} color={C.faint} /> : null}
    </View>
  );
  if (!onPress) return body(false);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? [title, detail, meta].filter(Boolean).join(', ')}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

/** Two or three peers ("All / People"). The selected segment takes the teal wash. */
export function Segmented<K extends string>({ options, value, onChange, style }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[controls.track, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[controls.segment, on && controls.segmentOn]}>
            <T v="small" strong color={on ? C.accent : C.muted}>{o.label}</T>
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
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: S[2] },
  large: { minHeight: 88, borderRadius: R.card },
  glow: { shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  dim: { opacity: 0.85 },
  text: { minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: S[3], minHeight: 64, paddingVertical: S[3], marginHorizontal: -CARD_PAD, paddingHorizontal: CARD_PAD },
  rowPressed: { backgroundColor: C.pressed },
  rowText: { flex: 1 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: S[2] },
  rowDetail: { marginTop: 2 },
  rowMeta: { alignSelf: 'center' },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
  track: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: R.control, padding: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: R.control - 4, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: C.accentSoft },
});

// ---------- states ----------

/**
 * One big word, one supporting line, at most one action. Re-enters with a small spring rise
 * whenever the word changes. `color` tints the word with the state's meaning.
 */
export function StateWord({ word, line, color = C.text, center, children, style }: { word: string; line?: string; color?: string; center?: boolean; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  return (
    <Animated.View key={word} style={style} accessibilityLiveRegion="polite"
      entering={reduce ? undefined : FadeInDown.springify(420).dampingRatio(0.85)}>
      <T v="display" accessibilityRole="header" color={color} style={center && states.center}>{word}</T>
      {line ? <T v="body" color={C.muted} num style={[states.line, center && states.center]}>{line}</T> : null}
      {children}
    </Animated.View>
  );
}

/** Nothing here yet, or nothing can be shown: an icon well, a sentence, a line, at most one action. */
export function EmptyState({ title, line, action, icon, style }: { title: string; line?: string; action?: ReactNode; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  return (
    <Card style={[states.empty, style]}>
      {icon ? <View style={states.emptyIcon}><IconWell name={icon} size={44} /></View> : null}
      <T v="lead">{title}</T>
      {line ? <T v="small" style={states.emptyLine}>{line}</T> : null}
      {action ? <View style={states.action}>{action}</View> : null}
    </Card>
  );
}

/** "More": the second (and last) level of disclosure, as a card that opens in place. */
export function Disclosure({ label = 'More', children, style }: { label?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const reduce = useReduceMotion();
  const turn = {
    transform: [{ rotate: open ? '90deg' : '0deg' }],
    transitionProperty: 'transform',
    transitionDuration: reduce ? 0 : DUR.state,
  } as ViewStyle;
  return (
    <View style={style}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => [states.disclosure, pressed && controls.rowPressed]}>
        <T v="body" strong style={layout.flex}>{label}</T>
        <Animated.View style={turn}><Icon name="chevron" size={18} color={C.muted} /></Animated.View>
      </Pressable>
      {open ? <Animated.View entering={reduce ? undefined : FadeInDown.duration(DUR.enter).easing(EASE_OUT)} style={states.disclosed}>{children}</Animated.View> : null}
    </View>
  );
}

/** A bottom sheet for a short task (tag a person, confirm unpair). Springs up; tap outside or "Done" to close. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={states.scrim} entering={reduce ? undefined : FadeIn.duration(DUR.state)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[states.sheet, { paddingBottom: Math.max(insets.bottom, S[4]) + S[2] }]}
        entering={reduce ? undefined : SlideInDown.springify(380).dampingRatio(0.82)}>
        <View style={states.grabber} />
        <View style={states.sheetHead}>
          <T v="lead" style={layout.flex} accessibilityRole="header">{title}</T>
          <TextButton label="Done" onPress={onClose} />
        </View>
        {children}
      </Animated.View>
    </Modal>
  );
}

const states = StyleSheet.create({
  line: { marginTop: S[2] },
  center: { textAlign: 'center' },
  empty: { marginTop: S[2] },
  emptyIcon: { marginBottom: S[4] },
  emptyLine: { marginTop: S[2] },
  action: { marginTop: S[5] },
  disclosure: { minHeight: 56, flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.card, paddingHorizontal: CARD_PAD + S[1] },
  disclosed: { marginTop: S[3] },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,4,2,0.65)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.surface, borderTopLeftRadius: R.sheet, borderTopRightRadius: R.sheet, paddingHorizontal: GUTTER, paddingTop: S[2], maxHeight: '85%', ...SHADOW },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: C.lineStrong, marginBottom: S[1] },
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
