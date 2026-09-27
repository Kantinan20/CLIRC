import type { SubagentResult } from "@/lib/types";
import styles from "./LayerCard.module.css";

export type LayerStatus = "queued" | "running" | "done" | "error";

export interface LayerCardProps {
  label: string;
  sub: string;
  status: LayerStatus;
  result?: SubagentResult;
  error?: string;
}

const PILL_CLASS: Record<LayerStatus, string> = {
  queued:  styles.pillQueued,
  running: styles.pillRunning,
  done:    styles.pillDone,
  error:   styles.pillError,
};

const PILL_LABEL: Record<LayerStatus, string> = {
  queued:  "● Queued",
  running: "● Analyzing…",
  done:    "✓ Done",
  error:   "✗ Error",
};

const CARD_MODIFIER: Record<LayerStatus, string> = {
  queued:  "",
  running: styles.cardRunning,
  done:    styles.cardDone,
  error:   styles.cardError,
};

const RELEVANCE_CLASS: Record<"high" | "medium" | "low", string> = {
  high:   styles.relevanceHigh,
  medium: styles.relevanceMedium,
  low:    styles.relevanceLow,
};

export default function LayerCard({ label, sub, status, result, error }: LayerCardProps) {
  const cardClass = [styles.card, CARD_MODIFIER[status]].filter(Boolean).join(" ");

  return (
    <div className={cardClass}>
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.layerTitle}>{label}</div>
          <div className={styles.layerSub}>{sub}</div>
        </div>
        <span className={`${styles.statusPill} ${PILL_CLASS[status]}`}>
          {PILL_LABEL[status]}
        </span>
      </div>

      {status === "done" && result && (
        <>
          <p className={styles.finding}>{result.finding}</p>
          <code className={styles.evidenceRef}>{result.evidence_reference}</code>
          <div className={styles.metaRow}>
            <span
              className={`${styles.relevanceBadge} ${RELEVANCE_CLASS[result.relevance]}`}
            >
              {result.relevance}
            </span>
            <span className={styles.timestamp}>{result.timestamp}</span>
          </div>
          {result.notes && (
            <p className={styles.notes}>{result.notes}</p>
          )}
        </>
      )}

      {status === "error" && (
        <p className={styles.errorMsg}>{error ?? "An error occurred."}</p>
      )}
    </div>
  );
}
