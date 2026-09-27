export type LayerId = "iac" | "iam" | "app" | "logs";

export interface Layer {
  id: LayerId;
  label: string;
  sub: string;
  context: string;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  symptom: string;
  layers: Layer[];
}

const SCENARIO_S3IAM: Scenario = {
  id: "s3iam",
  title: "Report uploads failing (500 errors)",
  blurb:
    "Users get intermittent 500 upload_failed on POST /reports since yesterday. On-call's first guess: the deploy that shipped this morning.",
  symptom:
    "Service: report-uploader. Symptom: intermittent 500 upload_failed on POST /reports, first noticed 2026-09-22 ~14:10 UTC, still occurring 2026-09-23. GET /healthz is fine. On-call's first suspicion is the validation-change deploy that shipped 2026-09-23 16:40 UTC, since it's the most recent change — but errors were already occurring the day before that deploy.",
  layers: [
    {
      id: "iac",
      label: "Infrastructure as Code",
      sub: "terraform/main.tf — 4 revisions",
      context: `Terraform history for the IAM policy attached to the report-uploader app role (most recent last):

REVISION 1 (2026-09-10 09:00, commit 662a108) — initial:
resource "aws_iam_role_policy" "report_uploader_s3_policy" {
  policy = jsonencode({
    Statement = [{
      Sid = "AllowReportBucketReadWrite"
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource = [aws_s3_bucket.report_uploads.arn, "\${aws_s3_bucket.report_uploads.arn}/*"]
    }]
  })
}

REVISION 2 (2026-09-22 11:05 UTC, commit a223086, message: "Security audit: tighten report-uploader IAM policy to least privilege (remove unused write perms)"):
resource "aws_iam_role_policy" "report_uploader_s3_policy" {
  policy = jsonencode({
    Statement = [{
      Sid = "AllowReportBucketReadOnly"
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:ListBucket"]
      Resource = [aws_s3_bucket.report_uploads.arn, "\${aws_s3_bucket.report_uploads.arn}/*"]
    }]
  })
}
(s3:PutObject was removed in this revision and never re-added)

No further terraform changes after this.`,
    },
    {
      id: "iam",
      label: "IAM / Permissions",
      sub: "current effective policy",
      context: `Current effective IAM policy state for role "report-uploader-app-role" (as of now, matches Terraform revision 2 above):

Allowed actions on bucket clirc-demo-report-uploads: s3:GetObject, s3:ListBucket
NOT allowed: s3:PutObject (was present until 2026-09-22 11:05 UTC, removed by a policy update citing "least privilege" / "remove unused write perms")

No IAM changes have been made directly in the console — the only IAM history is the Terraform-managed policy above. No other roles or resources were modified.`,
    },
    {
      id: "app",
      label: "App + Git History",
      sub: "server.js — commit log",
      context: `Git commit history for the report-uploader application (most recent last):

662a108 (2026-09-10 09:00) "Initial infra + report-uploader service (S3 read/write for report bucket)" — adds POST /reports which calls s3.PutObjectCommand to upload each report.

3de330f (2026-09-15 14:22) "Add README for report-uploader service" — documentation only, no code change.

a223086 (2026-09-22 11:05) "Security audit: tighten report-uploader IAM policy to least privilege (remove unused write perms)" — Terraform-only change (see IaC layer), no application code touched.

51fe05f (2026-09-23 16:40) "Add basic request body validation to /reports endpoint" — adds a check that req.body is a non-null object before proceeding; returns 400 invalid_body if not. Does not touch the S3 upload call itself.

The application code that calls s3:PutObject has been unchanged since the very first commit (662a108).`,
    },
    {
      id: "logs",
      label: "Runtime Logs",
      sub: "logs/app-prod.log",
      context: `Production log excerpt (report-uploader), chronological:

2026-09-22T11:12:03Z info report_uploaded (success)
2026-09-22T11:14:47Z info report_uploaded (success)
2026-09-22T11:20:15Z error report_upload_failed — AccessDenied: "User: assumed-role/report-uploader-app-role/i-0a1b2c3d is not authorized to perform: s3:PutObject on resource public.../report-....json because no identity-based policy allows the s3:PutObject action"
2026-09-22T11:21:02Z error report_upload_failed — AccessDenied (same s3:PutObject message)
2026-09-22T11:25:40Z error report_upload_failed — AccessDenied (same s3:PutObject message)
2026-09-22T14:03:11Z error report_upload_failed — AccessDenied (same s3:PutObject message)
2026-09-23T16:41:05Z info report_uploaded (a request was rejected by new input validation before reaching S3, logged separately)
2026-09-23T16:52:33Z error report_upload_failed — AccessDenied (same s3:PutObject message, AFTER the 16:40 deploy)

Every failure has the identical AccessDenied / s3:PutObject error signature. Errors began at 11:20 on 2026-09-22 and continued unchanged in signature after the 2026-09-23 16:40 deploy.`,
    },
  ],
};

