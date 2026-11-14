'use client';

import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Bookmark, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Button, Dialog, DialogClose, Disclosure, EmptyState, ICON, InlineStat, Input, List, ListRow, Menu, Page,
  PatternMark, Prose, Section, SegmentedControl, Skeleton, SkeletonLines, Sparkline, StatusWord, Tabs, TextLink,
  Textarea, ThemeToggle, Tooltip, toast,
} from '@/components/ui';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/lib/bus/patterns';
import { motionPresets } from '@/lib/motion';
import { TokenSwatches } from './tokens';

const TYPE_SCALE = [
  { name: 'Display, 32/38, 500', cls: 'qi-display', sample: 'Conversations' },
  { name: 'Title, 22/28, 500', cls: 'qi-title', sample: 'Tuesday with Sam' },
  { name: 'Lead, 17/26, 400', cls: 'qi-lead', sample: 'You spoke for 12 minutes and asked four questions.' },
  { name: 'Body, 15/24, 400 and 500', cls: 'qi-body', sample: 'The band heard this at 9:40 in the morning. Nudges reached your phone twice.' },
  { name: 'Caption, 13/18, 400 and 500', cls: 'qi-caption', sample: 'Yesterday, 9:40, 14 minutes' },
];

const SPACE = [4, 8, 12, 16, 24, 32, 48, 64];

export function Styleguide() {
  return (
    <Page
      title="Quiet Ink"
      lede="Every token and primitive the site is built from. Dev only; DESIGN.md says when to use each."
      action={<ThemeToggle />}
      width="wide"
    >
      <Section title="Colour, both themes" rule={false}>
        <div className="grid gap-4 md:grid-cols-2">
          <TokenSwatches theme="dark" />
          <TokenSwatches theme="light" />
        </div>
      </Section>

      <Section title="The same page in both themes">
        <div className="grid gap-4 md:grid-cols-2">
          <Specimen theme="dark" />
          <Specimen theme="light" />
        </div>
      </Section>

      <Reading>
        <Section title="Type: Inter for facts and controls">
          <div className="grid gap-5">
            {TYPE_SCALE.map((t) => (
              <div key={t.name}>
                <p className="qi-caption text-muted">{t.name}</p>
                <p className={t.cls}>{t.sample}</p>
              </div>
            ))}
            <p className="qi-body">Numbers sit in sentences with tabular figures: 9:40, 12 minutes, 1,204 words.</p>
          </div>
        </Section>

        <Section title="Type: Newsreader for the coach's voice">
          <div className="grid gap-6">
            <Prose size="display" as="p">You mostly talked with Sam this week, about the launch.</Prose>
            <Prose size="lead" as="p">Next time Sam pushes back, <mark>let the pause sit for two seconds</mark> before you answer.</Prose>
            <Prose size="body">
              <p>You opened well and asked Sam what worried him most. Halfway through, when the budget came up, your answers got longer and you started to talk over the ends of his sentences.</p>
              <p>The nudge at 14 minutes worked: you slowed down and the next exchange was even.</p>
            </Prose>
          </div>
        </Section>

        <Section title="Space: 4 px base">
          <ul className="grid gap-2">
            {SPACE.map((s) => (
              <li key={s} className="grid grid-cols-[40px_1fr] items-center gap-3">
                <span className="qi-caption tabular text-muted">{s}</span>
                <span className="block h-2 rounded-[2px] bg-line-strong" style={{ width: s * 4 }} aria-hidden />
              </li>
            ))}
          </ul>
          <p className="qi-caption mt-4 text-muted">8 inside a group, 16 between related groups, 48 (64 from 640 px) between sections. Radius 6 on controls, 8 on floating layers.</p>
        </Section>

        <ButtonsSection />
        <FieldsSection />
        <ListSection />
        <FeedbackSection />
        <DisclosureSection />
        <MarksSection />
        <MotionSection />
      </Reading>
    </Page>
  );
}

