// POST /api/investigate/synthesize
// Body: { scenarioId: string, findings: SubagentResult[] }
// Returns: { result: SynthesisResult } | { error: string }

import { NextRequest, NextResponse } from "next/server";
import { getScenario } from "@/lib/scenarios";
import { callGroqWithRetry } from "@/lib/groq";
import type { SubagentResult, SynthesisResult } from "@/lib/types";

const SYSTEM_PROMPT = `You are a senior SRE analyst performing multi-layer incident root-cause correlation. You will receive a symptom description and findings from multiple investigation layers. Your job is to synthesize them into a definitive root-cause analysis.

Reply with ONLY a valid JSON object — no markdown fences, no explanatory text. The JSON must match this exact shape:
{
  "timeline": [{ "time": "<ISO 8601>", "layer": "<layer name>", "event": "<description>" }],
  "root_cause": {
    "summary": "<one sentence root cause>",
    "confidence_pct": <number 0-100>,
    "confidence_reasoning": "<explain the score>",
    "citation": "<exact evidence reference>"
  },
  "red_herring": {
    "summary": "<one sentence describing the misleading change>",
    "confidence_pct": <number 0-100>,
    "confidence_reasoning": "<why this is NOT the cause despite seeming suspicious>",
    "citation": "<exact evidence reference>"
  } or null if none,
  "fix": {
    "description": "<what needs to be changed>",
    "diff_preview": "<a short diff or config snippet showing the fix>"
  }
}`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { scenarioId, findings } = body as Record<string, unknown>;

  if (typeof scenarioId !== "string" || !scenarioId) {
    return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
  }
  if (!Array.isArray(findings) || findings.length < 1) {
    return NextResponse.json(
      { error: "findings must be a non-empty array" },
      { status: 400 }
    );
  }

  const scenario = getScenario(scenarioId);
  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  const userPrompt = `Incident symptom: ${scenario.symptom}

Findings from ${findings.length} investigation layer(s):
${JSON.stringify(findings as SubagentResult[], null, 2)}

CONFIDENCE SCORING RULE (apply this explicitly when computing confidence_pct):
Score confidence using: 40% weight on how tightly the finding's timestamp precedes the symptom onset; 40% weight on whether there is a direct causal mechanism (not just time proximity) linking the finding to the symptom; 20% weight on whether it matches a known failure pattern. A recent-but-uncausal finding must score LOW despite its recency. This is the specific failure mode to guard against — do not let a "most recent change" heuristic determine root cause.`;

  console.log(`[CLIRC] synthesis call: scenario=${scenarioId} findings=${findings.length} promptChars=${userPrompt.length}`);

  try {
    // Synthesis output schema is much larger than a single subagent response:
    // timeline (4–6 entries) + root_cause + red_herring + fix.diff_preview.
    // 1800 tokens gives ample headroom without multiplying rate-limit risk
    // (synthesis is a single call, not 4 parallel ones).
    const parsed = await callGroqWithRetry(SYSTEM_PROMPT, userPrompt, 1800);
    console.log(`[CLIRC] synthesis OK: scenario=${scenarioId}`);
    return NextResponse.json({ result: parsed as SynthesisResult }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";

    if (msg === "GROQ_API_KEY_MISSING") {
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured. See README for setup instructions." },
        { status: 503 }
      );
    }
    if (msg.startsWith("GROQ_RATE_LIMITED")) {
      return NextResponse.json(
        { error: "This layer hit a rate limit — try running the investigation again in a few seconds." },
        { status: 429 }
      );
    }
    if (msg.startsWith("GROQ_API_ERROR:")) {
      const parts = msg.split(":");
      const status = parts[1];
      const detail = parts.slice(2).join(":").trim();
      return NextResponse.json(
        { error: `LLM API error ${status}${detail ? `: ${detail}` : ""}` },
        { status: 502 }
      );
    }
    if (msg === "JSON_PARSE_FAILED") {
      return NextResponse.json(
        { error: "Model returned invalid JSON after retry." },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