const SCENARIO_SGNET: Scenario = {
  id: "sgnet",
  title: "Checkout service can't reach payment API (timeouts)",
  blurb:
    "Checkout requests started timing out this morning. On-call suspects the payment SDK version bump merged yesterday.",
  symptom:
    "Service: checkout-service. Symptom: outbound calls to the external payment API (payments.example.com:443) started timing out at 2026-09-18 ~08:40 UTC and are still failing. No errors calling internal services. On-call's first suspicion is the payment SDK dependency bump merged the day before (2026-09-17), since it's the most recent app change — but the timeouts started roughly 15 hours after that merge, not immediately after deploy.",
  layers: [
    {
      id: "iac",
      label: "Infrastructure as Code",
      sub: "terraform/network.tf — 3 revisions",
      context: `Terraform history for the security group attached to checkout-service (most recent last):

REVISION 1 (2026-08-02, commit 7a1c204) — initial, working:
resource "aws_security_group_rule" "checkout_egress_https" {
  type = "egress"
  from_port = 443
  to_port = 443
  protocol = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
  security_group_id = aws_security_group.checkout_sg.id
  description = "Allow outbound HTTPS to any external API (payments, shipping, tax)"
}

REVISION 2 (2026-09-18 06:15 UTC, commit f9e2b31, message: "Network hardening: scope checkout egress to known vendor CIDR ranges only"):
resource "aws_security_group_rule" "checkout_egress_https" {
  type = "egress"
  from_port = 443
  to_port = 443
  protocol = "tcp"
  cidr_blocks = ["203.0.113.0/24"]   # shipping + tax vendor range only
  security_group_id = aws_security_group.checkout_sg.id
  description = "Allow outbound HTTPS to shipping/tax vendors"
}
(The payments vendor's CIDR range, 198.51.100.0/24, was omitted from this revision — appears to be an oversight, as the commit message and PR description only mention shipping/tax vendors, not payments)

No further network.tf changes after this.`,
    },
    {
      id: "iam",
      label: "IAM / Permissions",
      sub: "current effective policy",
      context: `IAM role permissions for checkout-service are unchanged in the relevant window and are not implicated: the service has always had secretsmanager:GetSecretValue for the payment API key, and this permission was not modified. No IAM policy changes occurred between 2026-09-15 and now. This layer shows no relevant change.`,
    },
    {
      id: "app",
      label: "App + Git History",
      sub: "checkout-service — commit log",
      context: `Git commit history for checkout-service (most recent last):

7a1c204 (2026-08-02) "Initial checkout service with payment API integration" — establishes outbound HTTPS call to payments.example.com.

c88d015 (2026-09-10) "Refactor tax calculation module" — unrelated internal logic change, no network or dependency changes.

f9e2b31 (2026-09-18 06:15) "Network hardening: scope checkout egress to known vendor CIDR ranges only" — Terraform-only change (see IaC layer), no application code touched.

d41a99e (2026-09-17 19:50) "Bump payment-sdk from 4.2.0 to 4.3.1 (routine dependency update)" — package.json version bump only; changelog for 4.3.1 lists "no breaking changes, internal retry logic improvements." No changes to which host or port the SDK calls.

Note the SDK bump (d41a99e) landed at 09-17 19:50, BEFORE the network hardening commit (f9e2b31) at 09-18 06:15 — the SDK bump predates the symptom's onset by about 13 hours, and the network change lands about 2.5 hours before the first reported timeout.`,
    },
    {
      id: "logs",
      label: "Runtime Logs",
      sub: "logs/checkout-prod.log",
      context: `Production log excerpt (checkout-service), chronological:

2026-09-18T06:20:00Z info payment_api_call_success (last known success)
2026-09-18T08:41:12Z error payment_api_call_failed — ETIMEDOUT connecting to payments.example.com:443, no response after 30000ms
2026-09-18T12:02:11Z error payment_api_call_failed — ETIMEDOUT (same signature)
2026-09-18T15:47:03Z error payment_api_call_failed — ETIMEDOUT (same signature)

Every failure is a connection-level timeout (ETIMEDOUT), never an HTTP error response, and never an SDK-level exception (no stack trace referencing payment-sdk internals) — consistent with packets never leaving the network, not with an application or SDK-level bug. Timeouts began at 08:41 on 2026-09-18, roughly 2.5 hours after the network hardening commit and roughly 14 hours after the SDK bump.`,
    },
  ],
};

export const SCENARIOS: Scenario[] = [SCENARIO_S3IAM, SCENARIO_SGNET];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
