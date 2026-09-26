# CLIRC — Cross-Layer Incident Root-Cause Correlator: System Design Plan

## Top-Level Overview

CLIRC is a Bob-native agent workflow that accepts a raw incident report
(symptom + timestamp) and produces a structured root-cause analysis by
dispatching four parallel subagents — one per evidence layer — then
correlating their findings on a shared timeline. Everything runs against
static files in this repo; no live cloud account is touched.

The concrete sample scenario that validates the design:
- **Root cause:** commit `a223086` removed `s3:PutObject` from
  `report-uploader-s3-policy` in `terraform/main.tf`.
- **Red herring:** commit `51fe05f` (validation change, one day later)
  is what on-call suspects first; CLIRC must correctly deprioritize it.
- **Evidence files:** `terraform/main.tf`, `app/server.js`,
  `logs/app-prod.log`, git history (4 commits), `INCIDENT.md`.

**Assumptions (stated, not asked):**
1. "Parallel subagent" means `spawn_subagent` calls issued in the same
   turn before any `wait`; Bob's native mechanism handles concurrency.
2. IAM "state" is read from the current `terraform/main.tf` plus the
   git diff of that file — no live AWS API call is needed.
3. The postmortem template (`runbook/postmortem-template.md`) is the
   document-understanding input; the `.docx` conversion is a demo-day
   option, not a build requirement.
4. "Apply fix" means Bob writes a patched `terraform/main.tf` in Agent
   mode and shows a `diff` preview — no `terraform apply` is ever run.

---

## 1. ORCHESTRATION FLOW

### 1.1 Decomposition

When the main agent receives an incident report it performs three steps
before spawning anything:

1. **Parse the incident report** — extract `symptom_text`, `first_seen`
   timestamp, and `service_name` from `INCIDENT.md` (or whatever the
   user pastes).
2. **Anchor the timeline window** — set `window_start = first_seen − 2h`
   and `window_end = now`. Every subagent filters its evidence to this
   window.
3. **Spawn four subagents in one turn** — all four `spawn_subagent` calls
   are issued simultaneously (same turn); no subagent output is needed
   before another starts.

### 1.2 Subagent Roster

| ID | Subagent | Scope | Why isolated |
|----|----------|-------|-------------|
| SA-A | **IaC Analyst** | `terraform/` directory only | Terraform HCL and git diffs for `.tf` files are self-contained; no need to read app code |
| SA-B | **IAM Inspector** | `terraform/main.tf` IAM resources + git diff of that file | Focused on permission statements; overlaps SA-A's file but asks a different question |
| SA-C | **App / Deploy Analyst** | `app/` directory + full git log | Code-level what-changed; should not be polluted by infra HCL |
| SA-D | **Log Parser** | `logs/` directory only | Pure log parsing; needs no awareness of code or infra |

> SA-B and SA-A both read `terraform/main.tf` but their questions are
> different: SA-A asks "what resource configuration changed?"; SA-B asks
> "what IAM actions are currently allowed vs. what was allowed before?"
> Keeping them separate keeps each context window under ~2 k tokens of
> relevant file content.

### 1.3 Parallel vs. Sequential Execution

```
Turn 1 — Main agent parses INCIDENT.md
Turn 2 — Main agent spawns SA-A, SA-B, SA-C, SA-D (all in same turn → parallel)
Turn 3 — Main agent receives all four FindingPackets → runs correlation logic
Turn 4 — Main agent writes final report + patches terraform/main.tf (after approval)
```

The main agent **must not** synthesize until all four `spawn_subagent`
results are back. No subagent spawns another subagent.

### 1.4 Subagent Return Format — `FindingPacket`

Every subagent returns exactly one JSON object (written to stdout / returned
as the subagent result string). The main agent parses these four strings.

```jsonc
{
  "layer": "IaC | IAM | Application | Runtime",
  "subagent_id": "SA-A | SA-B | SA-C | SA-D",
  "findings": [
    {
      "finding_id": "F-A-1",
      "summary": "Human-readable one-liner",
      "evidence_reference": "terraform/main.tf:46-51 | commit:a223086 | log line 3",
      "event_timestamp": "2026-09-22T11:05:00Z",   // ISO-8601 UTC; null if unknown
      "confidence": 0.9,                             // 0.0–1.0
      "detail": "Full extracted evidence text or diff hunk",
      "suggested_fix": "Add s3:PutObject to the AllowReportBucketReadOnly statement in terraform/main.tf"
                       // null if this subagent has no concrete fix opinion for this finding
    }
  ],
  "nothing_found": false,
  "layer_summary": "One-sentence summary for the report narrative"
}
```

