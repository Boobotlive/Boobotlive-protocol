import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STATES = ['stated', 'absent', 'unconfirmed'];
export const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const loadRegister = (p = join(ROOT, 'register.json')) => JSON.parse(readFileSync(p, 'utf8'));
export const rec = (reg, id) => reg.records.find((r) => r.id === id);

export function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

// Register pattern: an absent or unconfirmed record carries no value and no url.
export function validateRegister(reg) {
  const errs = [];
  const seen = new Set();
  for (const r of reg.records) {
    if (seen.has(r.id)) errs.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!STATES.includes(r.state)) errs.push(`${r.id}: bad state ${r.state}`);
    if (!r.label || !r.source || !r.scope) errs.push(`${r.id}: missing label/source/scope`);
    if (r.state !== 'stated' && ('value' in r || 'url' in r)) errs.push(`${r.id}: inert record carries value or url`);
    if (r.state === 'stated' && !r.value && !r.url) errs.push(`${r.id}: stated record has neither value nor url`);
    if (r.id === 'ca' && r.state === 'stated' && !SOLANA_ADDR.test(r.value || '')) errs.push('ca: stated value is not a Solana address');
    if ((r.id === 'x' || r.id === 'github') && r.state === 'stated' && !/^https:\/\//.test(r.url || '')) errs.push(`${r.id}: stated url must be https`);
  }
  return errs;
}

// Link rule: only the URL is stored; the handle is derived from it.
export function deriveHandle(url) {
  try { return '@' + new URL(url).pathname.split('/').filter(Boolean)[0]; } catch { return null; }
}
