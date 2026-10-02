// v3fees/site/app.js
// Owner: frontend-dev.
//
// Vanilla ES module, no build step, no third-party runtime. It talks to exactly
// one thing across the network: whatever `../data-adapter.js` does. There is no
// request to a server of ours, because there is no server of ours.
//
// The adapter is imported dynamically rather than statically so that a broken
// adapter still renders the whole page (and says so) instead of a blank screen.

import { t, detectLang, rememberLang, htmlLang } from './i18n.js';
import { DONATION_ADDRESS, SOURCE_URL, HOME_URL, UNISWAP_POSITIONS, ETHERSCAN } from './config.js';
import { renderRich } from './rich.js';

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const MOCK_MODE = new URLSearchParams(location.search).has('mock');

// A real address can hold thousands of positions (one mainnet address we test
// against enumerates 9,038). Rendering all of them at once produces a document
// that takes seconds to lay out and a scrollbar nobody can use, so each table
// shows this many rows and offers the rest behind one button.
const RENDER_CAP = 50;            // rows in the first paint of a table
const RENDER_BATCH = 200;         // rows appended per animation frame after that


const els = {
  form: document.getElementById('checkform'),
  input: document.getElementById('addr'),
  check: document.getElementById('check'),
  retry: document.getElementById('retry'),
  result: document.getElementById('result'),
  errHead: document.querySelector('#state-error .state__head'),
  errBody: document.querySelector('#state-error .state__body'),
  loadingLine: document.getElementById('loading-line'),
  meter: document.getElementById('meter'),
  tipAddr: document.getElementById('tipaddr'),
  tipNote: document.getElementById('tipnote'),
  navSrc: document.querySelectorAll('[data-navsrc]'),
  navHome: document.querySelectorAll('[data-navhome]'),
  datatimeFoot: document.getElementById('datatime-foot'),
  copybuf: document.getElementById('copybuf')
};

const ui = {
  lang: 'en',
  state: 'idle',
  result: null,
  lastInput: ''
};

/** Which of the two tables the reader asked to see in full. */
const shown = { main: RENDER_CAP, locked: RENDER_CAP };

// ---------------------------------------------------------------- adapter

let adapterPromise = null;

function getAdapter() {
  if (!adapterPromise) {
    const spec = MOCK_MODE ? './dev-mock.js' : '../data-adapter.js';
    adapterPromise = import(spec).then((mod) => {
      if (typeof mod.query !== 'function') throw new Error('data-adapter has no query()');
      return mod;
    }).catch((err) => {
      adapterPromise = null;
      throw err;
    });
  }
  return adapterPromise;
}

// ------------------------------------------------------------- formatting

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function groupDigits(str) {
  return String(str).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Raw integer units -> display string + an unformatted copy string.
 * Never goes through Number: token amounts routinely exceed 2^53.
 */
function fmtAmountParts(raw, decimals) {
  const dec = Number.isFinite(decimals) ? Math.min(Math.max(Math.trunc(decimals), 0), 36) : 18;
  let v = null;
  try { v = BigInt(String(raw).trim()); } catch (_) { v = null; }
  if (v === null) {
    // A value we cannot parse as an integer is almost certainly already
    // decimal or scientific notation. Re-formatting it (groupDigits on
    // "2.5e-8") only makes it worse, so it is shown exactly as it arrived.
    return { display: String(raw), plain: String(raw) };
  }
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(dec);
  const intPart = abs / base;
  const fracFull = (abs % base).toString().padStart(dec, '0').replace(/0+$/, '');
  const cut = intPart > 0n ? 6 : 8;
  const fracCut = fracFull.slice(0, cut);
  const sign = neg ? '-' : '';
  const plain = sign + intPart.toString() + (fracFull ? '.' + fracFull : '');
  let display;
  if (intPart === 0n && fracFull && !fracCut) {
    display = '<0.00000001';                       // dust: show the bound, copy the exact value
  } else {
    display = sign + groupDigits(intPart.toString()) + (fracCut ? '.' + fracCut : '');
  }
  return { display, plain };
}

function fmtUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 6 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 2, maximumFractionDigits: digits
    }).format(n);
  } catch (_) {
    return '$' + n.toFixed(2);
  }
}