Rules subagents must follow:
- `event_timestamp` must be ISO-8601 UTC; use `null` if genuinely
  unknown (do not guess).
- `confidence` is self-assessed: 0.9 = explicit evidence found;
  0.5 = circumstantial; 0.1 = speculative.
- `suggested_fix` should be populated by SA-A and SA-B when a concrete
  Terraform or IAM change is evident; SA-C populates it only if the fix
  is a code change; SA-D will almost always set it to `null` (symptom
  extraction, not fixing). The main agent de-duplicates all non-null
  `suggested_fix` values into the single **Proposed Fix** section.
- `nothing_found: true` is a valid, non-error response. The main agent
  handles it gracefully (see §2.3).
- The entire JSON must be returned as a single parseable string — no
  prose before or after the JSON object.

---

## 2. EVIDENCE CORRELATION LOGIC

### 2.1 Shared Timeline Alignment

After receiving all four `FindingPacket`s, the main agent:

1. Collects every finding that has a non-null `event_timestamp`.
2. Sorts them into a unified list by timestamp ascending.
3. Groups them into a **causal window**: all events within ±30 min of
   the first error log line are candidate root-cause events.

### 2.2 Scoring — Proximity + Cross-Layer Corroboration

The scoring formula is intentionally simple and human-explainable.
Each finding receives a score of the form `score(F) = C + P + X`.

#### Terms

