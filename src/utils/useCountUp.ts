import { useEffect, useRef, useState } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Animates 0 → target (ease-out cubic). Jumps straight to the value when the
 *  user prefers reduced motion. Purely visual: the real number is always `target`. */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (prefersReducedMotion()) { setValue(target); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - p) ** 3;
      setValue(Math.round(eased * target));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, durationMs]);
  return value;
}
