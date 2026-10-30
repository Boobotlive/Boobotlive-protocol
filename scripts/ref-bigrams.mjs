import { writeFileSync } from 'node:fs';
import { visibleText, bigrams, hash } from './text.mjs';

const base = 'https://masbot.si';
const pages = ['/', '/stats', '/tokenomics', '/marketplace', '/getting-started', '/compare', '/bots', '/bot-subscriptions', '/token-launch', '/bot-payments', '/demo/index.html'];
const all = new Set();
for (const p of pages) {
  try {
    const r = await fetch(base + p);
    if (!r.ok) { console.log('skip', p, r.status); continue; }
    const g = bigrams(visibleText(await r.text()));
    g.forEach((b) => all.add(hash(b)));
    console.log(p, g.size);
  } catch (e) { console.log('fail', p, e.message); }
}
writeFileSync(new URL('./ref-bigrams.json', import.meta.url), JSON.stringify([...all].sort()));
console.log('total', all.size);
