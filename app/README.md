# report-uploader

Small internal service that accepts report payloads and stores them in S3
for later retrieval by the analytics team.

## Endpoints
- `POST /reports` — uploads a report JSON blob to the configured S3 bucket
- `GET /healthz` — health check
