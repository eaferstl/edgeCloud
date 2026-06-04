/* edgeCloud webform.
 *
 * Plain JS, no framework. Crypto/zip MUST mirror shared/src exactly:
 *   - canonical JSON (sorted keys, no whitespace)
 *   - deterministic zip: STORE, fixed mtime, entry file then manifest.json
 *   - jobId = sha256(base64(zip)), Ed25519 signature over the jobId hex string
 * tweetnacl + js-sha256 + fflate are vendored because crypto.subtle is
 * unavailable on a plain-HTTP origin (no secure context).
 */
'use strict';

// --- constants mirrored from shared/src/constants.js ---
var ZIP_FIXED_MTIME_MS = Date.UTC(2026, 0, 1);
var DEFAULT_JOB_TIMEOUT_MS = 10000;
var LS_IDENTITY = 'edgecloud.identity';
var LS_HISTORY = 'edgecloud.history';

// --- tiny helpers ---
function $(id) { return document.getElementById(id); }

function b64FromBytes(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function bytesFromB64(b64) {
  var bin = atob(b64);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8Bytes(s) { return new TextEncoder().encode(s); }
// Capitalize the first letter of a user-facing message (server errors included).
function cap(s) { return (typeof s === 'string' && s.length) ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// canonical JSON — must match shared/src/canonical.js byte-for-byte
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  var keys = Object.keys(value).sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    if (value[keys[i]] === undefined) continue;
    parts.push(JSON.stringify(keys[i]) + ':' + canonicalJson(value[keys[i]]));
  }
  return '{' + parts.join(',') + '}';
}

// Is this a plausible base64 Ed25519 public key? (mirrors shared/src/crypto.js)
function isValidPubkeyB64(s) {
  if (typeof s !== 'string' || s.length > 64) return false;
  try { return bytesFromB64(s).length === nacl.sign.publicKeyLength; } catch (e) { return false; }
}

// Verify a result is cryptographically SIGNED by the worker that produced it —
// the browser independently checks integrity and does NOT trust the server to
// have done so. Mirrors shared/src/result.js verifyResult: the signature is over
// the canonical JSON of the result EXCLUDING its own `sig` and the OrbitDB `_id`,
// by the Ed25519 key named in `executedBy`. Returns null if valid, else why.
function verifyResultSig(result) {
  if (!result || typeof result !== 'object') return 'no result';
  if (!isValidPubkeyB64(result.executedBy)) return 'not attributed to a valid worker key';
  if (typeof result.sig !== 'string' || !result.sig) return 'result is not signed';
  var rest = {};
  for (var k in result) {
    if (!Object.prototype.hasOwnProperty.call(result, k)) continue;
    if (k === 'sig' || k === '_id') continue;
    rest[k] = result[k];
  }
  try {
    var pub = bytesFromB64(result.executedBy);
    var sig = bytesFromB64(result.sig);
    if (pub.length !== nacl.sign.publicKeyLength || sig.length !== nacl.sign.signatureLength) {
      return 'malformed key or signature';
    }
    var ok = nacl.sign.detached.verify(utf8Bytes(canonicalJson(rest)), sig, pub);
    return ok ? null : 'signature does not verify';
  } catch (e) {
    return 'malformed signature';
  }
}

// --- identity ---
function loadIdentity() {
  try { return JSON.parse(localStorage.getItem(LS_IDENTITY)); } catch (e) { return null; }
}
function saveIdentity(id) { localStorage.setItem(LS_IDENTITY, JSON.stringify(id)); }

function renderIdentity() {
  var id = loadIdentity();
  $('noIdentity').hidden = !!id;
  $('hasIdentity').hidden = !id;
  if (id) {
    $('identityEmail').textContent = id.email;
    $('identityPubkey').textContent = id.publicKey;
  }
}

$('registerForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  var email = $('emailInput').value.trim().toLowerCase();
  var msg = $('registerMsg');
  msg.className = 'msg';
  msg.textContent = 'Creating key & registering…';
  $('registerBtn').disabled = true;
  try {
    var kp = nacl.sign.keyPair();
    var identity = {
      email: email,
      publicKey: b64FromBytes(kp.publicKey),
      secretKey: b64FromBytes(kp.secretKey),
      createdAt: Date.now(),
    };
    var res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email, pubkey: identity.publicKey }),
    });
    var body = await res.json();
    if (!res.ok) throw new Error(body.error || ('registration failed (' + res.status + ')'));
    saveIdentity(identity);
    msg.className = 'msg ok';
    msg.textContent = '✓ Registered — your key lives in this browser';
    renderIdentity();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = cap(err.message);
  } finally {
    $('registerBtn').disabled = false;
  }
});

