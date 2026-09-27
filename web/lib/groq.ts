/**
 * Server-side only. The ONLY file permitted to reference process.env.GROQ_API_KEY.
 * Never import this from a client component.
 */

export function stripAndParse(text: string): unknown {
  let s = text.trim();

  // Strip leading/trailing markdown code fences (```json ... ``` or ``` ... ```)
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // If the string contains { and }, extract from first { to last }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  return JSON.parse(s);
}

/**
 * Parse the retry delay (ms) from a Groq 429 error body.
 * Groq includes "Please try again in X.XXXs" in the message.
 * Falls back to `defaultMs` if not found.
 */
function parse429DelayMs(body: string, defaultMs: number): number {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    const msg = parsed?.error?.message ?? "";
    // Matches "Please try again in 6.12s" or "Please try again in 800ms"
    const secMatch = msg.match(/try again in ([\d.]+)s/);
    if (secMatch) return Math.ceil(parseFloat(secMatch[1]) * 1000);
    const msMatch = msg.match(/try again in ([\d.]+)ms/);
    if (msMatch) return Math.ceil(parseFloat(msMatch[1]));
  } catch { /* ignore parse errors */ }
  return defaultMs;
}

/**
 * Call the Groq API once. Throws typed errors:
 *   "GROQ_API_KEY_MISSING"
 *   "GROQ_429:<delayMs>"   — rate limited; caller should wait and retry
 *   "GROQ_API_ERROR:<status>:<body>"
 *
 * @param maxTokens  Output token ceiling. Use 600 for subagent calls,
 *                   1800 for synthesis (larger output schema).
 */
export async function callGroq(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY_MISSING");

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    }
  );

  if (!response.ok) {
    let body = "";
    try { body = await response.text(); } catch { /* ignore */ }
    console.error(`[CLIRC] Groq API error ${response.status}:`, body);

    if (response.status === 429) {
      const delayMs = parse429DelayMs(body, 1000);
      throw new Error(`GROQ_429:${delayMs}`);
    }

    throw new Error(`GROQ_API_ERROR:${response.status}:${body}`);
  }

  const data = await response.json();
  return data.choices[0].message.content as string;
}

/**
 * Call Groq with up to 2 automatic 429 retries (exponential backoff).
 * Parses Groq's suggested retry delay from the error body.
 * Throws "GROQ_RATE_LIMITED" after exhausting retries.
 */
async function callGroqWith429Retry(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  maxRetries = 2
): Promise<string> {
  let attempt = 0;
  let lastDelay = 1000;

  while (attempt <= maxRetries) {
    try {
      return await callGroq(systemPrompt, userPrompt, maxTokens);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";

      if (msg.startsWith("GROQ_429:") && attempt < maxRetries) {
        const suggestedMs = parseInt(msg.split(":")[1], 10) || 1000;
        // Each retry doubles the wait: first retry uses Groq's hint, second uses 2×
        const waitMs = attempt === 0 ? suggestedMs : suggestedMs * 2;
        lastDelay = waitMs;
        console.warn(`[CLIRC] Rate limited — waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        attempt++;
        continue;
      }

      // Not a 429, or retries exhausted
      if (msg.startsWith("GROQ_429:")) {
        throw new Error(`GROQ_RATE_LIMITED:${lastDelay * 2}`);
      }
      throw err;
    }
  }

  // Should never reach here
  throw new Error("GROQ_RATE_LIMITED:2000");
}

/**
 * Full pipeline: 429-aware retry → call → JSON parse → retry on bad JSON.
 *
 * @param maxTokens  Passed through to callGroq. Default 600 (subagent).
 *                   Pass 1800 for synthesis calls.
 */
export async function callGroqWithRetry(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600
): Promise<unknown> {
  const raw = await callGroqWith429Retry(systemPrompt, userPrompt, maxTokens);

  try {
    return stripAndParse(raw);
  } catch {
    // Log the raw model output so we can see exactly what non-JSON it produced
    console.error("[CLIRC] JSON parse failed on first attempt. Raw model output:\n---\n" + raw + "\n---");

    // Retry once with explicit correction instruction
    const retryPrompt = `${userPrompt}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object, nothing else.`;
    const retryRaw = await callGroqWith429Retry(systemPrompt, retryPrompt, maxTokens);

    try {
      return stripAndParse(retryRaw);
    } catch {
      console.error("[CLIRC] JSON parse failed on retry. Raw model output:\n---\n" + retryRaw + "\n---");
      throw new Error("JSON_PARSE_FAILED");
    }
  }
}
