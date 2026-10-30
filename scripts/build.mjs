import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { ROOT, loadRegister, rec, validateRegister, deriveHandle } from './lib.mjs';

const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const GH_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';
const ICONS = {
  x: { viewBox: '0 0 24 24', path: X_PATH, name: 'X' },
  github: { viewBox: '0 0 16 16', path: GH_PATH, name: 'GitHub' },
};
const LOGO_SRC = 'brand/LOGO BOOBOT PNG...png'; // the one with an alpha channel (colour type 6, transparent area)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function social(reg) {
  return ['x', 'github'].map((id) => {
    const r = rec(reg, id), ic = ICONS[id];
    const svg = `<svg viewBox="${ic.viewBox}" aria-hidden="true" focusable="false"><path d="${ic.path}"/></svg>`;
    if (r && r.state === 'stated' && r.url) {
      const h = deriveHandle(r.url);
      return `<a class="icon-btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-record="${id}" data-state="stated" aria-label="Boobot on ${ic.name}${h ? ' (' + esc(h) + ')' : ''}, opens in a new tab">${svg}</a>`;
    }
    return `<span class="icon-btn" role="img" aria-disabled="true" data-record="${id}" data-state="${r ? r.state : 'absent'}" aria-label="${ic.name}, pending">${svg}</span>`;
  }).join('\n    ');
}

function caSlot(reg) {
  const r = rec(reg, 'ca');
  const live = '<span class="sr-only" role="status" data-ca-live></span>';
  if (r && r.state === 'stated' && r.value) {
    return `<section class="ca-slot spot" data-ca-slot data-record="ca" data-state="stated" aria-label="Contract address"><span class="ca-label">Contract address</span><p class="ca-value" data-ca-value>${esc(r.value)}</p><button class="ca-copy" type="button" data-ca-copy aria-label="Copy contract address">Copy</button>${live}</section>`;
  }
  return `<section class="ca-slot" data-ca-slot data-record="ca" data-state="${r ? r.state : 'absent'}" aria-label="Contract address"><span class="ca-label">Contract address</span><p class="ca-value" data-ca-value>Pending</p>${live}</section>`;
}

function registerGrid(reg) {
  return reg.records.map((r) => {
    const base = `class="reg spot" data-reveal data-record="${r.id}" data-state="${r.state}"`;
    const lbl = `<span class="lbl">${esc(r.label)}</span>`;
    if (r.state !== 'stated') return `<div ${base}>${lbl}<span class="st">Pending</span></div>`;
    if ((r.id === 'x' || r.id === 'github') && r.url) {
      return `<a ${base} href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${lbl}<span class="st">${esc(deriveHandle(r.url) || 'Open')}</span></a>`;
    }
    if (r.id === 'ca') return `<a ${base} href="#top">${lbl}<span class="st">Stated</span></a>`;
    if (r.id === 'market') return `<div ${base}>${lbl}<span class="st">Live feed</span></div>`;
    return `<div ${base}>${lbl}<span class="st">${esc(r.value)}</span></div>`;
  }).join('\n      ');
}

function marketCfg(reg) {
  const m = rec(reg, 'market');
  if (!m || m.state !== 'stated') return 'data-market-state="absent"';
  return `data-market-state="stated" data-base="${esc(m.url)}" data-boosts="${esc(m.meta.boosts)}" data-pairs="${esc(m.meta.pairs)}"`;
}

async function traceFavicon(out) {
  const GRID = 128;
  const { data, info } = await sharp(join(ROOT, LOGO_SRC)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 128) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const side = Math.max(x1 - x0, y1 - y0) + 1;
  const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
  const left = Math.max(0, cx - (side >> 1)), top = Math.max(0, cy - (side >> 1));
  const crop = Math.min(side, info.width - left, info.height - top);
  const px = await sharp(join(ROOT, LOGO_SRC)).extract({ left, top, width: crop, height: crop })
    .resize(GRID, GRID, { kernel: 'lanczos3', fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const on = (x, y) => px[(y * GRID + x) * 4 + 3] >= 128;
  const open = new Map(); const rects = [];
  for (let y = 0; y <= GRID; y++) {
    const runs = new Map();
    if (y < GRID) for (let x = 0; x < GRID; x++) {
      if (!on(x, y)) continue;
      let w = 1; while (x + w < GRID && on(x + w, y)) w++;
      runs.set(x + ',' + w, [x, w]); x += w - 1;
    }
    for (const [k, v] of open) if (!runs.has(k)) { rects.push([v.x, v.y, v.w, y - v.y]); open.delete(k); }
    for (const [k, [x, w]] of runs) if (!open.has(k)) open.set(k, { x, y, w });
  }
  const d = rects.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#f5f2eb"/><path transform="translate(4 4) scale(.1875)" fill="#181818" d="${d}"/></svg>\n`;
  writeFileSync(out, svg);
  return rects.length;
}

export async function build({ registerPath, out = join(ROOT, 'dist') } = {}) {
  const reg = loadRegister(registerPath);
  const errs = validateRegister(reg);
  if (errs.length) throw new Error('register invalid:\n  ' + errs.join('\n  '));

  rmSync(out, { recursive: true, force: true });
  for (const d of ['assets', 'css', 'js']) mkdirSync(join(out, d), { recursive: true });

  // logo: copy original, then premultiplied downscales (source has pure-black RGB under alpha 0)
  const logo = join(ROOT, LOGO_SRC);
  if (!existsSync(logo)) throw new Error('logo missing: ' + LOGO_SRC);
  copyFileSync(logo, join(out, 'assets', 'boobot-logo.png'));
  for (const s of [640, 192]) {
    const pre = await sharp(logo).ensureAlpha().resize(s, s, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(join(out, 'assets', `boobot-logo-${s}.png`), pre);
  }
  await traceFavicon(join(out, 'favicon.svg'));

  cpSync(join(ROOT, 'src', 'css'), join(out, 'css'), { recursive: true });
  cpSync(join(ROOT, 'src', 'js'), join(out, 'js'), { recursive: true });

  let html = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
  html = html.replace('<!--@social-->', social(reg)).replace('<!--@ca-->', caSlot(reg))
    .replace('<!--@register-->', registerGrid(reg)).replace('<!--@market-cfg-->', marketCfg(reg));
  writeFileSync(join(out, 'index.html'), html);
  return { out, reg };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  build({ registerPath: opt('--register'), out: opt('--out') && resolve(opt('--out')) })
    .then(({ out }) => console.log('built ->', out))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
