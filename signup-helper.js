/*
 * signup-helper.js  (DRAFT - not deployed)
 * Australian Business Startup - helps subscribers catch email typos on the
 * embedded Sender.net form (form aM83XG).
 *
 * How it works:
 *  - Sender's universal.js renders the form inside a SAME-ORIGIN iframe
 *    (about:blank + document.write), so this page's JS can reach
 *    iframe.contentDocument and the <input name="email">.
 *  - As the visitor leaves the email field we:
 *      1. suggest a fix for common provider typos ("Did you mean gmail.com?")
 *      2. ask Google Public DNS (dns.google, CORS-enabled) whether the
 *         domain exists / can receive mail. Only the DOMAIN is sent,
 *         never the full address. Fails open (silent) if DNS is unreachable.
 *  - On submit, if there is an unresolved warning, the first submit is held
 *    once so they can see it; pressing the button again sends anyway.
 *  - After a successful sign-up we add "We've sent a confirmation email to
 *    X. Not right? Fix it" to Sender's success view. "Fix it" reloads the
 *    form with their details pre-filled (Sender only allows one submit per
 *    page load).
 *  - If Sender changes its markup, every step silently does nothing and the
 *    normal Sender form keeps working.
 */
(function () {
  'use strict';

  var FORM_ID = 'aM83XG';
  var HOLD_SUBMIT_ON_WARNING = true;   // set false to only show hints
  var DNS_URL = 'https://dns.google/resolve';
  var DNS_TIMEOUT_MS = 3000;
  var PREFILL_KEY = 'abs_signup_prefill';

  // Common Australian + global mailbox domains (exact matches are never flagged)
  var DOMAINS = [
    'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.au', 'outlook.com',
    'outlook.com.au', 'live.com', 'live.com.au', 'msn.com', 'yahoo.com',
    'yahoo.com.au', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
    'protonmail.com', 'proton.me', 'bigpond.com', 'bigpond.net.au',
    'bigpond.com.au', 'telstra.com', 'optusnet.com.au', 'iinet.net.au',
    'tpg.com.au', 'westnet.com.au', 'internode.on.net', 'dodo.com.au',
    'ozemail.com.au', 'aapt.net.au', 'adam.com.au', 'exetel.com.au',
    'people.net.au', 'netspace.net.au', 'skymesh.com.au', 'zoho.com',
    'fastmail.com', 'gmx.com'
  ];
  // Whole-domain typos that edit distance alone misses or gets wrong
  var DIRECT = {
    'gmail.com.au': 'gmail.com', 'gmail.co': 'gmail.com', 'gmai.com': 'gmail.com',
    'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'hotmail.co': 'hotmail.com',
    'hotmial.com': 'hotmail.com', 'outlook.co': 'outlook.com', 'icloud.co': 'icloud.com',
    'bigpond.co': 'bigpond.com', 'bigpond.net': 'bigpond.net.au'
  };
  // Ending fixes: ".con" -> ".com", ".comau" -> ".com.au", ".co.au" -> ".com.au" etc.
  var TLD_FIXES = [
    [/\.con$/, '.com'], [/\.cmo$/, '.com'], [/\.ocm$/, '.com'], [/\.vom$/, '.com'],
    [/\.comm$/, '.com'], [/\.om$/, '.com'], [/\.comau$/, '.com.au'],
    [/\.com\.au\.$/, '.com.au'], [/\.com\.u$/, '.com.au'], [/\.com\.a$/, '.com.au'],
    [/\.co\.au$/, '.com.au'], [/\.cm\.au$/, '.com.au'], [/\.con\.au$/, '.com.au'],
    [/\.net\.u$/, '.net.au'], [/\.netau$/, '.net.au'], [/\.ent\.au$/, '.net.au']
  ];

  /* ---------- typo suggestion ---------- */
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    if (Math.abs(m - n) > 2) return 99;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) { d[0][j] = j; }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
        }
      }
    }
    return d[m][n];
  }

  function suggestDomain(domain) {
    if (DOMAINS.indexOf(domain) !== -1) return null;
    if (DIRECT[domain]) return DIRECT[domain];
    var fixed = domain, k;
    for (k = 0; k < TLD_FIXES.length; k++) fixed = fixed.replace(TLD_FIXES[k][0], TLD_FIXES[k][1]);
    if (DOMAINS.indexOf(fixed) !== -1) return fixed;
    if (DOMAINS.indexOf(fixed + '.au') !== -1 && !/^(tpg|live|yahoo|hotmail|outlook)\.com$/.test(fixed)) return fixed + '.au'; // optusnet.com -> optusnet.com.au
    var best = null, bestD = 99;
    for (k = 0; k < DOMAINS.length; k++) {
      var dd = lev(fixed, DOMAINS[k]);
      if (dd < bestD) { bestD = dd; best = DOMAINS[k]; }
    }
    var limit = best && best.length >= 10 ? 2 : 1;
    if (best && bestD > 0 && bestD <= limit) return best;
    if (fixed !== domain) return fixed; // e.g. something.co.au -> something.com.au
    return null;
  }

  /* ---------- DNS check (Google Public DNS JSON API, CORS: *) ---------- */
  var dnsCache = {};
  function dnsQuery(name, type) {
    var url = DNS_URL + '?name=' + encodeURIComponent(name) + '&type=' + type;
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, DNS_TIMEOUT_MS);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { accept: 'application/dns-json' } })
      .then(function (r) { clearTimeout(t); return r.json(); });
  }
  // Resolves to 'ok' | 'nodomain' | 'nomail' | 'unknown'
  function checkDomain(domain) {
    if (dnsCache[domain]) return dnsCache[domain];
    var p = dnsQuery(domain, 'MX').then(function (mx) {
      if (mx.Status === 3) return 'nodomain';                 // NXDOMAIN
      if (mx.Status !== 0) return 'unknown';                  // SERVFAIL etc: don't guess
      var ans = (mx.Answer || []).filter(function (a) { return a.type === 15; });
      if (ans.length) {
        var nullMx = ans.every(function (a) { return /^\d+\s+\.?$/.test(a.data.trim()); });
        return nullMx ? 'nomail' : 'ok';                      // RFC 7505 null MX
      }
      // No MX: mail falls back to the A/AAAA record (RFC 5321)
      return dnsQuery(domain, 'A').then(function (a) {
        return (a.Status === 0 && (a.Answer || []).length) ? 'ok' : 'nomail';
      });
    }).catch(function () { return 'unknown'; });
    dnsCache[domain] = p;
    return p;
  }

  /* ---------- UI helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function attach(iframe) {
    var doc = iframe.contentDocument;
    if (!doc || doc.__absHelper) return;
    var form = doc.querySelector('form');
    var email = doc.querySelector('input[name="email"]');
    if (!form || !email) return;
    doc.__absHelper = true;
    var first = doc.querySelector('input[name="firstname"]');

    var style = doc.createElement('style');
    style.textContent =
      '.abs-hint{font-family:inherit;font-size:14px;line-height:1.4;margin:6px 0 0;padding:8px 10px;border-radius:6px;text-align:left}' +
      '.abs-hint.warn{background:#fff4e2;color:#7a4b00;border:1px solid #f0c987}' +
      '.abs-hint.bad{background:#fdecec;color:#8a1c1c;border:1px solid #f2b8b8}' +
      '.abs-hint button{font:inherit;background:none;border:0;padding:0;color:#0b5cad;text-decoration:underline;cursor:pointer}' +
      '.abs-sent{font-family:inherit;font-size:15px;line-height:1.5;margin:10px 0 0;text-align:center}' +
      '.abs-sent strong{overflow-wrap:anywhere}' +
      '.abs-sent button{font:inherit;background:none;border:0;padding:0;color:#0b5cad;text-decoration:underline;cursor:pointer}';
    doc.head.appendChild(style);

    var hint = doc.createElement('div');
    hint.className = 'abs-hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    hint.style.display = 'none';
    email.parentNode.insertBefore(hint, email.nextSibling);

    var state = { value: '', level: null, held: false, seq: 0 };

    function resize() {
      var r = form.getBoundingClientRect();
      if (r.height) iframe.style.height = Math.ceil(r.height) + 'px';
    }
    function show(level, html) {
      state.level = level;
      if (!level) { hint.style.display = 'none'; hint.innerHTML = ''; }
      else { hint.className = 'abs-hint ' + level; hint.innerHTML = html; hint.style.display = 'block'; }
      resize();
    }

    function evaluate() {
      var v = email.value.trim().toLowerCase();
      if (v === state.value) return;
      state.value = v; state.held = false;
      var seq = ++state.seq;
      var at = v.lastIndexOf('@');
      if (at < 1 || v.indexOf('.', at) === -1) { show(null); return; }  // Sender's own validation handles format
      var local = v.slice(0, at), domain = v.slice(at + 1);
      var sug = suggestDomain(domain);
      if (sug) {
        var full = local + '@' + sug;
        show('warn', 'Did you mean <button type="button" data-fix="' + esc(full) + '">' +
          esc(local) + '@<strong>' + esc(sug) + '</strong></button>?');
      } else {
        show(null);
      }
      checkDomain(domain).then(function (res) {
        if (seq !== state.seq) return;                       // they've typed since
        if (res === 'nodomain' || res === 'nomail') {
          var msg = res === 'nodomain'
            ? '<strong>' + esc(domain) + '</strong> doesn\'t seem to exist, so we couldn\'t email you there. Please check the spelling.'
            : '<strong>' + esc(domain) + '</strong> doesn\'t seem to accept email. Please check the spelling.';
          if (sug) msg += ' Did you mean <button type="button" data-fix="' + esc(local + '@' + sug) + '">' +
            esc(local) + '@<strong>' + esc(sug) + '</strong></button>?';
          show('bad', msg);
        }
      });
    }

    hint.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-fix]');
      if (!b) return;
      email.value = b.getAttribute('data-fix');
      email.dispatchEvent(new Event('input', { bubbles: true }));
      evaluate();
      email.focus();
    });
    email.addEventListener('blur', evaluate);
    email.addEventListener('change', evaluate);
    email.addEventListener('input', function () {
      if (state.level && email.value.trim().toLowerCase() !== state.value) { state.value = null; show(null); }
    });

    // Capture-phase submit on the iframe document runs before Sender's handlers.
    doc.addEventListener('submit', function (e) {
      evaluate();
      try {
        sessionStorage.setItem(PREFILL_KEY, JSON.stringify({
          email: email.value.trim(), firstname: first ? first.value : ''
        }));
      } catch (err) {}
      if (HOLD_SUBMIT_ON_WARNING && state.level && !state.held) {
        state.held = true;                                   // only hold once
        e.preventDefault();
        e.stopImmediatePropagation();
        hint.insertAdjacentHTML('beforeend',
          '<br><em>If the address is right, press the button again to continue.</em>');
        resize();
        email.focus();
      }
    }, true);

    // When Sender switches to its success view, add the address used.
    var success = doc.querySelector('.sender-form-success');
    if (success && window.MutationObserver) {
      var done = false;
      new MutationObserver(function () {
        if (done || success.style.display === 'none') return;
        done = true;
        var used = email.value.trim();
        var p = doc.createElement('p');
        p.className = 'abs-sent';
        p.innerHTML = 'We\'ve sent a confirmation email to<br><strong>' + esc(used) +
          '</strong>.<br>Not right? <button type="button">Fix it</button>';
        success.appendChild(p);
        p.querySelector('button').addEventListener('click', function () {
          try { sessionStorage.setItem(PREFILL_KEY + '_go', '1'); } catch (err) {}
          window.location.hash = 'signup';
          window.location.reload();
        });
        setTimeout(resize, 0);
      }).observe(success, { attributes: true, attributeFilter: ['style'] });
    }

    // Returning from "Fix it": prefill and focus the email field.
    try {
      if (sessionStorage.getItem(PREFILL_KEY + '_go')) {
        sessionStorage.removeItem(PREFILL_KEY + '_go');
        var pre = JSON.parse(sessionStorage.getItem(PREFILL_KEY) || '{}');
        if (pre.email) email.value = pre.email;
        if (first && pre.firstname) first.value = pre.firstname;
        email.focus();
        email.select && email.select();
        evaluate();
      }
    } catch (err) {}
  }

  /* ---------- wait for Sender to render the iframe ---------- */
  function scan() {
    var host = document.querySelector('[data-sender-form-id="' + FORM_ID + '"]');
    if (!host) return;
    var frames = host.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      try { attach(frames[i]); } catch (err) { /* cross-origin or markup changed: do nothing */ }
    }
  }
  function start() {
    scan();
    if (window.MutationObserver) {
      var mo = new MutationObserver(scan);
      mo.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { mo.disconnect(); }, 60000);   // form renders within a few seconds
    }
    // Sender fills the iframe after creating it; poll briefly as a backstop.
    var n = 0, iv = setInterval(function () { scan(); if (++n > 40) clearInterval(iv); }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
