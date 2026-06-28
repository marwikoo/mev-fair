import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import s from "./Landing.module.css";
import { Eyebrow } from "../components/ui";
import { Starfield } from "../components/Starfield";
import { StageFlow } from "../components/StageFlow";
import { Accordion } from "../components/Accordion";
import {
  IconRewind,
  IconBundle,
  IconFlag,
  IconLink,
  IconSpark,
  IconCoins,
  IconGavel,
  IconScale,
  IconShield,
} from "../components/icons";
import { useReveal } from "../hooks/useReveal";
import { getCountByBand, type BandCounts } from "../contractService";
import { CONTRACT_ADDRESS } from "../chain";

const NAV = [
  { label: "How it works", href: "#how" },
  { label: "Mechanics", href: "#mechanics" },
  { label: "The Court", href: "#court" },
  { label: "FAQ", href: "#faq" },
];

function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={`${s.nav} ${solid ? s.navSolid : ""}`}>
      <div className={`wrap ${s.navInner}`}>
        <Link to="/" className={s.brand} aria-label="Time-Machine home">
          <span className={s.brandGlyph}>
            <IconRewind size={18} />
          </span>
          <b>TIME&middot;MACHINE</b>
        </Link>
        <nav className={s.navlinks} aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <Link to="/court" className={`btn sm ${s.navcta}`}>
          Enter the Court
          <span className="icoCircle">
            <IconScale size={12} />
          </span>
        </Link>
      </div>
    </header>
  );
}

function HeroGlyph() {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ringOuter = el.querySelector(".ringOuter");
    const arcs = el.querySelectorAll(".arc");
    const tl = gsap.timeline({ repeat: -1, defaults: { ease: "none" } });
    tl.to(ringOuter, { rotation: 360, transformOrigin: "50% 50%", duration: 60 }, 0);
    gsap.fromTo(
      arcs,
      { opacity: 0.15 },
      { opacity: 0.7, duration: 1.6, stagger: 0.25, yoyo: true, repeat: -1, ease: "sine.inOut" }
    );
    return () => {
      tl.kill();
      gsap.killTweensOf(arcs);
    };
  }, []);
  return (
    <svg ref={ref} className={s.glyph} viewBox="0 0 320 320" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="hg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#00d4ff" />
          <stop offset="100%" stopColor="#ff006e" />
        </linearGradient>
      </defs>
      <g className="ringOuter">
        <circle cx="160" cy="160" r="148" stroke="url(#hg)" strokeWidth="1" opacity="0.4" />
        {Array.from({ length: 60 }).map((_, i) => (
          <line
            key={i}
            x1="160"
            y1="18"
            x2="160"
            y2={i % 5 === 0 ? 30 : 25}
            stroke="#b8c5d6"
            strokeWidth="1"
            opacity={i % 5 === 0 ? 0.5 : 0.2}
            transform={`rotate(${i * 6} 160 160)`}
          />
        ))}
      </g>
      <circle className="arc" cx="160" cy="160" r="112" stroke="#00d4ff" strokeWidth="1.5" strokeDasharray="40 600" opacity="0.4" />
      <circle className="arc" cx="160" cy="160" r="92" stroke="#ff006e" strokeWidth="1.5" strokeDasharray="30 480" opacity="0.4" />
      <circle cx="160" cy="160" r="70" stroke="#b8c5d6" strokeWidth="1" opacity="0.18" />
      {/* rewind chevrons at the core */}
      <g stroke="url(#hg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M168 144l-20 16 20 16" />
        <path d="M150 144l-20 16 20 16" />
      </g>
      <circle cx="160" cy="160" r="5" fill="#eaf2ff" />
    </svg>
  );
}