function Reading({ children }: { children: ReactNode }) {
  return <div className="max-w-[var(--col-reading)]">{children}</div>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[120px_1fr] sm:items-center sm:gap-6">
      <p className="qi-caption text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
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
      <Row label="Primary"><Button variant="primary" onClick={save} loading={saving}>Save coach</Button><Button variant="primary" disabled>Save coach</Button><Button variant="primary" loading>Save coach</Button></Row>
      <Row label="Quiet"><Button>Rehearse</Button><Button disabled>Rehearse</Button><Button size="small">Test buzz</Button></Row>
      <Row label="Ghost"><Button variant="ghost">Skip</Button><Tooltip content="Bookmark this moment"><Button variant="ghost" iconOnly aria-label="Bookmark this moment"><Bookmark {...ICON} aria-hidden /></Button></Tooltip></Row>
      <Row label="Danger"><Button variant="danger">Forget this band</Button><Button variant="danger" size="small">Delete</Button></Row>
      <Row label="Link"><Button href="/conversations">Open conversations</Button></Row>
      <Row label="Text link"><span className="qi-body">Read the <TextLink href="/conversations">full debrief</TextLink>, or see <TextLink href="/conversations" tone="muted">all conversations</TextLink>.</span></Row>
      <p className="qi-caption pt-2 text-muted">Press Tab to see focus rings. Hover changes only colour; press scales to 0.97.</p>
    </Section>
  );
}

function FieldsSection() {
  return (
    <Section title="Inputs">
      <div className="grid gap-6">
        <Input label="Band name" placeholder="Left wrist" hint="Shown on your phone when it buzzes." />
        <Input label="Phone pairing code" defaultValue="48 21" error="That code has expired. Show a new one on the phone and try again." />
        <Input label="Server address" defaultValue="http://192.168.1.20:8000" disabled />
        <Textarea label="What do you want to get better at?" placeholder="Stop saying “like” when I’m nervous in interviews" />
      </div>
    </Section>
  );
}

function ListSection() {
  const [current, setCurrent] = useState('sam');
  const rowMenu = (who: string) => (
    <Menu
      label={`Actions for the conversation with ${who}`}
      actions={[
        { label: 'Rename', onSelect: () => toast('Rename opened') },
        { label: 'Download audio', onSelect: () => toast('Download started') },
        { label: 'Delete', danger: true, onSelect: () => toast.error('Deleted (demo)') },
      ]}
    />
  );
  return (
    <Section title="List rows" aside={<TextLink href="/conversations" tone="muted">All conversations</TextLink>}>
      <List label="Recent conversations">
        <ListRow key="sam" href="/conversations" leading="9:40" title="Launch timeline with Sam" meta="Today, 14 minutes" trailing={<><StatusWord tone="moment">Try this next</StatusWord>{rowMenu('Sam')}</>} />
        <ListRow key="priya" href="/conversations" leading="Mon" title="Weekly one-to-one with Priya" meta="Monday, 31 minutes" trailing={<><Sparkline values={[6, 5, 7, 4, 3, 3, 2]} label="Fewer filler words over the week" />{rowMenu('Priya')}</>} />
        <ListRow key="long" href="/conversations" leading="Sun" title="Dinner with the family, which ran long and wandered from the trip to the house move and back again" meta="Sunday, 1 hour 12 minutes" trailing={rowMenu('the family')} />
      </List>
      <div className="mt-8">
        <p className="qi-caption mb-2 text-muted">Selectable rows (onSelect, current)</p>
        <List label="Coaches">
          {['sam', 'interview', 'listener'].map((id) => (
            <ListRow key={id} onSelect={() => setCurrent(id)} current={current === id}
              title={{ sam: 'Your coach', interview: 'Interview coach', listener: 'Listener coach' }[id]}
              meta={{ sam: 'Built from your last ten conversations', interview: 'Short, structured answers', listener: 'Talk less, ask more' }[id]}
              trailing={current === id ? <StatusWord tone="quiet">In use</StatusWord> : null} />
          ))}
        </List>
      </div>
    </Section>
  );
}

function FeedbackSection() {
  const [minutes, setMinutes] = useState(12);
  return (
    <Section title="Numbers, states and feedback">
      <Row label="Inline stat">
        <p className="qi-lead">You spoke for <InlineStat value={minutes} suffix=" minutes" /> and asked <InlineStat value={4} /> questions.</p>
        <Button size="small" onClick={() => setMinutes((v) => v + 3)}>Add 3</Button>
      </Row>
      <Row label="Status word">
        <StatusWord>Listening</StatusWord><StatusWord tone="quiet">Not listening</StatusWord><StatusWord tone="moment">Your moment</StatusWord><StatusWord tone="warn">Battery low</StatusWord><StatusWord tone="error">Couldn’t reach the band</StatusWord>
      </Row>
      <Row label="Toast">
        <Button size="small" onClick={() => toast('Test buzz sent')}>Send test buzz</Button>
        <Button size="small" onClick={() => toast.error('Couldn’t reach your phone. Check it is unlocked.')}>Show an error</Button>
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
      <div className="pt-3">
        <p className="qi-caption mb-1 text-muted">Empty state</p>
        <EmptyState action={<Button href="/settings">Pair your band</Button>}>Your conversations show up here after the band hears one.</EmptyState>
      </div>
      <div className="grid gap-2 pt-3">
        <p className="qi-caption text-muted">Skeleton</p>
        <SkeletonLines lines={3} label="Loading the debrief" />
        <Skeleton shape="block" height={48} width="40%" />
      </div>
    </Section>
  );
}