$('forgetBtn').addEventListener('click', function () {
  if (!confirm('Forget this key? You will lose access to results submitted with it.')) return;
  localStorage.removeItem(LS_IDENTITY);
  renderIdentity();
});

// --- examples ---
var JS_EXAMPLES = [
  {
    id: 'custom',
    label: '✏️ Custom JavaScript…',
    code: '6 * 7',
  },
  {
    id: 'multiply',
    label: 'Multiply two big numbers',
    code: 'console.log(123456789n * 987654321n + "")',
  },
  {
    id: 'pi100',
    label: 'First 100 digits of π (Machin formula, BigInt)',
    code: [
      '// pi = 4*(4*acot(5) - acot(239)), fixed-point BigInt with guard digits',
      'const D = 110n, U = 10n ** D;',
      'function acot(xi) {',
      '  const x = BigInt(xi), xx = x * x;',
      '  let t = U / x, s = t, n = 1n, sg = 1n;',
      '  while (t > 0n) { t /= xx; n += 2n; sg = -sg; s += sg * t / n; }',
      '  return s;',
      '}',
      'const pi = 4n * (4n * acot(5) - acot(239));',
      'const digits = pi.toString().slice(0, 100);',
      'console.log(digits[0] + "." + digits.slice(1));',
    ].join('\n'),
  },
  {
    id: 'fib',
    label: 'fibonacci(500) exactly (BigInt)',
    code: 'let a = 0n, b = 1n;\nfor (let i = 0; i < 500; i++) [a, b] = [b, a + b];\nconsole.log("fib(500) = " + a);',
  },
  {
    id: 'primes',
    label: 'All primes below 200 (sieve)',
    code: [
      'const N = 200, sieve = new Uint8Array(N).fill(1);',
      'sieve[0] = sieve[1] = 0;',
      'for (let p = 2; p * p < N; p++) if (sieve[p]) for (let m = p * p; m < N; m += p) sieve[m] = 0;',
      'const primes = [];',
      'for (let i = 2; i < N; i++) if (sieve[i]) primes.push(i);',
      'console.log(primes.join(", "));',
    ].join('\n'),
  },
];
var wasmModules = []; // from /api/modules

async function populateExamples() {
  var sel = $('exampleSelect');
  sel.innerHTML = '';
  JS_EXAMPLES.forEach(function (ex) {
    var o = document.createElement('option');
    o.value = 'js:' + ex.id;
    o.textContent = ex.label;
    sel.appendChild(o);
  });
  try {
    var res = await fetch('/api/modules');
    wasmModules = (await res.json()).modules || [];
    wasmModules.forEach(function (m) {
      var o = document.createElement('option');
      o.value = 'wasm:' + m.name;
      o.textContent = '🧩 WASM · ' + m.label;
      sel.appendChild(o);
    });
  } catch (e) { /* wasm examples are optional */ }
  sel.value = 'js:custom';
  onExampleChange();
}

function selectedExample() {
  var v = $('exampleSelect').value.split(':');
  return { kind: v[0], id: v.slice(1).join(':') };
}

function onExampleChange() {
  var sel = selectedExample();
  if (sel.kind === 'js') {
    var ex = JS_EXAMPLES.find(function (e) { return e.id === sel.id; });
    $('jsEditor').hidden = false;
    $('wasmInfo').hidden = true;
    $('jsInput').value = ex ? ex.code : '';
  } else {
    var m = wasmModules.find(function (x) { return x.name === sel.id; });
    $('jsEditor').hidden = true;
    $('wasmInfo').hidden = false;
    $('wasmInfo').textContent = m
      ? 'Runs ' + m.name + ' under wasmtime on a volunteer node' + (m.args && m.args.length ? ' (args: ' + m.args.join(' ') + ')' : '')
      : '';
  }
}
$('exampleSelect').addEventListener('change', onExampleChange);

