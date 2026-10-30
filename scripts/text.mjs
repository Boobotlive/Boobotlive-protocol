import { createHash } from 'node:crypto';

// Function words. A shared phrase only counts when both of its words carry meaning, so
// "the market" is ignored while "price change" is not.
const STOP = new Set(('a an the this that these those each every any all some no not nor more most other another such same one ' +
  'i me my we us our you your yours he she his her him it its they them their there here what which who whom whose where when how why ' +
  'is are was were be been being am do does did have has had will would can could should may might must shall ' +
  'to of in on at by for with from into onto over under after before until off up down out about through between as than per via across within without ' +
  'and or but so yet if then because while though also just only very too still even ever never always ' +
  'get got let make made need needs').split(' '));

export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<head[\s\S]*?<\/head>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ');
}

export function bigrams(text) {
  const words = text.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9$]+/g) || [];
  const out = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    if (STOP.has(words[i]) || STOP.has(words[i + 1])) continue;
    out.add(words[i] + ' ' + words[i + 1]);
  }
  return out;
}

export const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
