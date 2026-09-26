# Demo Impact Worksheet

Use this to produce a real number for the "Business Value" pitch.

## Ground truth (do not show judges this file — it's your answer key)
- **Root cause:** commit `a223086` ("Security audit: tighten report-uploader
  IAM policy...") removed `s3:PutObject` from `report-uploader-s3-policy`.
- **Red herring:** commit `51fe05f` (validation change) is what on-call
  suspects first, but it's unrelated — it landed a day after errors began.
- **Correct causal chain:** IaC/IAM change (2026-09-22 11:05) → first
  AccessDenied log line (2026-09-22 11:20) → errors persist through the
  red-herring deploy (2026-09-23 16:40) → still failing after (16:52).

## Run 1 — Manual investigation (baseline)
Have someone unfamiliar with this repo try to find the root cause using
only: `git log`, the Terraform diff, and `logs/app-prod.log`. No Bob.
- Start time: ____
- End time (root cause correctly identified + cited): ____
- **Elapsed:** ____
- Did they get misled by the red herring commit first? Y/N

## Run 2 — CLIRC-assisted (Bob, parallel subagents)
Paste `INCIDENT.md` into Bob with the CLIRC system prompt active.
- Start time (prompt submitted): ____
- End time (final report produced with correct root cause): ____
- **Elapsed:** ____
- Did the report correctly flag the red herring as unrelated? Y/N
- Did it cite the correct commit hash and log line as evidence? Y/N

## Metrics to report in the pitch
- Time-to-root-cause: manual vs. CLIRC (state as "Nx faster")
- Number of layers correctly identified out of 4 (IaC, IAM, App, Logs)
- False leads avoided (red herring correctly deprioritized)