// If the source already prints, send it as-is. Otherwise wrap it so the
// completion value of the last statement/expression becomes the job's stdout
// (works for bare expressions AND multi-statement snippets).
function prepareJsSource(input) {
  var src = input.trim();
  if (src === '') throw new Error('enter some JavaScript first');
  if (/console\.(log|error|info|warn)/.test(src)) return src;
  return 'const __r = eval(' + JSON.stringify(src) + ');\nif (__r !== undefined) console.log(__r);';
}

// --- deterministic zip + envelope (mirrors shared/src/zip.js + envelope.js) ---
function buildZipB64(manifest, entryBytes) {
  var opts = { level: 0, mtime: new Date(ZIP_FIXED_MTIME_MS) };
  var tree = {};
  tree[manifest.entry] = [entryBytes, opts];
  tree['manifest.json'] = [utf8Bytes(canonicalJson(manifest)), opts];
  var zipped = fflate.zipSync(tree, { level: 0, mtime: new Date(ZIP_FIXED_MTIME_MS) });
  return b64FromBytes(zipped);
}

function buildEnvelope(zipB64, identity) {
  var jobId = sha256(zipB64);
  var sig = nacl.sign.detached(utf8Bytes(jobId), bytesFromB64(identity.secretKey));
  var nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  return {
    v: 1,
    jobId: jobId,
    zipB64: zipB64,
    pubkey: identity.publicKey,
    sig: b64FromBytes(sig),
    submittedAt: Date.now(),
    nonce: b64FromBytes(nonce),
  };
}

// --- submission + result polling ---
var pollTimer = null;
var awaiting = null; // { jobId, done, deliver } — the result this page is waiting on

$('submitBtn').addEventListener('click', async function () {
  var identity = loadIdentity();
  var msg = $('submitMsg');
  msg.className = 'msg';
  if (!identity) {
    msg.className = 'msg err';
    msg.textContent = 'Register your email first (step 1)';
    return;
  }
  $('submitBtn').disabled = true;
  msg.textContent = 'Building & signing job…';
  try {
    var sel = selectedExample();
    var manifest, entryBytes, labelText;
    if (sel.kind === 'js') {
      var src = prepareJsSource($('jsInput').value);
      labelText = src.length > 60 ? src.slice(0, 57) + '…' : src;
      manifest = { v: 1, type: 'js', entry: 'main.js', args: [], timeoutMs: DEFAULT_JOB_TIMEOUT_MS, label: labelText };
      entryBytes = utf8Bytes(src);
    } else {
      var mod = wasmModules.find(function (x) { return x.name === sel.id; });
      if (!mod) throw new Error('unknown module');
      labelText = mod.label;
      manifest = {
        v: 1, type: 'wasm', entry: 'module.wasm',
        command: ['wasmtime', 'run', '--dir', '.', 'module.wasm'],
        args: mod.args || [], timeoutMs: DEFAULT_JOB_TIMEOUT_MS, label: mod.label,
      };
      var wres = await fetch('/api/modules/' + encodeURIComponent(mod.name));
      if (!wres.ok) throw new Error('could not fetch ' + mod.name);
      entryBytes = new Uint8Array(await wres.arrayBuffer());
    }

    var zipB64 = buildZipB64(manifest, entryBytes);
    var env = buildEnvelope(zipB64, identity);

    msg.textContent = 'Submitting to the network…';
    var res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(env),
    });
    var body = await res.json();
    if (!res.ok) throw new Error(body.error || ('submit failed (' + res.status + ')'));

    addHistory(env.jobId, labelText);
    bumpJobsSubmitted(body.jobsSubmitted); // tick the pill up immediately (cached or not)
    msg.className = 'msg ok';
    if (body.status === 'done' && body.result) {
      msg.textContent = '✓ Answered instantly from the network result cache';
      showResultCard(env.jobId);
      renderResult(env.jobId, body.result, true);
    } else {
      msg.textContent = '✓ Job queued — waiting for a volunteer node…';
      showResultCard(env.jobId);
      pollForResult(env.jobId);
    }
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = cap(err.message);
  } finally {
    $('submitBtn').disabled = false;
  }
});

