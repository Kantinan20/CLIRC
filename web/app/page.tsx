"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SCENARIOS } from "@/lib/scenarios";
import styles from "./page.module.css";

export default function HomePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const router = useRouter();

  function handleRun() {
    if (selectedId) router.push(`/investigate/${selectedId}`);
  }

  return (
    <main className={styles.page}>
      <header>
        <h1 className={styles.header}>CLIRC</h1>
        <p className={styles.tagline}>Cross-Layer Incident Root-Cause Correlator</p>
      </header>

      <p className={styles.description}>
        CLIRC investigates a synthetic cloud incident by running four independent
        AI analyses in parallel — one per evidence layer (Infrastructure, IAM,
        Application code, Runtime logs) — then synthesizes their findings into a
        causal timeline, a root-cause verdict with confidence score, a red-herring
        callout, and a proposed fix.
      </p>

      <section>
        <div className={styles.scenarioGrid}>
          {SCENARIOS.map((scenario) => (
            <div
              key={scenario.id}
              className={`${styles.card} ${selectedId === scenario.id ? styles.cardSelected : ""}`}
              onClick={() => setSelectedId(scenario.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setSelectedId(scenario.id)}
              aria-pressed={selectedId === scenario.id}
            >
              <div className={styles.cardTitle}>{scenario.title}</div>
              <div className={styles.cardBlurb}>{scenario.blurb}</div>
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          <button
            className={selectedId ? styles.button : styles.buttonDisabled}
            disabled={!selectedId}
            onClick={handleRun}
          >
            Run investigation
          </button>
        </div>
      </section>

      <footer className={styles.footer}>
        Select a scenario and click Run investigation to begin.
      </footer>
    </main>
  );
}
