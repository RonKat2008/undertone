'use client';

import { useState } from 'react';
import { Avatar, Button, Dialog, DialogClose, EmptyState, Input, List, ListRow, Menu, toast } from '@/components/ui';
import { plainError } from '@/lib/api/settings-model';
import { forgetVoice, nameVoice } from '@/lib/api/voices';
import { cleanName, voiceMeta, type KnownVoice } from '@/lib/api/voices-model';

export interface KnownVoicesProps {
  voices: KnownVoice[];
  reload: () => Promise<void>;
}

type Open = { kind: 'rename' | 'forget'; voice: KnownVoice } | null;

/** Other people's voices Undertone recognises, each with rename and forget. */
export function KnownVoices({ voices, reload }: KnownVoicesProps) {
  const [open, setOpen] = useState<Open>(null);

  if (voices.length === 0) {
    return <EmptyState mark="none">No other voices yet. People you talk with appear here after a conversation.</EmptyState>;
  }

  return (
    <>
      <List label="Voices it knows">
        {voices.map((v) => (
          <ListRow key={v.voice_id} title={v.name} meta={voiceMeta(v)}
            leading={<Avatar name={v.named ? v.name : '?'} size="sm" />}
            trailing={
              <Menu label={`Actions for ${v.name}`} actions={[
                { label: v.named ? 'Rename' : 'Name this voice', onSelect: () => setOpen({ kind: 'rename', voice: v }) },
                { label: 'Forget this voice', danger: true, onSelect: () => setOpen({ kind: 'forget', voice: v }) },
              ]} />
            } />
        ))}
      </List>
      {open?.kind === 'rename' ? <RenameDialog key={open.voice.voice_id} voice={open.voice} close={() => setOpen(null)} reload={reload} /> : null}
      {open?.kind === 'forget' ? <ForgetDialog key={open.voice.voice_id} voice={open.voice} close={() => setOpen(null)} reload={reload} /> : null}
    </>
  );
}

interface VoiceDialogProps {
  voice: KnownVoice;
  close: () => void;
  reload: () => Promise<void>;
}

function RenameDialog({ voice, close, reload }: VoiceDialogProps) {
  const [typed, setTyped] = useState(voice.named ? voice.name : '');
  const [busy, setBusy] = useState(false);
  const name = cleanName(typed);

  async function save() {
    if (!name) return;
    setBusy(true);
    try {
      await nameVoice(voice.voice_id, name);
      toast(`Saved as ${name}`);
      close();
      await reload();
    } catch (e) {
      toast.error(`The name wasn’t saved. ${plainError(e)}`);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}
      title={voice.named ? `Rename ${voice.name}` : 'Name this voice'}
      description="Undertone uses this name whenever it hears this voice again."
      actions={
        <>
          <DialogClose><Button>Cancel</Button></DialogClose>
          <Button variant="primary" loading={busy} disabled={!name} onClick={() => void save()}>Save name</Button>
        </>
      }>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Input label="Name" value={typed} maxLength={80} autoFocus autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      </form>
    </Dialog>
  );
}

function ForgetDialog({ voice, close, reload }: VoiceDialogProps) {
  const [busy, setBusy] = useState(false);
  async function forget() {
    setBusy(true);
    try {
      await forgetVoice(voice.voice_id);
      toast(`${voice.name}’s voice forgotten`);
      close();
      await reload();
    } catch (e) {
      toast.error(`Nothing was forgotten. ${plainError(e)}`);
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}
      title={`Forget ${voice.name}’s voice?`}
      description="Undertone stops recognising them. Your conversations with them are kept."
      actions={
        <>
          <DialogClose><Button>Keep it</Button></DialogClose>
          <Button variant="danger" loading={busy} onClick={() => void forget()}>Forget voice</Button>
        </>
      } />
  );
}