function showResultCard(jobId) {
  $('resultCard').hidden = false;
  $('resultJobId').textContent = jobId.slice(0, 16) + '…';
  $('resultStatus').className = 'msg';
  $('resultStatus').textContent = '⏳ Waiting for the network…';
  $('resultOut').hidden = true;
  $('resultErr').hidden = true;
  $('resultMeta').hidden = true;
  $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Wait for a job's result. Primary path is EVENTED: the SSE 'execution' event
// for this jobId triggers `deliver()` the instant it's cached (handleExecution).
// A slow status poll stays as a fallback in case SSE is unavailable/missed.
function pollForResult(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  var started = Date.now();
  var deliver = async function () {
    if (!awaiting || awaiting.jobId !== jobId || awaiting.done) return;
    awaiting.done = true;
    if (pollTimer) clearInterval(pollTimer);
    try {
      renderResult(jobId, await fetchResultAuthed(jobId), false);
    } catch (e) {
      awaiting.done = false; // let the poll retry
    }
  };
  awaiting = { jobId: jobId, done: false, deliver: deliver };
  pollTimer = setInterval(async function () {
    if (!awaiting || awaiting.done) { clearInterval(pollTimer); return; }
    try {
      var body = await (await fetch('/api/jobs/' + jobId + '/status')).json();
      if (body.status === 'done') deliver();
      else if (Date.now() - started > 120000) {
        clearInterval(pollTimer);
        $('resultStatus').className = 'msg err';
        $('resultStatus').textContent = 'No result after 2 minutes — are any worker nodes online?';
      }
    } catch (e) { /* transient; keep polling */ }
  }, 1500);
}

// Challenge/response: prove key possession, then fetch the (gated) result.
async function fetchResultAuthed(jobId) {
  var identity = loadIdentity();
  var ch = await (await fetch('/api/challenge?pubkey=' + encodeURIComponent(identity.publicKey))).json();
  var sig = nacl.sign.detached(utf8Bytes(ch.nonce), bytesFromB64(identity.secretKey));
  var vr = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pubkey: identity.publicKey, nonce: ch.nonce, sig: b64FromBytes(sig) }),
  });
  if (!vr.ok) throw new Error('auth failed');
  var token = (await vr.json()).token;
  var rr = await fetch('/api/jobs/' + jobId + '/result', { headers: { authorization: 'Bearer ' + token } });
  var body = await rr.json();
  if (!rr.ok) throw new Error(body.error || 'could not fetch result');
  return body.result;
}

function renderResult(jobId, result, fromCache) {
  // INTEGRITY GATE: only display a result that is cryptographically signed by a
  // valid worker key. We verify in the browser rather than trusting the server.
  var sigErr = verifyResultSig(result);
  if (sigErr) {
    $('resultStatus').className = 'msg err';
    $('resultStatus').textContent = '✗ Refusing to display — result is not signed by a valid worker (' + sigErr + ')';
    $('resultOut').hidden = true;
    $('resultErr').hidden = true;
    $('resultMeta').hidden = true;
    return;
  }
  $('resultStatus').className = 'msg ok';
  $('resultStatus').textContent = result.ok
    ? (fromCache ? '✓ Done (cached — this exact job ran before)' : '✓ Done')
    : '✗ Job failed' + (result.error ? ' (' + result.error + ')' : '');
  if (result.stdout) {
    $('resultOut').textContent = result.stdout;
    $('resultOut').hidden = false;
  }
  if (result.stderr) {
    $('resultErr').textContent = result.stderr;
    $('resultErr').hidden = false;
  }
  $('resultMeta').textContent =
    'executed by ' + (result.executedBy || 'unknown') +
    (result.startedAt && result.timestamp ? ' in ' + (result.timestamp - result.startedAt) + ' ms' : '') +
    ' · exit ' + result.exitCode + ' · 🔏 signature verified';
  $('resultMeta').hidden = false;
}

