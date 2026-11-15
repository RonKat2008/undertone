'use client';

/**
 * "Who was this with?": pick someone you have talked with before or type a new name.
 * POST /sessions/{id}/person. Picking a person saves at once; a toast confirms or says it failed.
 */
import { Plus } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Avatar, Button, Dialog, DialogClose, ICON, Input, toast } from '@/components/ui';
import { tagPerson, type PersonPick } from '@/lib/api/conversation';
import type { Person } from '@/lib/bus/contracts';
import { isNewName, matchPeople } from '@/lib/conversations/display';

interface PersonDialogProps {
  sessionId: string;
  people: readonly Person[];
  currentId: string | null;
  trigger: ReactElement;
  onTagged: (person: Person) => void;
}

const MAX_NAME = 80;
const SHOWN = 6;

export function PersonDialog({ sessionId, people, currentId, trigger, onTagged }: PersonDialogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const matches = matchPeople(people, query).slice(0, SHOWN);
  const typed = query.trim();
  const canAdd = isNewName(people, typed) && typed.length <= MAX_NAME;

  async function choose(pick: PersonPick) {
    setBusy(pick.person_id ?? 'new');
    try {
      const person = await tagPerson(sessionId, pick);
      onTagged(person);
      toast(`Tagged ${person.name}`);
      setOpen(false);
      setQuery('');
    } catch {
      toast.error('Couldn’t save who this was with. Try once more.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}
      trigger={trigger}
      title="Who was this with?"
      description="It links this conversation to them, so their page shows how your talks go."
      actions={(
        <>
          <DialogClose><Button>Cancel</Button></DialogClose>
          <Button variant="primary" disabled={!canAdd} loading={busy === 'new'} onClick={() => void choose({ name: typed })}>
            {typed && canAdd ? `Add ${typed.length > 18 ? `${typed.slice(0, 17)}…` : typed}` : 'Add'}
          </Button>
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (matches[0] && !canAdd) void choose({ name: matches[0].name, person_id: matches[0].person_id }); else if (canAdd) void choose({ name: typed }); }}>
        <Input label="Name" placeholder="Sam" value={query} maxLength={MAX_NAME} autoFocus autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          hint={people.length ? 'Pick someone below, or type a new name.' : 'Type their name.'} />
      </form>
      {matches.length > 0 ? (
        <ul className="mt-3 grid gap-1" aria-label="People">
          {matches.map((p) => (
            <li key={p.person_id}>
              <button type="button" disabled={busy !== null} onClick={() => void choose({ name: p.name, person_id: p.person_id })}
                aria-current={p.person_id === currentId ? 'true' : undefined}
                className="flex min-h-11 w-full items-center gap-3 rounded-control px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 aria-[current=true]:bg-[var(--accent-wash)]">
                <Avatar name={p.name} size="sm" />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {p.person_id === currentId ? <span className="text-caption text-accent">Tagged</span> : null}
                {busy === p.person_id ? <span className="qi-spinner text-muted" aria-label="Saving" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : typed ? (
        <p className="mt-3 flex items-center gap-2 text-caption text-muted"><Plus {...ICON} size={14} aria-hidden />No one by that name yet. Add them as someone new.</p>
      ) : null}
    </Dialog>
  );
}
