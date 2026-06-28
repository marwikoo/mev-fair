import type { SVGProps } from "react";

// Custom thin-line icon set for TIME·MACHINE. Single 1.6 stroke weight,
// currentColor, 24px grid. No icon library — hand-drawn paths.
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function IconRewind({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M21 12a9 9 0 1 1-3.1-6.8" />
      <path d="M21 4v4h-4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function IconBundle({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="M3 12l9 4.5L21 12" />
      <path d="M3 16.5 12 21l9-4.5" />
    </svg>
  );
}

export function IconGavel({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="m14 5 5 5" />
      <path d="M16.5 2.5 21.5 7.5 18 11 12 5l3.5-3.5Z" transform="translate(-2 0)" />
      <path d="m11 8-7 7 4 4 7-7" />
      <path d="M3 22h9" />
    </svg>
  );
}

export function IconScale({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M5 6h14" />
      <path d="M5 6 2.5 12a3 3 0 0 0 5 0L5 6Z" />
      <path d="M19 6l-2.5 6a3 3 0 0 0 5 0L19 6Z" />
    </svg>
  );
}

export function IconShield({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M12 3 5 6v5c0 4.2 3 7.7 7 9 4-1.3 7-4.8 7-9V6l-7-3Z" />
      <path d="m9 11.5 2 2 4-4" />
    </svg>
  );
}

export function IconCoins({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <ellipse cx="9" cy="7" rx="6" ry="3" />
      <path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" />
      <path d="M3 12c0 1.7 2.7 3 6 3" />
      <ellipse cx="16" cy="15" rx="5" ry="2.6" />
      <path d="M11 15v3c0 1.4 2.2 2.6 5 2.6s5-1.2 5-2.6v-3" />
    </svg>
  );
}

export function IconFlag({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 3.5L16 11H5" />
    </svg>
  );
}

export function IconSpark({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
    </svg>
  );
}

export function IconArrow({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function IconLink({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

export function IconChevron({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