| Term | Name | Range | Rule |
|------|------|-------|------|
| `C` | Confidence | 0.0 – 1.0 | Self-reported by subagent. 0.9 = explicit direct evidence; 0.5 = circumstantial; 0.1 = speculative. |
| `P` | Proximity Bonus | 0.0 or 1.0 | **Hard binary.** 1.0 if `event_timestamp` falls inside the causal window (`first_error_time − 30 min` to `first_error_time + 30 min`). 0.0 if outside or if `event_timestamp` is null. |
| `X` | Cross-Layer Corroboration | 0.0 – 0.6 | `0.2 × N`, capped at 0.6, where N = the number of *other* layers (not this finding's own) whose findings also cite the same named entity via a plain string-contains check (case-insensitive). |

**Maximum possible score:** `1.0 + 1.0 + 0.6 = 2.6`.
Display as: `score / 2.6 × 100` → confidence percentage in the report.

#### Entity Matching (for `X`)

Two findings are treated as citing the **same entity** if any of the
following strings appear in both their `evidence_reference` or `detail`
fields (case-insensitive):
- IAM role name: `report-uploader-app-role`
- IAM policy name: `report-uploader-s3-policy`
- S3 action: `s3:PutObject`
- S3 bucket name: `clirc-demo-report-uploads`
- Commit hash: `a223086`

This is a plain string-contains check — no semantic matching or embeddings.

#### Hypothesis Clustering

1. Group findings into clusters where every member cites at least one
   common entity from the list above.
2. Compute the **mean score** of each cluster.
3. Cluster with the highest mean score → `root_cause_hypothesis`.
4. Findings not in any cluster, or in a cluster with mean score < 0.5,
   → `other_signals` section (not the primary causal chain).

#### Why the Red Herring Loses

| Finding | C | P | X | Total | % |
|---------|---|---|---|-------|---|
| Commit `a223086` — IAM change at 11:05Z (15 min before first error) | 0.9 | 1.0 | 0.6 | 2.5 | 96 % |
| Commit `51fe05f` — validation change at 16:40Z next day (29 h after first error) | 0.6 | 0.0 | 0.0 | 0.6 | 23 % |

`51fe05f` scores 0.0 on both P and X: it is outside the causal window
and no other layer cites it. It will appear in the **Red Herrings
Deprioritized** section with an explicit explanation.

### 2.3 Handling Disagreement and Empty Results

| Situation | Main agent behavior |
|-----------|---------------------|
| One subagent returns `nothing_found: true` | Noted in report as "Layer X: no evidence found in window." Score proceeds with remaining three layers. |
| Two subagents find conflicting timestamps | Both findings are listed in the timeline; the lower-confidence one is flagged `[unresolved]`. |
| All four return `nothing_found: true` | Report states "Insufficient evidence. Widen the time window or provide more files." No root-cause hypothesis is emitted. |
| A finding has `confidence < 0.3` | It is included in the "Other signals" section but not in the primary causal chain. |

---

## 3. DOCUMENT UNDERSTANDING INTEGRATION

### 3.1 Where It Fits

The postmortem template (`runbook/postmortem-template.md`) is read by
the main agent **after correlation is complete but before the report is
written**. It is ingested once, in the synthesis turn (Turn 3).

If the user provides a `.docx` version instead, Bob uses `office_read`
with `mode: text` to extract its structure; a `.pdf` is also acceptable
via `office_read`. The Markdown version is the default for this repo.

### 3.2 How the Template Shapes Output

The main agent maps each template section to a correlation output:

| Template section | Filled from |
|-----------------|-------------|
| Incident Summary | Parsed from `INCIDENT.md` |
| Root Cause | `root_cause_hypothesis` from scoring |
| Causal Timeline table | Sorted `FindingPacket` events (columns: Time, Layer, Event) |
| Evidence | `evidence_reference` fields from each finding |
| Fix | Proposed `terraform/main.tf` diff |
| Prevention | Main agent generates based on the layer that introduced the bug |

The template's **exact section headings** and **table column names** are
preserved verbatim in the output so the final report drops straight into
the team's existing postmortem workflow.

---

## 4. OUTPUT ARTIFACT

### 4.1 Final Report Structure

The report is written to `reports/incident-<date>.md`. Its sections:

```
# Incident Root-Cause Report: <service> — <date>

## Incident Summary
(Filled from INCIDENT.md)

## Root Cause Hypothesis
**Confidence: XX %**
Plain-language statement of the root cause.

## Causal Timeline
| Time (UTC)           | Layer       | Event                              | Evidence Ref         |
|----------------------|-------------|-------------------------------------|----------------------|
| 2026-09-22T11:05:00Z | IaC         | Terraform commit a223086 removed… | terraform/main.tf:46 |
| 2026-09-22T11:20:15Z | Runtime     | First AccessDenied log line        | logs/app-prod.log:3  |
| ...                  | ...         | ...                                 | ...                  |

## Evidence by Layer
### IaC / Terraform
(Detail from SA-A FindingPacket)

### IAM / Permissions
(Detail from SA-B FindingPacket)

### Application / Deploy History
(Detail from SA-C FindingPacket)

### Runtime / Logs
(Detail from SA-D FindingPacket)

## Red Herrings Deprioritized
List of findings scored below threshold and why.

## Proposed Fix
(Unified diff preview of terraform/main.tf)

## Prevention
(Main agent narrative)
```

### 4.2 Post-Approval File Patching (Agent Mode)

After the user reviews and approves the report, the main agent in Agent
mode does exactly two things:

1. **Writes a patched `terraform/main.tf`** that adds `s3:PutObject`
   back into the `AllowReportBucketReadOnly` statement (rename to
   `AllowReportBucketAccess`).
2. **Shows a unified diff** of the change inline in chat before writing
   the file — the user must confirm before the file is written.

Safety constraints (hard):
- `terraform apply` is never run, simulated, or suggested.
- No AWS API calls are made.
- The only file written is `terraform/main.tf` (and optionally
  `reports/incident-<date>.md`).
- If the user declines the diff preview, the file is not touched.

---

## 5. DEMO / EVALUATION HARNESS

The `eval/timing-worksheet.md` file already defines the measurement
protocol. The implementation adds one small script:

### 5.1 `eval/run-eval.sh` (new file)

A shell script (~30 lines) that:
1. Prints "START — manual run" and opens a timer.
2. Tells the evaluator to find the root cause using only `git log`,
   `cat terraform/main.tf`, and `cat logs/app-prod.log`.
3. When they call done, records elapsed time.
4. Repeats for the CLIRC-assisted run (paste `INCIDENT.md` into Bob).
5. Prints a comparison table.

### 5.2 Metrics to Report

| Metric | How measured |
|--------|-------------|
| Time-to-root-cause | Wall-clock seconds from "investigation starts" to "root cause stated with evidence" |
| Layers correctly identified | Count (0–4) of IaC / IAM / App / Runtime layers cited correctly in the output |
| Red herring avoided | Boolean — was commit `51fe05f` correctly excluded from the causal chain? |
| Evidence precision | Were `evidence_reference` fields correct (right file + line)? |

The worksheet's "answer key" section in `eval/timing-worksheet.md`
already documents the expected correct answers for all four metrics.

---

## 6. FILE / FOLDER STRUCTURE

```
clirc-sample/
├── INCIDENT.md                  # Trigger input (exists)
├── clirc-plan.md                # This plan file (new)
│
├── terraform/
│   └── main.tf                  # IaC sample (exists, intentionally broken)
│
├── app/
│   ├── server.js                # Node.js app (exists)
│   ├── package.json             # (exists)
│   └── README.md                # (exists)
│
├── logs/
│   └── app-prod.log             # Synthetic log (exists)
│
├── runbook/
│   └── postmortem-template.md   # Document template (exists)
│
├── eval/
│   ├── timing-worksheet.md      # Metrics worksheet (exists)
│   └── run-eval.sh              # NEW: timing script
│
├── reports/                     # NEW: created at runtime
│   └── incident-<date>.md       # NEW: final report output
│
└── prompts/                     # NEW: system prompts for subagents
    ├── orchestrator.md          # Main agent instructions
    ├── sa-a-iac.md              # IaC subagent instructions
    ├── sa-b-iam.md              # IAM subagent instructions
    ├── sa-c-app.md              # App/Deploy subagent instructions
    └── sa-d-logs.md             # Log parser subagent instructions
```

**What already exists:** `terraform/`, `app/`, `logs/`, `runbook/`,
`eval/timing-worksheet.md`, `INCIDENT.md`.

**What gets built:** `prompts/` directory (5 files),
`eval/run-eval.sh`, `reports/` directory (created at runtime by the
agent).

---

## 7. RISKS & SCOPE CUTS FOR A TIME-BOXED HACKATHON

| Risk | Likelihood | Impact | Fallback / Simplification |
|------|-----------|--------|---------------------------|
| `spawn_subagent` result parsing fails (malformed JSON from a subagent) | Medium | Blocks synthesis | Add a `try/parse` wrapper; on failure, treat the raw string as a `layer_summary` with `confidence: 0.5` and `nothing_found: false` |
| Four subagents + synthesis exceeds context window | Low (files are small) | Corrupted report | Pre-truncate each file to the ±2 h window before passing to subagents; this repo's files are tiny |
| `.docx` postmortem template conversion is flaky | Low | Report format mismatch | Default to the `.md` version already in `runbook/`; the `.docx` path is a demo-day bonus |
| Git log parsing is ambiguous (no structured commit metadata) | Low | Wrong timestamps | Subagent reads `.git/logs/HEAD` directly and maps Unix epoch → ISO-8601; already validated in the explore run |
| Scoring ties between two hypotheses | Low | Ambiguous report | Report both hypotheses ranked 1 and 2; user chooses |
| "Patch file" step corrupts `terraform/main.tf` | Low | Demo broken | Always write to a new file `terraform/main.tf.patched` first; show diff against original; only overwrite on explicit user confirmation |
| Red-herring commit is NOT deprioritized (scoring bug) | Medium | Demo fails | Unit-test the scorer against the known answer in `eval/timing-worksheet.md` before demo day; the 29 h gap is large enough that `proximity_bonus = 0` should dominate |
| Subagent description too long → subagent confused | Medium | Wrong findings | Keep each subagent description under 300 words; use the `prompts/` files as the source of truth |

### Core Demo Minimum (if everything else falls behind)

The non-negotiable demo path is:
1. Paste `INCIDENT.md` into Bob.
2. Bob spawns 4 subagents in one turn (visible in the tool calls).
3. Each returns a `FindingPacket`.
4. Main agent produces a timeline table and names commit `a223086` as
   root cause, deprioritizes `51fe05f`.
5. Diff preview of the `terraform/main.tf` fix is shown.

Everything else (`.docx` ingestion, `run-eval.sh`, `reports/` directory,
`prompts/` files as separate files) is additive and can be dropped if
time runs out.

---

## Sub-Tasks (Implementation Order)

### Sub-Task 1 — Prompt Files
**Intent:** Create the `prompts/` directory with one instruction file per
agent role. These are the reusable system prompts that tell each subagent
exactly what file(s) to read, what JSON format to return, and what to
ignore. Getting these right is the foundation for clean subagent output.

**Expected Outcomes:**
- `prompts/orchestrator.md` — main agent instructions
- `prompts/sa-a-iac.md`, `sa-b-iam.md`, `sa-c-app.md`, `sa-d-logs.md`

**Todo List:**
- [ ] Write `prompts/orchestrator.md` covering: parse INCIDENT.md,
      spawn 4 subagents, wait for results, run scoring, call template
- [ ] Write `prompts/sa-a-iac.md`: read `terraform/` + git diffs of
      `.tf` files; return `FindingPacket` with `layer: "IaC"`
- [ ] Write `prompts/sa-b-iam.md`: read `terraform/main.tf` IAM
      resources only; diff against prior commit; return
      `FindingPacket` with `layer: "IAM"`
- [ ] Write `prompts/sa-c-app.md`: read `app/` + full git log; return
      `FindingPacket` with `layer: "Application"`
- [ ] Write `prompts/sa-d-logs.md`: read `logs/app-prod.log`; extract
      error lines within window; return `FindingPacket` with
      `layer: "Runtime"`

**Relevant Context:** `INCIDENT.md`, `terraform/main.tf`,
`app/server.js`, `logs/app-prod.log`, `.git/logs/HEAD`

**Status:** `[ ] pending`

---

### Sub-Task 2 — Orchestrator Trigger Script
**Intent:** Create a `reports/` directory placeholder and a thin
`orchestrator-prompt.md` that a user can paste into Bob to kick off the
full CLIRC run against this repo. This is the "demo entry point."

**Expected Outcomes:**
- `reports/.gitkeep` so the directory exists in git
- `orchestrator-prompt.md` at repo root — a ready-to-paste prompt that
  includes the incident text, points to all relevant files, and
  instructs Bob to follow the plan in `clirc-plan.md`

**Todo List:**
- [ ] Create `reports/.gitkeep`
- [ ] Write `orchestrator-prompt.md` (user-facing trigger)

**Relevant Context:** `INCIDENT.md`, `clirc-plan.md` (this file)

**Status:** `[ ] pending`

---

### Sub-Task 3 — Evaluation Script
**Intent:** Implement `eval/run-eval.sh` so the hackathon demo has a
quantitative before/after metric.

**Expected Outcomes:**
- `eval/run-eval.sh` — runnable on macOS/Linux bash; prints elapsed
  times and prompts evaluator for Y/N on red-herring and evidence
  questions; outputs a summary table

**Todo List:**
- [ ] Write `eval/run-eval.sh` with manual-run and CLIRC-run sections
- [ ] Verify it references the correct answer key from
      `eval/timing-worksheet.md`

**Relevant Context:** `eval/timing-worksheet.md`

**Status:** `[ ] pending`

---

### Sub-Task 4 — Live CLIRC Run + Report Generation
**Intent:** Execute the actual CLIRC investigation in Agent mode using
the completed prompts. This produces the artifact that proves the system
works end-to-end.

**Expected Outcomes:**
- `reports/incident-2026-09-22.md` written with correct root cause,
  causal timeline, evidence citations, and Terraform fix diff
- `terraform/main.tf.patched` showing the fix (not overwriting original
  until confirmed)

**Todo List:**
- [ ] In Agent mode, follow `prompts/orchestrator.md`
- [ ] Spawn SA-A, SA-B, SA-C, SA-D via `spawn_subagent` (same turn)
- [ ] Parse all four `FindingPacket` results
- [ ] Run scoring logic; identify root cause and red herring
- [ ] Read `runbook/postmortem-template.md` to shape report sections
- [ ] Write `reports/incident-2026-09-22.md`
- [ ] Write `terraform/main.tf.patched` with diff preview
- [ ] Confirm fix with user before any overwrite

**Relevant Context:** All files listed in §6; scoring logic in §2.2

**Status:** `[ ] pending`
