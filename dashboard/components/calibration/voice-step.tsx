'use client';

import { useState } from 'react';
import { Button, Dialog, DialogClose, EmptyState, Skeleton, toast } from '@/components/ui';
import { plainError } from '@/lib/api/settings-model';
import { forgetWearer } from '@/lib/api/voices';
import type { BandReadiness } from '@/lib/api/voices-model';
import { KnownVoices } from './known-voices';
import { useVoices } from './use-voices';
import { VoiceStage } from './voice-stage';

export interface VoiceStepProps {
  /** Where the band stands; null while unknown. */
  band: BandReadiness | null;
}

/** "Your voice": the guided stage for the wearer, then the other voices Undertone knows. */
export function VoiceStep({ band }: VoiceStepProps) {
  const { voices, reload } = useVoices();

  if (voices.kind === 'loading') return <Skeleton shape="block" height={220} />;
  if (voices.kind === 'error') {
    return <p role="alert" className="text-body text-danger">Couldn’t read what Undertone knows about voices. {plainError(voices.error)}</p>;
  }
  if (!voices.data.enabled) {
    return <EmptyState mark="idle">Voice memory is turned off on this laptop, so Undertone doesn’t tell voices apart.</EmptyState>;
  }

  const { wearer, voices: others } = voices.data;
  return (
    <div className="grid gap-8">
      <VoiceStage wearer={wearer} band={band} reload={reload}
        forget={wearer.state !== 'none' ? <ForgetMine reload={reload} /> : null} />
      <div className="grid gap-3">
        <div>
          <h4 className="text-body font-medium text-fg">Voices it knows</h4>
          <p className="text-body text-muted text-pretty">Other people Undertone recognises from one conversation to the next.</p>
        </div>
        <KnownVoices voices={others} reload={reload} />
      </div>
    </div>
  );
}

function ForgetMine({ reload }: { reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function forget() {
    setBusy(true);
    try {
      await forgetWearer();
      setOpen(false);
      toast('Your voice is forgotten');
      await reload();
    } catch (e) {
      toast.error(`Nothing was forgotten. ${plainError(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}
      trigger={<Button variant="ghost">Forget my voice</Button>}
      title="Forget your voice?"
      description="Undertone goes back to guessing which voice is yours from who sounds closest to the band. You can teach it again any time."
      actions={
        <>
          <DialogClose><Button>Keep it</Button></DialogClose>
          <Button variant="danger" loading={busy} onClick={() => void forget()}>Forget my voice</Button>
        </>
      } />
  );
}