function feeLabel(fee) {
  const n = Number(fee);
  if (!Number.isFinite(n)) return '';
  return (n / 10000).toFixed(2) + '%';
}

function shortAddr(a) {
  const s = String(a || '');
  return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s;
}

function formatIso(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function uniUrl(tokenId) {
  return UNISWAP_POSITIONS + '/' + encodeURIComponent(String(tokenId));
}

// -------------------------------------------------------------- rendering

function copyBtn(value, label) {
  return '<button class="copy" type="button" data-copy="' + esc(value) + '" aria-label="' +
    esc((label || '') + ' — ' + t(ui.lang, 'copy.copy')) + '">' + esc(t(ui.lang, 'copy.copy')) + '</button>';
}

function amountCell(r) {
  const L = ui.lang;
  const sym0 = r.symbol0 || shortAddr(r.address0);
  const sym1 = r.symbol1 || shortAddr(r.address1);
  const out = [];
  const a0 = fmtAmountParts(r.amount0, r.decimals0);
  const a1 = fmtAmountParts(r.amount1, r.decimals1);
  if (BigIntSafeNonZero(r.amount0)) {
    out.push('<span class="amt">' + esc(a0.display) + ' ' + esc(sym0) + copyBtn(a0.plain + ' ' + sym0, sym0) + '</span>');
  }
  if (BigIntSafeNonZero(r.amount1)) {
    out.push('<span class="amt">' + esc(a1.display) + ' ' + esc(sym1) + copyBtn(a1.plain + ' ' + sym1, sym1) + '</span>');
  }
  if (!out.length) out.push('<span class="amt">0</span>');
  const usd = fmtUsd(r.usd);
  out.push('<span class="usd">' + (usd === null ? esc(t(L, 'res.usdNone')) : esc(usd)) + '</span>');
  return out.join('');
}

function BigIntSafeNonZero(raw) {
  try { return BigInt(String(raw).trim()) !== 0n; } catch (_) { return Number(raw) !== 0; }
}

function rowHtml(r, lockedRow) {
  const L = ui.lang;
  const sym0 = r.symbol0 || shortAddr(r.address0);
  const sym1 = r.symbol1 || shortAddr(r.address1);
  const range = r.inRange ? t(L, 'res.inRange') : t(L, 'res.outOfRange');

  const id = lockedRow
    ? '<span class="mono">#' + esc(r.tokenId) + '</span>'
    : '<a class="poslink mono" href="' + esc(uniUrl(r.tokenId)) + '" target="_blank" rel="noopener noreferrer" ' +
      'title="' + esc(t(L, 'res.uniTitle')) + '">#' + esc(r.tokenId) + '</a>';

  return '<tr>' +
    '<td class="mono c-pos">' + id + copyBtn('#' + r.tokenId, 'tokenId') +
    (lockedRow ? '<span class="tag-dead">' + esc(t(L, 'lock.tag')) + '</span>' : '') + '</td>' +
    '<td class="c-pool"><span class="poolname">' + esc(sym0) + ' / ' + esc(sym1) + '</span>' +
    '<span class="feetier">' + esc(feeLabel(r.feeTier)) + '</span>' +
    '<span class="range">' + esc(range) + '</span></td>' +
    '<td class="num">' + amountCell(r) + '</td>' +
    '</tr>';
}

function tableHtml(rows, isLocked, expandKey) {
  const L = ui.lang;
  const all = rows.slice(0, shown[expandKey]);
  let more = '';
  if (all.length < rows.length) {
    more = '<tr class="tbl__more"><td colspan="3">' +
      '<button class="linkbtn" type="button" data-showall="' + expandKey + '">' +
      esc(t(L, isLocked ? 'res.showAllLocked' : 'res.showAll', { n: groupDigits(rows.length) })) +
      '</button></td></tr>';
  }
  return '<div class="tw"><table class="tbl"><thead><tr>' +
    '<th class="c-pos">' + esc(t(L, 'res.thPosition')) + '</th>' +
    '<th class="c-pool">' + esc(t(L, 'res.thPool')) + '</th>' +
    '<th class="num">' + esc(t(L, 'res.thUncollected')) + '</th>' +
    '</tr></thead><tbody data-rows="' + expandKey + '">' +
    all.map((r) => rowHtml(r, isLocked)).join('') + more +
    '</tbody></table></div>';
}

/**
 * "Show all" for addresses with thousands of positions. Appending 4,519 rows in
 * one task freezes the tab, so rows are appended in batches on animation frames
 * and the button doubles as a progress readout until it is pulled out.
 */
function pumpRows(expandKey, btn) {
  const groups = ui.groups || classify(ui.result || { rows: [] });
  const rows = expandKey === 'locked' ? groups.locked : groups.claimable;
  const isLocked = expandKey === 'locked';
  const tbody = els.result.querySelector('tbody[data-rows="' + expandKey + '"]');
  const moreRow = tbody && tbody.querySelector('.tbl__more');
  if (!tbody || !moreRow || !rows.length) return;
  const total = rows.length;
  const step = () => {
    const from = shown[expandKey];
    const to = Math.min(from + RENDER_BATCH, total);
    moreRow.insertAdjacentHTML('beforebegin', rows.slice(from, to).map((r) => rowHtml(r, isLocked)).join(''));
    shown[expandKey] = to;
    if (to < total) {
      btn.textContent = t(ui.lang, 'res.showing', { done: groupDigits(to), total: groupDigits(total) });
      requestAnimationFrame(step);
    } else {
      moreRow.remove();
    }
  };
  btn.disabled = true;
  requestAnimationFrame(step);
}

function byUsdDesc(a, b) {
  const x = typeof a.usd === 'number' ? a.usd : -1;
  const y = typeof b.usd === 'number' ? b.usd : -1;
  return y - x;
}

/**
 * Split the rows by what can actually be done with them. The three groups are
 * not interchangeable: `locked` was never claimable, and `degenerate` is a
 * position whose fees could not be read at all — a zero there would be a lie,
 * so those rows are reported as skipped instead of as numbers.
 */
function classify(res) {
  const rows = Array.isArray(res.rows) ? res.rows.slice() : [];
  const claimable = [];
  const locked = [];
  const degenerate = [];
  for (const r of rows) {
    if (r && r.degenerate) degenerate.push(r);
    else if (r && r.locked) locked.push(r);
    else claimable.push(r);
  }
  claimable.sort(byUsdDesc);
  locked.sort(byUsdDesc);
  return { claimable, locked, degenerate, count: rows.length };
}

/**
 * Turn the adapter's machine codes into one localized line: "NFT burned ×2 ·
 * moved during the query ×1". Codes are never printed raw, and an unknown code
 * degrades to a generic phrase instead of leaking English or Chinese internals.
 */
const REASON_KEYS = ['burned', 'transferred', 'enum-failed', 'parse-failed'];
function reasonBreakdown(list) {
  const counts = new Map();
  for (const e of list) {
    const code = e && typeof e.reason === 'string' ? e.reason : 'other';
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => t(ui.lang, REASON_KEYS.indexOf(code) >= 0 ? 'reason.' + code : 'reason.other') + ' ×' + groupDigits(n))
    .join(' · ');
}

function renderResult(res) {
  const L = ui.lang;
  const { claimable, locked, degenerate } = classify(res);
  ui.groups = { claimable, locked };
  const totals = res.totals || {};
  const unpriced = Number(totals.unpricedCount) || 0;
  const lockedUsd = Number(totals.lockedUsd) || 0;
  const degenerateN = Number(res.degenerateCount) || degenerate.length;
  const allErrors = Array.isArray(res.errors) ? res.errors : [];
  // `capped` is not a failure: the query stopped at its per-query limit, so the
  // result set is truncated and every number below is a lower bound. It belongs
  // with `partial`, not in the list of dropped positions.
  const capped = res.partial === true || allErrors.some((e) => e && e.reason === 'capped');
  const skipped = allErrors.filter((e) => !e || e.reason !== 'capped');
  const anyClaimable = claimable.length > 0;
  const anyLocked = locked.length > 0;

  // When nothing is claimable the headline must not say fees are waiting: the
  // only rows left are ones nobody can ever collect, or none that read at all.
  let headKey;
  let headVars = null;
  if (anyClaimable) {
    headKey = claimable.length === 1 ? 'res.one' : 'res.many';
    headVars = { n: groupDigits(claimable.length) };
  } else if (anyLocked) {
    headKey = locked.length === 1 ? 'lock.headOne' : 'lock.headMany';
    headVars = { n: groupDigits(locked.length) };
  } else {
    headKey = 'res.noneRead';
  }

  // A dollar total may only appear when at least one claimable row actually has a
  // price. Pricing is a single point of failure that fails for everyone at once:
  // when the price feed is down every claimable row comes back unpriced, and then
  // `totals.usd` is 0 and `≥ $0.00` is technically true while reading as "you
  // have nothing to collect". That is the one sentence this page must never say.
  // The test is "no claimable row carries a price" — never `usd === 0`: fees that
  // really are worth $0.00 keep their $0.00.
  //
  // Counted from the rows about to be rendered instead of `totals.count -
  // unpricedCount`, because `count` includes locked rows: a priced burnt position
  // would otherwise rescue the total and bring back `≥ $0.00`.
  const pricedClaimable = claimable.filter((r) => r && r.usd != null).length;
  const unpricedTotal = anyClaimable && pricedClaimable === 0;

  let totalText = null;
  if (anyClaimable && !unpricedTotal) {
    totalText = fmtUsd(totals.usd);
    if (totalText && (unpriced > 0 || capped)) totalText = '≥ ' + totalText;
  }

  const parts = [];

  parts.push('<div class="res__head">' +
    '<p class="res__count"><span class="dot" aria-hidden="true"></span>' +
    esc(t(L, headKey, headVars)) + '</p>' +
    (totalText
      ? '<div class="res__totalwrap"><span class="res__totallabel">' + esc(t(L, 'res.total')) + '</span>' +
        '<span class="res__total">' + esc(totalText) + '</span></div>'
      : '') +
    '</div>');

  // Nothing could be priced. Say so where the total would have been, and keep the
  // per-row token amounts, which are onchain truths and unaffected by pricing.
  if (unpricedTotal) {
    parts.push('<p class="note-inline note-inline--flag">' + esc(t(L, 'res.unpricedAll')) + '</p>');
  }

  // Claimable and permanently locked money are never added together.
  if ((totalText || unpricedTotal) && lockedUsd > 0) {
    parts.push('<p class="note-inline">' + esc(t(L, 'res.alsoLocked', { usd: fmtUsd(lockedUsd) })) + '</p>');
  }

  // A truncated result set has to be declared next to the number it truncates.
  if (capped) {
    const scannedN = Number(res.scanned);
    const totalN = Number(res.total);
    parts.push('<p class="note-inline note-inline--flag">' + esc(t(L, 'res.partial', {
      scanned: Number.isFinite(scannedN) ? groupDigits(scannedN) : '?',
      total: Number.isFinite(totalN) ? groupDigits(totalN) : '?'
    })) + '</p>');
  }

  if (res.address) {
    parts.push('<p class="res__addr mono">' + esc(res.address) + copyBtn(res.address, 'address') +
      ' · <a href="' + esc(ETHERSCAN + '/address/' + res.address) + '" target="_blank" rel="noopener noreferrer">' +
      esc(t(L, 'res.etherscan')) + '</a></p>');
  }

  if (anyClaimable) parts.push(tableHtml(claimable, false, 'main'));

  if (unpriced > 0) {
    const key = unpriced === 1 ? 'res.lowerBoundOne' : 'res.lowerBoundMany';
    parts.push('<p class="note-inline">' + esc(t(L, key, { n: groupDigits(unpriced) })) + '</p>');
  }

  if (anyLocked) {
    parts.push('<section class="locked">');
    if (anyClaimable) {
      parts.push('<h3 class="locked__head">' +
        esc(t(L, locked.length === 1 ? 'lock.headOne' : 'lock.headMany', { n: groupDigits(locked.length) })) + '</h3>');
    }
    parts.push('<p class="note-inline">' + esc(t(L, 'lock.note')) + '</p>');
    parts.push(tableHtml(locked, true, 'locked'));
    if (!anyClaimable) {
      const lv = fmtUsd(totals.lockedUsd);
      if (lv && lockedUsd > 0) {
        parts.push('<p class="note-inline">' + esc(t(L, 'lock.value', { usd: lv })) + '</p>');
      }
    }
    parts.push('</section>');
  }

  if (anyClaimable) {
    parts.push('<div class="cta">' +
      '<a class="btn" href="' + esc(UNISWAP_POSITIONS) + '" target="_blank" rel="noopener noreferrer">' +
      esc(t(L, 'cta.collect')) + '</a>' +
      '<p class="cta__note">' + esc(t(L, 'cta.note')) + '</p></div>');
  }

  // Positions the adapter had to drop, and why. Quiet, but never silent — and a
  // whale address can drop a hundred of them, so long lists are folded.
  if (skipped.length) {
    const IDS_MAX = 10;
    const ids = skipped.slice(0, IDS_MAX)
      .map((e) => String(e && e.tokenId != null ? e.tokenId : '?'))
      .join(' ');
    let tail = t(L, 'res.skippedIds') + ' ' + ids;
    if (skipped.length > IDS_MAX) tail += ' ' + t(L, 'res.skippedMore', { n: groupDigits(skipped.length - IDS_MAX) });
    parts.push('<p class="note-inline">' + esc(t(L, skipped.length === 1 ? 'res.skippedOne' : 'res.skipped', { n: groupDigits(skipped.length) })) +
      ' <span class="skipped__why mono">' + esc(reasonBreakdown(skipped)) + '</span>' +
      ' <span class="mono skipped__ids">' + esc(tail) + '</span></p>');
  }
  if (degenerateN > 0) {
    parts.push('<p class="note-inline">' +
      esc(t(L, degenerateN === 1 ? 'res.degenerateOne' : 'res.degenerate', { n: groupDigits(degenerateN) })) + '</p>');
  }

  const meta = ['<p>' + esc(t(L, 'meta.dataTime', { time: formatIso(res.dataTimestamp) })) + '</p>'];
  if (res.blockNumber) meta.push('<p class="mono">' + esc(t(L, 'meta.block', { n: groupDigits(res.blockNumber) })) + '</p>');
  // `total` is the raw NFT count and `scanned` the number actually computed, so
  // a diff between them means positions were dropped, not merely that some had no
  // price. When they agree, the plainer "holds N NFTs" line reads better.
  const balance = Number(res.balance);
  const totalN = Number(res.total);
  const scannedN = Number(res.scanned);
  if (Number.isFinite(totalN) && totalN > 0) {
    if (Number.isFinite(scannedN) && scannedN < totalN) {
      meta.push('<p>' + esc(t(L, 'meta.scanned', { scanned: groupDigits(scannedN), total: groupDigits(totalN) })) + '</p>');
    } else {
      meta.push('<p>' + esc(t(L, 'meta.balance', { n: groupDigits(totalN) })) + '</p>');
    }
  } else if (Number.isFinite(balance) && balance > 0) {
    meta.push('<p>' + esc(t(L, 'meta.balance', { n: groupDigits(balance) })) + '</p>');
  }
  meta.push('<p>' + esc(t(L, 'meta.usd')) + '</p>');
  parts.push('<div class="res__meta">' + meta.join('') + '</div>');

  els.result.innerHTML = parts.join('');
}

// ----------------------------------------------------------------- state

let slowTimer = null;
let progressSeen = false;

/** Back to the plain indeterminate meter, ready for the next query. */
function loadingReset() {
  if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
  progressSeen = false;
  if (els.meter) {
    els.meter.removeAttribute('data-det');
    els.meter.style.removeProperty('--p');
  }
}

function setLoading(key, vars) {
  if (!els.loadingLine) return;
  els.loadingLine.dataset.i18n = key;
  els.loadingLine.textContent = t(ui.lang, key, vars);
}

/**
 * Adapter progress, when the adapter offers it. A mainnet wallet with a handful
 * of positions finishes in a second or two; one holding 4,519 of them needs
 * 4,519 contract calls and takes tens of seconds. Those two cases must not look
 * the same, or the second one reads as a hung page.
 */
function onProgress(done, total) {
  const totalN = Number(total) || 0;
  const doneN = Number(done) || 0;
  if (totalN < 1) return;
  if (!progressSeen) {
    progressSeen = true;
    if (slowTimer) { clearTimeout(slowTimer); slowTimer = null; }
  }
  if (totalN < 2) return;
  if (doneN >= totalN) {
    // Enumeration is over and the expensive half is still ahead: every one of
    // them needs its pool read and priced. Leaving "9,038 of 9,038" on screen
    // while nothing moves is the one thing that reads as a hung page, so the
    // bar goes back to indeterminate and the line says what is happening.
    setLoading('checking.reading', { n: groupDigits(totalN) });
    if (els.meter) {
      els.meter.removeAttribute('data-det');
      els.meter.style.removeProperty('--p');
    }
    return;
  }
  setLoading('checking.progress', { done: groupDigits(doneN), total: groupDigits(totalN) });
  if (els.meter) {
    els.meter.setAttribute('data-det', '1');
    els.meter.style.setProperty('--p', Math.max(2, Math.round((doneN / totalN) * 100)) + '%');
  }
}

function setState(name) {
  ui.state = name;
  document.body.dataset.state = name;
  els.check.disabled = name === 'loading';
  els.input.disabled = name === 'loading';
  if (name !== 'loading') loadingReset();
}

/** Write a translated string into an element and keep the key for later
 *  language switches. Passing no key empties and hides the element. */
function setText(el, key) {
  if (key) {
    el.dataset.i18n = key;
    el.textContent = t(ui.lang, key);
  } else {
    delete el.dataset.i18n;
    el.textContent = '';
  }
  el.hidden = !key;
}

function setError(kind) {
  // kind: 'rpc' | 'adapter' | 'invalid' | 'ens' | 'empty'
  if (kind === 'rpc') {
    setText(els.errHead, 'rpcError');
    setText(els.errBody, 'rpcErrorHint');
  } else if (kind === 'adapter') {
    // A module that will not load is not a network problem, and retrying will
    // not fix it — say what actually went wrong instead.
    setText(els.errHead, 'err.adapter');
    setText(els.errBody, null);
  } else if (kind === 'invalid') {
    setText(els.errHead, 'err.invalid');
    setText(els.errBody, null);
  } else if (kind === 'ens') {
    setText(els.errHead, 'err.ens');
    setText(els.errBody, null);
  } else {
    setText(els.errHead, 'err.empty');
    setText(els.errBody, null);
  }
  els.retry.hidden = kind !== 'rpc';
  els.result.innerHTML = '';
  setState('error');
}

// ------------------------------------------------------------------ hash

function setHash(addr, push) {
  try {
    const url = location.pathname + location.search + (addr ? '#' + addr : '');
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  } catch (_) {
    try { location.hash = addr || ''; } catch (__) { /* file:// on old engines */ }
  }
}

function hashAddress() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  return ADDR_RE.test(raw) ? raw.toLowerCase() : '';
}

