'use client';

import { Smartphone } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Button, Dialog, DialogClose, ICON, List, ListRow, Skeleton, StatusWord, toast, type StatusTone } from '@/components/ui';
import { createPairing, type DeviceInfo, type Pairing } from '@/lib/api/client';
import { unpairDevice } from '@/lib/api/settings';
import { ago, pairedPhones, PHONE_WORD, phoneState, plainError, type PhoneState } from '@/lib/api/settings-model';
import { motionPresets } from '@/lib/motion';
import { PairingStep } from './pairing-step';
import type { Load } from './use-settings-data';

const TONE: Record<PhoneState, StatusTone> = { connected: 'neutral', paired: 'warn', none: 'quiet' };
const SENTENCE: Record<PhoneState, string> = {
  connected: 'Nudges reach your wrist through your phone.',
  paired: 'Open Undertone on your phone so nudges can reach you.',
  none: 'Pair your phone so Undertone can buzz you during a conversation.',
};

export interface PhoneSectionProps {
  devices: Load<DeviceInfo[]>;
  reload: () => Promise<void>;
}

export function PhoneSection({ devices, reload }: PhoneSectionProps) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [minting, setMinting] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  if (devices.kind === 'loading') return <Skeleton shape="block" height={120} />;

  const list = devices.kind === 'ok' ? devices.data : [];
  const phones = pairedPhones(list);
  const state = phoneState(list);

  async function startPairing() {
    setMinting(true);
    setPairError(null);
    try {
      setPairing(await createPairing());
    } catch (e) {
      setPairError(plainError(e));
    } finally {
      setMinting(false);
    }
  }

  function connected(phone: DeviceInfo) {
    setPairing(null);
    toast(`${phone.name} is connected`);
    void reload();
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start gap-4">
        <span aria-hidden data-state={state}
          className="settings-phone-icon grid size-12 shrink-0 place-items-center rounded-[14px]">
          <Smartphone {...ICON} size={22} />
        </span>
        <div className="min-w-0 flex-1 basis-[14rem]">
          <StatusWord tone={TONE[state]} live>{PHONE_WORD[state]}</StatusWord>
          <p className="mt-1 text-body text-muted text-pretty">
            {devices.kind === 'error' ? plainError(devices.error) : SENTENCE[state]}
          </p>
        </div>
        {pairing ? null : (
          <span className="pl-16 sm:pl-0"><Button variant={state === 'none' ? 'primary' : 'quiet'} loading={minting} onClick={() => void startPairing()}>
            {state === 'none' ? 'Pair a phone' : 'Pair another phone'}
          </Button></span>
        )}
      </div>

      {pairError ? <p role="alert" className="text-body text-danger">Couldn’t make a pairing code. {pairError}</p> : null}

      {phones.length > 0 ? (
        <List label="Paired phones" animate={false}>
          {phones.map((d) => (
            <ListRow key={d.device_id} title={d.name}
              meta={d.connected ? 'Connected now' : `Not connected${ago(d.last_seen) ? `, last seen ${ago(d.last_seen)}` : ''}`}
              trailing={<UnpairButton phone={d} reload={reload} />} />
          ))}
        </List>
      ) : null}

      <AnimatePresence initial={false}>
        {pairing ? (
          <m.div key={pairing.device_id} variants={presets.enter} initial="hidden" animate="shown" exit="gone">
            <PairingStep pairing={pairing} onConnected={connected} onCancel={() => setPairing(null)} />
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function UnpairButton({ phone, reload }: { phone: DeviceInfo; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function unpair() {
    setBusy(true);
    try {
      await unpairDevice(phone.device_id);
      setOpen(false);
      toast(`${phone.name} unpaired`);
      await reload();
    } catch (e) {
      toast.error(`Couldn’t unpair. ${plainError(e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}
      trigger={<Button size="small" variant="ghost">Unpair</Button>}
      title={`Unpair ${phone.name}?`}
      description="It stops getting nudges. You can pair it again any time with a new code."
      actions={
        <>
          <DialogClose><Button>Keep it</Button></DialogClose>
          <Button variant="danger" loading={busy} onClick={() => void unpair()}>Unpair</Button>
        </>
      } />
  );
}
