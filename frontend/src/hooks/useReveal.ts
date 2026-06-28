import { useEffect, useRef } from "react";
import { gsap } from "gsap";

/**
 * Reveals descendants marked `.reveal` with a heavy fade-up when the section
 * enters the viewport. GSAP-driven (transform+opacity only); triggered by
 * IntersectionObserver (no scroll listeners). Respects reduced-motion.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = el.querySelectorAll<HTMLElement>(".reveal");
    if (!targets.length) return;

    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const items = Array.from(e.target.querySelectorAll<HTMLElement>(".reveal"));
          gsap.to(items, {
            opacity: 1,
            y: 0,
            duration: 0.85,
            stagger: 0.08,
            ease: "power3.out",
          });
          obs.unobserve(e.target);
        });
      },
      { threshold: 0.16 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
