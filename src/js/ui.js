import { motionOff } from './spring.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export function initProgress() {
  const bar = $('[data-progress]');
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
  addEventListener('resize', paint);
  paint();
}

export function initTheme() {
  const btn = $('[data-theme-toggle]');
  const sync = () => btn.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('boobot-theme', next); } catch { /* storage blocked */ }
    sync();
  });
  sync();
}

export function initMenu() {
  const m = $('[data-menu]');
  if (!m) return;
  document.addEventListener('click', (e) => { if (m.open && !m.contains(e.target)) m.open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.open) { m.open = false; $('summary', m).focus(); } });
  $$('a', m).forEach((a) => a.addEventListener('click', () => { m.open = false; }));
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

export function initTabs() {
  $$('[data-tabs]').forEach((box) => {
    const tabs = $$('[role="tab"]', box);
    const thumb = $('.tab-thumb', box);
    const place = () => {
      if (!thumb) return;
      const t = tabs.find((x) => x.getAttribute('aria-selected') === 'true');
      thumb.style.width = `${t.offsetWidth}px`;
      thumb.style.transform = `translateX(${t.offsetLeft - 4}px)`;
    };
    const select = (t, focus) => {
      tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === t)); x.tabIndex = x === t ? 0 : -1; });
      place();
      if (focus) t.focus();
      if (t.getAttribute('aria-controls')) {
        tabs.forEach((x) => {
          const p = document.getElementById(x.getAttribute('aria-controls'));
          if (!p) return;
          p.hidden = x !== t;
          if (x === t && !motionOff()) { p.classList.remove('pane-in'); void p.offsetWidth; p.classList.add('pane-in'); }
        });
      }
      box.dispatchEvent(new CustomEvent('tabchange', { detail: t }));
    };
    tabs.forEach((t, i) => {
      t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
      });
    });
    addEventListener('resize', place);
    requestAnimationFrame(place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  });
}

export function initCa() {
  const slot = $('[data-ca-slot]');
  if (!slot || slot.dataset.state !== 'stated') return;
  const val = $('[data-ca-value]', slot), btn = $('[data-ca-copy]', slot), live = $('[data-ca-live]', slot);
  let t = 0;
  const go = async () => {
    const ok = await copyText(val.textContent.trim());
    btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    btn.classList.toggle('is-done', ok);
    live.textContent = ok ? 'Contract address copied' : 'Copy failed';
    clearTimeout(t);
    t = setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('is-done'); live.textContent = ''; }, 1600);
  };
  btn.addEventListener('click', go);
  val.addEventListener('click', go);
}

export function initParallax() {
  const stage = $('[data-stage]');
  if (!stage || motionOff()) return;
  const layers = $$('[data-depth]', stage).map((el) => ({ el, d: Number(el.dataset.depth) }));
  const mesh = $('.mesh');
  let tx = 0, ty = 0, cx = 0, cy = 0, sy = 0, raf = 0;
  const loop = () => {
    cx += (tx - cx) * 0.09; cy += (ty - cy) * 0.09;
    const near = Math.abs(tx - cx) < 0.002 && Math.abs(ty - cy) < 0.002;
    for (const { el, d } of layers) el.style.transform = `translate3d(${(cx * d).toFixed(2)}px, ${(cy * d - sy * d * 0.35).toFixed(2)}px, 0)`;
    if (mesh) mesh.style.transform = `translate3d(0, ${(sy * 40).toFixed(2)}px, 0)`;
    raf = near ? 0 : requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; kick();
  }, { passive: true });
  addEventListener('scroll', () => {
    const r = stage.getBoundingClientRect();
    sy = Math.max(-1, Math.min(1, r.top / innerHeight)); kick();
  }, { passive: true });
  kick();
}