// --- history (this browser only) ---
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch (e) { return []; }
}
function addHistory(jobId, label) {
  var h = loadHistory().filter(function (x) { return x.jobId !== jobId; });
  h.unshift({ jobId: jobId, label: label, at: Date.now() });
  localStorage.setItem(LS_HISTORY, JSON.stringify(h.slice(0, 20)));
  renderHistory();
}
function renderHistory() {
  var h = loadHistory();
  $('historyCard').hidden = h.length === 0;
  var ul = $('historyList');
  ul.innerHTML = '';
  h.forEach(function (item) {
    var li = document.createElement('li');
    var label = document.createElement('span');
    label.className = 'label mono';
    label.textContent = item.label;
    var a = document.createElement('a');
    a.textContent = 'view';
    a.addEventListener('click', async function () {
      showResultCard(item.jobId);
      try {
        var result = await fetchResultAuthed(item.jobId);
        renderResult(item.jobId, result, true);
      } catch (e) {
        $('resultStatus').className = 'msg err';
        $('resultStatus').textContent = cap(e.message);
      }
    });
    li.appendChild(label);
    li.appendChild(a);
    ul.appendChild(li);
  });
}

// --- network status pill ---
function gb(b) { return (b == null) ? '?' : (b / 1e9).toFixed(1) + ' GB'; }

var lastStatus = null; // most recent /api/status, so we can patch one field cheaply

function renderPill(s) {
  var el = $('netStatus');
  el.classList.add('online');
  // "job slots free" = how many jobs the whole fleet can run at once right now
  // (sum of each worker's maxConcurrent minus what it's currently running).
  var slots = s.fleetAvailableCapacity;
  var cap = slots != null ? ' · ' + slots + ' job slot' + (slots === 1 ? '' : 's') + ' free' : '';
  // registeredKeys counts registered public keys; we surface each as a client.
  var clients = s.registeredKeys;
  // total jobs ever submitted to the network — a running "score".
  var jobs = s.jobsSubmitted;
  el.textContent = s.workersOnline + ' worker node' + (s.workersOnline === 1 ? '' : 's') + ' online' + cap +
    ' · ' + clients + ' registered client' + (clients === 1 ? '' : 's') +
    (jobs != null ? ' · ' + jobs + ' total job' + (jobs === 1 ? '' : 's') + ' submitted' : '');
  // Hover/title shows each device's specs (CPU cores, free RAM/disk, capacity).
  if (s.devices && s.devices.length) {
    el.title = s.devices.map(function (d) {
      var c = d.cpu || {};
      return (d.hostname || d.peerId.slice(0, 8)) + ': ' + (c.cores || '?') + ' core ' + (c.arch || '') +
        ', RAM ' + gb(d.ram && d.ram.freeBytes) + ' free, disk ' + gb(d.storage && d.storage.freeBytes) +
        ' free, capacity ' + (d.availableCapacity != null ? d.availableCapacity : '?') + '/' + (d.maxConcurrent || '?');
    }).join('\n');
  } else {
    el.title = '';
  }
}

// Patch just the "jobs submitted" count from a job-submit response, so the pill
// ticks up the instant you click submit — cached or not — without a round-trip.
function bumpJobsSubmitted(total) {
  if (total == null) return;
  if (lastStatus) { lastStatus.jobsSubmitted = total; renderPill(lastStatus); }
  else { refreshStatus(); }
}

async function refreshStatus() {
  try {
    lastStatus = await (await fetch('/api/status')).json();
    renderPill(lastStatus);
    renderViz(lastStatus);
  } catch (e) {
    $('netStatus').classList.remove('online');
    $('netStatus').textContent = 'Server unreachable';
    $('netStatus').title = '';
  }
}

