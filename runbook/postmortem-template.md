# Postmortem Template (Internal Standard)

> Convert to .docx/.pdf for the actual hackathon demo if you want to
> exercise Bob's document-understanding feature on a real binary file.
> Kept as Markdown here for easy editing.

## Incident Summary
- **Service(s) affected:**
- **Start time / End time:**
- **Detected by:** (alert, user report, manual discovery)
- **Severity:** (P1 / P2 / P3)

## Impact
- What broke, for whom, for how long.

## Root Cause
- The single most likely cause, stated plainly.
- Confidence level (High / Medium / Low) and why.

## Causal Timeline
| Time (UTC) | Layer | Event |
|---|---|---|
| | | |

> Layer must be one of: IaC, IAM/Permissions, Application, Runtime/Logs.

## Evidence
- Cite the specific commit hash, policy change, or log line for each
  timeline entry above. No unsupported claims.

## Fix
- Proposed change (diff or description).
- Who needs to approve it before it's applied to real infrastructure.

## Prevention
- What would catch this class of issue earlier next time
  (e.g. staging environment parity check, IAM policy simulation in CI).
