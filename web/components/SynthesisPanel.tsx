import type { SynthesisResult } from "@/lib/types";
import styles from "./SynthesisPanel.module.css";

interface SynthesisPanelProps {
  result: SynthesisResult;
  layersAnalyzed: number;
  totalLayers: number;
}

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+")) {
    return (
      <span style={{ color: "var(--accent)" }}>
        {line}
        {"\n"}
      </span>
    );
  }
  return (
    <span>
      {line}
      {"\n"}
    </span>
  );
}

export default function SynthesisPanel({
  result,
  layersAnalyzed,
  totalLayers,
}: SynthesisPanelProps) {
  const failed = totalLayers - layersAnalyzed;

  return (
    <div className={styles.panel}>
      {/* 1. Partial analysis notice */}
      {layersAnalyzed < totalLayers && (
        <div className={styles.partialNotice}>
          ⚠ Analysis based on {layersAnalyzed} of {totalLayers} layers (
          {failed} layer{failed !== 1 ? "s" : ""} failed)
        </div>
      )}

      {/* 2. Timeline table */}
      <table className={styles.timelineTable}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Layer</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          {result.timeline.map((entry, i) => (
            <tr key={i}>
              <td className={styles.timeCell}>{entry.time}</td>
              <td className={styles.layerCell}>{entry.layer}</td>
              <td className={styles.eventCell}>{entry.event}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 3. Root cause card */}
      <div className={styles.rootCauseCard}>
        <div className={styles.cardLabel}>
          Root Cause
          <span className={styles.confidenceBadge}>
            {result.root_cause.confidence_pct}% confidence
          </span>
        </div>
        <div className={styles.confidenceTrack}>
          <div
            className={`${styles.confidenceBar} ${styles.confidenceBarRed}`}
            style={{ width: `${result.root_cause.confidence_pct}%` }}
          />
        </div>
        <div className={styles.cardSummary}>{result.root_cause.summary}</div>
        <div className={styles.cardReasoning}>
          {result.root_cause.confidence_reasoning}
        </div>
        <code className={styles.citation}>{result.root_cause.citation}</code>
      </div>

      {/* 4. Red herring card (optional) */}
      {result.red_herring && (
        <div className={styles.redHerringCard}>
          <div className={`${styles.cardLabel} ${styles.redHerringLabel}`}>
            Ruled Out / Red Herring
            <span style={{ color: "var(--amber)", fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>
              {result.red_herring.confidence_pct}% confidence
            </span>
          </div>
          <div className={styles.confidenceTrack}>
            <div
              className={`${styles.confidenceBar} ${styles.confidenceBarAmber}`}
              style={{ width: `${result.red_herring.confidence_pct}%` }}
            />
          </div>
          <div className={styles.cardSummary}>{result.red_herring.summary}</div>
          <div className={styles.cardReasoning}>
            {result.red_herring.confidence_reasoning}
          </div>
          <code className={styles.citation}>{result.red_herring.citation}</code>
        </div>
      )}

      {/* 5. Proposed fix block */}
      <div className={styles.fixBlock}>
        <div className={styles.fixLabel}>
          <span className={styles.fixLabelTitle}>Proposed fix preview</span>
          <span className={styles.fixLabelSub}>(not applied — review before use)</span>
        </div>
        <div className={styles.fixDescription}>{result.fix.description}</div>
        <pre className={styles.fixCode}>
          {result.fix.diff_preview.split("\n").map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </pre>
      </div>
    </div>
  );
}
