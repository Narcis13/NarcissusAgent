/**
 * Output Analysis Types
 *
 * Types for output state detection and confidence scoring.
 */

/** Possible output states detected from terminal output */
export type OutputState = 'running' | 'completed' | 'error' | 'prompt_ready';

/** Categories for pattern classification */
export type PatternCategory = 'completion' | 'error' | 'prompt_ready' | 'running';

/** Weight configuration for a detection pattern */
export interface PatternWeight {
  /** Regex pattern to match against clean (ANSI-stripped) output */
  pattern: RegExp;
  /** Which category this pattern indicates */
  category: PatternCategory;
  /** Contribution to confidence score (0-1) */
  weight: number;
  /** If true, other categories get penalty when this matches */
  exclusive?: boolean;
}

/** Result of matching a single pattern */
export interface PatternMatch {
  /** Name/description of the pattern */
  name: string;
  /** Whether the pattern matched */
  matched: boolean;
  /** Confidence contribution (0-1) */
  confidence: number;
  /** Matched text evidence (empty if no match) */
  evidence: string[];
}

/** Complete analysis result from OutputAnalyzer */
export interface AnalysisResult {
  /** Detected state with highest confidence */
  state: OutputState;
  /** Aggregated confidence score (0-1) */
  confidence: number;
  /** Individual pattern match results */
  matches: PatternMatch[];
  /** ANSI-stripped output used for analysis */
  cleanOutput: string;
  /** Per-category confidence breakdown */
  categoryScores: Map<PatternCategory, number>;
}
