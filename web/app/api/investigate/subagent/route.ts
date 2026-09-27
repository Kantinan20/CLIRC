// POST /api/investigate/subagent
// Body: { scenarioId: string, layerId: string }
// Returns: { result: SubagentResult } | { error: string }

import { NextRequest, NextResponse } from "next/server";
import { getScenario } from "@/lib/scenarios";
import { callGroqWithRetry } from "@/lib/groq";
import type { SubagentResult } from "@/lib/types";

const SYSTEM_PROMPT = `You are an expert SRE incident analyst. You will be given a symptom description and one layer of evidence from a cloud incident investigation.

Your job is to analyze ONLY this layer's evidence and report your finding.

Reply with ONLY a valid JSON object — no markdown fences, no explanatory text before or after. The JSON must match this exact shape:
{
  "layer": "<layer id>",
  "finding": "<1-2 sentence finding>",
  "evidence_reference": "<exact quote, commit hash, log line, or policy line from the evidence>",
  "timestamp": "<most relevant timestamp from the evidence, ISO 8601>",
  "relevance": "<high|medium|low>",
  "notes": "<any important caveats or additional observations>"
}`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { scenarioId, layerId } = body as Record<string, unknown>;

  if (typeof scenarioId !== "string" || !scenarioId) {
    return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
  }
  if (typeof layerId !== "string" || !layerId) {
    return NextResponse.json({ error: "layerId is required" }, { status: 400 });
  }

  const scenario = getScenario(scenarioId);
  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  const layer = scenario.layers.find((l) => l.id === layerId);
  if (!layer) {
    return NextResponse.json({ error: "Layer not found" }, { status: 404 });
  }

  // CRITICAL: include ONLY this single layer's context
  const userPrompt = `${scenario.symptom}\n\nEvidence — ${layer.label} (${layer.sub}):\n${layer.context}`;

  console.log(`[CLIRC] subagent call: scenario=${scenarioId} layer=${layerId} promptChars=${userPrompt.length}`);

  try {
    const parsed = await callGroqWithRetry(SYSTEM_PROMPT, userPrompt);
    console.log(`[CLIRC] subagent OK: scenario=${scenarioId} layer=${layerId}`);
    return NextResponse.json({ result: parsed as SubagentResult }, { status: 200 });
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
