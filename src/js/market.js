import { motionOff } from './spring.js';
import { copyText } from './ui.js';

const POLL_MS = 60000;
const BACKOFF_BASE = 2000;
const BACKOFF_CAP = 60000;
const TIMEOUT_MS = 12000;
const TOP_N = 10;
const MAX_ADDRS = 30;
const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SUB = '₀₁₂₃₄₅₆₇₈₉';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const DASH = '—';

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : v);
  }
  kids.forEach((c) => c != null && el.append(c));
  return el;
}

export const fmt = {
  price(n) {
    if (!Number.isFinite(n)) return DASH;
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return '$' + n.toFixed(n >= 100 ? 2 : 3);
    if (n >= 0.01) return '$' + n.toFixed(4);
    if (n <= 0) return '$0';
    const s = n.toFixed(24).slice(2);
    const zeros = s.match(/^0*/)[0].length;
    const digits = s.slice(zeros, zeros + 3);
    return zeros >= 4 ? `$0.0${String(zeros).split('').map((d) => SUB[d]).join('')}${digits}` : '$0.' + s.slice(0, zeros + 3);
  },
  usd: (n) => (Number.isFinite(n) ? '$' + compact.format(n) : DASH),
  change: (n) => (Number.isFinite(n) ? `${Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 2)}%` : DASH),
  count: (n) => (Number.isFinite(n) ? String(Math.round(n)) : DASH),
};

const dirOf = (n) => (!Number.isFinite(n) || n === 0 ? '' : n > 0 ? 'up' : 'down');

