/** Unit tests for the Settings page's data shaping. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PATTERN_ORDER } from '../bus/patterns.ts';
import {
  ago, appMeta, batteryWords, BUZZ_GROUPS, buzzResult, groupCode, motionPhase, pairedPhones, parseBandStatus,
  phoneState, plainError, sortApps, typedAddress,
} from './settings-model.ts';
import type { AppInfo, DeviceInfo } from './types';

const NOW = 1_700_000_000_000;
const sec = NOW / 1000;
const device = (extra: Partial<DeviceInfo>): DeviceInfo => ({ device_id: 'd', name: 'iPhone', connected: false, paired: false, last_seen: null, ...extra });
const app = (extra: Partial<AppInfo>): AppInfo => ({ app_id: 'a', name: 'Slides', origin: null, status: 'pending', created_at: sec - 60, last_used: null, buzzes: 0, ...extra });

describe('band status', () => {
  test('keeps the plain fields and drops the transport', () => {
    const s = parseBandStatus({ type: 'band.status', connected: true, transport: 'sim', battery_pct: 87.4, mic_on: false, always_on: true });
    assert.deepEqual(s, { connected: true, mic_on: false, battery_pct: 87, always_on: true });
  });
  test('a missing battery is null and always_on defaults to false', () => {
    assert.deepEqual(parseBandStatus({ connected: false, mic_on: false }), { connected: false, mic_on: false, battery_pct: null, always_on: false });
  });
  test('rejects a body that is not a band status', () => {
    assert.equal(parseBandStatus({ detail: 'Not Found' }), null);
    assert.equal(parseBandStatus(null), null);
  });
  test('battery reads as a word plus number', () => {
    assert.deepEqual(batteryWords(95), { word: 'Full, 95%', tone: 'good' });
    assert.deepEqual(batteryWords(55), { word: 'Good, 55%', tone: 'good' });
    assert.equal(batteryWords(25).tone, 'low');
    assert.equal(batteryWords(9).tone, 'empty');
    assert.deepEqual(batteryWords(null), { word: 'Not reported', tone: 'unknown' });
  });
});

describe('phones', () => {
  test('an unclaimed pairing is not a phone', () => {
    assert.equal(pairedPhones([device({ device_id: 'x' })]).length, 0);
    assert.equal(phoneState([device({})]), 'none');
  });
  test('connected beats paired, and connected phones come first', () => {
    const list = [device({ device_id: 'a', paired: true, last_seen: 5 }), device({ device_id: 'b', paired: true, connected: true })];
    assert.equal(phoneState(list), 'connected');
    assert.equal(pairedPhones(list)[0].device_id, 'b');
    assert.equal(phoneState([device({ paired: true })]), 'paired');
  });
  test('code and address are readable', () => {
    assert.equal(groupCode('k7m2qx'), 'K7M 2QX');
    assert.equal(typedAddress('http://172.20.10.2:8000/'), '172.20.10.2:8000');
  });
});

describe('time and apps', () => {
  test('ago speaks in words', () => {
    assert.equal(ago(null, NOW), null);
    assert.equal(ago(sec - 30, NOW), 'just now');
    assert.equal(ago(sec - 600, NOW), '10 minutes ago');
    assert.equal(ago(sec - 3600, NOW), 'an hour ago');
    assert.equal(ago(sec - 86400, NOW), 'yesterday');
    assert.equal(ago(sec - 86400 * 4, NOW), '4 days ago');
  });
  test('pending first, revoked hidden, approved by last use', () => {
    const { pending, approved } = sortApps([
      app({ app_id: 'r', status: 'revoked' }),
      app({ app_id: 'old', status: 'approved', last_used: 1 }),
      app({ app_id: 'p' }),
      app({ app_id: 'new', status: 'approved', last_used: 9 }),
    ]);
    assert.deepEqual(pending.map((a) => a.app_id), ['p']);
    assert.deepEqual(approved.map((a) => a.app_id), ['new', 'old']);
  });
  test('app meta says when it asked or last buzzed', () => {
    assert.equal(appMeta(app({ created_at: sec - 600 }), NOW), 'Asked 10 minutes ago');
    assert.equal(appMeta(app({ status: 'approved' }), NOW), 'Has not buzzed you yet');
    assert.equal(appMeta(app({ status: 'approved', last_used: sec - 30 }), NOW), 'Last buzzed you just now');
  });
});

describe('buzzes', () => {
  test('every pattern has exactly one plain row and no id leaks into a title', () => {
    const rows = BUZZ_GROUPS.flatMap((g) => g.rows);
    assert.deepEqual(rows.map((r) => r.pattern).sort(), [...PATTERN_ORDER].sort());
    for (const r of rows) assert.doesNotMatch(r.title, /_/);
  });
  test('the toast says whether a phone got it', () => {
    assert.deepEqual(buzzResult(1), { ok: true, text: 'Sent to your phone' });
    assert.deepEqual(buzzResult(0), { ok: false, text: 'No phone is connected' });
    assert.equal(buzzResult(2).text, 'Sent to your 2 phones');
  });
});

describe('calibration and errors', () => {
  test('the movement phases count down five seconds each', () => {
    assert.deepEqual(motionPhase(0), { index: 0, secondsLeft: 5, finishing: false });
    assert.deepEqual(motionPhase(4200), { index: 0, secondsLeft: 1, finishing: false });
    assert.deepEqual(motionPhase(5000), { index: 1, secondsLeft: 5, finishing: false });
    assert.deepEqual(motionPhase(14_999), { index: 2, secondsLeft: 1, finishing: false });
    assert.equal(motionPhase(15_000).finishing, true);
  });
  test('errors lose the address and path but keep the reason', () => {
    const e = Object.assign(new Error('The backend at http://localhost:8819 answered /devices/x with: unknown device'), { status: 404 });
    assert.equal(plainError(e), 'Unknown device.');
    assert.match(plainError(Object.assign(new Error('Cannot reach the backend at http://x'), { status: 0 })), /can’t reach/);
    assert.match(plainError(Object.assign(new Error('x with: only the paired phone'), { status: 403 })), /Only this laptop/);
    assert.equal(plainError(Object.assign(new Error('x with: HTTP 500'), { status: 500 })), 'That didn’t work. Try again.');
  });
});
