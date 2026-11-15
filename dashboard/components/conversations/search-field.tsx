'use client';

import { Search, X } from 'lucide-react';
import { ICON } from '@/components/ui';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Spoken name of the field; the placeholder is only an example. */
  label: string;
  placeholder?: string;
}

/**
 * A search box: the Lamplight input with a leading magnifier and a clear button. The label is
 * spoken (a visible "Search" label above a search box only repeats the icon). Escape clears it.
 * Missing from components/ui, so it lives here.
 */
export function SearchField({ value, onChange, label, placeholder }: SearchFieldProps) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search {...ICON} size={16} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search" value={value} aria-label={label} placeholder={placeholder} autoComplete="off" spellCheck={false}
        className="qi-input pl-10 pr-11 [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }}
      />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="Clear the search"
          className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-control text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
          <X {...ICON} size={16} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
