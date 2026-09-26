# Incident Report (paste this to Bob as the investigation trigger)

**Reported by:** On-call engineer
**Time noticed:** 2026-09-22 ~14:10 UTC (escalated again 2026-09-23 ~17:00 UTC)
**Service:** report-uploader

## Symptom
Users are intermittently getting `500 upload_failed` when submitting
reports via `POST /reports`. It started sometime on 2026-09-22 and is
still happening. No errors on `GET /healthz` — the service itself is up.

## What we know
- Logs show repeated `AccessDenied` errors from AWS S3 on PutObject.
- There was an app deploy on 2026-09-23 (validation change) — on-call's
  first guess is that deploy broke something, but the errors actually
  started the day before.
- No changes were made directly in the AWS console (as far as we know).

## What we need
Find the actual root cause across infra, permissions, and app history —
not just the most recent deploy — and propose a fix.
