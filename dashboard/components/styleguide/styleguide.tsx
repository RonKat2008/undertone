'use client';

import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Bookmark, Download, Hash, Pencil, Trash2, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Avatar, Button, CoachNote, Dialog, DialogClose, Disclosure, EmptyState, ICON, InlineStat, Input, KIND_LABEL, KINDS,
  KindChip, KindDot, List, ListeningMark, ListRow, Menu, PaceBar, Page, Panel, PatternMark, Prose, Section,
  SegmentedControl, ShareBar, Skeleton, SkeletonLines, Sparkline, StatusWord, Tabs, TextLink, Textarea, ThemeToggle,
  Tooltip, toast,
} from '@/components/ui';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/lib/bus/patterns';
import { motionPresets } from '@/lib/motion';
import { TokenSwatches } from './tokens';

const TYPE_SCALE = [
  { name: 'Display 32/38, 500', cls: 'qi-display', sample: 'Conversations' },
  { name: 'Title 22/28, 500', cls: 'qi-title', sample: 'Tuesday with Sam' },
  { name: 'Lead 17/26, 400', cls: 'qi-lead', sample: 'You spoke for 12 minutes and asked four questions.' },
  { name: 'Body 15/24, 400 and 500', cls: 'qi-body', sample: 'The band heard this at 9:40. Two nudges reached your phone.' },
  { name: 'Caption 13/18, 400 and 500', cls: 'qi-caption', sample: 'Yesterday, 9:40, 14 minutes' },
];

const SPACE = [4, 8, 12, 16, 20, 24, 32, 40, 56];

