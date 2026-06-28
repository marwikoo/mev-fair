# TIME·MACHINE

DEX MEV-fairness rebate court on [GenLayer](https://genlayer.com). Solvers submit a bundle and a fair-trade attestation; victims file complaints; a panel of validators reads an oracle counterfactual, scores the bundle's extracted value in basis points, assigns a fairness band, and accrues pro-rata rebate credit that victims pull on-chain.

## How it works

1. Submit a bundle: a solver posts the block number, bundle hash, swaps blob, and a fair-trade attestation with a GEN bond; ingest and parse stages validate it.
2. File a complaint: a victim posts a bond and claims harm in basis points against the bundle.
3. Attach a counterfactual: a victim-supplied oracle URL is fetched and cleaned into a counterfactual ordering.
4. Score: an LLM compares the bundle against the counterfactual under validator consensus, sets the extracted bps, and a judgment stage assigns the FAIR / BORDERLINE / EXTRACTIVE / PREDATORY band.
5. Settle: rebate credit accrues pro-rata to victim addresses and they withdraw it at will. A solver whose bundle finalises PREDATORY can be slashed; either side may appeal against a second oracle.

## Architecture

```
backend/mev-fair.py   GenLayer Intelligent Contract (Python, runs on the GenVM)
frontend/             React + Vite + TypeScript dashboard (genlayer-js)
```

Every public write delegates to one named pipeline stage (ingest, parse, counterfactual, score, judgment, rebate, appeal), so the contract class stays orchestration-only and each step lands in an on-chain stage log.

## Live deployment

- **Network**: GenLayer Studionet (chain id 61999)
- **Contract**: `0xa8513697719790BE49dEbE812f66830094852588`
- **App**: https://marwikoo.github.io/mev-fair/

## Run locally

```bash
cd frontend
npm install
npm run dev
npm run build
```

The committed `.env` holds the public Studionet config; no secrets are required. Copy `.env.example` to `.env.local` only to override.

## Environment variables

| Name | Required | Description |
|------|----------|-------------|
| `VITE_CONTRACT_ADDRESS` | yes | Deployed MevFairCourt contract on Studionet |
| `VITE_CHAIN_ID` | yes | GenLayer chain id (61999) |
| `VITE_RPC_URL` | yes | Studionet JSON-RPC endpoint |

## Deploy the contract

```bash
npx genlayer deploy --contract backend/mev-fair.py
```

## Contract methods (`MevFairCourt`)

| Method | Type | Description |
|--------|------|-------------|
| `submit_bundle` | payable | Solver posts a bundle and fair attestation with a bond; runs ingest and parse. |
| `file_complaint` | payable | Victim posts a bond and claims harm in basis points against a bundle. |
| `attach_counterfactual` | write | Fetch and clean a counterfactual ordering from a victim-supplied oracle URL. |
| `score` | write | LLM scores extracted bps against the counterfactual and sets the fairness band. |
| `disburse_rebate` | write | Accrue rebate credit pro-rata to the bundle's victim addresses. |
| `appeal` | payable | Re-score against a second oracle with an appeal bond. |
| `withdraw_credit` | write | Victim pulls their accrued rebate credit. |
| `slash_solver` | write | Slash the bond of a solver whose bundle finalised PREDATORY. |
| `bundle` | view | Full bundle dossier: solver, extracted bps, band, bond, sequence marks. |
| `bundle_stage_log` | view | Ordered pipeline-stage log lines for a bundle. |
| `complaints_of` | view | All complaints filed against a bundle. |
| `pending_credit` | view | Accrued rebate credit for an address. |
| `band` | view | Current fairness band for a bundle. |
| `count_by_band` | view | Bundle counts per fairness band. |
| `solver_record` | view | A solver's submitted / predatory / slashed record. |

## License

MIT