// --------------------------------------------------------------- queries

async function runQuery(raw, opts) {
  const options = opts || {};
  const input = String(raw == null ? '' : raw).trim();
  ui.lastInput = input;

  if (!input) {
    setError('empty');
    return;
  }

  setState('loading');
  els.result.innerHTML = '';
  loadingReset();
  setLoading('checking', null);
  slowTimer = setTimeout(() => {
    if (!progressSeen) setLoading('checking.slow', null);
  }, 3000);

  let adapter;
  try {
    adapter = await getAdapter();
  } catch (err) {
    console.error('[v3fees] data-adapter could not be loaded:', err);
    setError('adapter');
    return;
  }

  let res;
  try {
    res = await adapter.query(input, { onProgress });
  } catch (err) {
    console.error('[v3fees] data-adapter query failed:', err);
    setError('rpc');
    return;
  }

  if (!res || res.ok !== true) {
    const reason = res && res.reason;
    if (reason === 'invalid-address') {
      const looksLikeEns = !/^0x/i.test(input) && /[a-z0-9-]+\.[a-z]{2,}/i.test(input);
      setError(looksLikeEns ? 'ens' : 'invalid');
      setHash('', false);
    } else {
      // A network failure is transient. Keep the address in the URL so that a
      // reload, a bookmark or a retry button press can pick it up again.
      setError('rpc');
      if (ADDR_RE.test(input)) setHash(input.toLowerCase(), false);
    }
    return;
  }

  ui.result = res;
  const addr = (res.address || input).toLowerCase();

  if (!Array.isArray(res.rows) || res.rows.length === 0) {
    setState('empty');
    els.result.innerHTML = '';
  } else {
    shown.main = RENDER_CAP;
    shown.locked = RENDER_CAP;
    renderResult(res);
    setState('result');
  }

  if (res.dataTimestamp && els.datatimeFoot) {
    els.datatimeFoot.textContent = formatIso(res.dataTimestamp);
  }

  setHash(addr, options.push === true);
}

