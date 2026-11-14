/**
 * Undertone Haptics SDK. Lets any web page buzz the wearer's paired iPhone through the
 * Undertone backend (the iPhone web cannot vibrate by itself).
 *
 *   <script src="http://<laptop>:8000/sdk/undertone-haptics.js"></script>
 *   const ut = await Undertone.connect({ server: 'http://<laptop>:8000', appName: 'Slide timer' });
 *   const r = await ut.buzz('wrap_up', { label: '2 minutes left' });   // or Undertone.buzz(...)
 *   // r = { ok: true, delivered: 1 }                    a phone got it
 *   //     { ok: false, status: 403, reason: 'pending' } waiting for approval on the phone
 *
 * connect() registers the app once (POST /v1/apps) and keeps the app key in localStorage.
 * The wearer approves the app on the phone; until then buzz() resolves with reason 'pending'.
 *
 * Patterns: tap, interrupt, filler, wrap_up, slow_down, still, success, approve,
 *           status_good, status_talking, status_ask.
 */
(function (root) {
  'use strict';

  var PATTERNS = ['tap', 'interrupt', 'filler', 'wrap_up', 'slow_down', 'still', 'success', 'approve',
    'status_good', 'status_talking', 'status_ask'];
  var REASONS = { 400: 'bad_request', 401: 'unauthorized', 403: 'pending' };
  var current = null;

  function storageKey(server, appName) { return 'undertone:' + server + ':' + appName; }

  function load(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function save(key, value) {
    try {
      if (value) root.localStorage.setItem(key, JSON.stringify(value));
      else root.localStorage.removeItem(key);
    } catch (e) { /* private mode: the key lives for this page only */ }
  }

  function Client(server, appName, creds) {
    this.server = server;
    this.appName = appName;
    this.appId = creds.app_id;
    this._key = creds.app_key;
  }

  /** Buzz the phone. Never throws: resolves with { ok, delivered } or { ok: false, status, reason }. */
  Client.prototype.buzz = function (pattern, opts) {
    opts = opts || {};
    if (PATTERNS.indexOf(pattern) === -1) {
      return Promise.resolve({ ok: false, status: 400, reason: 'unknown_pattern' });
    }
    var self = this;
    var body = { pattern: pattern, label: opts.label || '' };
    if (typeof opts.intensity === 'number') body.intensity = Math.max(0, Math.min(1, opts.intensity));
    return fetch(this.server + '/v1/haptics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._key },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.ok) return res.json();
      if (res.status === 401) save(storageKey(self.server, self.appName), null); // removed on the phone: re-register next time
      return { ok: false, status: res.status, reason: REASONS[res.status] || 'error' };
    }).catch(function () {
      return { ok: false, status: 0, reason: 'unreachable' };
    });
  };

  /** Forget this app on this browser (the phone's Connected apps screen removes it for real). */
  Client.prototype.forget = function () { save(storageKey(this.server, this.appName), null); };

  var Undertone = {
    patterns: PATTERNS.slice(),

    /** Register (or reuse) this app with an Undertone backend. Rejects if the server cannot be reached. */
    connect: function (opts) {
      opts = opts || {};
      var server = String(opts.server || root.location.origin).replace(/\/+$/, '');
      var appName = String(opts.appName || root.document.title || 'Web app').slice(0, 60);
      var key = storageKey(server, appName);
      var saved = load(key);
      if (saved && saved.app_id && saved.app_key) {
        current = new Client(server, appName, saved);
        return Promise.resolve(current);
      }
      return fetch(server + '/v1/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: appName })
      }).then(function (res) {
        if (!res.ok) throw new Error('Undertone: could not register (' + res.status + ')');
        return res.json();
      }).then(function (creds) {
        save(key, { app_id: creds.app_id, app_key: creds.app_key });
        current = new Client(server, appName, creds);
        return current;
      });
    },

    /** Buzz through the last connect()ed client. */
    buzz: function (pattern, opts) {
      if (!current) return Promise.resolve({ ok: false, status: 0, reason: 'not_connected' });
      return current.buzz(pattern, opts);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Undertone;
  else root.Undertone = Undertone;
})(typeof window !== 'undefined' ? window : globalThis);
