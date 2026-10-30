import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { parse } from 'node-html-parser';
import { ROOT, loadRegister, validateRegister, walk, SOLANA_ADDR } from './lib.mjs';
import { visibleText, bigrams, hash } from './text.mjs';
import { build } from './build.mjs';

const read = (p) => readFileSync(p, 'utf8');
const B58 = /(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/g;
const EVM = /(?<![A-Za-z0-9])0x[0-9a-fA-F]{40}(?![A-Za-z0-9])/g;
const HEX = /#[0-9a-fA-F]{3,8}(?![0-9A-Za-z_-])/g;
// patterns assembled from parts so this file never trips its own content scan
const AI_WORDS = [new RegExp('cl' + 'aude', 'i'), new RegExp('anth' + 'ropic', 'i'), new RegExp('\\bA' + 'I\\b'), new RegExp('co-?authored-?by', 'i'), new RegExp('generated (with|by)', 'i')];
const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const DATE_PATTERNS = [
  /\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/, /\b\d{1,2}[-/.]\d{1,2}[-/.](19|20)\d{2}\b/, /\b(19|20)\d{2}\b/,
  new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+\\d{1,2}\\b`, 'i'), /\b\d{1,2}:\d{2}(:\d{2})?\b/,
  /\bas of\b/i, /\bchecked\b/i, /\bupdated?\b/i, /\blast (sync|seen|refresh)/i, /\b\d+\s*(s|sec|min|h|hr|d)\s+ago\b/i, /\btimestamp\b/i,
];

const files = (dist, ...exts) => walk(dist).filter((f) => exts.includes(extname(f)));
const jsStrings = (src) => [...src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
const cssStrings = (src) => [...src.matchAll(/content\s*:\s*(['"])(.*?)\1/g)].map((m) => m[2]);

function statedValues(reg) {
  const out = new Set();
  for (const r of reg.records) if (r.state === 'stated') { if (r.value) out.add(r.value); if (r.url) out.add(r.url); }
  return out;
}

async function pixel(file, x, y) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Every gate takes ctx = { dist, reg, root } and returns null (pass) or a string (failure detail).
export const GATES = [
  ['register-valid', async ({ reg }) => { const e = validateRegister(reg); return e.length ? e.join('; ') : null; }],

  ['dist-entry', async ({ dist }) => (existsSync(join(dist, 'index.html')) ? null : 'dist/index.html missing')],

  ['dist-whitelist', async ({ dist }) => {
    const bad = walk(dist).filter((f) => !['.html', '.css', '.js', '.svg', '.png'].includes(extname(f)));
    return bad.length ? 'unexpected files: ' + bad.map((f) => relative(dist, f)).join(', ') : null;
  }],

  ['no-external-assets', async ({ dist }) => {
    const doc = parse(read(join(dist, 'index.html')));
    const ext = (v) => /^(https?:)?\/\//i.test(v || '');
    const bad = doc.querySelectorAll('script[src],img[src],iframe,source,link[href]').filter((e) => (e.tagName === 'LINK' ? e.getAttribute('rel') !== 'canonical' && ext(e.getAttribute('href')) : ext(e.getAttribute('src'))));
    return bad.length ? 'external: ' + bad.map((e) => e.toString().slice(0, 80)).join(' | ') : null;
  }],

  ['logo-in-dist-and-referenced', async ({ dist, root }) => {
    const doc = parse(read(join(dist, 'index.html')));
    const imgs = doc.querySelectorAll('img').map((i) => i.getAttribute('src'));
    const logos = imgs.filter((s) => /boobot-logo/.test(s || ''));
    if (!logos.length) return 'no <img> references the logo';
    for (const s of logos) {
      if (/^([a-z]+:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('..')) return `logo path not relative: ${s}`;
      if (!existsSync(join(dist, s))) return `referenced logo missing on disk: ${s}`;
    }
    const hero = doc.querySelector('.layer-logo img');
    if (!hero || !hero.getAttribute('alt')) return 'hero logo img missing or has no alt';
    const src = join(root, 'brand', 'LOGO BOOBOT PNG...png');
    if (!existsSync(join(dist, 'assets', 'boobot-logo.png'))) return 'original logo copy missing from dist/assets';
    if (!readFileSync(src).equals(readFileSync(join(dist, 'assets', 'boobot-logo.png')))) return 'dist logo differs from brand source';
    for (const css of files(dist, '.css')) for (const m of read(css).matchAll(/url\(([^)]+)\)/g)) {
      const u = m[1].replace(/['"]/g, '');
      if (!existsSync(join(css, '..', u))) return `css url() target missing: ${u}`;
    }
    return null;
  }],

  ['logo-premultiplied-resize', async ({ dist, root }) => {
    const src = await sharp(join(root, 'brand', 'LOGO BOOBOT PNG...png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let blackUnderClear = 0;
    for (let i = 0; i < src.data.length; i += 4) if (src.data[i + 3] === 0 && !src.data[i] && !src.data[i + 1] && !src.data[i + 2]) blackUnderClear++;
    for (const s of [640, 192]) {
      const { data, info } = await sharp(join(dist, 'assets', `boobot-logo-${s}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== s || info.height !== s) return `${s}: wrong size ${info.width}x${info.height}`;
      let n = 0, dev = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a > 40 && a < 215) { n++; dev += Math.abs(data[i] - 24) + Math.abs(data[i + 1] - 24) + Math.abs(data[i + 2] - 24); }
      }
      if (n && dev / n / 3 > 14) return `${s}: dark fringe on edge pixels (mean deviation from ink ${(dev / n / 3).toFixed(1)}), black-under-clear px in source: ${blackUnderClear}`;
    }
    return null;
  }],

  ['favicon', async ({ dist }) => {
    const p = join(dist, 'favicon.svg');
    if (!existsSync(p)) return 'favicon.svg missing';
    const s = read(p);
    if (!/width="32"/.test(s) || !/height="32"/.test(s) || !/viewBox="0 0 32 32"/.test(s)) return 'not 32x32';
    if (s.includes('--') || s.includes('<!--')) return 'double hyphen or XML comment inside svg';
    if (!/<path[^>]+d="M\d/.test(s)) return 'no traced path';
    if (!/rel="icon"[^>]+href="favicon\.svg"|href="favicon\.svg"[^>]+rel="icon"/.test(read(join(dist, 'index.html')))) return 'index.html does not link favicon.svg';
    return null;
  }],

  ['palette-hex-only-in-tokens', async ({ dist, root }) => {
    const bad = [];
    const scan = (dir) => {
      for (const f of walk(dir)) {
        const rel = relative(dir, f).replace(/\\/g, '/');
        if (!['.css', '.js', '.html', '.svg'].includes(extname(f))) continue;
        if (rel === 'css/tokens.css' || rel === 'favicon.svg') continue;
        const hits = read(f).match(HEX);
        if (hits) bad.push(`${rel}: ${hits.slice(0, 3).join(' ')}`);
        if (/\b(rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/i.test(read(f))) bad.push(`${rel}: functional colour literal`);
      }
    };
    scan(dist);
    if (existsSync(join(root, 'src'))) scan(join(root, 'src'));
    return bad.length ? bad.join(' | ') : null;
  }],

  ['palette-provenance-real-pixels', async ({ dist, root }) => {
    const css = read(join(dist, 'css', 'tokens.css'));
    const re = /(--[\w-]+):\s*(#[0-9a-fA-F]{6});\s*\/\*\s*(.+?)@(\d+),(\d+)\s*\*\//g;
    const seen = new Set(); const errs = [];
    for (const m of css.matchAll(re)) {
      seen.add(m[2].toLowerCase());
      const file = ['brand', 'reference'].map((d) => join(root, d, m[3])).find(existsSync);
      if (!file) { errs.push(`${m[1]}: ${m[3]} not found`); continue; }
      const got = await pixel(file, +m[4], +m[5]);
      if (got !== m[2].toLowerCase()) errs.push(`${m[1]}: ${m[2]} but pixel is ${got}`);
    }
    const all = (css.match(HEX) || []).map((h) => h.toLowerCase());
    for (const h of all) if (!seen.has(h)) errs.push(`${h} has no provenance comment`);
    const fav = read(join(dist, 'favicon.svg')).match(HEX) || [];
    for (const h of fav) if (!seen.has(h.toLowerCase())) errs.push(`favicon colour ${h} is not a token`);
    return errs.length ? errs.join('; ') : (seen.size ? null : 'no tokens parsed');
  }],

  ['no-ch-units', async ({ dist }) => {
    const bad = [...files(dist, '.css', '.html')].filter((f) => /(^|[^\w.])\d*\.?\d+ch\b/.test(read(f).replace(/<script[\s\S]*?<\/script>/g, '')));
    return bad.length ? 'ch unit in ' + bad.map((f) => relative(dist, f)).join(', ') : null;
  }],

  ['no-dates-anywhere', async ({ dist }) => {
    const hits = [];
    const test = (where, text) => { for (const p of DATE_PATTERNS) { const m = text.match(p); if (m) hits.push(`${where}: "${m[0]}"`); } };
    const html = read(join(dist, 'index.html'));
    const doc = parse(html);
    doc.querySelectorAll('script,style').forEach((n) => n.remove());
    test('html text', doc.textContent);
    for (const el of doc.querySelectorAll('*')) for (const [k, v] of Object.entries(el.attributes)) if (!['d', 'viewBox', 'transform', 'style'].includes(k)) test(`html @${k}`, v);
    for (const f of files(dist, '.js')) jsStrings(read(f)).forEach((s) => test(relative(dist, f), s));
    for (const f of files(dist, '.css')) cssStrings(read(f)).forEach((s) => test(relative(dist, f), s));
    if (walk(dist).some((f) => /register\.json$/.test(f))) hits.push('register.json shipped in dist');
    return hits.length ? [...new Set(hits)].slice(0, 6).join(' | ') : null;
  }],

  ['no-ai-attribution-in-repo', async ({ dist, root }) => {
    const bad = [];
    for (const n of ['CLAUDE.md', '.claude']) if (existsSync(join(root, n))) bad.push(n + ' exists');
    const roots = [dist, join(root, 'src'), join(root, 'docs'), join(root, 'scripts')];
    const list = [...roots.filter(existsSync).flatMap((r) => walk(r)), ...['README.md', 'LICENSE', 'register.json', 'package.json'].map((n) => join(root, n)).filter(existsSync)];
    for (const f of list) {
      if (/ref-bigrams\.json$|\.png$|scripts[\\/]gates\.mjs$/.test(f)) continue;
      const t = read(f);
      for (const re of AI_WORDS) if (re.test(t)) bad.push(`${relative(root, f)} matches ${re.source.length > 1 ? 'a banned term' : ''}`);
    }
    return bad.length ? [...new Set(bad)].join(' | ') : null;
  }],

  ['link-rule', async ({ dist, reg }) => {
    const doc = parse(read(join(dist, 'index.html')));
    const stated = new Map(reg.records.filter((r) => r.state === 'stated' && r.url).map((r) => [r.url, r.id]));
    const errs = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href');
      if (/^https?:/i.test(h)) {
        if (!stated.has(h)) errs.push(`href not from a stated record: ${h}`);
        else if (!['x', 'github'].includes(stated.get(h)) || a.getAttribute('data-record') !== stated.get(h)) errs.push(`unexpected external link ${h}`);
      } else if (!h.startsWith('#')) errs.push(`non-anchor href ${h}`);
    }
    for (const el of doc.querySelectorAll('[data-record]')) {
      const id = el.getAttribute('data-record'), st = el.getAttribute('data-state');
      const rec = reg.records.find((r) => r.id === id);
      if (!rec) { errs.push(`${id}: no such record`); continue; }
      if (st !== rec.state) errs.push(`${id}: markup state ${st} != register ${rec.state}`);
      if (st !== 'stated') {
        if (el.getAttribute('href') !== undefined && el.getAttribute('href') !== null) errs.push(`${id}: inert record has href`);
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        const allowed = [rec.label, 'Pending', ''];
        const rest = t.split(' ').join(' ').replace(new RegExp(`^${rec.label}\\s*`), '').trim();
        if (!allowed.includes(rest)) errs.push(`${id}: inert record shows "${t}"`);
        if (/https?:|data-copy/.test(el.toString())) errs.push(`${id}: inert record carries url/copy payload`);
      }
    }
    for (const id of ['ca', 'x', 'github']) if (!doc.querySelector(`[data-record="${id}"]`)) errs.push(`${id}: slot missing`);
    return errs.length ? errs.join('; ') : null;
  }],

  ['address-scanner-matches-registry', async ({ dist, reg }) => {
    const ok = statedValues(reg);
    const html = parse(read(join(dist, 'index.html')));
    html.querySelectorAll('[data-ca-slot]').forEach((n) => n.remove()); // CA slot is exempt
    html.querySelectorAll('script').forEach((n) => n.remove());
    const hay = [['html', html.toString()], ...files(dist, '.js', '.css', '.svg').map((f) => [relative(dist, f), read(f)])];
    const errs = [];
    for (const [where, text] of hay) for (const re of [B58, EVM]) for (const m of text.matchAll(re)) if (!ok.has(m[0])) errs.push(`${where}: ${m[0].slice(0, 16)}...`);
    return errs.length ? 'address-shaped string not in stated registry: ' + errs.slice(0, 4).join(', ') : null;
  }],

  ['ca-slot-shape', async ({ dist, reg }) => {
    const doc = parse(read(join(dist, 'index.html')));
    const slot = doc.querySelector('[data-ca-slot]');
    if (!slot) return 'CA slot missing';
    const main = doc.querySelector('main');
    if (!main || !main.querySelector('[data-ca-slot]')) return 'CA slot not at top of main';
    const idx = (n) => doc.toString().indexOf(n);
    if (idx('data-ca-slot') > idx('class="hero"')) return 'CA slot is below the hero';
    const r = reg.records.find((x) => x.id === 'ca');
    const val = slot.querySelector('[data-ca-value]');
    if (r.state === 'stated') {
      if (val.textContent.trim() !== r.value) return 'CA slot does not show the full stated address';
      if (!slot.querySelector('[data-ca-copy]')) return 'stated CA has no copy control';
    } else if (slot.querySelector('button') || val.textContent.trim() !== 'Pending') return 'inert CA slot is not inert';
    return null;
  }],

  ['social-icons-always-present', async ({ dist }) => {
    const doc = parse(read(join(dist, 'index.html')));
    const hdr = doc.querySelector('header');
    const errs = [];
    for (const id of ['x', 'github']) {
      const el = hdr && hdr.querySelector(`[data-record="${id}"]`);
      if (!el) { errs.push(`${id} icon not in header`); continue; }
      if (el.textContent.trim()) errs.push(`${id} icon carries text`);
      if (!el.querySelector('svg path')) errs.push(`${id} has no svg`);
      if (el.closest('.mobile-nav, .desktop-nav')) errs.push(`${id} icon sits inside a collapsing nav`);
    }
    const x = hdr && hdr.querySelector('[data-record="x"] path'), g = hdr && hdr.querySelector('[data-record="github"] path');
    if (x && !x.getAttribute('d').startsWith('M18.244 2.25h3.308')) errs.push('X mark is not the official path');
    if (g && !g.getAttribute('d').startsWith('M8 0c4.42 0 8 3.58 8 8a8.013')) errs.push('GitHub mark is not the official Octicon path');
    for (const f of files(dist, '.css')) for (const m of read(f).matchAll(/([^{}]+)\{([^}]*display\s*:\s*none[^}]*)\}/g)) if (/icon-btn|data-record|social/.test(m[1] + m[2]) && !/mobile-nav|desktop-nav/.test(m[1])) errs.push(`css hides ${m[1].trim()}`);
    return errs.length ? errs.join('; ') : null;
  }],

  ['reduced-motion-everywhere', async ({ dist }) => {
    const css = files(dist, '.css').map(read).join('\n');
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*$/);
    if (!block) return 'no reduced-motion media block';
    if (!/animation:\s*none\s*!important/.test(block[0]) || !/transition:\s*none\s*!important/.test(block[0])) return 'reduced-motion block does not kill animation and transition';
    const spring = read(join(dist, 'js', 'spring.js'));
    if (!/prefers-reduced-motion: reduce/.test(spring)) return 'JS does not read the media query';
    for (const f of ['ui.js', 'market.js', 'spring.js']) if (!/motionOff/.test(read(join(dist, 'js', f)))) return `${f} never consults motionOff`;
    return null;
  }],

  ['market-wiring', async ({ dist, reg }) => {
    const js = read(join(dist, 'js', 'market.js'));
    const errs = [];
    const need = [[/POLL_MS = 60000/, '60s poll'], [/visibilitychange/, 'visibility handler'], [/document\.hidden/, 'pause while hidden'], [/Math\.pow\(2/, 'exponential backoff'],
      [/BACKOFF_CAP/, 'backoff cap'], [/chainId === 'solana'/, 'solana filter'], [/slice\(0, TOP_N\)/, 'top n'], [/TOP_N = 10/, 'top 10'], [/addEventListener\('error', letter/, 'letter tile fallback'], [/sk-row/, 'skeleton rows'], [/fade-in/, 'fade-in stagger'], [/setNum/, 'count-up'], [/flash-up/, 'value flash'], [/\.volume/, 'volume']];
    for (const [re, name] of need) if (!re.test(js)) errs.push('missing ' + name);
    if (/dexscreener|api\./i.test(js)) errs.push('market.js hardcodes an endpoint; it must read the register');
    if (/data-ca|data-record|register|\bca\b/i.test(js)) errs.push('market.js touches CA or register state');
    const m = reg.records.find((r) => r.id === 'market');
    const sec = parse(read(join(dist, 'index.html'))).querySelector('[data-market]');
    if (m.state === 'stated') {
      if (sec.getAttribute('data-base') !== m.url || sec.getAttribute('data-boosts') !== m.meta.boosts || sec.getAttribute('data-pairs') !== m.meta.pairs) errs.push('market config differs from register');
      if (m.url !== 'https://api.dexscreener.com' || m.meta.boosts !== '/token-boosts/top/v1' || m.meta.pairs !== '/tokens/v1/solana/') errs.push('register market endpoints are not the specified ones');
    }
    const html = read(join(dist, 'index.html'));
    for (const t of ['data-ticker', 'data-pill', 'data-rows', 'data-error', 'data-tile="count"', 'sk-tick', 'data-sort="volume"']) if (!html.includes(t)) errs.push('markup missing ' + t);
    return errs.length ? errs.join('; ') : null;
  }],

  ['chain-record', async ({ reg }) => {
    const c = reg.records.find((r) => r.id === 'chain');
    return c && c.state === 'stated' && c.value === 'Solana' && c.url === 'https://solana-rpc.publicnode.com' && c.source === 'client statement' && c.scope === 'batch-level' ? null : 'chain record is not as specified';
  }],

  ['tap-targets-declared', async ({ dist }) => {
    const css = files(dist, '.css').map(read).join('\n');
    if (!/--tap:\s*44px/.test(css)) return '--tap is not 44px';
    const errs = [];
    for (const sel of ['.icon-btn', '.tab', '.copy', '.btn', '.ca-copy', '.text-link', '.desktop-nav a', '.mobile-panel a', '.foot-links a', '.wordmark']) {
      const rules = [...css.matchAll(/(?<=^|\})\s*([^{}@]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === sel));
      if (!rules.some((m) => /var\(--tap\)/.test(m[2]))) errs.push(sel);
    }
    return errs.length ? 'no 44px floor on: ' + errs.join(', ') : null;
  }],

  ['copy-shares-no-2grams-with-reference', async ({ dist, root }) => {
    const ref = new Set(JSON.parse(read(join(root, 'scripts', 'ref-bigrams.json'))));
    const mine = bigrams(visibleText(read(join(dist, 'index.html'))));
    const shared = [...mine].filter((b) => ref.has(hash(b)));
    return shared.length ? `${shared.length} shared: ${shared.slice(0, 8).join(' | ')}` : null;
  }],

  ['html-basics', async ({ dist }) => {
    const doc = parse(read(join(dist, 'index.html')));
    const errs = [];
    if (doc.querySelectorAll('h1').length !== 1) errs.push('need exactly one h1');
    if (!doc.querySelector('html').getAttribute('lang')) errs.push('no lang');
    if (!doc.querySelector('meta[name="viewport"]')) errs.push('no viewport');
    for (const i of doc.querySelectorAll('img')) if (i.getAttribute('alt') === undefined || i.getAttribute('alt') === null) errs.push('img without alt');
    return errs.length ? errs.join('; ') : null;
  }],

  ['repo-files', async ({ dist, root }) => {
    const errs = [];
    for (const n of ['README.md', 'docs/whitepaper.md', 'LICENSE']) {
      if (!existsSync(join(root, n))) errs.push(n + ' missing');
      if (existsSync(join(dist, n)) || existsSync(join(dist, n.split('/').pop()))) errs.push(n + ' leaked into dist');
    }
    if (errs.length) return errs.join('; ');
    const lic = read(join(root, 'LICENSE')), rd = read(join(root, 'README.md')), wp = read(join(root, 'docs', 'whitepaper.md'));
    if (!/^MIT License/.test(lic) || !/Copyright \(c\) 2026 Boobot/.test(lic)) errs.push('LICENSE is not MIT / Boobot');
    if (!/boobot\.live/i.test(rd) || !/img\.shields\.io/.test(rd) || !/Solana/.test(rd) || !/^## Overview/m.test(rd) || !/^## Features/m.test(rd) || !/^## Links/m.test(rd) || !/Pending/.test(rd)) errs.push('README is missing a required part');
    if (!/Vision/i.test(wp) || !/Mission/i.test(wp) || !/Tokenomics/i.test(wp) || !/Roadmap/i.test(wp) || !/Team/i.test(wp)) errs.push('whitepaper is missing a required part');
    if ((wp.match(/^### Phase \d/gm) || []).length < 3) errs.push('whitepaper roadmap needs 3-4 phases');
    return errs.length ? errs.join('; ') : null;
  }],
];

export async function runGates(ctx, quiet = true) {
  const out = [];
  for (const [id, fn] of GATES) {
    let detail;
    try { detail = await fn(ctx); } catch (e) { detail = 'threw: ' + e.message; }
    out.push({ id, pass: detail === null, detail });
    if (!quiet) console.log(`${detail === null ? 'PASS' : 'FAIL'}  ${id}${detail ? '\n        ' + detail : ''}`);
  }
  return out;
}

// ---------- branch proofs + negative controls ----------

const SYNTH_CA = 'BooBotTestAddress' + '1'.repeat(27);
const SYNTH_STRAY = 'Strayy' + 'Addr'.repeat(1) + 'XyZ' + '2'.repeat(30);
const TMP = join(ROOT, 'node_modules', '.cache', 'boobot-gates');

function flip(reg, id) {
  const copy = JSON.parse(JSON.stringify(reg));
  const r = copy.records.find((x) => x.id === id);
  if (r.state === 'stated') { r.state = 'absent'; delete r.value; delete r.url; }
  else {
    r.state = 'stated';
    if (id === 'ca') r.value = SYNTH_CA;
    if (id === 'x') r.url = 'https://x.com/boobot_test';
    if (id === 'github') r.url = 'https://github.com/boobot-test';
  }
  return copy;
}

async function buildTo(name, reg) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const rp = join(dir, 'register.json');
  writeFileSync(rp, JSON.stringify(reg));
  const out = join(dir, 'dist');
  await build({ registerPath: rp, out });
  return { dist: out, reg, root: ROOT };
}

const marketCfg = (dist) => (read(join(dist, 'index.html')).match(/data-market-state="[^"]*"[^>]*/) || [''])[0];

export async function proveBranches(baseReg) {
  rmSync(TMP, { recursive: true, force: true });
  const results = []; // {name, pass, detail}
  const rec = (name, pass, detail = '') => results.push({ name, pass, detail });
  const cfgs = {};

  for (const id of ['ca', 'x', 'github']) {
    const cur = baseReg.records.find((r) => r.id === id).state; // read at run time, never assumed
    const A = await buildTo(`${id}-asis`, baseReg);
    const B = await buildTo(`${id}-flip`, flip(baseReg, id));
    for (const [tag, ctx] of [['as-is', A], ['flipped', B]]) {
      const res = await runGates(ctx);
      const failed = res.filter((r) => !r.pass);
      rec(`${id} ${tag}: all ${res.length} static gates`, !failed.length, failed.map((f) => `${f.id}: ${f.detail}`).join(' | '));
      const doc = parse(read(join(ctx.dist, 'index.html')));
      const el = doc.querySelector(`[data-record="${id}"]`);
      const st = ctx.reg.records.find((r) => r.id === id).state;
      let ok;
      if (st === 'stated') {
        ok = el.getAttribute('data-state') === 'stated' && (id === 'ca' ? doc.querySelector('[data-ca-value]').textContent.trim() === SYNTH_CA && !!doc.querySelector('[data-ca-copy]') : !!el.getAttribute('href') && el.getAttribute('target') === '_blank');
      } else {
        ok = el.getAttribute('data-state') !== 'stated' && !el.getAttribute('href') && !/https?:|[A-HJ-NP-Za-km-z1-9]{32}/.test(el.toString());
      }
      rec(`${id} ${tag} (${st}): DOM matches state`, ok, el && el.toString().slice(0, 120));
      cfgs[`${id}-${tag}`] = marketCfg(ctx.dist);
    }
    rec(`${id}: ${cur} -> ${cur === 'stated' ? 'absent' : 'stated'} flip produced the other branch`, A.reg.records.find((r) => r.id === id).state !== B.reg.records.find((r) => r.id === id).state);
  }
  const uniq = new Set(Object.values(cfgs));
  rec('market config identical across every CA / X / GitHub state', uniq.size === 1 && [...uniq][0].includes('data-base="https://api.dexscreener.com"'), [...uniq].join(' || '));

  // register pattern refuses an inert record that carries a value or url
  const bad = JSON.parse(JSON.stringify(baseReg));
  const inert = bad.records.find((r) => r.state !== 'stated') || (() => { const r = bad.records.find((x) => x.id === 'ca'); r.state = 'absent'; return r; })();
  inert.value = 'leak';
  rec('register refuses inert record that carries a value', validateRegister(bad).length > 0);
  const bad2 = JSON.parse(JSON.stringify(baseReg)); const i2 = bad2.records.find((r) => r.id === 'x'); i2.state = 'absent'; i2.url = 'https://x.com/leak';
  rec('register refuses inert record that carries a url', validateRegister(bad2).length > 0);

  // negative controls: each mutation appends/removes at a state-independent anchor
  const base = await buildTo('ctl-base', baseReg);
  const controls = [
    ['no-dates-anywhere', 'date in body', (d) => appendBody(d, '<p>Refreshed 2031-05-04</p>')],
    ['no-dates-anywhere', 'clock string in body', (d) => appendBody(d, '<p>at 14:32</p>')],
    ['link-rule', 'href on an inert record', (d) => appendBody(d, '<a data-record="x" data-state="absent" href="https://x.com/leak">x</a>')],
    ['link-rule', 'unregistered external link', (d) => appendBody(d, '<a href="https://example.org/">e</a>')],
    ['address-scanner-matches-registry', 'stray base58 address', (d) => appendBody(d, `<p>${SYNTH_STRAY}</p>`)],
    ['address-scanner-matches-registry', 'stray 0x address', (d) => appendBody(d, `<p>0x${'ab'.repeat(20)}</p>`)],
    ['palette-hex-only-in-tokens', 'hex literal in styles', (d) => appendFileSync(join(d, 'css', 'styles.css'), '\n.q{color:#123456}\n')],
    ['palette-hex-only-in-tokens', 'rgb() literal in styles', (d) => appendFileSync(join(d, 'css', 'styles.css'), '\n.q{color:rgb(1,2,3)}\n')],
    ['palette-provenance-real-pixels', 'token with wrong pixel', (d) => appendFileSync(join(d, 'css', 'tokens.css'), '\n:root{--bad:#123456; /* LOGO BOOBOT PNG.png@0,0 */}\n')],
    ['no-ch-units', 'ch unit', (d) => appendFileSync(join(d, 'css', 'styles.css'), '\n.q{width:20ch}\n')],
    ['no-ai-attribution-in-repo', 'attribution line', (d) => appendBody(d, '<!-- Co' + '-Authored-By: x -->')],
    ['logo-in-dist-and-referenced', 'logo file removed', (d) => rmSync(join(d, 'assets', 'boobot-logo-640.png'))],
    ['logo-in-dist-and-referenced', 'absolute logo path', (d) => rewrite(d, (h) => h.replace('src="assets/boobot-logo-640.png"', 'src="/assets/boobot-logo-640.png"'))],
    ['favicon', 'comment with double hyphen', (d) => rewrite(d, (h) => h, join(d, 'favicon.svg'), (s) => s.replace('<rect', '<!-- a -- b --><rect'))],
    ['copy-shares-no-2grams-with-reference', 'copied reference phrase', (d) => appendBody(d, '<p>Choose your platform, then explore marketplace</p>')],
    ['social-icons-always-present', 'icon hidden by css', (d) => appendFileSync(join(d, 'css', 'styles.css'), '\n@media (max-width:600px){.icon-btn{display:none}}\n')],
    ['market-wiring', 'market reads CA state', (d) => appendFileSync(join(d, 'js', 'market.js'), "\ndocument.querySelector('[data-ca-slot]');\n")],
    ['reduced-motion-everywhere', 'reduced-motion block removed', (d) => rewrite(d, (h) => h, join(d, 'css', 'styles.css'), (s) => s.replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*$/, ''))],
    ['no-external-assets', 'external script', (d) => appendBody(d, '<script src="https://cdn.example.net/x.js"></script>')],
  ];
  for (const [gate, label, mutate] of controls) {
    const dir = join(TMP, 'ctl-' + results.length);
    cpDir(base.dist, join(dir, 'dist'));
    mutate(join(dir, 'dist'));
    const res = await runGates({ ...base, dist: join(dir, 'dist') });
    const hit = res.find((r) => r.id === gate);
    rec(`control "${label}" trips ${gate}`, hit && !hit.pass, hit && hit.detail);
  }

  // positive controls: the same scanners must not over-reject
  const pos = [
    ['address-scanner-matches-registry', 'short 0x token is not address-shaped', (d) => appendBody(d, '<code>0x1f</code>')],
    ['address-scanner-matches-registry', 'CA slot is exempt from the scanner', (d) => appendBody(d, `<div data-ca-slot>${SYNTH_STRAY}</div>`)],
    ['no-dates-anywhere', 'plain prose passes', (d) => appendBody(d, '<p>Nothing temporal here.</p>')],
  ];
  for (const [gate, label, mutate] of pos) {
    const dir = join(TMP, 'pos-' + results.length);
    cpDir(base.dist, join(dir, 'dist'));
    mutate(join(dir, 'dist'));
    const res = await runGates({ ...base, dist: join(dir, 'dist') });
    const hit = res.find((r) => r.id === gate);
    rec(`positive control "${label}" keeps ${gate} green`, hit && hit.pass, hit && hit.detail);
  }
  // matching a stated registry value is allowed outside the slot
  {
    const ctx = await buildTo('pos-stated', flip(baseReg, 'ca').records.find((r) => r.id === 'ca').state === 'stated' ? flip(baseReg, 'ca') : baseReg);
    appendBody(ctx.dist, `<p>${ctx.reg.records.find((r) => r.id === 'ca').value}</p>`);
    const hit = (await runGates(ctx)).find((r) => r.id === 'address-scanner-matches-registry');
    rec('address matching a stated register value is accepted outside the slot', hit.pass, hit.detail);
  }
  rmSync(TMP, { recursive: true, force: true });
  return results;
}

import { cpSync } from 'node:fs';
function cpDir(a, b) { cpSync(a, b, { recursive: true }); }
function appendBody(dist, html) {
  const p = join(dist, 'index.html');
  writeFileSync(p, read(p).replace('</body>', html + '\n</body>'));
}
function rewrite(dist, htmlFn, other, otherFn) {
  const p = join(dist, 'index.html');
  writeFileSync(p, htmlFn(read(p)));
  if (other) writeFileSync(other, otherFn(read(other)));
}

async function main() {
  const reg = loadRegister();
  const bi = await build({ out: join(ROOT, 'dist') }).catch((e) => { console.error(e.message); process.exit(1); });
  console.log('== static gates against dist/ ==');
  const res = await runGates({ dist: join(ROOT, 'dist'), reg: bi.reg, root: ROOT }, false);
  console.log('\n== branch proofs and controls (each builds to a scratch dir) ==');
  const proofs = await proveBranches(reg);
  for (const p of proofs) console.log(`${p.pass ? 'PASS' : 'FAIL'}  ${p.name}${!p.pass && p.detail ? '\n        ' + p.detail : ''}`);
  const fails = res.filter((r) => !r.pass).length + proofs.filter((p) => !p.pass).length;
  const total = res.length + proofs.length;
  console.log(`\nstatic gates: ${res.length} (${res.filter((r) => r.pass).length} pass) | proofs and controls: ${proofs.length} (${proofs.filter((p) => p.pass).length} pass) | total ${total}, failing ${fails}`);
  process.exit(fails ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