function DisclosureSection() {
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  return (
    <Section title="Disclosure, tabs and segments">
      <Disclosure summary="How Undertone counts filler words">
        <p className="qi-body text-muted">It counts “um”, “uh”, “like” and “you know” when they stand alone, not when they carry meaning. It only counts what you said, never the other person.</p>
      </Disclosure>
      <div className="mt-8">
        <Tabs label="Conversation views" items={[
          { value: 'debrief', label: 'Debrief', content: <Prose as="p">You held your ground without raising your voice.</Prose> },
          { value: 'transcript', label: 'Transcript', content: <p className="qi-body">Sam: Can we move the launch? You: Let’s look at what moves with it.</p> },
          { value: 'audio', label: 'Audio', content: <p className="qi-body text-muted">The recording plays here.</p> },
        ]} />
      </div>
      <div className="mt-8">
        <SegmentedControl label="Time range" value={range} onValueChange={setRange}
          options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      </div>
    </Section>
  );
}

function MarksSection() {
  const [plays, setPlays] = useState<Record<string, number>>({});
  const nudges = PATTERN_ORDER.filter((p) => PATTERNS[p].group === 'nudge');
  return (
    <Section title="Marks: patterns and trends">
      <ul className="grid gap-1">
        {nudges.map((p: HapticPattern) => (
          <li key={p} className="flex min-h-11 items-center justify-between gap-4">
            <span className="qi-body"><PatternMark pattern={p} playKey={plays[p]} /></span>
            <span className="flex items-center gap-3">
              <span className="qi-caption text-muted">{PATTERNS[p].feel}</span>
              <Button size="small" variant="ghost" onClick={() => setPlays((s) => ({ ...s, [p]: (s[p] ?? 0) + 1 }))}>Play</Button>
            </span>
          </li>
        ))}
      </ul>
      <p className="qi-body mt-4">In your moment the mark takes the accent: <span className="text-accent"><PatternMark pattern="slow_down" /></span></p>
      <p className="qi-body mt-4">Filler words went from 6 to 2 a minute <Sparkline values={[6, 5, 5, 4, 3, 3, 2]} label="Filler words fell from 6 to 2 a minute" /> over the last two weeks.</p>
    </Section>
  );
}

function MotionSection() {
  const [shown, setShown] = useState(true);
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  return (
    <Section title="Motion">
      <p className="qi-body text-muted">150 to 250 ms, transform and opacity only, exits faster than entries. With reduced motion, movement becomes a short fade.</p>
      <div className="mt-4 flex min-h-24 items-start gap-4">
        <Button size="small" onClick={() => setShown((s) => !s)}>{shown ? 'Dismiss' : 'Show'} the nudge</Button>
        <AnimatePresence initial={false}>
          {shown ? (
            <m.div key="nudge" variants={presets.enter} initial="hidden" animate="shown" exit="gone"
              className="flex items-center gap-3 rounded-[8px] border border-line bg-surface px-4 py-3">
              <span className="qi-body text-accent"><PatternMark pattern="interrupt" /></span>
              <Button variant="ghost" size="small" iconOnly aria-label="Dismiss" onClick={() => setShown(false)}><X {...ICON} size={16} aria-hidden /></Button>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Section>
  );
}

/** A miniature page rendered inside one theme, so both can be judged side by side. */
function Specimen({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div data-theme={theme} className="rounded-[8px] border border-line bg-bg p-5 text-fg">
      <p className="qi-caption text-muted">Home</p>
      <Prose size="lead" as="p" className="mt-2">This week you talked most with <mark>Sam</mark>, mostly about the launch.</Prose>
      <div className="qi-section" style={{ marginTop: 24 }}>
        <div className="qi-section-head"><h3 className="qi-section-title">Recent</h3></div>
        <List label={`Recent, ${theme}`}>
          <ListRow key="a" href="/conversations" title="Launch timeline with Sam" meta="Today, 14 minutes" trailing={<StatusWord tone="moment">Try this next</StatusWord>} />
          <ListRow key="b" href="/conversations" title="One-to-one with Priya" meta="Monday, 31 minutes" />
        </List>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" size="small">Rehearse</Button>
        <Button size="small">Open debrief</Button>
        <Button variant="danger" size="small">Delete</Button>
      </div>
    </div>
  );
}
