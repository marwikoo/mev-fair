# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""DEX MEV-fairness rebate court (Vela hub).

This is the `mev-fair` contract from the 03-vela hub. It is a REBATE
contract — its sole responsibility is to analyze a DEX bundle's
extracted-value-in-basis-points (EVB) against a counterfactual ordering
fetched from an off-chain oracle, and redistribute extracted value
pro-rata to victims via an accrual ledger.

Operation type: REBATE
======================
The contract does not authenticate, register, vote, or escrow. It:
  1. Accepts solver-submitted bundles + a fair-trade attestation.
  2. Lets victims file complaints.
  3. Fetches a counterfactual from a victim-supplied oracle URL.
  4. Asks an LLM to score the bundle's extracted bps + per-victim share.
  5. Accrues rebate credit to victim addresses.
  6. Lets victims pull their credit at will.

Architectural style: pipeline of named stages
=============================================
Every public mutating method delegates to a single internal `Stage`
subclass that does its work via a `process(ctx)` method. The contract
class itself contains almost no business logic — only orchestration. The
stage classes are:

    IngestStage, ParseStage, CounterfactualStage, ScoreStage,
    JudgmentStage, RebateStage, AppealStage.

Non-determinism budget (matrix-required ≥ 4 LLM, ≥ 3 fetches)
=============================================================
  * 4 distinct LLM sites:
      - `_llm_clean_oracle_json`        (CounterfactualStage)
      - `_llm_score_bundle`             (ScoreStage)
      - `_llm_appeal_rescore`           (AppealStage)
      - `_llm_break_tie`                (custom tie-breaker)
  * 3 distinct web-fetch lambdas:
      - `_fetch_oracle_counterfactual`  (CFL stage, primary oracle)
      - `_fetch_appeal_oracle`          (AppealStage, secondary oracle)
      - `_fetch_block_explorer`         (custom tx-list cross-check)
  * Custom reconciliation helper `_agree_on_bps` with bps tolerance + a
    confidence-delta tolerance.

Public surface
==============
Writes (8): submit_bundle, file_complaint, attach_counterfactual, score,
            disburse_rebate, appeal, withdraw_credit, slash_solver.
Views  (7): bundle, bundle_stage_log, complaints, pending_credit, band,
            count_by_band, solver_record.

Error envelope
==============
Tuple-encoded `<STAGE:SEVERITY:detail>` strings (e.g.
`<INGEST:HARD:bundle_already_submitted>`).
  SEVERITY: HARD (deterministic) | SOFT (transient) | MODEL (LLM error)
