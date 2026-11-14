/**
 * "Who was this with?": one row that opens a sheet with the people the laptop knows, plus a
 * field to add a new name. Nothing shows as tagged until the laptop says yes.
 */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { listPeople, tagPerson } from '@/api/client';
import type { Person } from '@/bus/contracts';
import { Button, Card, Row, Sheet, T } from '@/ui/kit';
import { Avatar, IconWell } from '@/ui/visuals';
import { C, F, HUES, R, S, SIZE } from '@/ui/theme';

const NAME_MAX = 40;

export function TagPerson({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [tagged, setTagged] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let on = true;
    listPeople().then((p) => { if (on && p.kind === 'ok') setPeople(p.data); }, () => undefined);
    return () => { on = false; };
  }, [open]);

  const tag = (raw: string) => {
    const clean = raw.trim();
    if (!clean || saving) return;
    setFailed(false);
    setSaving(clean);
    tagPerson(sessionId, clean).then(
      () => { setTagged(clean); setSaving(null); setName(''); setOpen(false); },
      () => { setSaving(null); setFailed(true); },
    );
  };

  return (
    <View>
      <Card list>
        <Row title={tagged ?? 'Tag the person'}
          detail={tagged ? 'Counts toward your pattern with them.' : 'Builds a brief for next time you talk.'}
          leading={tagged ? <Avatar name={tagged} /> : <IconWell name="people" color={HUES[4]} />}
          onPress={() => setOpen(true)} />
      </Card>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Who was this with?">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {people.map((p) => (
              <Row key={p.person_id} title={p.name} leading={<Avatar name={p.name} />} meta={tagged === p.name ? 'Tagged' : undefined}
                detail={p.sessions > 0 ? (p.sessions === 1 ? '1 conversation' : `${p.sessions} conversations`) : undefined}
                onPress={() => tag(p.name)} />
            ))}
          </ScrollView>
          <View style={styles.add}>
            <TextInput value={name} onChangeText={setName} placeholder="Add a name" placeholderTextColor={C.faint}
              autoCorrect={false} maxLength={NAME_MAX} returnKeyType="done" onSubmitEditing={() => tag(name)}
              accessibilityLabel="Name of the person this was with" style={styles.input} />
            <Button label="Add" onPress={() => tag(name)} disabled={!name.trim()} loading={saving !== null && saving === name.trim()} />
          </View>
          {failed ? <T v="small" color={C.text} style={styles.failed} accessibilityLiveRegion="polite">That didn’t save. Try again.</T> : null}
        </KeyboardAvoidingView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 280 },
  add: { flexDirection: 'row', alignItems: 'center', gap: S[3], marginTop: S[4] },
  input: {
    flex: 1, minHeight: 52, paddingHorizontal: S[4], borderRadius: R.control, backgroundColor: C.raised,
    fontFamily: F.sans, fontSize: SIZE.body, color: C.text,
  },
  failed: { marginTop: S[3] },
});
