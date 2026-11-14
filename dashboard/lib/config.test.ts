/** Unit tests for choosing the backend address. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultBusUrl, normaliseBusUrl, resolveBusUrl } from './config.ts';

describe('backend address', () => {
  test('with nothing set, it is the page host on port 8000', () => {
    assert.equal(resolveBusUrl({ hostname: 'localhost' }), 'http://localhost:8000');
    assert.equal(resolveBusUrl({ hostname: '192.168.1.20' }), 'http://192.168.1.20:8000');
    assert.equal(resolveBusUrl({}), 'http://localhost:8000');
    assert.equal(defaultBusUrl(''), 'http://localhost:8000');
  });

  test('NEXT_PUBLIC_BUS_URL beats the page host', () => {
    assert.equal(resolveBusUrl({ env: 'http://10.0.0.5:9000/', hostname: 'localhost' }), 'http://10.0.0.5:9000');
  });

  test('?bus= beats everything, then the value remembered for the tab', () => {
    assert.equal(resolveBusUrl({ query: 'http://h:1', stored: 'http://s:2', env: 'http://e:3', hostname: 'x' }), 'http://h:1');
    assert.equal(resolveBusUrl({ stored: 'http://s:2', env: 'http://e:3', hostname: 'x' }), 'http://s:2');
  });

  test('the old mock switch is gone: ?bus=mock, ?bus=live and junk fall through to the default', () => {
    for (const v of ['mock', 'live', '', '   ', 'not a url', 'javascript:alert(1)']) {
      assert.equal(resolveBusUrl({ query: v, stored: v, hostname: 'laptop.local' }), 'http://laptop.local:8000', v);
    }
  });

  test('normalises ws and trailing slashes', () => {
    assert.equal(normaliseBusUrl('ws://h:8000/ws'), 'http://h:8000');
    assert.equal(normaliseBusUrl('wss://h/ws/'), 'https://h');
    assert.equal(normaliseBusUrl('http://h:8000///'), 'http://h:8000');
    assert.equal(normaliseBusUrl(null), undefined);
  });
});