export function Styleguide() {
  return (
    <Page
      title="Lamplight"
      lede="Every token and primitive the site is built from, in both themes. Dev only; DESIGN.md says when to use each."
      action={<ThemeToggle />}
      width="wide"
    >
      <Section title="The same page in both themes">
        <div className="grid gap-5 md:grid-cols-2">
          <Specimen theme="dark" />
          <Specimen theme="light" />
        </div>
      </Section>

      <Section title="Colour">
        <div className="grid gap-5 lg:grid-cols-2">
          <TokenSwatches theme="dark" />
          <TokenSwatches theme="light" />
        </div>
      </Section>

      <Section title="Kinds" icon={<Hash {...ICON} size={18} aria-hidden />}>
        <Panel>
          <p className="qi-body text-muted">Five things Undertone knows about. Each keeps one hue everywhere: dots, chips, avatars, graph nodes, trend lines.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {KINDS.map((k) => <KindChip key={k} kind={k}>{KIND_LABEL[k]}</KindChip>)}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            {KINDS.map((k) => (
              <span key={k} className="qi-caption inline-flex items-center gap-2 text-muted"><KindDot kind={k} />{KIND_LABEL[k]}</span>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Avatar name="Sam Ortiz" size="lg" /><Avatar name="Priya" /><Avatar name="Dana Lee" size="sm" />
            <Avatar name="You" tone="me" /><Avatar name="Coach" tone="coach" />
          </div>
        </Panel>
      </Section>

      <div className="mt-[var(--gap-section)] grid gap-x-10 lg:grid-cols-2">
        <div>
          <Section title="Type">
            <Panel>
              <div className="grid gap-5">
                {TYPE_SCALE.map((t) => (
                  <div key={t.name}>
                    <p className="qi-caption text-muted">{t.name}</p>
                    <p className={t.cls}>{t.sample}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </Section>
          <Section title="Space, shape, depth">
            <Panel>
              <ul className="grid gap-2">
                {SPACE.map((s) => (
                  <li key={s} className="grid grid-cols-[32px_1fr] items-center gap-3">
                    <span className="qi-caption tabular text-muted">{s}</span>
                    <span className="block h-2 rounded-full bg-accent/60" style={{ width: s * 4 }} aria-hidden />
                  </li>
                ))}
              </ul>
              <p className="qi-caption mt-4 text-muted">4 px base. Controls round to 10, panels to 16, dialogs to 20. One surface level: a panel never holds another panel.</p>
            </Panel>
          </Section>
        </div>
        <div>
          <Section title="The coach's voice">
            <div className="grid gap-4">
              <Prose size="display" as="p">You mostly talked with Sam this week, about the launch.</Prose>
              <CoachNote size="lead">
                <p>Next time Sam pushes back, <mark>let the pause sit for two seconds</mark> before you answer.</p>
              </CoachNote>
              <CoachNote>
                <p>You opened well and asked Sam what worried him most. When the budget came up your answers got longer, and you started to finish his sentences.</p>
                <p>The nudge at 14 minutes worked: you slowed down and the next exchange was even.</p>
              </CoachNote>
            </div>
          </Section>
        </div>
      </div>

      <div className="mt-[var(--gap-section)] grid gap-x-10 lg:grid-cols-2">
        <div>
          <ButtonsSection />
          <FieldsSection />
          <FeedbackSection />
        </div>
        <div>
          <ListSection />
          <VisualsSection />
          <DisclosureSection />
          <MarksSection />
          <MotionSection />
        </div>
      </div>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-2.5 sm:grid-cols-[96px_1fr] sm:items-center sm:gap-5">
      <p className="qi-caption text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}

function ButtonsSection() {
  const [saving, setSaving] = useState(false);
  const save = () => {
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      toast('Coach saved');
    }, 1200);
  };
  return (
    <Section title="Buttons and links">
      <Panel>
        <Row label="Primary"><Button variant="primary" onClick={save} loading={saving}>Save coach</Button><Button variant="primary" disabled>Save coach</Button></Row>
        <Row label="Quiet"><Button>Rehearse</Button><Button disabled>Rehearse</Button><Button size="small">Test buzz</Button></Row>
        <Row label="Ghost"><Button variant="ghost">Skip</Button><Tooltip content="Bookmark this moment"><Button variant="ghost" iconOnly aria-label="Bookmark this moment"><Bookmark {...ICON} aria-hidden /></Button></Tooltip></Row>
        <Row label="Danger"><Button variant="danger">Forget this band</Button><Button variant="danger" size="small">Delete</Button></Row>
        <Row label="Loading"><Button variant="primary" loading>Save coach</Button><Button loading>Rehearse</Button></Row>
        <Row label="Text link"><span className="qi-body">Read the <TextLink href="/conversations">full debrief</TextLink> or <TextLink href="/conversations" tone="muted">all conversations</TextLink>.</span></Row>
        <p className="qi-caption pt-2 text-muted">Tab for focus rings (teal). Hover shifts the fill; press settles to 0.97.</p>
      </Panel>
    </Section>
  );
}

function FieldsSection() {
  return (
    <Section title="Inputs">
      <Panel>
        <div className="grid gap-5">
          <Input label="Band name" placeholder="Left wrist" hint="Shown on your phone when it buzzes." />
          <Input label="Pairing code" defaultValue="48 21" error="That code has expired. Show a new one on the phone and try again." />
          <Input label="Server address" defaultValue="http://192.168.1.20:8000" disabled />
          <Textarea label="What do you want to get better at?" placeholder="Stop saying “like” when I’m nervous in interviews" />
        </div>
      </Panel>
    </Section>
  );
}

function FeedbackSection() {
  const [minutes, setMinutes] = useState(12);
  return (
    <Section title="Numbers, states, feedback">
      <Panel>
        <p className="qi-lead">You spoke for <InlineStat value={minutes} suffix=" minutes" /> with <InlineStat value={3} tone="person" suffix=" people" /> and kept <InlineStat value={2} tone="promise" suffix=" promises" />.</p>
        <div className="mt-3"><Button size="small" onClick={() => setMinutes((v) => v + 3)}>Add 3 minutes</Button></div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 qi-body">
          <StatusWord>Connected</StatusWord><StatusWord tone="quiet">Not listening</StatusWord><StatusWord tone="moment">Try this next</StatusWord>
          <StatusWord tone="coach">New debrief</StatusWord><StatusWord tone="warn">Battery low</StatusWord><StatusWord tone="error">Couldn’t reach the band</StatusWord>
        </div>
        <Row label="Toast">
          <Button size="small" onClick={() => toast('Test buzz sent')}>Send test buzz</Button>
          <Button size="small" onClick={() => toast.error('Couldn’t reach your phone. Check it is unlocked.')}>Error</Button>
          <Button size="small" onClick={() => toast('Conversation deleted', { action: { label: 'Undo', onClick: () => toast('Restored') } })}>With undo</Button>
        </Row>
        <Row label="Dialog">
          <Dialog
            trigger={<Button variant="danger" size="small">Delete conversation</Button>}
            title="Delete this conversation?"
            description="The transcript, audio and debrief are removed for good."
            actions={<><DialogClose><Button>Keep it</Button></DialogClose><DialogClose><Button variant="danger" onClick={() => toast('Conversation deleted')}>Delete</Button></DialogClose></>}
          />
        </Row>
      </Panel>
      <Panel className="mt-4">
        <EmptyState action={<Button variant="primary" href="/settings">Pair your band</Button>}>Your conversations show up here after the band hears one.</EmptyState>
      </Panel>
      <Panel className="mt-4">
        <div className="flex items-center gap-3"><Skeleton shape="circle" /><div className="flex-1"><SkeletonLines lines={2} label="Loading people" /></div></div>
      </Panel>
    </Section>
  );
}

function ListSection() {
  const [current, setCurrent] = useState('mine');
  const rowMenu = (who: string) => (
    <Menu
      label={`Actions for the conversation with ${who}`}
      actions={[
        { label: 'Rename', icon: Pencil, onSelect: () => toast('Rename opened') },
        { label: 'Download audio', icon: Download, onSelect: () => toast('Download started') },
        { label: 'Delete', icon: Trash2, danger: true, onSelect: () => toast.error('Deleted (demo)') },
      ]}
    />
  );
  return (
    <Section title="Lists" icon={<Users {...ICON} size={18} aria-hidden />} aside={<TextLink href="/conversations" tone="muted">All conversations</TextLink>}>
      <Panel padding="list">
        <List label="Recent conversations">
          <ListRow key="sam" href="/conversations" leading={<Avatar name="Sam Ortiz" />} title="Launch timeline with Sam" meta="Today, 14 minutes" trailing={<><StatusWord tone="moment">Try this next</StatusWord>{rowMenu('Sam')}</>} />
          <ListRow key="priya" href="/conversations" leading={<Avatar name="Priya Shah" />} title="Weekly one-to-one with Priya" meta="Monday, 31 minutes" trailing={<><Sparkline values={[6, 5, 7, 4, 3, 3, 2]} tone="habit" label="Fewer filler words over the week" />{rowMenu('Priya')}</>} />
          <ListRow key="fam" href="/conversations" leading={<Avatar name="Dana Lee" />} title="Dinner with the family, which wandered from the trip to the house move and back" meta="Sunday, 1 hour 12 minutes" trailing={rowMenu('the family')} />
        </List>
      </Panel>
      <Panel padding="list" className="mt-4">
        <List label="Coaches">
          {[
            { id: 'mine', t: 'Your coach', m: 'Built from your last ten conversations' },
            { id: 'interview', t: 'Interview coach', m: 'Short, structured answers' },
            { id: 'listener', t: 'Listener coach', m: 'Talk less, ask more' },
          ].map((c) => (
            <ListRow key={c.id} onSelect={() => setCurrent(c.id)} current={current === c.id}
              leading={<Avatar name={c.t} tone="coach" size="sm" />} title={c.t} meta={c.m}
              trailing={current === c.id ? <StatusWord tone="moment">In use</StatusWord> : null} />
          ))}
        </List>
      </Panel>
    </Section>
  );
}

function VisualsSection() {
  const [share, setShare] = useState(0.58);
  return (
    <Section title="Small visuals">
      <Panel>
        <p className="qi-body">Who talked</p>
        <div className="mt-2"><ShareBar share={share} left="You" right="Sam" label="You talked a little more than Sam" /></div>
        <p className="qi-body mt-5">Your pace</p>
        <div className="mt-2"><PaceBar value={168} min={100} max={220} zone={[130, 160]} label="A little faster than your comfortable pace" /></div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 qi-body">
          <span className="inline-flex items-center gap-2">Filler words <Sparkline values={[6, 5, 5, 4, 3, 3, 2]} tone="habit" label="Filler words fell" /></span>
          <span className="inline-flex items-center gap-2">Questions <Sparkline values={[1, 2, 2, 3, 2, 4, 5]} label="More questions" /></span>
          <span className="inline-flex items-center gap-2">With Sam <Sparkline values={[2, 3, 1, 4, 3, 5, 4]} tone="person" label="More time with Sam" /></span>
        </div>
        <div className="mt-4"><Button size="small" onClick={() => setShare((s) => (s > 0.5 ? 0.38 : 0.62))}>Change the share</Button></div>
      </Panel>
    </Section>
  );
}

function DisclosureSection() {
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  return (
    <Section title="Tabs, segments, disclosure">
      <Panel>
        <SegmentedControl label="Time range" value={range} onValueChange={setRange}
          options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
        <div className="mt-5">
          <Tabs label="Conversation views" items={[
            { value: 'debrief', label: 'Debrief', content: <Prose as="p">You held your ground without raising your voice.</Prose> },
            { value: 'transcript', label: 'Transcript', content: <p className="qi-body">Sam: Can we move the launch? You: Let’s look at what moves with it.</p> },
            { value: 'audio', label: 'Audio', content: <p className="qi-body text-muted">The recording plays here.</p> },
          ]} />
        </div>
        <div className="mt-5">
          <Disclosure summary="How Undertone counts filler words">
            <p className="qi-body text-muted">It counts “um”, “uh”, “like” and “you know” when they stand alone, and only what you said, never the other person.</p>
          </Disclosure>
        </div>
      </Panel>
    </Section>
  );
}

function MarksSection() {
  const [plays, setPlays] = useState<Record<string, number>>({});
  const nudges = PATTERN_ORDER.filter((p) => PATTERNS[p].group === 'nudge');
  return (
    <Section title="Buzzes and the listening mark">
      <Panel>
        <div className="flex flex-wrap items-center gap-8">
          <ListeningMark size="lg" label="Listening" />
          <ListeningMark size="lg" state="idle" label="Not listening" />
          <ListeningMark size="lg" state="offline" label="Offline" />
          <span className="inline-flex items-center gap-1.5 qi-caption font-medium"><ListeningMark />Listening</span>
        </div>
        <ul className="mt-5 grid">
          {nudges.map((p: HapticPattern) => (
            <li key={p} className="flex min-h-11 items-center justify-between gap-4">
              <span className="qi-body text-accent"><PatternMark pattern={p} playKey={plays[p]} /></span>
              <span className="flex items-center gap-2">
                <span className="qi-caption text-muted max-sm:hidden">{PATTERNS[p].feel}</span>
                <Button size="small" variant="ghost" onClick={() => setPlays((s) => ({ ...s, [p]: (s[p] ?? 0) + 1 }))}>Play</Button>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </Section>
  );
}

function MotionSection() {
  const [shown, setShown] = useState(true);
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  return (
    <Section title="Motion">
      <Panel>
        <p className="qi-body text-muted">150 to 320 ms, transform and opacity only; springs for panels and menus; lists rise in one after another. With reduced motion, movement becomes a short fade.</p>
        <div className="mt-4 flex min-h-20 flex-wrap items-start gap-4">
          <Button size="small" onClick={() => setShown((s) => !s)}>{shown ? 'Dismiss' : 'Show'} the nudge</Button>
          <AnimatePresence initial={false}>
            {shown ? (
              <m.div key="nudge" variants={presets.enter} initial="hidden" animate="shown" exit="gone"
                className="flex items-center gap-3 rounded-[12px] bg-[var(--accent-wash)] py-2 pl-4 pr-2">
                <span className="qi-body font-medium text-accent"><PatternMark pattern="interrupt" /></span>
                <Button variant="ghost" size="small" iconOnly aria-label="Dismiss" onClick={() => setShown(false)}><X {...ICON} size={16} aria-hidden /></Button>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </Panel>
    </Section>
  );
}

/** A miniature home page rendered inside one theme, so both themes can be judged side by side. */
function Specimen({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div data-theme={theme} className="rounded-[20px] p-4 sm:p-5" style={{
      background: `radial-gradient(420px 220px at 0% 0%, color-mix(in oklch, var(--accent) var(--ambient-strength), transparent), transparent 70%), radial-gradient(360px 200px at 100% 0%, color-mix(in oklch, var(--coach) 9%, transparent), transparent 70%), var(--bg)`,
      color: 'var(--text)',
    }}>
      <div className="flex items-center justify-between">
        <p className="qi-caption font-medium text-muted">{theme === 'dark' ? 'Dark' : 'Light'}</p>
        <span className="inline-flex items-center gap-1.5 qi-caption font-medium"><ListeningMark />Listening</span>
      </div>
      <Prose size="lead" as="p" className="mt-3">This week you talked most with Sam, mostly about <mark>the launch</mark>.</Prose>
      <div className="mt-3 flex flex-wrap gap-2">
        <KindChip kind="person">Sam</KindChip><KindChip kind="topic">Launch</KindChip><KindChip kind="habit">Filler words</KindChip><KindChip kind="promise">Send the deck</KindChip>
      </div>
      <Panel padding="list" className="mt-4">
        <List label={`Recent, ${theme}`} animate={false}>
          <ListRow key="a" href="/conversations" leading={<Avatar name="Sam Ortiz" size="sm" />} title="Launch timeline with Sam" meta="Today, 14 minutes" trailing={<StatusWord tone="moment">Try this next</StatusWord>} />
          <ListRow key="b" href="/conversations" leading={<Avatar name="Priya Shah" size="sm" />} title="One-to-one with Priya" meta="Monday, 31 minutes" trailing={<Sparkline values={[6, 5, 7, 4, 3, 2]} tone="habit" label="Fewer filler words" draw={false} />} />
        </List>
      </Panel>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="small">Rehearse</Button>
        <Button size="small">Open debrief</Button>
        <Button variant="danger" size="small">Delete</Button>
      </div>
    </div>
  );
}
