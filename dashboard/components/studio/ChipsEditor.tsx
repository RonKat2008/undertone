'use client';

import React, { useState } from 'react';

interface ChipsEditorProps {
  keyterms: string[];
  fillerWords: string[];
  onChangeKeyterms: (terms: string[]) => void;
  onChangeFillerWords: (words: string[]) => void;
}

export function ChipsEditor({
  keyterms,
  fillerWords,
  onChangeKeyterms,
  onChangeFillerWords
}: ChipsEditorProps) {
  const [newKeyterm, setNewKeyterm] = useState('');
  const [newFiller, setNewFiller] = useState('');

  const handleAddKeyterm = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newKeyterm.trim().toLowerCase();
    if (!clean || keyterms.includes(clean)) return;
    onChangeKeyterms([...keyterms, clean]);
    setNewKeyterm('');
  };

  const handleRemoveKeyterm = (termToRemove: string) => {
    onChangeKeyterms(keyterms.filter(t => t !== termToRemove));
  };

  const handleAddFiller = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFiller.trim().toLowerCase();
    if (!clean || fillerWords.includes(clean)) return;
    onChangeFillerWords([...fillerWords, clean]);
    setNewFiller('');
  };

  const handleRemoveFiller = (wordToRemove: string) => {
    onChangeFillerWords(fillerWords.filter(w => w !== wordToRemove));
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Keyterms Section */}
      <div className="space-y-4">
        <div className="border-b border-hairline pb-2">
          <h4 className="font-serif text-xl text-ink">Anchor Terms & Vocabulary</h4>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Key concepts to listen for. Their presence signals adherence to the goal.
          </p>
        </div>

        <form onSubmit={handleAddKeyterm} className="flex gap-2">
          <input
            type="text"
            value={newKeyterm}
            onChange={(e) => setNewKeyterm(e.target.value)}
            placeholder="Add anchor term (e.g. trade-off)"
            className="flex-1 px-3 py-1.5 font-mono text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={!newKeyterm.trim()}
            className="px-3 py-1.5 font-mono text-xs uppercase tracking-wider bg-ink text-paper hover:bg-ink/80 disabled:opacity-40"
          >
            + Add
          </button>
        </form>

        <div className="flex flex-wrap gap-2 pt-1">
          {keyterms.map((term) => (
            <span
              key={term}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-paper-well border border-hairline font-mono text-xs text-ink"
            >
              <span>{term}</span>
              <button
                type="button"
                onClick={() => handleRemoveKeyterm(term)}
                className="text-ink-mid hover:text-p-interrupt font-mono text-xs leading-none ml-1"
                title={`Remove ${term}`}
              >
                ✕
              </button>
            </span>
          ))}
          {keyterms.length === 0 && (
            <span className="font-sans text-xs text-ink-mid italic">No anchor terms configured.</span>
          )}
        </div>
      </div>

      {/* Filler Words Section */}
      <div className="space-y-4">
        <div className="border-b border-hairline pb-2">
          <h4 className="font-serif text-xl text-ink">Target Filler Words & Hedges</h4>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Underlined in ochre on the transcript score and tracked in rolling fillers/min.
          </p>
        </div>

        <form onSubmit={handleAddFiller} className="flex gap-2">
          <input
            type="text"
            value={newFiller}
            onChange={(e) => setNewFiller(e.target.value)}
            placeholder="Add filler word (e.g. basically)"
            className="flex-1 px-3 py-1.5 font-mono text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={!newFiller.trim()}
            className="px-3 py-1.5 font-mono text-xs uppercase tracking-wider bg-ink text-paper hover:bg-ink/80 disabled:opacity-40"
          >
            + Add
          </button>
        </form>

        <div className="flex flex-wrap gap-2 pt-1">
          {fillerWords.map((word) => (
            <span
              key={word}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-paper-well border border-[oklch(0.75_0.15_85)]/40 font-mono text-xs text-ink"
            >
              <span className="underline decoration-[oklch(0.75_0.15_85)] decoration-1 underline-offset-2">
                {word}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveFiller(word)}
                className="text-ink-mid hover:text-p-interrupt font-mono text-xs leading-none ml-1"
                title={`Remove ${word}`}
              >
                ✕
              </button>
            </span>
          ))}
          {fillerWords.length === 0 && (
            <span className="font-sans text-xs text-ink-mid italic">No filler words registered.</span>
          )}
        </div>
      </div>
    </div>
  );
}