function Hero() {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.from("[data-hx]", {
        opacity: 0,
        y: 26,
        duration: 0.9,
        stagger: 0.12,
        ease: "power3.out",
        delay: 0.1,
      });
    }, root);
    return () => ctx.revert();
  }, []);
  return (
    <section className={s.hero} ref={root}>
      <Starfield className={s.stars} />
      <div className={`wrap ${s.heroGrid}`}>
        <div className={s.heroCopy}>
          <div data-hx>
            <Eyebrow>actual ↔ counterfactual</Eyebrow>
          </div>
          <h1 className={s.h1} data-hx>
            Rewind the block.
            <br />
            Price the <em>squeeze.</em>
          </h1>
          <p className={s.lede} data-hx>
            mev-fair replays a DEX bundle against a fair-ordering counterfactual, scores the value
            extracted in basis points, and pays it back to the victims on-chain.
          </p>
          <div className={s.heroCtas} data-hx>
            <Link to="/court" className="btn">
              <span>Enter the Court</span>
              <span className="icoCircle">
                <IconScale size={13} />
              </span>
            </Link>
            <a href="#mechanics" className="textlink">
              Read the mechanics ↓
            </a>
          </div>
        </div>
        <div className={s.heroArt} data-hx>
          <HeroGlyph />
        </div>
      </div>
    </section>
  );
}

const STATS = [
  { k: "GenLayer-native", v: "validator-scored" },
  { k: "On-chain rebates", v: "accrual ledger" },
  { k: "LLM jury", v: "4 reconciled sites" },
  { k: "Appeal-ready", v: "second oracle" },
];