// --------------------------------------------------------------- language

function applyLang(lang) {
  ui.lang = lang;
  document.documentElement.lang = htmlLang(lang);
  document.title = t(lang, 'page.title');

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const bits = pair.split(':');
      if (bits.length === 2) el.setAttribute(bits[0].trim(), t(lang, bits[1].trim()));
    });
  });
  document.querySelectorAll('.lang__btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });

  renderTipbar();
  renderMethod();
  if (ui.state === 'result' && ui.result) renderResult(ui.result);
}

/**
 * The Method section. Its copy lives in i18n.js and comes from v3fees/METHOD.md:
 * multi-paragraph bodies, a formula in a code block and several lists, so it is
 * rendered as blocks rather than swapped element by element.
 */
function renderMethod() {
  const L = ui.lang;
  const box = document.getElementById('methodbody');
  if (!box) return;
  const h = (key) => '<h3 class="h3">' + esc(t(L, key)) + '</h3>';
  const section = (titleKey, bodyKey, extra) => h(titleKey) +
    '<div class="rich' + (extra || '') + '">' + renderRich(t(L, bodyKey)) + '</div>';

  box.innerHTML =
    '<p>' + esc(t(L, 'method.intro')) + '</p>' +
    // The headline stat comes first: it is the number the reader just saw, and
    // it is the one they are most likely to confuse with their own result.
    section('method.total.title', 'method.total.body') +
    section('method.formula.title', 'method.formula.body') +
    section('method.stuck.title', 'method.stuck.body') +
    section('method.reads.title', 'method.reads.body') +
    section('method.limits.title', 'method.limits.body', ' rich--limits') +
    section('method.collect.title', 'method.collect.body') +
    section('method.verify.title', 'method.verify.body') +
    '<p class="fine">' + esc(t(L, 'method.freshness')) + '</p>';
}

