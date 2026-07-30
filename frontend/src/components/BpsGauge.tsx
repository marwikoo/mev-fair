import { useEffect, useRef } from "react";
import Konva from "konva";

const BAND_COLOR: Record<string, string> = {
  FAIR: "#00d4ff",
  BORDERLINE: "#ffc24b",
  EXTRACTIVE: "#ff8a3d",
  PREDATORY: "#ff006e",
  PENDING: "#6a7a92",
};

/**
 * Konva radial gauge: sweeps an arc proportional to extracted bps (0..300+
 * clamped), tinted by band. Animates to the value on change.
 */
export function BpsGauge({ bps, band, size = 150 }: { bps: number; band: string; size?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const arcRef = useRef<Konva.Arc | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stage = new Konva.Stage({ container: el, width: size, height: size });
    const layer = new Konva.Layer();
    stage.add(layer);
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 12;

    // track
    layer.add(
      new Konva.Arc({
        x: cx,
        y: cy,
        innerRadius: radius - 8,
        outerRadius: radius,
        angle: 270,
        rotation: 135,
        fill: "rgba(184,197,214,0.12)",
      })
    );
    const arc = new Konva.Arc({
      x: cx,
      y: cy,
      innerRadius: radius - 8,
      outerRadius: radius,
      angle: 0,
      rotation: 135,
      fill: BAND_COLOR[band] ?? "#00d4ff",
      shadowColor: BAND_COLOR[band] ?? "#00d4ff",
      shadowBlur: 12,
      shadowOpacity: 0.6,
    });
    arcRef.current = arc;
    layer.add(arc);
    layer.draw();

    const target = Math.max(0, Math.min(1, bps / 300)) * 270;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      arc.angle(target);
      layer.draw();
    } else {
      const anim = new Konva.Animation((frame) => {
        if (!frame) return;
        const t = Math.min(1, frame.time / 800);
        arc.angle(target * (1 - Math.pow(1 - t, 3)));
        if (t >= 1) anim.stop();
      }, layer);
      anim.start();
    }

    return () => {
      stage.destroy();
    };
  }, [bps, band, size]);

  return <div ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}
