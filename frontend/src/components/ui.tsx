import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { IconArrow } from "./icons";

type Variant = "primary" | "magenta" | "ghost";
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  arrow?: boolean;
  block?: boolean;
  sm?: boolean;
}

export function Button({ variant = "primary", arrow, block, sm, children, className = "", ...rest }: BtnProps) {
  const v = variant === "primary" ? "" : variant;
  return (
    <button className={`btn ${v} ${block ? "block" : ""} ${sm ? "sm" : ""} ${className}`} {...rest}>
      <span>{children}</span>
      {arrow && (
        <span className="icoCircle">
          <IconArrow size={13} />
        </span>
      )}
    </button>
  );
}

const BAND_LABEL: Record<string, string> = {
  FAIR: "fair",
  BORDERLINE: "borderline",
  EXTRACTIVE: "extractive",
  PREDATORY: "predatory",
  PENDING: "pending",
  "": "pending",
};

export function BandPill({ band }: { band: string }) {
  const key = (band || "PENDING").toUpperCase();
  return (
    <span className="bandpill" style={{ ["--bandc" as any]: `var(--band-${key})` }}>
      {BAND_LABEL[key] ?? key.toLowerCase()}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

export function GlassCard({ children, className = "", ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`glass ${className}`} {...rest}>
      {children}
    </div>
  );
}
