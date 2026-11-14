/*!
 * Undertone Haptics SDK. One file, no build step.
 *
 *   <script src="undertone-haptics.js"></script>
 *   <script>
 *     const ut = await Undertone.connect({ server: 'http://192.168.1.20:8000', appName: 'Slide timer' });
 *     await ut.buzz('wrap_up', { label: '2 minutes left' });
 *   </script>
 *
 * In a module script: `import './undertone-haptics.js'` then use `globalThis.Undertone`.
 * In Node / bundlers: `const Undertone = require('./undertone-haptics.js')`.
 *
 * What happens: connect() registers the page as an app (POST /v1/apps), the wearer approves
 * it on their phone, and from then on buzz() plays a haptic pattern on that phone through
 * POST /v1/haptics. The app key is kept in localStorage, so approval is asked once per browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Undertone = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PATTERNS = [
    'tap', 'interrupt', 'filler', 'wrap_up', 'slow_down', 'still', 'success', 'approve',
    'status_good', 'status_talking', 'status_ask',
  ];

  function UndertoneError(code, message, status) {
    var err = new Error(message);
    err.name = 'UndertoneError';
    err.code = code; // 'network' | 'pending' | 'revoked' | 'unauthorized' | 'rate_limited' | 'invalid' | 'timeout' | 'http'
    err.status = status || 0;
    return err;
  }

  function store() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function request(server, method, path, body, key) {
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = 'Bearer ' + key;
    return fetch(server + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .catch(function (e) {
        throw UndertoneError('network', 'Cannot reach Undertone at ' + server + ' (' + e.message + ')');
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok) return data;
          var message = (data.error && data.error.message) || data.detail || 'HTTP ' + res.status;
          var code = res.status === 401 ? 'unauthorized'
            : res.status === 403 ? (/revoked/.test(message) ? 'revoked' : 'pending')
            : res.status === 429 ? 'rate_limited'
            : res.status === 422 ? 'invalid' : 'http';
          throw UndertoneError(code, message, res.status);
        });
      });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * @param {{server: string, appName: string, waitForApproval?: boolean, timeoutMs?: number,
   *          onPending?: (app: {app_id: string, name: string}) => void, forget?: boolean}} options
   */
  function connect(options) {
    if (!options || !options.server || !options.appName) {
      return Promise.reject(UndertoneError('invalid', 'connect({ server, appName }) needs both'));
    }
    var server = String(options.server).replace(/\/+$/, '');
    var storageKey = 'undertone:' + server + ':' + options.appName;
    var s = store();
    if (options.forget && s) s.removeItem(storageKey);
    var saved = null;
    try { saved = s ? JSON.parse(s.getItem(storageKey) || 'null') : null; } catch (e) { saved = null; }

    function register() {
      var origin = typeof location !== 'undefined' ? location.origin : null;
      return request(server, 'POST', '/v1/apps', { name: options.appName, origin: origin }).then(function (app) {
        var creds = { app_id: app.app_id, app_key: app.app_key };
        if (s) s.setItem(storageKey, JSON.stringify(creds));
        return creds;
      });
    }

    function status(creds) {
      return request(server, 'GET', '/v1/apps/' + creds.app_id).then(function (a) { return a.status; });
    }

    var ready = (saved
      ? status(saved).then(function (st) { return st === 'revoked' ? register() : saved; }, function (e) {
          if (e.status === 404) return register(); // the backend forgot us (new database)
          throw e;
        })
      : register()
    ).then(function (creds) {
      var client = makeClient(server, creds, options.appName);
      if (options.waitForApproval === false) return client;
      return client.waitForApproval(options.timeoutMs, options.onPending).then(function () { return client; });
    });
    return ready;
  }

  function makeClient(server, creds, appName) {
    var client = {
      server: server,
      appId: creds.app_id,
      appName: appName,
      patterns: PATTERNS.slice(),
      /** 'pending' | 'approved' | 'revoked' */
      status: function () {
        return request(server, 'GET', '/v1/apps/' + creds.app_id).then(function (a) { return a.status; });
      },
      /** Resolves once the wearer approves on the phone. Rejects on revoke or timeout (default 2 min). */
      waitForApproval: function (timeoutMs, onPending) {
        var deadline = Date.now() + (timeoutMs || 120000);
        var told = false;
        function poll() {
          return client.status().then(function (st) {
            if (st === 'approved') return;
            if (st === 'revoked') throw UndertoneError('revoked', 'Access was revoked on the phone', 403);
            if (!told && onPending) { told = true; onPending({ app_id: creds.app_id, name: appName }); }
            if (Date.now() > deadline) throw UndertoneError('timeout', 'Not approved in time');
            return sleep(1000).then(poll);
          });
        }
        return poll();
      },
      /**
       * Play one pattern on the wearer's phone.
       * @param {string} pattern one of Undertone.patterns
       * @param {{label?: string, intensity?: number, deviceId?: string}} [opts]
       * @returns {Promise<{ok: true, delivered: number, pattern: string}>} delivered = phones reached
       */
      buzz: function (pattern, opts) {
        opts = opts || {};
        if (PATTERNS.indexOf(pattern) === -1) {
          return Promise.reject(UndertoneError('invalid', 'Unknown pattern "' + pattern + '". Use one of: ' + PATTERNS.join(', ')));
        }
        var body = { pattern: pattern, label: opts.label || appName };
        if (typeof opts.intensity === 'number') body.intensity = Math.max(0, Math.min(1, opts.intensity));
        if (opts.deviceId) body.device_id = opts.deviceId;
        return request(server, 'POST', '/v1/haptics', body, creds.app_key);
      },
    };
    return client;
  }

  var api = { connect: connect, patterns: PATTERNS.slice(), version: '0.1.0' };
  // Undertone.buzz(...) works after the first connect(), as in plan.md 4.8
  var last = null;
  api.connect = function (options) {
    return connect(options).then(function (c) { last = c; return c; });
  };
  api.buzz = function (pattern, opts) {
    return last ? last.buzz(pattern, opts) : Promise.reject(UndertoneError('unauthorized', 'Call Undertone.connect() first'));
  };
  api.default = api;
  return api;
});