function renderTipbar() {
  const L = ui.lang;
  const has = ADDR_RE.test(DONATION_ADDRESS.trim());
  const old = els.tipAddr.querySelector('.copy');
  if (old) old.remove();

  if (has) {
    els.tipAddr.hidden = false;
    els.tipAddr.textContent = DONATION_ADDRESS.trim();
    els.tipAddr.insertAdjacentHTML('beforeend', copyBtn(DONATION_ADDRESS.trim(), 'donation'));
    els.tipNote.dataset.i18n = 'tip.addrnote';
    els.tipNote.textContent = t(L, 'tip.addrnote');
  } else {
    els.tipAddr.hidden = true;
    els.tipAddr.textContent = '';
    els.tipNote.dataset.i18n = 'tip.note';
    els.tipNote.textContent = t(L, 'tip.note');
  }
}

/**
 * The source link is either real or absent. A nav item pointing at a bare
 * github.com reads as an unfinished page, which is exactly the impression this
 * page cannot afford, so an empty SOURCE_URL hides it.
 */
function renderSourceLink() {
  const url = (SOURCE_URL || '').trim();
  const live = /^https:\/\/\S+$/.test(url);
  els.navSrc.forEach((el) => {
    if (live && el.tagName === 'A') el.href = url;
    el.hidden = !live;
  });
}