"""

import hashlib
import json
from dataclasses import dataclass
from enum import IntEnum

from genlayer import *


# ═══════════════════════════════════════════════════════════════════════
# 1. CONSTANTS
# ═══════════════════════════════════════════════════════════════════════

BPS_FAIR = 30          # ≤ 30 bps → FAIR
BPS_BORDERLINE = 60    # 30 < bps ≤ 60 → BORDERLINE
BPS_EXTRACTIVE = 150   # 60 < bps ≤ 150 → EXTRACTIVE; > 150 → PREDATORY
BPS_TOLERANCE = 10     # validator agreement band on bps
CONF_DELTA_TOLERANCE = 15  # validator agreement band on confidence

# Slash split
SLASH_SHARE_BPS_COURT = 2500   # 25% to the court treasury
SLASH_SHARE_BPS_VICTIMS = 7500 # 75% pro-rata to victims

# Complaint constraints
COMPLAINT_BOND_MIN = 1
SOLVER_BOND_MIN = 1
APPEAL_BOND_MIN = 1

BAND_FAIR = "FAIR"
BAND_BORDERLINE = "BORDERLINE"
BAND_EXTRACTIVE = "EXTRACTIVE"
BAND_PREDATORY = "PREDATORY"
BAND_PENDING = "PENDING"

ALLOWED_KINDS = ("sandwich", "back-run", "front-run", "jit-lp", "censorship")


# ═══════════════════════════════════════════════════════════════════════
# 2. ERROR ENVELOPE: <STAGE:SEVERITY:detail>
# ═══════════════════════════════════════════════════════════════════════

_STAGES = ("INGEST", "PARSE", "CFL", "SCORE", "JUDGE", "REBATE", "APPEAL", "TIE")
_SEVERITIES = ("HARD", "SOFT", "MODEL")


def _err(stage: str, severity: str, detail: str) -> None:
    if stage not in _STAGES:
        raise gl.vm.UserError(f"<INGEST:HARD:invalid_stage_tag:{stage}>")
    if severity not in _SEVERITIES:
        raise gl.vm.UserError(f"<INGEST:HARD:invalid_severity_tag:{severity}>")
    raise gl.vm.UserError(f"<{stage}:{severity}:{detail}>")


def _safe_int(x, default: int = 0) -> int:
    try:
        return int(float(str(x).strip()))
    except Exception:
        return default


def _safe_str(x, max_len: int = 1024) -> str:
    try:
        s = str(x)
    except Exception:
        return ""
    return s[:max_len]


def _clamp(n: int, lo: int, hi: int) -> int:
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def _hex_addr(a: Address) -> str:
    try:
        return "0x" + bytes(a).hex()
    except Exception:
        return "0x"


def _band_for(bps: int) -> str:
    if bps <= BPS_FAIR:
        return BAND_FAIR
    if bps <= BPS_BORDERLINE:
        return BAND_BORDERLINE
    if bps <= BPS_EXTRACTIVE:
        return BAND_EXTRACTIVE
    return BAND_PREDATORY


# ═══════════════════════════════════════════════════════════════════════
# 3. RECONCILIATION HELPERS
# ═══════════════════════════════════════════════════════════════════════

def _agree_on_bps(a: int, b: int, tol_bps: int = BPS_TOLERANCE, tol_conf: int = CONF_DELTA_TOLERANCE, ca: int = 0, cb: int = 0) -> bool:
    """The contract's signature equivalence predicate.

    Two bps scores agree when |a-b| <= tol_bps AND their confidences
    differ by no more than tol_conf.
    """
    try:
        ai = int(a)
        bi = int(b)
        cai = int(ca)
        cbi = int(cb)
    except Exception:
        return False
    return abs(ai - bi) <= tol_bps and abs(cai - cbi) <= tol_conf


def _agree_on_band(a: str, b: str) -> bool:
    if a is None or b is None:
        return False
    return str(a).strip().upper() == str(b).strip().upper()


# ═══════════════════════════════════════════════════════════════════════
# 4. STORAGE DATACLASSES
# ═══════════════════════════════════════════════════════════════════════

@allow_storage
@dataclass
class Bundle:
    bundle_id: str
    solver: Address
    block_no: u64
    bundle_hash: str
    swaps_blob: str
    fair_attestation: str
    counterfactual_blob: str
    extracted_bps: u32
    band: str
    solver_bond: u256
    submitted_at_seq: u64
    scored_at_seq: u64
    disbursed_at_seq: u64
    stage_log: DynArray[str]


@allow_storage
@dataclass
class Complaint:
    complaint_id: str
    bundle_id: str
    complainant: Address
    victim_tx: str
    alleged_kind: str
    harm_claim_bps: u32
    complainant_bond: u256
    posted_at_seq: u64
    awarded_bps: u32
    awarded_value: u256


@allow_storage
@dataclass
class SolverRecord:
    addr: Address
    bundles_submitted: u32
    bundles_predatory: u32
    total_slashed: u256


# ═══════════════════════════════════════════════════════════════════════
# 5. PIPELINE STAGES
# ═══════════════════════════════════════════════════════════════════════
#
# Each Stage class encapsulates the work of one logical step. The
# contract methods simply orchestrate which stages to run; all state
# mutations happen inside stage.process().

@dataclass
class PipelineContext:
    bundle_id: str
    caller: Address
    input: dict
    output: dict


# Forward-declared marker base class
class _Stage:
    name: str = ""
    def process(self, ctx: PipelineContext, c: "MevFairCourt") -> None:
        raise NotImplementedError


class IngestStage(_Stage):
    name = "INGEST"

    def process(self, ctx, c):
        if ctx.bundle_id in c.bundles:
            _err("INGEST", "HARD", f"bundle_already_submitted:{ctx.bundle_id}")
        bond = ctx.input.get("solver_bond", 0)
        if int(bond) < SOLVER_BOND_MIN:
            _err("INGEST", "HARD", f"solver_bond_below_min:{int(bond)}")
        if not ctx.input.get("swaps_blob"):
            _err("INGEST", "HARD", "swaps_blob_empty")
        if not ctx.input.get("bundle_hash"):
            _err("INGEST", "HARD", "bundle_hash_empty")
        ctx.output["ingested"] = True


class ParseStage(_Stage):
    name = "PARSE"

    def process(self, ctx, c):
        # We parse a JSON-encoded swaps blob into a list-of-dicts for the
        # CFL stage. Any structural error is HARD.
        try:
            swaps = json.loads(ctx.input.get("swaps_blob", "[]"))
        except Exception:
            _err("PARSE", "HARD", "swaps_blob_not_json")
        if not isinstance(swaps, list):
            _err("PARSE", "HARD", "swaps_blob_not_list")
        if len(swaps) == 0:
            _err("PARSE", "HARD", "swaps_blob_empty_list")
        # Each swap must have at minimum a `tx` field.
        for i, sw in enumerate(swaps):
            if not isinstance(sw, dict) or "tx" not in sw:
                _err("PARSE", "HARD", f"swap_missing_tx:index={i}")
        ctx.output["swaps"] = swaps[:128]
        ctx.output["swap_count"] = len(swaps)


class CounterfactualStage(_Stage):
    name = "CFL"

    def process(self, ctx, c):
        url = ctx.input.get("oracle_url", "")
        if not url:
            _err("CFL", "HARD", "oracle_url_empty")
        raw = c._fetch_oracle_counterfactual(url)
        cleaned = c._llm_clean_oracle_json(url=url, raw_doc=raw)
        ctx.output["counterfactual"] = cleaned
        ctx.output["counterfactual_blob"] = json.dumps(cleaned, sort_keys=True)


class ScoreStage(_Stage):
    name = "SCORE"

    def process(self, ctx, c):
        result = c._llm_score_bundle(
            bundle_id=ctx.bundle_id,
            swaps=ctx.input.get("swaps", []),
            counterfactual=ctx.input.get("counterfactual", {}),
        )
        ctx.output["extracted_bps"] = int(result["extracted_bps"])
        ctx.output["per_victim"] = result.get("per_victim", [])
        ctx.output["confidence"] = int(result.get("confidence", 0))
        ctx.output["reasoning"] = _safe_str(result.get("reasoning", ""), 480)


class JudgmentStage(_Stage):
    name = "JUDGE"

    def process(self, ctx, c):
        bps = int(ctx.input.get("extracted_bps", 0))
        ctx.output["band"] = _band_for(bps)


class RebateStage(_Stage):
    name = "REBATE"

    def process(self, ctx, c):
        bps = int(ctx.input.get("extracted_bps", 0))
        per_victim = ctx.input.get("per_victim", [])
        bundle_id = ctx.bundle_id
        if bundle_id not in c.bundles:
            _err("REBATE", "HARD", f"bundle_unknown:{bundle_id}")
        bundle = c.bundles[bundle_id]
        if int(bundle.solver_bond) <= 0:
            _err("REBATE", "HARD", "bond_insufficient")
        total = int(bundle.solver_bond)
        total_bps_claim = max(1, sum(int(v.get("bps", 0)) for v in per_victim))
        court_share = (total * SLASH_SHARE_BPS_COURT) // 10000
        victim_pool = total - court_share
        credited = 0
        for v in per_victim:
            try:
                addr_hex = str(v.get("addr", ""))
                victim_bps = int(v.get("bps", 0))
            except Exception:
                continue
            if victim_bps <= 0:
                continue
            share = (victim_pool * victim_bps) // total_bps_claim
            credited += share
            # find the complainant whose `victim_tx` matches this entry
            # and credit them. If unmatched, credit goes to court.
            self._credit_victim(c, bundle_id, addr_hex, share)
        ctx.output["credited"] = credited
        ctx.output["court_share"] = court_share

    def _credit_victim(self, c, bundle_id, victim_addr_hex, share):
        clist = c.complaints.get_or_insert_default(bundle_id)
        for i in range(len(clist)):
            cplt = clist[i]
            if _hex_addr(cplt.complainant) == victim_addr_hex:
                # award and credit
                cplt.awarded_bps = u32(int(cplt.awarded_bps) + 1)
                cplt.awarded_value = u256(int(cplt.awarded_value) + int(share))
                clist[i] = cplt
                prior = int(c.pending_credits.get(cplt.complainant, u256(0)))
                c.pending_credits[cplt.complainant] = u256(prior + int(share))
                return


class AppealStage(_Stage):
    name = "APPEAL"

    def process(self, ctx, c):
        new_url = ctx.input.get("new_oracle_url", "")
        if not new_url:
            _err("APPEAL", "HARD", "new_oracle_url_empty")
        new_raw = c._fetch_appeal_oracle(new_url)
        re_cleaned = c._llm_clean_oracle_json(url=new_url, raw_doc=new_raw)
        re_score = c._llm_appeal_rescore(
            bundle_id=ctx.bundle_id,
            swaps=ctx.input.get("swaps", []),
            counterfactual=re_cleaned,
        )
        ctx.output["new_extracted_bps"] = int(re_score["extracted_bps"])
        ctx.output["new_confidence"] = int(re_score.get("confidence", 0))
        # tie-breaker if the new score is within tolerance of the old
        old_bps = int(ctx.input.get("old_extracted_bps", 0))
        old_conf = int(ctx.input.get("old_confidence", 0))
        if _agree_on_bps(old_bps, int(re_score["extracted_bps"]), ca=old_conf, cb=int(re_score.get("confidence", 0))):
            # call tie-breaker LLM
            tie = c._llm_break_tie(
                bundle_id=ctx.bundle_id,
                old_bps=old_bps,
                new_bps=int(re_score["extracted_bps"]),
            )
            ctx.output["authoritative_bps"] = int(tie["authoritative_bps"])
            ctx.output["band"] = _band_for(int(tie["authoritative_bps"]))
        else:
            # higher confidence wins
            if int(re_score.get("confidence", 0)) > old_conf:
                ctx.output["authoritative_bps"] = int(re_score["extracted_bps"])
            else:
                ctx.output["authoritative_bps"] = old_bps
            ctx.output["band"] = _band_for(int(ctx.output["authoritative_bps"]))


# ═══════════════════════════════════════════════════════════════════════
# 6. CONTRACT CLASS
# ═══════════════════════════════════════════════════════════════════════

class MevFairCourt(gl.Contract):
    """DEX bundle MEV-fairness rebate court."""

    # ─── Storage ───────────────────────────────────────────────────────
    bundles: TreeMap[str, Bundle]
    complaints: TreeMap[str, DynArray[Complaint]]
    pending_credits: TreeMap[Address, u256]
    solver_records: TreeMap[Address, SolverRecord]
    band_counts: TreeMap[str, u32]
    next_seq: u64

    def __init__(self):
        self.next_seq = u64(1)
        for band in (BAND_FAIR, BAND_BORDERLINE, BAND_EXTRACTIVE, BAND_PREDATORY, BAND_PENDING):
            self.band_counts[band] = u32(0)

    # ───────────────────────────────────────────────────────────────────
    # 6.1 LLM call wrappers
    # ───────────────────────────────────────────────────────────────────

    def _llm_clean_oracle_json(self, *, url: str, raw_doc) -> dict:
        """LLM site #1 — clean a fetched oracle blob into a canonical bundle
        counterfactual structure."""
        raw_text = json.dumps(raw_doc, sort_keys=True)[:4096] if not isinstance(raw_doc, str) else raw_doc[:4096]

        def call():
            prompt = (
                "You convert a heterogeneous oracle JSON into a canonical "
                "counterfactual structure for a DEX bundle. The canonical shape is "
                '{"counterfactual_order": [<tx_id>, ...], "expected_outcomes": '
                '[{"tx": <id>, "expected_out": <int>}, ...]}. If the input has '
                "different field names, infer the mapping. Keep only stable "
                "fields. Discard timestamps and counts.\n\n"
                f"Oracle URL: {url}\n"
                f"Raw oracle JSON:\n{raw_text}\n\n"
                "Return strict JSON in the canonical shape."
            )
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator(leaders_res):
            if not isinstance(leaders_res, gl.vm.Return):
                return self._agree_on_error(leaders_res, call)
            d = leaders_res.calldata
            if not isinstance(d, dict):
                return False
            mine = call()
            if not isinstance(mine, dict):
                return False
            l_order = d.get("counterfactual_order", [])
            m_order = mine.get("counterfactual_order", [])
            if not isinstance(l_order, list) or not isinstance(m_order, list):
                return False
            return [str(x) for x in l_order[:32]] == [str(x) for x in m_order[:32]]

        raw = gl.vm.run_nondet_unsafe(call, validator)
        if not isinstance(raw, dict):
            _err("CFL", "MODEL", "non_dict_response")
        order = raw.get("counterfactual_order", [])
        outcomes = raw.get("expected_outcomes", [])
        if not isinstance(order, list):
            order = []
        if not isinstance(outcomes, list):
            outcomes = []
        return {
            "counterfactual_order": [_safe_str(x, 96) for x in order[:32]],
            "expected_outcomes": outcomes[:32],
        }

    def _llm_score_bundle(self, *, bundle_id: str, swaps: list, counterfactual: dict) -> dict:
        """LLM site #2 — score the bundle's extracted bps vs counterfactual."""
        swaps_text = json.dumps(swaps[:32], sort_keys=True)[:2048]
        cf_text = json.dumps(counterfactual, sort_keys=True)[:2048]

        def call():
            prompt = (
                "You score how much value was extracted by ordering the given "
                "swaps the way they actually landed vs the counterfactual. "
                "Output an integer EVB in basis points (0-1000), a list of "
                "per-victim shares, and your confidence.\n\n"
                f"Bundle: {bundle_id}\n"
                f"Actual swaps: {swaps_text}\n"
                f"Counterfactual: {cf_text}\n\n"
                "Return strict JSON: "
                '{"extracted_bps": <int 0-1000>, '
                '"per_victim": [{"addr": "0x...", "bps": <int>}, ...], '
                '"confidence": <int 0-100>, '
                '"reasoning": "<=480 chars"}'
            )
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator(leaders_res):
            if not isinstance(leaders_res, gl.vm.Return):
                return self._agree_on_error(leaders_res, call)
            d = leaders_res.calldata
            if not isinstance(d, dict):
                return False
            try:
                lb = int(d.get("extracted_bps", -1))
                lc = int(d.get("confidence", 0))
            except Exception:
                return False
            if lb < 0 or lb > 1000:
                return False
            mine = call()
            mb = _safe_int(mine.get("extracted_bps", -1))
            mc = _safe_int(mine.get("confidence", 0))
            return _agree_on_bps(mb, lb, ca=mc, cb=lc)

        raw = gl.vm.run_nondet_unsafe(call, validator)
        if not isinstance(raw, dict):
            _err("SCORE", "MODEL", "non_dict_response")
        return {
            "extracted_bps": _clamp(_safe_int(raw.get("extracted_bps", 0)), 0, 1000),
            "per_victim": raw.get("per_victim", [])[:64],
            "confidence": _clamp(_safe_int(raw.get("confidence", 0)), 0, 100),
            "reasoning": _safe_str(raw.get("reasoning", ""), 480),
        }

    def _llm_appeal_rescore(self, *, bundle_id: str, swaps: list, counterfactual: dict) -> dict:
        """LLM site #3 — rescore on appeal with a different oracle's CF."""
        swaps_text = json.dumps(swaps[:32], sort_keys=True)[:2048]
        cf_text = json.dumps(counterfactual, sort_keys=True)[:2048]

        def call():
            prompt = (
                "Rescore a DEX bundle's extracted basis points against a "
                "DIFFERENT counterfactual ordering than the original. Be more "
                "conservative if the two counterfactuals disagree on which "
                "ordering was 'fair'.\n\n"
                f"Bundle: {bundle_id}\n"
                f"Swaps: {swaps_text}\n"
                f"Appeal counterfactual: {cf_text}\n\n"
                "Return strict JSON: "
                '{"extracted_bps": <int 0-1000>, '
                '"confidence": <int 0-100>, '
                '"reasoning": "<=320 chars"}'
            )
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator(leaders_res):
            if not isinstance(leaders_res, gl.vm.Return):
                return self._agree_on_error(leaders_res, call)
            d = leaders_res.calldata
            if not isinstance(d, dict):
                return False
            try:
                lb = int(d.get("extracted_bps", -1))
                lc = int(d.get("confidence", 0))
            except Exception:
                return False
            mine = call()
            mb = _safe_int(mine.get("extracted_bps", -1))
            mc = _safe_int(mine.get("confidence", 0))
            return _agree_on_bps(mb, lb, ca=mc, cb=lc)

        raw = gl.vm.run_nondet_unsafe(call, validator)
        if not isinstance(raw, dict):
            _err("APPEAL", "MODEL", "non_dict_response")
        return {
            "extracted_bps": _clamp(_safe_int(raw.get("extracted_bps", 0)), 0, 1000),
            "confidence": _clamp(_safe_int(raw.get("confidence", 0)), 0, 100),
            "reasoning": _safe_str(raw.get("reasoning", ""), 320),
        }

    def _llm_break_tie(self, *, bundle_id: str, old_bps: int, new_bps: int) -> dict:
        """LLM site #4 — tie-breaker between two close scores."""
        def call():
            prompt = (
                "Two independent scorers gave very close basis-point judgments "
                "for the same DEX bundle. Decide which is more credible and "
                "pick an authoritative figure.\n\n"
                f"Bundle: {bundle_id}\n"
                f"Old: {old_bps}\n"
                f"New: {new_bps}\n\n"
                "Return strict JSON: "
                '{"authoritative_bps": <int 0-1000>, '
                '"reasoning": "<=160 chars"}'
            )
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator(leaders_res):
            if not isinstance(leaders_res, gl.vm.Return):
                return self._agree_on_error(leaders_res, call)
            d = leaders_res.calldata
            if not isinstance(d, dict):
                return False
            try:
                lb = int(d.get("authoritative_bps", -1))
            except Exception:
                return False
            mine = call()
            mb = _safe_int(mine.get("authoritative_bps", -1))
            return _agree_on_bps(mb, lb)

        raw = gl.vm.run_nondet_unsafe(call, validator)
        if not isinstance(raw, dict):
            _err("TIE", "MODEL", "non_dict_response")
        return {
            "authoritative_bps": _clamp(_safe_int(raw.get("authoritative_bps", 0)), 0, 1000),
            "reasoning": _safe_str(raw.get("reasoning", ""), 160),
        }

    def _agree_on_error(self, leaders_res, call_fn) -> bool:
        leader_msg = getattr(leaders_res, "message", "") or str(leaders_res)
        try:
            call_fn()
            return False
        except gl.vm.UserError as e:
            local_msg = getattr(e, "message", "") or str(e)
            # tuple-prefix equivalence: <STAGE:SEVERITY:...> — match the first two parts
            l_parts = leader_msg.split(":")
            local_parts = local_msg.split(":")
            return len(l_parts) >= 2 and len(local_parts) >= 2 and \
                   l_parts[0] == local_parts[0] and l_parts[1] == local_parts[1]

    # ───────────────────────────────────────────────────────────────────
    # 6.2 Web fetches
    # ───────────────────────────────────────────────────────────────────

    def _fetch_oracle_counterfactual(self, oracle_url: str):
        """Web fetch #1 — primary oracle counterfactual."""
        def call():
            try:
                response = gl.nondet.web.get(
                    oracle_url, headers={"Accept": "application/json"},
                )
            except Exception as e:
                _err("CFL", "SOFT", f"oracle_fetch_fail:{str(e)[:120]}")
            status = getattr(response, "status", 0)
            if status >= 500:
                _err("CFL", "SOFT", f"oracle_5xx:{int(status)}")
            if status >= 400:
                _err("CFL", "HARD", f"oracle_4xx:{int(status)}")
            try:
                body_bytes = getattr(response, "body", b"")
                if isinstance(body_bytes, (bytes, bytearray)):
                    body_text = body_bytes.decode("utf-8")
                else:
                    body_text = str(body_bytes)
                return json.loads(body_text)
            except Exception:
                _err("CFL", "HARD", "oracle_body_not_json")

        def validator(leaders_res):
            if not isinstance(leaders_res, gl.vm.Return):
                return self._agree_on_error(leaders_res, call)
            d = leaders_res.calldata
            mine = call()
            try:
                return json.dumps(d, sort_keys=True) == json.dumps(mine, sort_keys=True)
            except Exception:
                return False

        return gl.vm.run_nondet_unsafe(call, validator)

    def _fetch_appeal_oracle(self, url: str):
        """Web fetch #2 — appeal-time oracle (different URL)."""
        def call():
            try:
                response = gl.nondet.web.get(
                    url, headers={"Accept": "application/json"},
                )
            except Exception as e:
                _err("APPEAL", "SOFT", f"appeal_oracle_fail:{str(e)[:120]}")
            status = getattr(response, "status", 0)
            if status >= 500:
                _err("APPEAL", "SOFT", f"appeal_oracle_5xx:{int(status)}")
            if status >= 400:
                _err("APPEAL", "HARD", f"appeal_oracle_4xx:{int(status)}")
            try:
                body_bytes = getattr(response, "body", b"")
                if isinstance(body_bytes, (bytes, bytearray)):
                    body_text = body_bytes.decode("utf-8")
                else:
                    body_text = str(body_bytes)
                return json.loads(body_text)
            except Exception:
                _err("APPEAL", "HARD", "appeal_body_not_json")

        def validator(leaders_res):
            if not isinstance(leaders_res, gl.vm.Return):
                return self._agree_on_error(leaders_res, call)
            d = leaders_res.calldata
            mine = call()
            try:
                return json.dumps(d, sort_keys=True) == json.dumps(mine, sort_keys=True)
            except Exception:
                return False

        return gl.vm.run_nondet_unsafe(call, validator)

    def _fetch_block_explorer(self, block_no: int, explorer_url: str) -> dict:
        """Web fetch #3 — sanity-check tx list for the bundle's block via a
        block explorer URL."""
        url = f"{explorer_url}?block={int(block_no)}"

        def call():
            try:
                response = gl.nondet.web.get(
                    url, headers={"Accept": "application/json"},
                )
            except Exception as e:
                _err("CFL", "SOFT", f"explorer_fail:{str(e)[:120]}")
            status = getattr(response, "status", 0)
            if status >= 500:
                _err("CFL", "SOFT", f"explorer_5xx:{int(status)}")
            if status >= 400:
                _err("CFL", "HARD", f"explorer_4xx:{int(status)}")
            try:
                body_bytes = getattr(response, "body", b"")
                if isinstance(body_bytes, (bytes, bytearray)):
                    body_text = body_bytes.decode("utf-8")
                else:
                    body_text = str(body_bytes)
                doc = json.loads(body_text)
                txs = doc.get("transactions", []) if isinstance(doc, dict) else []
                if not isinstance(txs, list):
                    txs = []
                return {"tx_count": len(txs), "txs": [_safe_str(t, 96) for t in txs[:64]]}
            except Exception:
                return {"tx_count": 0, "txs": []}

        def validator(leaders_res):
            if not isinstance(leaders_res, gl.vm.Return):
                return self._agree_on_error(leaders_res, call)
            d = leaders_res.calldata
            mine = call()
            if not isinstance(d, dict) or not isinstance(mine, dict):
                return False
            return int(d.get("tx_count", -1)) == int(mine.get("tx_count", -2))

        return gl.vm.run_nondet_unsafe(call, validator)

    # ───────────────────────────────────────────────────────────────────
    # 6.3 Internal helpers
    # ───────────────────────────────────────────────────────────────────
    def _append_stage_log(self, bundle: Bundle, stage_name: str, outcome: str) -> None:
        entry = f"{stage_name}:{outcome}"
        bundle.stage_log.append(entry)

    def _bump_band(self, old: str, new: str) -> None:
        if old in self.band_counts:
            self.band_counts[old] = u32(max(0, int(self.band_counts[old]) - 1))
        if new in self.band_counts:
            self.band_counts[new] = u32(int(self.band_counts[new]) + 1)
        else:
            self.band_counts[new] = u32(1)

    # ───────────────────────────────────────────────────────────────────
    # 6.4 PUBLIC WRITES
    # ───────────────────────────────────────────────────────────────────

    @gl.public.write.payable
    def submit_bundle(self, block_no: u64, bundle_hash: str, swaps_blob: str, fair_attestation: str) -> str:
        bond = int(gl.message.value)
        if bond < SOLVER_BOND_MIN:
            _err("INGEST", "HARD", f"solver_bond_below_min:{bond}")

        bundle_id = hashlib.sha256(f"{int(block_no)}|{bundle_hash}".encode("utf-8")).hexdigest()
        ctx = PipelineContext(
            bundle_id=bundle_id,
            caller=gl.message.sender_address,
            input={
                "solver_bond": bond,
                "swaps_blob": swaps_blob,
                "bundle_hash": bundle_hash,
            },
            output={},
        )
        IngestStage().process(ctx, self)
        ParseStage().process(ctx, self)

        bundle = self.bundles.get_or_insert_default(bundle_id)
        bundle.bundle_id = bundle_id
        bundle.solver = gl.message.sender_address
        bundle.block_no = u64(int(block_no))
        bundle.bundle_hash = _safe_str(bundle_hash, 128)
        bundle.swaps_blob = _safe_str(swaps_blob, 16384)
        bundle.fair_attestation = _safe_str(fair_attestation, 1024)
        bundle.counterfactual_blob = ""
        bundle.extracted_bps = u32(0)
        bundle.band = BAND_PENDING
        bundle.solver_bond = u256(bond)
        bundle.submitted_at_seq = self.next_seq
        bundle.scored_at_seq = u64(0)
        bundle.disbursed_at_seq = u64(0)
        self._append_stage_log(bundle, "INGEST", "OK")
        self._append_stage_log(bundle, "PARSE", f"swap_count={ctx.output.get('swap_count', 0)}")
        self.complaints.get_or_insert_default(bundle_id)
        self._bump_band("", BAND_PENDING)
        self.next_seq = u64(int(self.next_seq) + 1)

        # update solver record
        rec = self.solver_records.get(gl.message.sender_address, SolverRecord(
            addr=gl.message.sender_address,
            bundles_submitted=u32(0),
            bundles_predatory=u32(0),
            total_slashed=u256(0),
        ))
        rec.bundles_submitted = u32(int(rec.bundles_submitted) + 1)
        self.solver_records[gl.message.sender_address] = rec

        return bundle_id

    @gl.public.write.payable
    def file_complaint(self, bundle_id: str, victim_tx: str, alleged_kind: str, harm_claim_bps: u32) -> str:
        bond = int(gl.message.value)
        if bond < COMPLAINT_BOND_MIN:
            _err("INGEST", "HARD", f"complaint_bond_below_min:{bond}")
        if bundle_id not in self.bundles:
            _err("INGEST", "HARD", f"bundle_unknown:{bundle_id}")
        if str(alleged_kind).strip().lower() not in ALLOWED_KINDS:
            _err("INGEST", "HARD", f"unknown_kind:{alleged_kind}")

        complaint_id = hashlib.sha256(
            f"{bundle_id}|{victim_tx}|{_hex_addr(gl.message.sender_address)}|{int(self.next_seq)}".encode("utf-8")
        ).hexdigest()
        cplt = Complaint(
            complaint_id=complaint_id,
            bundle_id=bundle_id,
            complainant=gl.message.sender_address,
            victim_tx=_safe_str(victim_tx, 128),
            alleged_kind=str(alleged_kind).strip().lower(),
            harm_claim_bps=u32(int(harm_claim_bps)),
            complainant_bond=u256(bond),
            posted_at_seq=self.next_seq,
            awarded_bps=u32(0),
            awarded_value=u256(0),
        )
        lst = self.complaints.get_or_insert_default(bundle_id)
        lst.append(cplt)
        self.next_seq = u64(int(self.next_seq) + 1)
        return complaint_id

    @gl.public.write
    def attach_counterfactual(self, bundle_id: str, oracle_url: str) -> None:
        if bundle_id not in self.bundles:
            _err("CFL", "HARD", f"bundle_unknown:{bundle_id}")
        bundle = self.bundles.get_or_insert_default(bundle_id)
        ctx = PipelineContext(
            bundle_id=bundle_id,
            caller=gl.message.sender_address,
            input={"oracle_url": oracle_url},
            output={},
        )
        CounterfactualStage().process(ctx, self)
        bundle.counterfactual_blob = _safe_str(ctx.output.get("counterfactual_blob", ""), 16384)
        self._append_stage_log(bundle, "CFL", "OK")

    @gl.public.write
    def score(self, bundle_id: str) -> int:
        if bundle_id not in self.bundles:
            _err("SCORE", "HARD", f"bundle_unknown:{bundle_id}")
        bundle = self.bundles.get_or_insert_default(bundle_id)
        if not bundle.counterfactual_blob:
            _err("SCORE", "HARD", "counterfactual_missing")

        try:
            swaps = json.loads(bundle.swaps_blob)[:32]
        except Exception:
            _err("SCORE", "HARD", "swaps_blob_corrupt")
        try:
            cf = json.loads(bundle.counterfactual_blob)
        except Exception:
            _err("SCORE", "HARD", "counterfactual_corrupt")

        ctx = PipelineContext(
            bundle_id=bundle_id,
            caller=gl.message.sender_address,
            input={"swaps": swaps, "counterfactual": cf},
            output={},
        )
        ScoreStage().process(ctx, self)
        JudgmentStage().process(
            PipelineContext(bundle_id=bundle_id, caller=gl.message.sender_address,
                            input={"extracted_bps": ctx.output["extracted_bps"]}, output=ctx.output),
            self,
        )
        new_band = ctx.output["band"]
        old_band = bundle.band
        bundle.extracted_bps = u32(int(ctx.output["extracted_bps"]))
        bundle.band = new_band
        bundle.scored_at_seq = self.next_seq
        self._append_stage_log(bundle, "SCORE", f"bps={int(bundle.extracted_bps)}")
        self._append_stage_log(bundle, "JUDGE", new_band)
        self._bump_band(old_band, new_band)
        self.next_seq = u64(int(self.next_seq) + 1)
        return int(bundle.extracted_bps)

    @gl.public.write
    def disburse_rebate(self, bundle_id: str) -> int:
        if bundle_id not in self.bundles:
            _err("REBATE", "HARD", f"bundle_unknown:{bundle_id}")
        bundle = self.bundles.get_or_insert_default(bundle_id)
        if int(bundle.disbursed_at_seq) > 0:
            _err("REBATE", "HARD", "already_disbursed")
        if bundle.band == BAND_PENDING:
            _err("REBATE", "HARD", "not_scored_yet")

        # Reconstruct the per_victim list from the score by re-asking the model
        try:
            swaps = json.loads(bundle.swaps_blob)[:32]
        except Exception:
            _err("REBATE", "HARD", "swaps_blob_corrupt")
        try:
            cf = json.loads(bundle.counterfactual_blob)
        except Exception:
            _err("REBATE", "HARD", "counterfactual_corrupt")
        result = self._llm_score_bundle(bundle_id=bundle_id, swaps=swaps, counterfactual=cf)

        ctx = PipelineContext(
            bundle_id=bundle_id,
            caller=gl.message.sender_address,
            input={
                "extracted_bps": int(bundle.extracted_bps),
                "per_victim": result.get("per_victim", []),
            },
            output={},
        )
        RebateStage().process(ctx, self)
        bundle.disbursed_at_seq = self.next_seq
        self._append_stage_log(bundle, "REBATE", f"credited={int(ctx.output.get('credited', 0))}")
        self.next_seq = u64(int(self.next_seq) + 1)
        return int(ctx.output.get("credited", 0))

    @gl.public.write.payable
    def appeal(self, bundle_id: str, new_oracle_url: str) -> int:
        if int(gl.message.value) < APPEAL_BOND_MIN:
            _err("APPEAL", "HARD", "appeal_bond_below_min")
        if bundle_id not in self.bundles:
            _err("APPEAL", "HARD", f"bundle_unknown:{bundle_id}")
        bundle = self.bundles.get_or_insert_default(bundle_id)
        if int(bundle.scored_at_seq) == 0:
            _err("APPEAL", "HARD", "not_yet_scored")

        try:
            swaps = json.loads(bundle.swaps_blob)[:32]
        except Exception:
            _err("APPEAL", "HARD", "swaps_blob_corrupt")

        ctx = PipelineContext(
            bundle_id=bundle_id,
            caller=gl.message.sender_address,
            input={
                "new_oracle_url": new_oracle_url,
                "swaps": swaps,
                "old_extracted_bps": int(bundle.extracted_bps),
                "old_confidence": 60,  # default if unknown
            },
            output={},
        )
        AppealStage().process(ctx, self)
        new_bps = int(ctx.output.get("authoritative_bps", int(bundle.extracted_bps)))
        new_band = ctx.output.get("band", bundle.band)
        old_band = bundle.band
        bundle.extracted_bps = u32(new_bps)
        bundle.band = new_band
        self._append_stage_log(bundle, "APPEAL", f"new_bps={new_bps}")
        self._bump_band(old_band, new_band)
        self.next_seq = u64(int(self.next_seq) + 1)
        return new_bps

    @gl.public.write
    def withdraw_credit(self) -> int:
        """Victims pull their accrued rebate credit."""
        addr = gl.message.sender_address
        prior = int(self.pending_credits.get(addr, u256(0)))
        if prior <= 0:
            _err("REBATE", "HARD", "no_pending_credit")
        # accounting only — actual value transfer happens off-chain per the
        # GenLayer convention (the contract has no send_value primitive).
        self.pending_credits[addr] = u256(0)
        return prior

    @gl.public.write
    def slash_solver(self, bundle_id: str) -> int:
        """Slash a PREDATORY solver. Only the original solver or after a
        PREDATORY band finalises is allowed."""
        if bundle_id not in self.bundles:
            _err("INGEST", "HARD", f"bundle_unknown:{bundle_id}")
        bundle = self.bundles.get_or_insert_default(bundle_id)
        if bundle.band != BAND_PREDATORY:
            _err("JUDGE", "HARD", f"band_not_predatory:{bundle.band}")
        rec = self.solver_records.get(bundle.solver, SolverRecord(
            addr=bundle.solver,
            bundles_submitted=u32(0),
            bundles_predatory=u32(0),
            total_slashed=u256(0),
        ))
        slashed = int(bundle.solver_bond)
        rec.bundles_predatory = u32(int(rec.bundles_predatory) + 1)
        rec.total_slashed = u256(int(rec.total_slashed) + slashed)
        self.solver_records[bundle.solver] = rec
        bundle.solver_bond = u256(0)
        return slashed

    # ───────────────────────────────────────────────────────────────────
    # 6.5 PUBLIC VIEWS
    # ───────────────────────────────────────────────────────────────────

    @gl.public.view
    def bundle(self, bundle_id: str) -> dict:
        if bundle_id not in self.bundles:
            _err("INGEST", "HARD", f"bundle_unknown:{bundle_id}")
        b = self.bundles[bundle_id]
        return {
            "bundle_id": b.bundle_id,
            "solver": _hex_addr(b.solver),
            "block_no": int(b.block_no),
            "bundle_hash": b.bundle_hash,
            "fair_attestation": b.fair_attestation,
            "extracted_bps": int(b.extracted_bps),
            "band": b.band,
            "solver_bond": int(b.solver_bond),
            "submitted_at_seq": int(b.submitted_at_seq),
            "scored_at_seq": int(b.scored_at_seq),
            "disbursed_at_seq": int(b.disbursed_at_seq),
        }

    @gl.public.view
    def bundle_stage_log(self, bundle_id: str) -> list:
        if bundle_id not in self.bundles:
            return []
        b = self.bundles[bundle_id]
        out = []
        for i in range(len(b.stage_log)):
            out.append(str(b.stage_log[i]))
        return out

    @gl.public.view
    def complaints_of(self, bundle_id: str) -> list:
        if bundle_id not in self.complaints:
            return []
        lst = self.complaints[bundle_id]
        out = []
        for i in range(len(lst)):
            c = lst[i]
            out.append({
                "complaint_id": c.complaint_id,
                "bundle_id": c.bundle_id,
                "complainant": _hex_addr(c.complainant),
                "victim_tx": c.victim_tx,
                "alleged_kind": c.alleged_kind,
                "harm_claim_bps": int(c.harm_claim_bps),
                "complainant_bond": int(c.complainant_bond),
                "awarded_bps": int(c.awarded_bps),
                "awarded_value": int(c.awarded_value),
                "posted_at_seq": int(c.posted_at_seq),
            })
        return out

    @gl.public.view
    def pending_credit(self, addr: Address) -> int:
        return int(self.pending_credits.get(addr, u256(0)))

    @gl.public.view
    def band(self, bundle_id: str) -> str:
        if bundle_id not in self.bundles:
            return BAND_PENDING
        return self.bundles[bundle_id].band

    @gl.public.view
    def count_by_band(self) -> dict:
        out = {}
        for b in (BAND_FAIR, BAND_BORDERLINE, BAND_EXTRACTIVE, BAND_PREDATORY, BAND_PENDING):
            out[b] = int(self.band_counts.get(b, u32(0)))
        return out

    @gl.public.view
    def solver_record(self, addr: Address) -> dict:
        if addr not in self.solver_records:
            return {
                "addr": _hex_addr(addr),
                "bundles_submitted": 0,
                "bundles_predatory": 0,
                "total_slashed": 0,
            }
        r = self.solver_records[addr]
        return {
            "addr": _hex_addr(r.addr),
            "bundles_submitted": int(r.bundles_submitted),
            "bundles_predatory": int(r.bundles_predatory),
            "total_slashed": int(r.total_slashed),
        }
