export const motionOff = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Damped harmonic solver, semi-implicit Euler on a fixed step. zeta = c / (2 * sqrt(k * m)).
export function spring({ from = 0, to = 1, k = 170, c = 19, m = 1, delay = 0, onUpdate, onDone }) {
  if (motionOff()) { onUpdate(to); onDone && onDone(); return () => {}; }
  const STEP = 1 / 120;
  let x = from, v = 0, last = 0, acc = 0, raf = 0, dead = false;
  const tick = (now) => {
    if (dead) return;
    if (!last) last = now;
    acc += Math.min(0.05, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      const a = (-k * (x - to) - c * v) / m;
      v += a * STEP;
      x += v * STEP;
      acc -= STEP;
    }
    if (Math.abs(x - to) < 0.0008 && Math.abs(v) < 0.0008) { onUpdate(to); onDone && onDone(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(tick);
  };
  const t = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
  return () => { dead = true; clearTimeout(t); cancelAnimationFrame(raf); };
}

export function revealOnScroll() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el, delay) => {
    spring({
      delay,
      onUpdate: (x) => {
        el.style.opacity = String(Math.max(0, Math.min(1, x)));
        el.style.transform = `translate3d(0, ${((1 - x) * 34).toFixed(2)}px, 0) scale(${(0.97 + 0.03 * x).toFixed(4)})`;
      },
      onDone: () => { el.style.opacity = '1'; el.style.transform = ''; },
    });
  };
  if (motionOff() || !('IntersectionObserver' in window)) { els.forEach((e) => { e.style.opacity = '1'; }); return; }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const group = en.target.parentElement && en.target.parentElement.hasAttribute('data-reveal-group') ? en.target.parentElement : null;
      const idx = group ? [...group.children].indexOf(en.target) : 0;
      show(en.target, idx * 85);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => io.observe(e));
}