/**
 * The same rule for the way back: this tool is one subdomain of the owner's
 * main site, so the front door belongs in the navigation — but only when
 * there is a door to point at.
 */
function renderHomeLink() {
  const url = (HOME_URL || '').trim();
  const live = /^https:\/\/\S+$/.test(url);
  els.navHome.forEach((el) => {
    if (live && el.tagName === 'A') el.href = url;
    el.hidden = !live;
  });
}

// ------------------------------------------------------------------ copy

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through to the old path */ }
  try {
    els.copybuf.value = text;
    els.copybuf.select();
    els.copybuf.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch (_) {
    return false;
  }
}

function markCopied(btn) {
  const original = t(ui.lang, 'copy.copy');
  btn.dataset.done = '1';
  btn.textContent = t(ui.lang, 'copy.done');
  setTimeout(() => {
    delete btn.dataset.done;
    btn.textContent = original;
  }, 1200);
}

// ------------------------------------------------------------------ wiring

function wire() {
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    runQuery(els.input.value, { push: true });
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      els.input.value = '';
      ui.lastInput = '';
      ui.result = null;
      els.result.innerHTML = '';
      setState('idle');
      setHash('', false);
      els.input.focus();
    }
  });

  els.retry.addEventListener('click', () => runQuery(ui.lastInput || els.input.value, { push: true }));

  document.addEventListener('click', async (e) => {
    const more = e.target.closest('[data-showall]');
    if (more) {
      if (more.disabled) return;
      pumpRows(more.dataset.showall, more);
      return;
    }
    const btn = e.target.closest('.copy');
    if (!btn) return;
    e.preventDefault();
    const ok = await copyText(btn.dataset.copy || '');
    if (ok) markCopied(btn);
    else {
      btn.textContent = t(ui.lang, 'copy.copy');
      console.warn('[v3fees] clipboard blocked');
    }
  });

  document.querySelectorAll('[data-scroll]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.dataset.scroll;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.querySelectorAll('.lang__btn').forEach((b) => {
    b.addEventListener('click', () => {
      const lang = b.dataset.lang;
      rememberLang(lang);
      applyLang(lang);
    });
  });

  window.addEventListener('hashchange', () => {
    const a = hashAddress();
    if (a) {
      els.input.value = a;
      runQuery(a, { push: false });
    } else {
      ui.result = null;
      els.result.innerHTML = '';
      setState('idle');
    }
  });
}

