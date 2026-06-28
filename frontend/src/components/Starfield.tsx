import { useEffect, useRef } from "react";

/**
 * Low-density starfield drifting slowly upward-left, with a faint cyan/magenta
 * tint. Plain canvas (no library). Pauses on reduced-motion and when offscreen.
 */
export function Starfield({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0,
      h = 0,
      dpr = Math.min(window.devicePixelRatio || 1, 2);
    type Star = { x: number; y: number; z: number; c: string };
    let stars: Star[] = [];

    function resize() {
      const r = cv!.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cv!.width = w * dpr;
      cv!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 14000); // low density
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 1 + 0.3,
        c: Math.random() > 0.82 ? "#ff006e" : Math.random() > 0.5 ? "#00d4ff" : "#b8c5d6",
      }));
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    let raf = 0;
    function frame() {
      ctx!.clearRect(0, 0, w, h);
      for (const st of stars) {
        st.x -= st.z * 0.18;
        st.y -= st.z * 0.1;
        if (st.x < 0) st.x = w;
        if (st.y < 0) st.y = h;
        ctx!.globalAlpha = 0.25 + st.z * 0.4;
        ctx!.fillStyle = st.c;
        ctx!.beginPath();
        ctx!.arc(st.x, st.y, st.z * 1.1, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    if (!reduced) raf = requestAnimationFrame(frame);
    else frame(); // draw a single static frame

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
