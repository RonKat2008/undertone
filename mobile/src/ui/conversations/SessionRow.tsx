/**
 * One conversation inside a <Card list>: who (avatar or icon), the coach's headline in serif, when and how long,
 * and a thin bar for how much of the talking was yours. Local because kit's Row has no slot under the detail.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import type { SessionListItem } from '@/api/client';
import { Avatar, Icon, IconWell, Meter, Prose, T } from '@/ui/kit';
import { C, hueFor, S } from '@/ui/theme';
import { sessionDetail, sessionTitle } from './words';

const CARD_PAD = S[4]; // matches kit's Card list padding so the press highlight runs edge to edge
const METER_W = 80;

interface Props {
  session: SessionListItem;
  personName?: string | null;
  unread?: boolean;
  onOpen: (sessionId: string) => void;
}

function Leading({ session, personName }: { session: SessionListItem; personName?: string | null }) {
  if (session.mode === 'practice') return <IconWell name="pulse" color={C.warm} />;
  if (personName && session.person_id) return <Avatar name={personName} size={40} />;
  return <IconWell name="talk" />;
}

export function SessionRow({ session, personName, unread, onOpen }: Props) {
  const title = sessionTitle(session);
  const detail = sessionDetail(session, personName);
  const share = session.mode === 'practice' ? null : session.numbers?.talk_ratio ?? null;
  const shareWord = share === null ? null : `You talked ${Math.round(share * 100)}%`;
  const hue = personName ? hueFor(personName) : C.muted;
  return (
    <Pressable onPress={() => onOpen(session.session_id)} accessibilityRole="button"
      accessibilityLabel={[unread ? 'New' : '', title, detail, shareWord].filter(Boolean).join(', ')}>
      {({ pressed }) => (
        <View style={[styles.row, pressed && styles.pressed]}>
          <Leading session={session} personName={personName} />
          <View style={styles.text}>
            <View style={styles.titleLine}>
              {unread ? <View style={styles.unread} /> : null}
              <Prose size="body" numberOfLines={2} style={styles.flex}>{title}</Prose>
            </View>
            {detail ? <T v="small" numberOfLines={1} style={styles.detail}>{detail}</T> : null}
            {share !== null ? (
              <View style={styles.share}>
                <Meter value={share} color={hue} style={styles.meter} />
                <T v="caption" num>{shareWord}</T>
              </View>
            ) : null}
          </View>
          <Icon name="chevron" size={18} color={C.faint} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S[3], minHeight: 64, paddingVertical: S[3], marginHorizontal: -CARD_PAD, paddingHorizontal: CARD_PAD },
  pressed: { backgroundColor: C.pressed },
  text: { flex: 1 },
  flex: { flex: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: S[2] },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
  detail: { marginTop: 2 },
  share: { flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[2] },
  meter: { width: METER_W },
});