// ===================== live execution map =====================
// Rendezvous/OrbitDB in the center; worker nodes around it labeled with IP +
// proximity. When a job completes, a packet glides from the center to the worker
// that ran it and the node pulses. Layout radius is driven by rttMs (proximity)
// once the latency work lands; until then nodes sit at a fixed radius.
var SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs) {
  var e = document.createElementNS(SVGNS, name);
  if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
var VIZ = {
  inited: false, center: { x: 500, y: 152 },
  layers: {}, nodeEls: {}, linkEls: {}, pos: {},
  seen: new Set(), seeded: false,
};

function initViz() {
  var svg = $('vizSvg');
  if (!svg || VIZ.inited) return;
  VIZ.layers.links = svg.appendChild(svgEl('g', { id: 'vizLinks' }));
  VIZ.layers.packets = svg.appendChild(svgEl('g', { id: 'vizPackets' }));
  VIZ.layers.nodes = svg.appendChild(svgEl('g', { id: 'vizNodes' }));
  // rendezvous / OrbitDB node (built once)
  var c = VIZ.center;
  var g = svgEl('g', { class: 'viz-server', transform: 'translate(' + c.x + ',' + c.y + ')' });
  g.appendChild(svgEl('circle', { class: 'body', r: 34 }));
  var t1 = svgEl('text', { class: 't1', 'text-anchor': 'middle', y: -4 }); t1.textContent = 'RENDEZVOUS';
  var t2 = svgEl('text', { class: 't2', 'text-anchor': 'middle', y: 12 }); t2.textContent = 'OrbitDB · libp2p';
  var t3 = svgEl('text', { class: 't2', 'text-anchor': 'middle', y: 50 }); t3.textContent = location.hostname;
  g.appendChild(t1); g.appendChild(t2); g.appendChild(t3);
  VIZ.layers.nodes.appendChild(g);
  VIZ.empty = svgEl('text', { class: 'viz-empty', 'text-anchor': 'middle', x: c.x, y: c.y + 96 });
  VIZ.empty.textContent = 'no worker nodes online yet';
  svg.appendChild(VIZ.empty);
  VIZ.inited = true;
}

function layoutViz(devices) {
  var c = VIZ.center, rx = 400, ry = 92, n = devices.length, pos = {};
  var rtts = devices.map(function (d) { return typeof d.rttMs === 'number' ? d.rttMs : null; });
  var maxRtt = Math.max.apply(null, rtts.filter(function (x) { return x != null; }).concat([1]));
  devices.forEach(function (d, i) {
    var ang = -Math.PI / 2 + (n ? (i / n) * 2 * Math.PI : 0);
    var f = typeof d.rttMs === 'number' ? (0.5 + 0.5 * (d.rttMs / (maxRtt || 1))) : 1; // closer = lower rtt
    pos[d.peerId] = { x: c.x + rx * f * Math.cos(ang), y: c.y + ry * f * Math.sin(ang) };
  });
  return pos;
}

function renderViz(s) {
  if (!$('vizSvg')) return;
  initViz();
  var devices = (s.devices || []).slice().sort(function (a, b) { return a.peerId < b.peerId ? -1 : 1; });
  var c = VIZ.center;
  VIZ.pos = layoutViz(devices);
  if (VIZ.empty) VIZ.empty.style.display = devices.length ? 'none' : '';
  var live = {};

  devices.forEach(function (d) {
    var id = d.peerId, p = VIZ.pos[id]; live[id] = true;
    var statusCls = (d.currentLoad > 0 ? 'busy' : 'available');
    // link
    var link = VIZ.linkEls[id];
    if (!link) { link = svgEl('line', { class: 'viz-link' }); VIZ.layers.links.appendChild(link); VIZ.linkEls[id] = link; }
    link.setAttribute('x1', c.x); link.setAttribute('y1', c.y); link.setAttribute('x2', p.x); link.setAttribute('y2', p.y);
    // node
    var n = VIZ.nodeEls[id];
    if (!n) {
      n = svgEl('g', { class: 'viz-node' });
      n.appendChild(svgEl('circle', { class: 'ring', r: 17 }));
      n.appendChild(svgEl('circle', { class: 'body', r: 14 }));
      n._nm = svgEl('text', { class: 'nm', 'text-anchor': 'middle', y: -24 });
      n._ip = svgEl('text', { class: 'ip', 'text-anchor': 'middle', y: 30 });
      n._px = svgEl('text', { class: 'px', 'text-anchor': 'middle', y: 44 });
      n.appendChild(n._nm); n.appendChild(n._ip); n.appendChild(n._px);
      VIZ.layers.nodes.appendChild(n); VIZ.nodeEls[id] = n;
    }
    n.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')');
    n.setAttribute('class', 'viz-node ' + statusCls + (n.classList.contains('pulsing') ? ' pulsing' : ''));
    n._nm.textContent = (d.peerId || '').slice(0, 8);
    n._ip.textContent = d.ip || '—';
    n._px.textContent = (typeof d.rttMs === 'number') ? ('~' + Math.round(d.rttMs) + ' ms') : 'measuring…';
  });

  // remove departed workers
  Object.keys(VIZ.nodeEls).forEach(function (id) {
    if (!live[id]) {
      if (VIZ.nodeEls[id].parentNode) VIZ.nodeEls[id].parentNode.removeChild(VIZ.nodeEls[id]);
      if (VIZ.linkEls[id] && VIZ.linkEls[id].parentNode) VIZ.linkEls[id].parentNode.removeChild(VIZ.linkEls[id]);
      delete VIZ.nodeEls[id]; delete VIZ.linkEls[id];
    }
  });

}

