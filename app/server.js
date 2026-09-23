const express = require("express");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const app = express();
app.use(express.json());

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
const BUCKET = process.env.REPORT_BUCKET || "clirc-demo-report-uploads";

// POST /reports — generates a report and uploads it to S3
app.post("/reports", async (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "invalid_body" });
  }

  const reportId = `report-${Date.now()}.json`;
  const body = JSON.stringify(req.body ?? {});

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: reportId,
        Body: body,
        ContentType: "application/json",
      })
    );
    console.log(
      JSON.stringify({
        level: "info",
        msg: "report_uploaded",
        reportId,
        bucket: BUCKET,
        timestamp: new Date().toISOString(),
      })
    );
    res.status(201).json({ reportId, status: "uploaded" });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "report_upload_failed",
        reportId,
        bucket: BUCKET,
        error_name: err.name,
        error_message: err.message,
        timestamp: new Date().toISOString(),
      })
    );
    res.status(500).json({ error: "upload_failed", detail: err.message });
  }
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`report-uploader listening on ${PORT}`));

module.exports = app;
