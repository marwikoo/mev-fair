import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { parseEther, formatEther } from "viem";
import s from "./Court.module.css";
import { Button, BandPill } from "../components/ui";
import { BpsGauge } from "../components/BpsGauge";
import {
  IconRewind,
  IconBundle,
  IconFlag,
  IconLink,
  IconSpark,
  IconCoins,
  IconShield,
  IconScale,
  IconGavel,
  IconChevron,
} from "../components/icons";
import { useToast } from "../components/Toast";
import { useWriteClient } from "../useWriteClient";
import { shortHash, shortAddr, stageLogLabel, parseEnvelope } from "../lib/format";
import { loadTracked, trackBundle, type TrackedBundle } from "../store";
import {
  submitBundle,
  fileComplaint,
  attachCounterfactual,
  score,
  disburseRebate,
  appeal,
  withdrawCredit,
  slashSolver,
  computeBundleId,
  getBundle,
  getStageLog,
  getComplaints,
  getPendingCredit,
  getSolverRecord,
  type BundleView,
  type ComplaintView,
  type SolverRecordView,
} from "../contractService";

type RunResult = { ok: boolean; error?: string };
type RunFn = (label: string, fn: (client: any) => Promise<void>) => Promise<RunResult>;

const PIPELINE = ["INGEST", "PARSE", "CFL", "SCORE", "JUDGE", "REBATE", "APPEAL"];

// labeled controls — input/select/textarea wrapped in their <label> for
// implicit association (accessibility).
function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="fl-wrap">
      <span className="fl">{label}</span>
      <input className="field" {...rest} />
    </label>
  );
}
function Area({ label, ...rest }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="fl-wrap">
      <span className="fl">{label}</span>
      <textarea className="field" {...rest} />
    </label>
  );
}
function Sel({
  label,
  children,
  ...rest
}: { label: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="fl-wrap">
      <span className="fl">{label}</span>
      <select className="field" {...rest}>
        {children}
      </select>
    </label>
  );
}

function gen(wei: string): string {
  try {
    const v = formatEther(BigInt(wei || "0"));
    return v.length > 10 ? Number(v).toFixed(4) : v;
  } catch {
    return "0";
  }
}