// Seed VIZ.seen from a status snapshot's history so a reconnect backlog isn't
// re-animated. Live executions are animated by handleExecution (from the SSE
// 'execution' event, or the polling fallback's diff).
function processExecutions(execs) {
  (execs || []).forEach(function (e) { if (e && e.jobId) VIZ.seen.add(e.jobId); });
}

function handleExecution(e) {
  if (!e || !e.jobId || VIZ.seen.has(e.jobId)) return;
  VIZ.seen.add(e.jobId);
  // a job this browser is waiting on just finished → fetch its result NOW (evented)
  if (awaiting && awaiting.jobId === e.jobId && awaiting.deliver) awaiting.deliver();
  if (e.ts && e.ts < Date.now() - 60000) return; // stale backlog → don't animate
  if (e.executedBy && VIZ.pos[e.executedBy]) { flyPacket(VIZ.pos[e.executedBy]); pulseNode(e.executedBy); }
}

function flyPacket(to) {
  var layer = VIZ.layers.packets; if (!layer || !to) return;
  var c = VIZ.center;
  var dot = svgEl('circle', { cx: c.x, cy: c.y, r: 5.5, class: 'viz-packet' });
  dot.style.transform = 'translate(0px,0px)';
  layer.appendChild(dot);
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    dot.style.transform = 'translate(' + (to.x - c.x) + 'px,' + (to.y - c.y) + 'px)';
  }); });
  setTimeout(function () { dot.style.opacity = '0'; }, 880);
  setTimeout(function () { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 1400);
}

function pulseNode(peerId) {
  var n = VIZ.nodeEls[peerId]; if (!n) return;
  n.classList.remove('pulsing'); try { n.getBBox(); } catch (e) {} // reflow → restart animation
  n.classList.add('pulsing');
  setTimeout(function () { n.classList.remove('pulsing'); }, 950);
}

// Live updates: prefer SSE push (executions arrive the instant they happen);
// fall back to polling only if EventSource is unavailable.
function startLiveFeed() {
  if (typeof EventSource === 'undefined') { startPolling(); return; }
  var es;
  try { es = new EventSource('/api/events'); } catch (e) { startPolling(); return; }
  var seeded = false;
  es.addEventListener('status', function (ev) {
    var s; try { s = JSON.parse(ev.data); } catch (x) { return; }
    lastStatus = s; renderPill(s); renderViz(s);
    if (!seeded) { processExecutions(s.recentExecutions); seeded = true; } // don't replay history
  });
  es.addEventListener('execution', function (ev) {
    try { handleExecution(JSON.parse(ev.data)); } catch (x) {}
  });
  es.onerror = function () { $('netStatus').classList.remove('online'); }; // EventSource auto-reconnects
}
function startPolling() {
  var first = true;
  var tick = function () {
    refreshStatus().then(function () {
      if (!lastStatus) return;
      if (first) { processExecutions(lastStatus.recentExecutions); first = false; }
      else { var ex = lastStatus.recentExecutions || []; for (var i = ex.length - 1; i >= 0; i--) handleExecution(ex[i]); }
    });
  };
  tick();
  setInterval(tick, 3000);
}

renderIdentity();
renderHistory();
populateExamples();
startLiveFeed();