function mockBanner() {
  if (!MOCK_MODE) return;
  const bar = document.createElement('div');
  bar.className = 'tipbar';
  bar.style.borderTop = '0';
  bar.innerHTML = '<div class="tipbar__inner"><span class="tipbar__label">Mock data</span>' +
    '<span class="tipbar__note">?mock=1 — every number on this page is fabricated for development. ' +
    'Not a real lookup.</span></div>';
  document.body.insertBefore(bar, document.body.firstChild);
}

/**
 * `?drive=<address|empty|invalid|ens>` fills the field and submits on load.
 * It exists so a headless browser (or a human with a bookmark) can reach every
 * state in a single navigation. It is inert without the parameter and asks for
 * nothing a visitor could not type into the box themselves.
 */
function driveValue() {
  const raw = new URLSearchParams(location.search).get('drive');
  if (raw == null) return null;
  if (raw === 'empty') return '';
  if (raw === 'invalid') return 'hello world';
  if (raw === 'ens') return 'vitalik.eth';
  return raw;
}

async function init() {
  mockBanner();
  renderSourceLink();
  renderHomeLink();
  wire();
  applyLang(detectLang());

  // Focus before the first await so the caret is there on the first paint.
  const fromHash = hashAddress();
  const driven = driveValue();
  if (driven != null) els.input.value = driven;
  else if (fromHash) els.input.value = fromHash;
  else els.input.focus();

  try {
    const adapter = await getAdapter();
    if (typeof adapter.getDataTimestamp === 'function') {
      const iso = await adapter.getDataTimestamp();
      if (els.datatimeFoot) els.datatimeFoot.textContent = formatIso(iso);
    }
  } catch (err) {
    console.error('[v3fees] data-adapter unavailable:', err);
  }

  if (driven != null) runQuery(driven, { push: false });
  else if (fromHash) runQuery(fromHash, { push: false });
}

init();