// count-up with flash when a displayed value changes
function setNum(el, value, format, { flash = true } = {}) {
  const prev = el._v;
  el._v = value;
  cancelAnimationFrame(el._raf);
  if (prev === undefined || !Number.isFinite(prev) || !Number.isFinite(value) || prev === value || motionOff()) {
    el.textContent = format(value);
    return;
  }
  const t0 = performance.now(), dur = 700;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(prev + (value - prev) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  if (flash) {
    const cls = value > prev ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(cls);
  }
}

function logoTile(row, size) {
  const tile = h('span', { class: 'logo-tile', 'aria-hidden': 'true' });
  tile.style.width = tile.style.height = size + 'px';
  const letter = () => { tile.replaceChildren(h('span', { text: (row.symbol || '?').charAt(0).toUpperCase() })); };
  if (!row.img) { letter(); return tile; }
  const img = h('img', { src: row.img, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', letter, { once: true });
  tile.append(img);
  return tile;
}

function aggregate(pairs) {
  const by = new Map();
  for (const p of pairs) {
    const a = p && p.baseToken && p.baseToken.address;
    if (!a) continue;
    const g = by.get(a) || { addr: a, best: null, volume: 0 };
    g.volume += Number(p.volume && p.volume.h24) || 0;
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    if (!g.best || liq > (Number(g.best.liquidity && g.best.liquidity.usd) || 0)) g.best = p;
    by.set(a, g);
  }
  return [...by.values()].map((g) => ({
    addr: g.addr,
    symbol: g.best.baseToken.symbol || '?',
    name: g.best.baseToken.name || '',
    price: parseFloat(g.best.priceUsd),
    change: Number(g.best.priceChange && g.best.priceChange.h24),
    volume: g.volume,
    liquidity: Number(g.best.liquidity && g.best.liquidity.usd),
    img: g.best.info && g.best.info.imageUrl,
  })).sort((a, b) => b.volume - a.volume).slice(0, TOP_N);
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export function initMarket() {
  const root = document.querySelector('[data-market]');
  if (!root) return;
  const rowsBox = root.querySelector('[data-rows]');
  const errBox = root.querySelector('[data-error]');
  const pill = root.querySelector('[data-pill]');
  const pillText = root.querySelector('[data-pill-text]');
  const tabs = root.querySelector('[data-tabs="market"]');
  const tiles = Object.fromEntries([...root.querySelectorAll('[data-tile]')].map((e) => [e.dataset.tile, e]));
  const tickerSets = [...document.querySelectorAll('[data-ticker-set]')];
  const live = h('span', { class: 'sr-only', role: 'status' });
  root.append(live);

  const S = { rows: [], sort: 'volume', fails: 0, timer: 0, busy: false, els: new Map(), sig: '' };
  const cfg = root.dataset;
  const base = (cfg.base || '').replace(/\/$/, '');

  const status = (s, text) => { pill.dataset.status = s; pillText.textContent = text; };

  // skeleton rows first, so the table keeps its height while loading
  for (let i = 0; i < TOP_N; i++) {
    rowsBox.append(h('div', { class: 'mrow sk-row', 'aria-hidden': 'true' },
      h('span', { class: 'sk c' }), h('span', { class: 'sk s' }), h('span', { class: 'sk l' }), h('span', { class: 'sk l' }), h('span', { class: 'sk l' }), h('span', { class: 'sk l' }), h('span', {})));
  }

  function makeRow(row, i) {
    const copy = h('button', { class: 'copy c-cp', type: 'button', 'aria-label': `Copy address for ${row.symbol}` });
    copy.innerHTML = COPY_SVG;
    copy.addEventListener('click', async () => {
      const ok = await copyText(row.addr);
      copy.classList.toggle('is-done', ok);
      copy.innerHTML = ok ? CHECK_SVG : COPY_SVG;
      live.textContent = ok ? `${row.symbol} address copied` : 'Copy failed';
      clearTimeout(copy._t);
      copy._t = setTimeout(() => { copy.classList.remove('is-done'); copy.innerHTML = COPY_SVG; live.textContent = ''; }, 1500);
    });
    const el = h('div', { class: 'mrow spot fade-in', role: 'row', style: `--i:${i}` },
      h('span', { class: 'c-lg' }, logoTile(row, 40)),
      h('span', { class: 'tok c-tk' }, h('b', { text: row.symbol }), h('span', { text: row.name })),
      h('span', { class: 'num r c-px', 'data-f': 'price' }),
      h('span', { class: 'num r chg c-ch', 'data-f': 'change' }),
      h('span', { class: 'num r c-vl', 'data-f': 'volume' }),
      h('span', { class: 'num r c-lq', 'data-f': 'liquidity' }),
      copy);
    el.addEventListener('animationend', () => el.classList.remove('fade-in'), { once: true });
    return el;
  }

  function fillRow(el, row) {
    const f = (k) => el.querySelector(`[data-f="${k}"]`);
    setNum(f('price'), row.price, fmt.price);
    const ch = f('change');
    setNum(ch, row.change, fmt.change);
    ch.dataset.dir = dirOf(row.change);
    setNum(f('volume'), row.volume, fmt.usd);
    setNum(f('liquidity'), row.liquidity, fmt.usd);
  }

  function ordered() {
    const r = S.rows.slice();
    if (S.sort === 'swing') r.sort((a, b) => (Math.abs(b.change) || 0) - (Math.abs(a.change) || 0));
    return r;
  }

  function renderRows() {
    const list = ordered();
    rowsBox.querySelectorAll('.sk-row').forEach((n) => n.remove());
    const keep = new Set(list.map((r) => r.addr));
    for (const [a, el] of S.els) if (!keep.has(a)) { el.remove(); S.els.delete(a); }
    list.forEach((row, i) => {
      let el = S.els.get(row.addr);
      if (!el) { el = makeRow(row, i); S.els.set(row.addr, el); }
      fillRow(el, row);
      rowsBox.append(el); // appending an existing node re-orders it
    });
  }

  function renderTiles() {
    const list = S.rows;
    const top = list.reduce((m, r) => (Math.abs(r.change) > Math.abs(m.change || 0) ? r : m), {});
    const put = (k, v, f) => {
      const el = tiles[k];
      if (!el) return;
      let n = el.querySelector('.num-v');
      if (!n) { n = h('span', { class: 'num-v' }); el.replaceChildren(n); n.classList.add('fade-in'); }
      setNum(n, v, f);
    };
    put('count', list.length, fmt.count);
    put('volume', list.reduce((s, r) => s + (r.volume || 0), 0), fmt.usd);
    put('liquidity', list.reduce((s, r) => s + (r.liquidity || 0), 0), fmt.usd);
    const sw = tiles.swing;
    if (sw) {
      let n = sw.querySelector('.num-v');
      if (!n) { n = h('span', { class: 'num-v fade-in' }); sw.replaceChildren(n); }
      n.dataset.sym = top.symbol || '';
      setNum(n, top.change, (v) => `${top.symbol || ''} ${fmt.change(v)}`.trim());
    }
  }

  function renderTicker() {
    const list = ordered();
    const sig = list.map((r) => r.addr).join(',') + S.sort;
    tickerSets.forEach((set, si) => {
      if (S.sig !== sig || !set.querySelector('.tick')) {
        set.replaceChildren(...list.map((row, i) => {
          const t = h('span', { class: 'tick fade-in', style: `--i:${i}`, 'data-addr': row.addr },
            logoTile(row, 24), h('b', { text: row.symbol }), h('span', { class: 'num', 'data-f': 'price' }), h('span', { class: 'num chg', 'data-f': 'change' }));
          return t;
        }));
      }
      list.forEach((row) => {
        const t = set.querySelector(`[data-addr="${CSS.escape(row.addr)}"]`);
        if (!t) return;
        t.querySelector('[data-f="price"]').textContent = fmt.price(row.price);
        const c = t.querySelector('[data-f="change"]');
        c.textContent = fmt.change(row.change); c.dataset.dir = dirOf(row.change);
      });
      if (si === 0 && !set.hasAttribute('aria-hidden')) set.setAttribute('role', 'list');
    });
    S.sig = sig;
  }

  function showFailure() {
    errBox.hidden = false;
    if (S.rows.length) return;
    rowsBox.replaceChildren(h('div', { class: 'mrow', role: 'row' },
      h('span', {}), h('span', { class: 'tok c-tk' }, h('b', { text: DASH })),
      h('span', { class: 'num r c-px', text: DASH }), h('span', { class: 'num r c-ch', text: DASH }),
      h('span', { class: 'num r c-vl', text: DASH }), h('span', { class: 'num r c-lq', text: DASH }), h('span', {})));
    Object.values(tiles).forEach((t) => t.replaceChildren(h('span', { class: 'num-v', text: DASH })));
    tickerSets.forEach((s) => s.replaceChildren(h('span', { class: 'tick', text: DASH })));
  }

  async function load() {
    if (S.busy) return;
    S.busy = true;
    try {
      const boosts = await getJson(base + cfg.boosts);
      const addrs = [...new Set((Array.isArray(boosts) ? boosts : []).filter((b) => b && b.chainId === 'solana' && b.tokenAddress).map((b) => b.tokenAddress))].slice(0, MAX_ADDRS);
      if (!addrs.length) throw new Error('no solana entries');
      const pairs = await getJson(base + cfg.pairs + addrs.join(','));
      const rows = aggregate(Array.isArray(pairs) ? pairs : []);
      if (!rows.length) throw new Error('no pairs');
      S.rows = rows; S.fails = 0;
      errBox.hidden = true;
      renderRows(); renderTiles(); renderTicker();
      status('live', 'Live');
      schedule(POLL_MS);
    } catch {
      S.fails += 1;
      status(S.rows.length ? 'retrying' : 'offline', S.rows.length ? 'Retrying' : 'Offline');
      showFailure(); // last good data stays on screen when there is any
      schedule(Math.min(BACKOFF_CAP, BACKOFF_BASE * Math.pow(2, S.fails - 1)) + Math.random() * 400);
    } finally { S.busy = false; }
  }

  function schedule(ms) {
    clearTimeout(S.timer);
    if (document.hidden) return; // resumed by the visibility handler
    S.timer = setTimeout(load, ms);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(S.timer); return; }
    clearTimeout(S.timer);
    load();
  });

  tabs && tabs.addEventListener('tabchange', (e) => {
    S.sort = e.detail.dataset.sort;
    if (S.rows.length) { renderRows(); renderTicker(); }
  });

  if (cfg.marketState !== 'stated' || !base) { status('offline', 'Offline'); showFailure(); return; }
  status('connecting', 'Connecting');
  load();
}
