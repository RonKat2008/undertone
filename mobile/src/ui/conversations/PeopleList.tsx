/** People: avatar, name, the coach's "next time" line, the relationship in their colour. A tap opens their conversations. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { RelationshipKind, SessionListItem } from '@/api/client';
import type { Person } from '@/bus/contracts';
import { Appear, Avatar, Card, Icon, Prose, Rule, T } from '@/ui/kit';
import { C, hueFor, S } from '@/ui/theme';
import { SessionRow } from './SessionRow';
import { relationshipWord } from './words';

const CARD_PAD = S[4]; // kit's Card list padding
const AVATAR = 40;

interface Props {
  people: Person[];
  sessions: SessionListItem[];
  kinds: Map<string, RelationshipKind>;
  unreadId: string | null;
  onOpen: (sessionId: string) => void;
}

export function PeopleList({ people, sessions, kinds, unreadId, onOpen }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card list>
      {people.map((p, i) => {
        const open = openId === p.person_id;
        return (
          <Appear key={p.person_id} index={i}>
            <PersonRow person={p} relation={relationshipWord(kinds.get(p.person_id))} open={open}
              onToggle={() => setOpenId((id) => (id === p.person_id ? null : p.person_id))} />
            {open ? (
              <Their person={p} sessions={sessions.filter((s) => s.person_id === p.person_id)} unreadId={unreadId} onOpen={onOpen} />
            ) : null}
          </Appear>
        );
      })}
    </Card>
  );
}

/** The opened person, in place: the pattern line, then their conversations in the same card. */
function Their({ person, sessions, unreadId, onOpen }: { person: Person; sessions: SessionListItem[]; unreadId: string | null; onOpen: (id: string) => void }) {
  const pattern = person.pattern.trim();
  return (
    <Appear style={styles.opened}>
      {pattern ? <T v="small" style={styles.pattern}>{pattern}</T> : null}
      {sessions.map((s) => (
        <View key={s.session_id}>
          <Rule />
          <SessionRow session={s} personName={person.name} unread={s.session_id === unreadId} onOpen={onOpen} />
        </View>
      ))}
      {!sessions.length && !pattern ? <T v="small" style={styles.pattern}>No conversations to show yet.</T> : null}
    </Appear>
  );
}

interface RowProps {
  person: Person;
  relation?: string;
  open: boolean;
  onToggle: () => void;
}

/** Local row: the "next time" line is the coach's voice (serif), and the relationship takes the person's hue. */
function PersonRow({ person, relation, open, onToggle }: RowProps) {
  const brief = person.brief.trim();
  const hue = hueFor(person.name);
  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={[person.name, relation, brief].filter(Boolean).join(', ')}>
      {({ pressed }) => (
        <View style={[styles.row, (pressed || open) && styles.pressed]}>
          <Avatar name={person.name} size={AVATAR} />
          <View style={styles.text}>
            <View style={styles.nameLine}>
              <T v="body" strong numberOfLines={1} style={styles.flex}>{person.name}</T>
              {relation ? <T v="caption" strong color={hue}>{relation}</T> : null}
            </View>
            {brief ? <Prose size="body" numberOfLines={open ? undefined : 2} style={styles.brief}>{brief}</Prose> : null}
          </View>
          <Icon name="chevron" size={18} color={open ? C.text : C.faint} />
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
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: S[2] },
  brief: { marginTop: 2 },
  opened: { paddingLeft: AVATAR + S[3] },
  pattern: { paddingBottom: S[3] },
});
