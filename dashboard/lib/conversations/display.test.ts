/** Unit tests for the plain-words display helpers. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dayHeading, fillersFor, fillerWords, flaggedMoments, hiddenReason, isNewName, lengthLabel, matchPeople, outOfView,
  paceWords, paceZone, questionsWords, shouldFollow, shownHeadline, talkShareWords, transcriptRows, turnPieces, whenLabel,
} from './display.ts';
import type { TranscriptTurn } from './types';

const turn = (start: number, extra: Partial<TranscriptTurn> = {}): TranscriptTurn =>
  ({ turn_id: `t${start}`, speaker: 'me', text: 'hello', start, end: start + 2, wpm: 150, fillers: [], ...extra });

describe('hidden reasons', () => {
  test('plain words for each reason', () => {
    assert.equal(hiddenReason({ kept: false, kept_reason: 'trivial' }), 'Too short');
    assert.equal(hiddenReason({ kept: false, kept_reason: 'noise' }), 'Just noise');
    assert.equal(hiddenReason({ kept: false, kept_reason: 'sensitive' }), 'Private');
    assert.equal(hiddenReason({ kept: false, kept_reason: null }), 'Hidden by you');
    assert.equal(hiddenReason({ kept: true, kept_reason: 'keep' }), null);
  });
});

describe('when and how long', () => {
  test('day headings and when', () => {
    assert.equal(dayHeading('2026-11-14', '2026-11-14'), 'Today');
    assert.equal(dayHeading('2026-11-11', '2026-11-14'), 'Wednesday 11 November');
    assert.equal(whenLabel('2026-11-13T11:30:00Z', '2026-11-14T10:00:00Z', 0), 'Yesterday, 11:30');
    assert.equal(whenLabel('2026-11-10T09:05:00Z', '2026-11-14T10:00:00Z', 0), 'Tuesday 10 November, 09:05');
  });
  test('length', () => {
    assert.equal(lengthLabel(40), '40 sec');
    assert.equal(lengthLabel(0.3), '1 sec');
    assert.equal(lengthLabel(660), '11 min');
    assert.equal(lengthLabel(3900), '1 h 5 min');
    assert.equal(lengthLabel(3600), '1 h');
    assert.equal(lengthLabel(null), null);
    assert.equal(lengthLabel(0), null);
  });
  test('headline placeholder is not a headline', () => {
    assert.equal(shownHeadline('(in progress)'), null);
    assert.equal(shownHeadline('  '), null);
    assert.equal(shownHeadline('You asked 3 questions'), 'You asked 3 questions');
  });
});

describe('transcript rows', () => {
  test('time at speaker changes and after long gaps only', () => {
    const rows = transcriptRows([
      turn(0), turn(3), turn(40), turn(43, { speaker: 'other' }), turn(46, { speaker: 'other' }),
    ]);
    assert.deepEqual(rows.map((r) => r.showTime), [true, false, true, true, false]);
    assert.deepEqual(rows.map((r) => r.newSpeaker), [true, false, false, true, false]);
    assert.deepEqual(transcriptRows([]), []);
  });
  test('fillers: yours only, falling back to hesitation sounds', () => {
    assert.deepEqual(fillersFor({ speaker: 'other', fillers: ['um'] }), []);
    assert.deepEqual(fillersFor({ speaker: 'me', fillers: ['like'] }), ['like']);
    assert.ok(fillersFor({ speaker: 'me', fillers: [] }).includes('um'));
  });
});

describe('flagged moments', () => {
  const turns = [
    turn(0, { text: 'Uh, my brother finally moved to Seattle.' }),
    turn(10, { speaker: 'other', text: 'Nice.' }),
    turn(20, { text: 'What are you reading right now?' }),
  ];
  test('bookmarks by snippet, then by time; best moment; one per turn', () => {
    const flags = flaggedMoments(turns, {
      best_moment_quote: '“what are you reading right now?”',
      bookmarks: [
        { ts: 99, source: 'phone', snippet: 'My brother finally moved', what_happened: 'You tapped here.', follow_up: 'Ask about the move' },
        { ts: 11, source: 'promise', snippet: 'not in the text', what_happened: '', follow_up: null },
      ],
    });
    assert.deepEqual(flags.map((f) => f.turnIndex), [0, 1, 2]);
    assert.equal(flags[0].phrase, 'my brother finally moved');
    assert.equal(flags[0].why, 'You tapped here. Follow up: Ask about the move');
    assert.equal(flags[1].phrase, null);
    assert.equal(flags[1].why, 'You made a promise here.');
    assert.equal(flags[2].phrase, 'What are you reading right now?');
    assert.deepEqual(flaggedMoments(turns, null), []);
    assert.deepEqual(flaggedMoments([], { bookmarks: [], best_moment_quote: 'x' }), []);
  });
  test('pieces keep every character and mark fillers inside and outside the flag', () => {
    const text = 'Uh, my brother finally moved to Seattle.';
    const pieces = turnPieces(text, ['uh'], 'my brother finally moved');
    assert.equal(pieces.map((p) => p.text).join(''), text);
    assert.deepEqual(pieces.filter((p) => p.flagged).map((p) => p.text), ['my brother finally moved']);
    assert.deepEqual(pieces.filter((p) => p.filler).map((p) => p.text), ['Uh']);
    assert.deepEqual(turnPieces('plain', [], 'absent'), [{ text: 'plain', filler: false, flagged: false }]);
  });
});

describe('numbers in sentences', () => {
  test('talk share', () => {
    assert.equal(talkShareWords(0.7, 'Sam'), 'You did most of the talking with Sam.');
    assert.equal(talkShareWords(0.5, 'Priya'), 'You and Priya shared the talking about evenly.');
    assert.equal(talkShareWords(0.4, null), 'They talked a little more than you.');
    assert.equal(talkShareWords(0.2, 'Alex'), 'Alex did most of the talking.');
  });
  test('pace', () => {
    assert.deepEqual(paceZone(null), [130, 170]);
    assert.deepEqual(paceZone(150), [128, 173]);
    assert.match(paceWords(154, 150), /154 words a minute, right in your comfortable range/);
    assert.match(paceWords(180, 150), /a little faster/);
    assert.match(paceWords(220, 150), /quite a bit faster/);
    assert.match(paceWords(100, 150), /slower than usual/);
  });
  test('fillers and questions', () => {
    assert.equal(fillerWords(12, 4.4, 660), 'You used 12 filler words, about 4 a minute.');
    assert.equal(fillerWords(0, 0.5, 120), 'You used one filler word, fewer than one a minute.');
    assert.equal(fillerWords(0, 0, 300), 'You used almost no filler words.');
    assert.equal(questionsWords(4, 1), 'You asked 4 questions and cut in once.');
    assert.equal(questionsWords(0, 3), 'You asked no questions and cut in 3 times.');
    assert.equal(questionsWords(1, 0), 'You asked one question and never cut in.');
  });
});

describe('following playback', () => {
  test('waits after a hand scroll; out-of-view band', () => {
    assert.equal(shouldFollow(1000, 3000), false);
    assert.equal(shouldFollow(1000, 5000), true);
    assert.equal(outOfView({ top: 50, bottom: 90 }, 80, 700), true);
    assert.equal(outOfView({ top: 100, bottom: 200 }, 80, 700), false);
    assert.equal(outOfView({ top: 650, bottom: 720 }, 80, 700), true);
  });
});

describe('people', () => {
  const people = [{ person_id: 'sam', name: 'Sam Ortiz' }, { person_id: 'priya', name: 'Priya' }, { person_id: 'jo', name: 'Jo Samuels' }];
  test('match and new names', () => {
    assert.deepEqual(matchPeople(people, 'sam').map((p) => p.person_id), ['sam', 'jo']);
    assert.deepEqual(matchPeople(people, '').map((p) => p.person_id), ['sam', 'priya', 'jo']);
    assert.equal(isNewName(people, 'priya'), false);
    assert.equal(isNewName(people, 'Pri'), true);
    assert.equal(isNewName(people, '  '), false);
  });
});