function WhatIs() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="section" id="what" ref={ref}>
      <div className="wrap">
        <div className="section-head">
          <span className="reveal">
            <Eyebrow>What is mev-fair</Eyebrow>
          </span>
          <h2 className="reveal">A small-claims court for sandwiched trades.</h2>
          <p className="reveal">
            When a solver reorders a block to extract value, the victims rarely get it back. mev-fair
            turns that extraction into a measurable number and a withdrawable rebate — judged by a
            GenLayer validator panel, not a centralized referee.
          </p>
        </div>
        <div className={s.stats}>
          {STATS.map((st) => (
            <div key={st.k} className={`glass ${s.stat} reveal`}>
              <b>{st.k}</b>
              <span>{st.v}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: IconBundle, t: "Submit a bundle", d: "A solver posts a DEX bundle hash, its swaps, and a fair-trade attestation, backed by a bond." },
  { icon: IconFlag, t: "File a complaint", d: "Victims point at their own transaction hash and the harm they claim, in basis points." },
  { icon: IconLink, t: "Attach a counterfactual", d: "Anyone attaches an oracle URL describing the fair ordering. An LLM cleans it to canonical form." },
  { icon: IconSpark, t: "Score the extraction", d: "GenLayer validators replay actual vs counterfactual and reconcile the extracted bps." },
  { icon: IconCoins, t: "Withdraw the rebate", d: "Credit accrues pro-rata to victims from the solver bond. They pull it whenever they like." },
];

function HowItWorks() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="section" id="how" ref={ref}>
      <div className="wrap">
        <div className="section-head">
          <span className="reveal">
            <Eyebrow>How it works</Eyebrow>
          </span>
          <h2 className="reveal">Five steps from extraction to rebate.</h2>
        </div>
        <ol className={s.steps}>
          {STEPS.map((st, i) => {
            const Icon = st.icon;
            return (
              <li key={st.t} className={`glass ${s.step} reveal`}>
                <span className={s.stepNo}>{String(i + 1).padStart(2, "0")}</span>
                <span className={s.stepIcon}>
                  <Icon size={20} />
                </span>
                <h3>{st.t}</h3>
                <p>{st.d}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

const MECH = [
  {
    icon: IconBundle,
    t: "Pipeline of stages",
    d: "Every write runs through named stages — Ingest, Parse, CFL, Score, Judge, Rebate, Appeal — each appending to an auditable stage log on the bundle.",
  },
  {
    icon: IconSpark,
    t: "LLM consensus",
    d: "Four distinct model sites (clean, score, appeal-rescore, tie-break) are reconciled by a custom bps-tolerance predicate, not naive string equality.",
  },
  {
    icon: IconShield,
    t: "Appeal",
    d: "A solver can post an appeal bond and a second oracle. A fresh score is reconciled against the first; the higher-confidence figure or a tie-breaker wins.",
  },
];

function Mechanics() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="section" id="mechanics" ref={ref}>
      <div className="wrap">
        <div className="section-head">
          <span className="reveal">
            <Eyebrow>Mechanics</Eyebrow>
          </span>
          <h2 className="reveal">Three moving parts, one verdict.</h2>
        </div>
        <div className={s.mechCols}>
          {MECH.map((m) => {
            const Icon = m.icon;
            return (
              <article key={m.t} className={`${s.mechCol} reveal`}>
                <span className={s.mechIcon}>
                  <Icon size={22} />
                </span>
                <h3>{m.t}</h3>
                <p>{m.d}</p>
              </article>
            );
          })}
        </div>
        <div className={`glass ${s.flowCard} reveal`}>
          <div className={s.flowHead}>
            <span className="mono">stage_log</span>
            <span className={s.flowHint}>bundle progressing through the pipeline</span>
          </div>
          <StageFlow />
        </div>
      </div>
    </section>
  );
}

const BANDS: { k: keyof BandCounts; label: string }[] = [
  { k: "FAIR", label: "fair" },
  { k: "BORDERLINE", label: "borderline" },
  { k: "EXTRACTIVE", label: "extractive" },
  { k: "PREDATORY", label: "predatory" },
  { k: "PENDING", label: "pending" },
];

function TheCourt() {
  const ref = useReveal<HTMLDivElement>();
  const [counts, setCounts] = useState<BandCounts | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    getCountByBand()
      .then((c) => on && setCounts(c))
      .catch(() => on && setErr(true));
    return () => {
      on = false;
    };
  }, []);
  return (
    <section className="section" id="court" ref={ref}>
      <div className="wrap">
        <div className="section-head">
          <span className="reveal">
            <Eyebrow>The Court · live</Eyebrow>
          </span>
          <h2 className="reveal">Bundles by band, on-chain right now.</h2>
          <p className="reveal">
            Read straight from <code>count_by_band()</code> on the deployed contract.
          </p>
        </div>
        <div className={s.bands}>
          {BANDS.map((b) => (
            <div
              key={b.k}
              className={`glass ${s.bandCard} reveal`}
              style={{ ["--bandc" as any]: `var(--band-${b.k})` }}
            >
              <b className="tnum">{counts ? counts[b.k] : err ? "—" : "··"}</b>
              <span>{b.label}</span>
            </div>
          ))}
        </div>
        <div className={`${s.courtCta} reveal`}>
          <Link to="/court" className="btn">
            <span>Open the workspace</span>
            <span className="icoCircle">
              <IconGavel size={13} />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: "Why GenLayer?",
    a: "Scoring extraction needs judgment a pure EVM contract can't make. GenLayer validators each run the LLM and web fetches, then reconcile — so the verdict is decentralized, not a single oracle's call.",
  },
  {
    q: "What is a counterfactual?",
    a: "The ordering the block 'should' have had if the solver hadn't reordered for profit. An off-chain oracle supplies it by URL; an LLM normalizes it to a canonical list of transactions and expected outcomes.",
  },
  {
    q: "How is the score reconciled?",
    a: "Each validator returns extracted basis points plus a confidence. They agree when the bps are within a tolerance band and confidences are close — a custom predicate rather than exact-match equality.",
  },
  {
    q: "Can the solver appeal?",
    a: "Yes. The solver posts an appeal bond and a second oracle URL. A fresh score is run; if it lands within tolerance of the original a tie-breaker decides, otherwise the higher-confidence figure stands.",
  },
  {
    q: "Is my data private?",
    a: "Everything you submit — bundle hashes, swaps, oracle URLs — is public on-chain by design, because the court has to be auditable. Don't put secrets in a complaint.",
  },
];

function FaqSection() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="section" id="faq" ref={ref}>
      <div className="wrap">
        <div className="section-head">
          <span className="reveal">
            <Eyebrow>FAQ</Eyebrow>
          </span>
          <h2 className="reveal">Questions before you enter.</h2>
        </div>
        <div className="reveal">
          <Accordion items={FAQ} />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`wrap ${s.footerInner}`}>
        <span className={s.footBrand}>
          <IconRewind size={15} /> TIME·MACHINE
        </span>
        <span className={s.footMid}>An MEV-fairness rebate court on GenLayer studionet.</span>
        <a
          className="mono"
          href={`https://studio.genlayer.com/contracts/${CONTRACT_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
        >
          {CONTRACT_ADDRESS.slice(0, 6)}…{CONTRACT_ADDRESS.slice(-4)}
        </a>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <WhatIs />
        <HowItWorks />
        <Mechanics />
        <TheCourt />
        <FaqSection />
      </main>
      <Footer />
    </>
  );
}