// ── stage timeline ──────────────────────────────────────────────────
function StageTimeline({ log }: { log: string[] }) {
  const reached = new Set<string>();
  const detail = new Map<string, string>();
  for (const e of log) {
    const { stage, detail: d } = stageLogLabel(e);
    reached.add(stage);
    detail.set(stage, d);
  }
  return (
    <div className={s.timeline}>
      <div className={s.timelineRail} />
      <ol className={s.timelineTrack}>
        {PIPELINE.map((st) => {
          const on = reached.has(st);
          return (
            <li key={st} className={`${s.tnode} ${on ? s.ton : ""}`}>
              <span className={s.tdot} />
              <span className={s.tlabel}>{st}</span>
              <span className={s.tdetail}>{on ? detail.get(st) || "ok" : "—"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── action card shell (collapsible accordion item) ──────────────────
const AccordionCtx = createContext<{ openId: string; setOpenId: (id: string) => void }>({
  openId: "",
  setOpenId: () => {},
});

function ActionCard({
  icon: Icon,
  name,
  desc,
  cta,
  onRun,
  disabled,
  variant,
  children,
}: {
  icon: (p: { size?: number }) => JSX.Element;
  name: string;
  desc: string;
  cta: string;
  onRun: () => Promise<RunResult>;
  disabled?: boolean;
  variant?: "primary" | "magenta";
  children?: React.ReactNode;
}) {
  const { openId, setOpenId } = useContext(AccordionCtx);
  const open = openId === name;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    const r = await onRun();
    if (!r.ok && r.error) setErr(r.error);
    setBusy(false);
  }
  return (
    <div className={`${s.action} ${open ? s.actionOpen : ""}`}>
      <button
        type="button"
        className={s.actionHead}
        aria-expanded={open}
        onClick={() => setOpenId(open ? "" : name)}
      >
        <span className={s.actionIcon}>
          <Icon size={18} />
        </span>
        <div className={s.actionHeadText}>
          <h3 className="mono">{name}</h3>
          <p>{desc}</p>
        </div>
        <span className={`${s.actionChevron} ${open ? s.actionChevronOpen : ""}`} aria-hidden="true">
          <IconChevron size={16} />
        </span>
      </button>
      {open && (
        <div className={s.actionBody}>
          {children}
          <Button variant={variant ?? "primary"} block arrow disabled={disabled || busy} onClick={go}>
            {busy ? "Working…" : cta}
          </Button>
          {err && (
            <p className={s.actionErr} role="alert">
              {err}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── individual panels (module-level so input focus is stable) ────────
function PanelSubmit({ run, onCreated }: { run: RunFn; onCreated: (b: TrackedBundle) => void }) {
  const [blockNo, setBlockNo] = useState("19000000");
  const [hash, setHash] = useState("0xbundle01");
  const [swaps, setSwaps] = useState(
    '[{"tx":"0xvictimSwap","dir":"buy","amount":4200},{"tx":"0xattackerFront","dir":"buy","amount":90000},{"tx":"0xattackerBack","dir":"sell","amount":90000}]'
  );
  const [attest, setAttest] = useState("fair-ordering attested by solver");
  const [bond, setBond] = useState("1");
  return (
    <ActionCard
      icon={IconBundle}
      name="submit_bundle"
      desc="Post a DEX bundle and a fair-trade attestation, backed by a solver bond."
      cta="Submit bundle"
      onRun={async () => {
        try {
          JSON.parse(swaps);
        } catch {
          return { ok: false, error: "Swaps blob must be valid JSON (a list of {tx,...})." };
        }
        const bn = Number(blockNo);
        const r = await run("Submit bundle", async (c) => {
          await submitBundle(c, bn, hash, swaps, attest, parseEther(bond.trim() || "0"));
        });
        if (r.ok) {
          const id = await computeBundleId(bn, hash.trim());
          onCreated({ bundleId: id, blockNo: bn, bundleHash: hash.trim(), label: `block #${bn}`, addedAt: Date.now(), swapsBlob: swaps, oracleUrl: "" });
        }
        return r;
      }}
    >
      <div className={s.two}>
        <Field label="block no" value={blockNo} onChange={(e) => setBlockNo(e.target.value)} inputMode="numeric" />
        <Field label="solver bond · GEN" value={bond} onChange={(e) => setBond(e.target.value)} inputMode="decimal" />
      </div>
      <Field label="bundle hash" value={hash} onChange={(e) => setHash(e.target.value)} />
      <Area label="swaps blob · json" value={swaps} onChange={(e) => setSwaps(e.target.value)} />
      <Field label="fair attestation" value={attest} onChange={(e) => setAttest(e.target.value)} />
    </ActionCard>
  );
}

const KINDS = ["sandwich", "back-run", "front-run", "jit-lp", "censorship"];

function PanelComplaint({ run, selectedId }: { run: RunFn; selectedId: string }) {
  const [bid, setBid] = useState(selectedId);
  const [victimTx, setVictimTx] = useState("0xvictimSwap");
  const [kind, setKind] = useState("sandwich");
  const [harm, setHarm] = useState("40");
  const [bond, setBond] = useState("1");
  useEffect(() => setBid(selectedId), [selectedId]);
  return (
    <ActionCard
      icon={IconFlag}
      name="file_complaint"
      desc="Point at your victim transaction and the harm you claim, in bps."
      cta="File complaint"
      variant="magenta"
      disabled={!bid}
      onRun={() =>
        run("File complaint", (c) =>
          fileComplaint(c, bid, victimTx, kind, Number(harm) || 0, parseEther(bond.trim() || "0"))
        )
      }
    >
      <Field label="bundle id" value={bid} onChange={(e) => setBid(e.target.value)} />
      <Field label="victim tx" value={victimTx} onChange={(e) => setVictimTx(e.target.value)} />
      <div className={s.two}>
        <Sel label="alleged kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Sel>
        <Field label="harm · bps" value={harm} onChange={(e) => setHarm(e.target.value)} inputMode="numeric" />
      </div>
      <Field label="complainant bond · GEN" value={bond} onChange={(e) => setBond(e.target.value)} inputMode="decimal" />
    </ActionCard>
  );
}

function PanelAttach({ run, selectedId }: { run: RunFn; selectedId: string }) {
  const [bid, setBid] = useState(selectedId);
  const [url, setUrl] = useState("https://jsonplaceholder.typicode.com/todos/1");
  useEffect(() => setBid(selectedId), [selectedId]);
  return (
    <ActionCard
      icon={IconLink}
      name="attach_counterfactual"
      desc="Attach an oracle URL; validators fetch it and an LLM cleans it to canonical form."
      cta="Attach counterfactual"
      disabled={!bid}
      onRun={() => run("Attach counterfactual", (c) => attachCounterfactual(c, bid, url))}
    >
      <Field label="bundle id" value={bid} onChange={(e) => setBid(e.target.value)} />
      <Field label="oracle url" value={url} onChange={(e) => setUrl(e.target.value)} />
    </ActionCard>
  );
}

function PanelScore({ run, selectedId }: { run: RunFn; selectedId: string }) {
  return (
    <ActionCard
      icon={IconSpark}
      name="score"
      desc="Run the validator panel to score extracted bps for the selected bundle."
      cta="Score bundle"
      disabled={!selectedId}
      onRun={() => run("Score bundle", (c) => score(c, selectedId))}
    >
      <SelectedRow id={selectedId} />
    </ActionCard>
  );
}

function PanelDisburse({ run, selectedId }: { run: RunFn; selectedId: string }) {
  return (
    <ActionCard
      icon={IconCoins}
      name="disburse_rebate"
      desc="Credit victims pro-rata from the solver bond. (Re-runs the model — may need a retry.)"
      cta="Disburse rebate"
      disabled={!selectedId}
      onRun={() => run("Disburse rebate", (c) => disburseRebate(c, selectedId))}
    >
      <SelectedRow id={selectedId} />
    </ActionCard>
  );
}

function PanelAppeal({ run, selectedId }: { run: RunFn; selectedId: string }) {
  const [bid, setBid] = useState(selectedId);
  const [url, setUrl] = useState("https://jsonplaceholder.typicode.com/todos/2");
  const [bond, setBond] = useState("1");
  useEffect(() => setBid(selectedId), [selectedId]);
  return (
    <ActionCard
      icon={IconShield}
      name="appeal"
      desc="Post an appeal bond and a second oracle for a fresh, reconciled re-score."
      cta="File appeal"
      variant="magenta"
      disabled={!bid}
      onRun={() => run("File appeal", (c) => appeal(c, bid, url, parseEther(bond.trim() || "0")))}
    >
      <Field label="bundle id" value={bid} onChange={(e) => setBid(e.target.value)} />
      <Field label="new oracle url" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Field label="appeal bond · GEN" value={bond} onChange={(e) => setBond(e.target.value)} inputMode="decimal" />
    </ActionCard>
  );
}

function PanelWithdraw({ run }: { run: RunFn }) {
  return (
    <ActionCard
      icon={IconCoins}
      name="withdraw_credit"
      desc="Pull your accrued rebate credit to the connected wallet."
      cta="Withdraw credit"
      onRun={() => run("Withdraw credit", (c) => withdrawCredit(c))}
    />
  );
}

function PanelSlash({ run, selectedId, band }: { run: RunFn; selectedId: string; band: string }) {
  const enabled = !!selectedId && (band || "").toUpperCase() === "PREDATORY";
  return (
    <ActionCard
      icon={IconGavel}
      name="slash_solver"
      desc="Slash the solver bond. Enabled only when the band is PREDATORY."
      cta={enabled ? "Slash solver" : "Band not predatory"}
      variant="magenta"
      disabled={!enabled}
      onRun={() => run("Slash solver", (c) => slashSolver(c, selectedId))}
    >
      <SelectedRow id={selectedId} />
    </ActionCard>
  );
}

function SelectedRow({ id }: { id: string }) {
  return (
    <div className={s.selRow}>
      <span className="fl" style={{ margin: 0 }}>
        acts on
      </span>
      <span className="mono">{id ? shortHash(id) : "no bundle selected"}</span>
    </div>
  );
}

// ── left rail ────────────────────────────────────────────────────────
function LeftRail({
  tracked,
  selectedId,
  onSelect,
  myComplaints,
  pendingCredit,
  onWithdraw,
  connected,
}: {
  tracked: TrackedBundle[];
  selectedId: string;
  onSelect: (id: string) => void;
  myComplaints: string[];
  pendingCredit: string;
  onWithdraw: () => void;
  connected: boolean;
}) {
  return (
    <aside className={s.left}>
      <section className={s.railSec}>
        <h2 className={s.railH}>Your bundles</h2>
        {tracked.length === 0 ? (
          <p className={s.railEmpty}>None yet. Submit one from the actions rail.</p>
        ) : (
          <ul className={s.railList}>
            {tracked.map((t) => (
              <li key={t.bundleId}>
                <button
                  className={`${s.railItem} ${selectedId === t.bundleId ? s.railOn : ""}`}
                  onClick={() => onSelect(t.bundleId)}
                >
                  <span className="mono">{shortHash(t.bundleId)}</span>
                  <span className={s.railSub}>block #{t.blockNo}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.railSec}>
        <h2 className={s.railH}>Active complaints</h2>
        {myComplaints.length === 0 ? (
          <p className={s.railEmpty}>No complaints from this wallet yet.</p>
        ) : (
          <ul className={s.railList}>
            {myComplaints.map((id) => (
              <li key={id}>
                <button className={`${s.railItem} ${selectedId === id ? s.railOn : ""}`} onClick={() => onSelect(id)}>
                  <span className="mono">{shortHash(id)}</span>
                  <span className={s.railSub}>you filed</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`glass ${s.creditCard}`}>
        <h2 className={s.railH}>Pending credit</h2>
        <b className="tnum">{gen(pendingCredit)}<i> GEN</i></b>
        <Button block sm disabled={!connected || pendingCredit === "0"} onClick={onWithdraw}>
          Withdraw
        </Button>
      </section>
    </aside>
  );
}

// ── center stage ──────────────────────────────────────────────────────
function CenterStage({
  selectedId,
  bundle,
  stageLog,
  solver,
  complaints,
}: {
  selectedId: string;
  bundle: BundleView | null;
  stageLog: string[];
  solver: SolverRecordView | null;
  complaints: ComplaintView[];
}) {
  const [showComplaints, setShowComplaints] = useState(true);
  if (!selectedId) {
    return (
      <div className={`${s.stage} ${s.stageEmpty}`}>
        <IconScale size={40} />
        <h2>Select or submit a bundle</h2>
        <p>Pick a bundle from the left rail, or submit one from the actions panel to begin.</p>
      </div>
    );
  }
  const band = bundle?.band || "PENDING";
  return (
    <div className={s.stage}>
      <div className={s.stageTop}>
        <div>
          <span className="fl" style={{ margin: 0 }}>
            bundle
          </span>
          <div className={`mono ${s.bid}`}>{selectedId}</div>
        </div>
        <BandPill band={band} />
      </div>

      <div className={s.bpsRow}>
        <div className={s.bpsBig}>
          <span className={`tnum ${s.bpsNum}`}>{bundle ? bundle.extractedBps : 0}</span>
          <span className={s.bpsUnit}>bps extracted</span>
        </div>
        <BpsGauge bps={bundle?.extractedBps ?? 0} band={band} size={148} />
      </div>

      <div className={s.stageSection}>
        <span className={s.stageLabel}>stage pipeline</span>
        <StageTimeline log={stageLog} />
      </div>

      <div className={s.metaGrid}>
        <div className={`glass ${s.metaCard}`}>
          <span className={s.stageLabel}>solver</span>
          <div className="mono">{shortAddr(bundle?.solver || solver?.addr || "")}</div>
          <div className={s.metaRow}>
            <span>submitted</span>
            <b className="tnum">{solver?.bundlesSubmitted ?? 0}</b>
          </div>
          <div className={s.metaRow}>
            <span>predatory</span>
            <b className="tnum">{solver?.bundlesPredatory ?? 0}</b>
          </div>
          <div className={s.metaRow}>
            <span>total slashed</span>
            <b className="tnum">{gen(solver?.totalSlashed || "0")}</b>
          </div>
        </div>
        <div className={`glass ${s.metaCard}`}>
          <span className={s.stageLabel}>bond &amp; timing</span>
          <div className={s.metaRow}>
            <span>solver bond</span>
            <b className="tnum">{gen(bundle?.solverBond || "0")} GEN</b>
          </div>
          <div className={s.metaRow}>
            <span>submitted seq</span>
            <b className="tnum">{bundle?.submittedAtSeq ?? 0}</b>
          </div>
          <div className={s.metaRow}>
            <span>scored seq</span>
            <b className="tnum">{bundle?.scoredAtSeq ?? 0}</b>
          </div>
          <div className={s.metaRow}>
            <span>disbursed seq</span>
            <b className="tnum">{bundle?.disbursedAtSeq ?? 0}</b>
          </div>
        </div>
      </div>

      <div className={s.stageSection}>
        <button className={s.collapse} onClick={() => setShowComplaints((v) => !v)} aria-expanded={showComplaints}>
          <span className={s.stageLabel}>complaints ({complaints.length})</span>
          <span className="mono">{showComplaints ? "–" : "+"}</span>
        </button>
        {showComplaints &&
          (complaints.length === 0 ? (
            <p className={s.railEmpty}>No complaints filed against this bundle.</p>
          ) : (
            <ul className={s.complaintList}>
              {complaints.map((c) => (
                <li key={c.complaintId} className={`glass ${s.complaint}`}>
                  <div className={s.complaintTop}>
                    <span className="mono">{shortAddr(c.complainant)}</span>
                    <span className={s.kindTag}>{c.allegedKind}</span>
                  </div>
                  <div className={s.complaintFigs}>
                    <span>
                      claim <b className="tnum">{c.harmClaimBps}</b> bps
                    </span>
                    <span>
                      awarded <b className="tnum">{gen(c.awardedValue)}</b> GEN
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}

// ── bottom drawer ──────────────────────────────────────────────────────
function BottomDrawer({
  stageLog,
  complaints,
  solver,
}: {
  stageLog: string[];
  complaints: ComplaintView[];
  solver: SolverRecordView | null;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"log" | "complaints" | "solver">("log");
  return (
    <div className={`${s.drawer} ${open ? s.drawerOpen : ""}`}>
      <button className={s.drawerHandle} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="mono">raw data</span>
        <span>{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <div className={s.drawerBody}>
          <div className={s.tabs} role="tablist">
            {(["log", "complaints", "solver"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`${s.tab} ${tab === t ? s.tabOn : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "log" ? "Stage log" : t === "complaints" ? "Complaints" : "Solver"}
              </button>
            ))}
          </div>
          <pre className={s.raw}>
            {tab === "log" && JSON.stringify(stageLog, null, 2)}
            {tab === "complaints" && JSON.stringify(complaints, null, 2)}
            {tab === "solver" && JSON.stringify(solver, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── page root ──────────────────────────────────────────────────────────
export function Court() {
  const { client, address, isConnected, wrongChain } = useWriteClient();
  const toast = useToast();
  const [tracked, setTracked] = useState<TrackedBundle[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [bundle, setBundle] = useState<BundleView | null>(null);
  const [stageLog, setStageLog] = useState<string[]>([]);
  const [complaints, setComplaints] = useState<ComplaintView[]>([]);
  const [solver, setSolver] = useState<SolverRecordView | null>(null);
  const [pendingCredit, setPendingCredit] = useState("0");
  const [myComplaints, setMyComplaints] = useState<string[]>([]);
  const [openAction, setOpenAction] = useState("submit_bundle");

  useEffect(() => {
    const t = loadTracked();
    setTracked(t);
    if (t.length) setSelectedId((cur) => cur || t[0].bundleId);
  }, []);

  const refreshSelected = useCallback(async (id: string) => {
    if (!id) {
      setBundle(null);
      setStageLog([]);
      setComplaints([]);
      setSolver(null);
      return;
    }
    const [b, log, cs] = await Promise.all([getBundle(id), getStageLog(id), getComplaints(id)]);
    setBundle(b);
    setStageLog(log);
    setComplaints(cs);
    if (b?.solver && b.solver !== "0x") setSolver(await getSolverRecord(b.solver));
    else setSolver(null);
  }, []);

  const refreshWallet = useCallback(async () => {
    if (address) setPendingCredit(await getPendingCredit(address));
    else setPendingCredit("0");
  }, [address]);

  const refreshComplaints = useCallback(async () => {
    if (!address) {
      setMyComplaints([]);
      return;
    }
    const t = loadTracked();
    const mine: string[] = [];
    await Promise.all(
      t.map(async (b) => {
        const cs = await getComplaints(b.bundleId);
        if (cs.some((c) => c.complainant.toLowerCase() === address.toLowerCase())) mine.push(b.bundleId);
      })
    );
    setMyComplaints(mine);
  }, [address]);

  const refreshAll = useCallback(() => {
    refreshSelected(selectedId);
    refreshWallet();
    refreshComplaints();
  }, [refreshSelected, refreshWallet, refreshComplaints, selectedId]);

  useEffect(() => {
    refreshSelected(selectedId);
  }, [selectedId, refreshSelected]);

  useEffect(() => {
    refreshWallet();
    refreshComplaints();
    const iv = setInterval(refreshAll, 15000);
    return () => clearInterval(iv);
  }, [refreshWallet, refreshComplaints, refreshAll]);

  const run = useCallback<RunFn>(
    async (label, fn) => {
      if (!client) {
        const m = "Connect a wallet on studionet first.";
        toast.push("error", m);
        return { ok: false, error: m };
      }
      if (wrongChain) {
        const m = "Wrong network — switch your wallet to studionet (chain 61999).";
        toast.push("error", m);
        return { ok: false, error: m };
      }
      const tid = toast.push("pending", `${label}…`);
      try {
        await fn(client);
        toast.update(tid, "success", `${label} — done.`);
        refreshAll();
        return { ok: true };
      } catch (e) {
        const m = parseEnvelope(String((e as Error)?.message || e));
        toast.update(tid, "error", m);
        refreshAll();
        return { ok: false, error: m };
      }
    },
    [client, wrongChain, toast, refreshAll]
  );

  const onCreated = useCallback((b: TrackedBundle) => {
    setTracked(trackBundle(b));
    setSelectedId(b.bundleId);
  }, []);

  const band = bundle?.band || "PENDING";

  return (
    <div className={s.shell}>
      <h1 className="sr-only">Time-Machine court workspace</h1>
      <header className={s.topbar}>
        <div className={s.topLeft}>
          <Link to="/" className={s.brand}>
            <span className={s.brandGlyph}>
              <IconRewind size={16} />
            </span>
            <b>TIME&middot;MACHINE</b>
          </Link>
          <nav className={s.crumb} aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span>/</span>
            <span aria-current="page">Court</span>
          </nav>
        </div>
        <div className={s.topRight}>
          {wrongChain && <span className={s.chainWarn}>wrong network</span>}
          <ConnectButton
            showBalance={false}
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus={{ smallScreen: "icon", largeScreen: "full" }}
          />
        </div>
      </header>

      <div className={s.grid}>
        <LeftRail
          tracked={tracked}
          selectedId={selectedId}
          onSelect={setSelectedId}
          myComplaints={myComplaints}
          pendingCredit={pendingCredit}
          connected={isConnected && !wrongChain}
          onWithdraw={() => run("Withdraw credit", (c) => withdrawCredit(c))}
        />

        <main className={s.center}>
          <CenterStage selectedId={selectedId} bundle={bundle} stageLog={stageLog} solver={solver} complaints={complaints} />
        </main>

        <aside className={s.right}>
          <div className={s.rightHead}>
            <h2 className="fl" style={{ margin: 0 }}>
              actions
            </h2>
            <span className={s.rightHint}>every contract write</span>
          </div>
          <div className={`glass ${s.actionStack}`}>
            <AccordionCtx.Provider value={{ openId: openAction, setOpenId: setOpenAction }}>
              <PanelSubmit run={run} onCreated={onCreated} />
              <PanelComplaint run={run} selectedId={selectedId} />
              <PanelAttach run={run} selectedId={selectedId} />
              <PanelScore run={run} selectedId={selectedId} />
              <PanelDisburse run={run} selectedId={selectedId} />
              <PanelAppeal run={run} selectedId={selectedId} />
              <PanelWithdraw run={run} />
              <PanelSlash run={run} selectedId={selectedId} band={band} />
            </AccordionCtx.Provider>
          </div>
        </aside>
      </div>

      <BottomDrawer stageLog={stageLog} complaints={complaints} solver={solver} />
    </div>
  );
}
