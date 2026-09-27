"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getScenario } from "@/lib/scenarios";
import type { LayerId } from "@/lib/scenarios";
import type { SubagentResult, SynthesisResult } from "@/lib/types";
import LayerCard, { type LayerStatus } from "@/components/LayerCard";
import SynthesisPanel from "@/components/SynthesisPanel";
import styles from "./page.module.css";

// ─── State types ────────────────────────────────────────────────────────────

type LayerState = {
  status: LayerStatus;
  result?: SubagentResult;
  error?: string;
};

type PageState = {
  layers: Record<LayerId, LayerState>;
  synthesisStatus: "idle" | "loading" | "done" | "error";
  synthesisResult?: SynthesisResult;
  synthesisError?: string;
  setupError?: string;
};

const LAYER_IDS: LayerId[] = ["iac", "iam", "app", "logs"];

const INITIAL_LAYERS: Record<LayerId, LayerState> = {
  iac:  { status: "queued" },
  iam:  { status: "queued" },
  app:  { status: "queued" },
  logs: { status: "queued" },
};

// ─── Page component ──────────────────────────────────────────────────────────

export default function InvestigatePage() {
  const params = useParams();
  const router = useRouter();
  // Capture scenarioId as a stable local const so every closure in this render
  // cycle refers to the same value — never a mutated outer variable.
  const scenarioId =
    typeof params.scenarioId === "string" ? params.scenarioId : "";
  const scenario = getScenario(scenarioId);

  const [state, setState] = useState<PageState>({
    layers: INITIAL_LAYERS,
    synthesisStatus: "idle",
  });

  // AbortController ref — a new controller is created each time the investigation
  // effect runs. On cleanup (unmount or scenarioId change), the previous
  // controller is aborted, which cancels all in-flight fetches and causes any
  // stager/backoff setTimeout awaits to resolve into aborted fetches that throw,
  // stopping the stale run before it can call setState or fire more requests.
  const abortRef = useRef<AbortController | null>(null);

  // Redirect if scenario not found
  useEffect(() => {
    if (!scenario) {
      router.replace("/");
    }
  }, [scenario, router]);

  // Main investigation effect
  useEffect(() => {
    if (!scenario) return;

    // Cancel any previous run (stale stagger delays, in-flight fetches, 429 backoffs)
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // Snapshot scenarioId by value into this effect's scope.
    // Every fetch and closure below reads THIS local variable, not the outer
    // param — so even if the component re-renders with a different scenarioId
    // the in-flight closures still hold the correct value for THIS run.
    const runScenarioId = scenarioId;

    // Mark all layers running
    setState((prev) => ({
      ...prev,
      layers: Object.fromEntries(
        LAYER_IDS.map((id) => [id, { status: "running" as LayerStatus }])
      ) as Record<LayerId, LayerState>,
    }));

    async function runInvestigation() {
      // Stagger starts by 800ms per slot to spread TPM usage across the minute
      // window. Slots: iac=0ms, iam=800ms, app=1600ms, logs=2400ms.
      // All 4 cards are already shown as "running" before any fetch fires.
      const STAGGER_MS = 800;
      const results = await Promise.allSettled(
        LAYER_IDS.map(async (layerId, index) => {
          if (index > 0) {
            // Honour abort during stagger delay: if the signal fires while we
            // are waiting, the subsequent fetch will throw AbortError immediately.
            await new Promise<void>((resolve, reject) => {
              if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
              const t = setTimeout(resolve, index * STAGGER_MS);
              signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
            });
          }
          // Pass signal into fetch — aborted runs are cancelled at the network level
          const res = await fetch("/api/investigate/subagent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Use runScenarioId (captured by value) — never the outer scenarioId
            body: JSON.stringify({ scenarioId: runScenarioId, layerId }),
            signal,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Unknown error");
          return { layerId, result: data.result as SubagentResult };
        })
      );

      // If this run was aborted, do not update state
      if (signal.aborted) return;

      // Detect setup error (key missing) — check first rejected reason
      let setupError: string | undefined;
      for (const r of results) {
        if (
          r.status === "rejected" &&
          typeof r.reason?.message === "string" &&
          r.reason.message.includes("GROQ_API_KEY")
        ) {
          setupError = r.reason.message;
          break;
        }
      }

      // Build updated layer states — skip AbortError rejections (stale run noise)
      const updatedLayers: Record<LayerId, LayerState> = {
        iac:  { status: "queued" },
        iam:  { status: "queued" },
        app:  { status: "queued" },
        logs: { status: "queued" },
      };

      const succeededFindings: SubagentResult[] = [];

      results.forEach((r, i) => {
        const layerId = LAYER_IDS[i];
        if (r.status === "fulfilled") {
          updatedLayers[layerId] = {
            status: "done",
            result: r.value.result,
          };
          succeededFindings.push(r.value.result);
        } else {
          // Suppress AbortError — it means the run was cancelled, not failed
          const isAbort = r.reason?.name === "AbortError";
          updatedLayers[layerId] = {
            status: isAbort ? "queued" : "error",
            error: isAbort ? undefined : (r.reason?.message ?? "Unknown error"),
          };
        }
      });

      setState((prev) => ({
        ...prev,
        layers: updatedLayers,
        setupError,
      }));

      // If no findings succeeded, bail out
      if (succeededFindings.length === 0) return;
      if (signal.aborted) return;

      // Fire synthesis
      setState((prev) => ({ ...prev, synthesisStatus: "loading" }));

      try {
        const res = await fetch("/api/investigate/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenarioId: runScenarioId, findings: succeededFindings }),
          signal,
        });
        if (signal.aborted) return;
        const data = await res.json();
        if (!res.ok) {
          // Check for missing key error in synthesis too
          const isSetup =
            typeof data.error === "string" &&
            data.error.includes("GROQ_API_KEY");
          setState((prev) => ({
            ...prev,
            synthesisStatus: "error",
            synthesisError: data.error ?? "Synthesis failed",
            setupError: isSetup ? data.error : prev.setupError,
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          synthesisStatus: "done",
          synthesisResult: data.result as SynthesisResult,
        }));
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          synthesisStatus: "error",
          synthesisError:
            err instanceof Error ? err.message : "Synthesis failed",
        }));
      }
    }

    runInvestigation();

    // Cleanup: abort the run if the component unmounts or scenarioId changes
    return () => { controller.abort(); };
  // scenarioId in deps so the effect re-runs (and aborts the old run) if the
  // param somehow changes without a full unmount
  }, [scenarioId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!scenario) return null;

  const layersAnalyzed = LAYER_IDS.filter(
    (id) => state.layers[id].status === "done"
  ).length;

  const synthLoadingCount = LAYER_IDS.filter(
    (id) => state.layers[id].status === "done"
  ).length;

  return (
    <main className={styles.page}>
      {/* Back link */}
      <Link href="/" className={styles.backLink}>
        ← Scenarios
      </Link>

      {/* Scenario header */}
      <div className={styles.scenarioHeader}>
        <h1 className={styles.scenarioTitle}>{scenario.title}</h1>
        <p className={styles.scenarioBlurb}>{scenario.blurb}</p>
      </div>

      {/* Setup error banner (shown instead of raw errors) */}
      {state.setupError && (
        <div className={styles.setupBanner}>
          <strong>⚠ GROQ_API_KEY is not configured.</strong>
          {`Add GROQ_API_KEY=your_key_here to web/.env.local for local dev,\nor set it in your Vercel/Netlify environment variables.\nSee README for full instructions.`}
        </div>
      )}

      {/* 2×2 layer grid */}
      <div className={styles.layerGrid}>
        {LAYER_IDS.map((layerId) => {
          const layer = scenario.layers.find((l) => l.id === layerId)!;
          const ls = state.layers[layerId];
          return (
            <LayerCard
              key={layerId}
              label={layer.label}
              sub={layer.sub}
              status={ls.status}
              result={ls.result}
              error={ls.error}
            />
          );
        })}
      </div>

      {/* Synthesis section */}
      {state.synthesisStatus !== "idle" && (
        <section className={styles.synthesisSection}>
          <h2 className={styles.synthesisSectionTitle}>Synthesis</h2>

          {state.synthesisStatus === "loading" && (
            <div className={styles.synthesisLoading}>
              <span className={styles.loadingPill}>● Analyzing…</span>
              Synthesizing findings across {synthLoadingCount} layer
              {synthLoadingCount !== 1 ? "s" : ""}…
            </div>
          )}

          {state.synthesisStatus === "error" && !state.setupError && (
            <p className={styles.errorMsg}>
              Synthesis failed: {state.synthesisError}
            </p>
          )}

          {state.synthesisStatus === "done" && state.synthesisResult && (
            <SynthesisPanel
              result={state.synthesisResult}
              layersAnalyzed={layersAnalyzed}
              totalLayers={LAYER_IDS.length}
            />
          )}
        </section>
      )}
    </main>
  );
}
