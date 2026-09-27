export interface SubagentResult {
  layer: string;
  finding: string;
  evidence_reference: string;
  timestamp: string;
  relevance: "high" | "medium" | "low";
  notes: string;
}

export interface TimelineEntry {
  time: string;
  layer: string;
  event: string;
}

export interface RootCauseResult {
  summary: string;
  confidence_pct: number;
  confidence_reasoning: string;
  citation: string;
}

export interface SynthesisResult {
  timeline: TimelineEntry[];
  root_cause: RootCauseResult;
  red_herring: RootCauseResult | null;
  fix: {
    description: string;
    diff_preview: string;
  };
}
