'use client';

import { Menu } from '@base-ui/react/menu';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { ICON } from '@/components/ui';
import {
  RELATIONSHIP_CHOICES, relationshipLabel, relationshipWord, type RelationshipKind, type RelationshipSource,
} from '@/lib/api/reports-model';

export interface RelationshipPickerProps {
  name: string;
  kind: RelationshipKind | null;
  confidence: number | null;
  source: RelationshipSource | null;
  busy: boolean;
  onPick: (kind: Exclude<RelationshipKind, 'unknown'>) => void;
  onAuto: () => void;
}

/**
 * Who this person is to you, said in a word, and a way to correct it in place. The menu lists
 * the kinds and, last, "Let Undertone decide", which drops your label and goes back to its guess.
 */
export function RelationshipPicker({ name, kind, confidence, source, busy, onPick, onAuto }: RelationshipPickerProps) {
  const word = relationshipWord(kind, confidence, source);
  const userSet = source === 'user' && kind !== null && kind !== 'unknown';
  return (
    <Menu.Root>
      <Menu.Trigger
        className="qi-chip min-h-11 cursor-pointer border-0 px-3 font-medium outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-busy:opacity-60"
        data-kind="person" aria-busy={busy || undefined}
        aria-label={word ? `${name} is ${word.toLowerCase()}. Change` : `Say who ${name} is to you`}>
        {word ?? 'Who is this to you?'}
        <ChevronDown {...ICON} size={14} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-50">
          <Menu.Popup className="qi-float qi-menu max-h-[min(420px,70dvh)] overflow-y-auto">
            <Menu.RadioGroup value={userSet ? kind : null} onValueChange={(v) => onPick(v as Exclude<RelationshipKind, 'unknown'>)}>
              {RELATIONSHIP_CHOICES.map((k) => (
                <Menu.RadioItem key={k} value={k} className="qi-menu-item" closeOnClick>
                  <span className="grid w-4 place-items-center">
                    <Menu.RadioItemIndicator><Check {...ICON} size={15} aria-hidden /></Menu.RadioItemIndicator>
                  </span>
                  {relationshipLabel(k)}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="qi-menu-separator" />
            <Menu.Item className="qi-menu-item" onClick={onAuto} disabled={!userSet}>
              <Sparkles {...ICON} size={15} aria-hidden />Let Undertone decide
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
