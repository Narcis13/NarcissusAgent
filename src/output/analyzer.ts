/**
 * Output Analyzer
 *
 * Analyzes terminal output to detect task state (completion, error, etc.)
 * using pattern matching and confidence scoring.
 *
 * The analyzer:
 * 1. Strips ANSI codes using strip-ansi
 * 2. Runs all patterns against clean output
 * 3. Aggregates matches by category
 * 4. Calculates confidence using weighted scoring
 * 5. Determines state from highest-scoring category
 * 6. Applies penalties for contradicting patterns
 */

import stripAnsi from 'strip-ansi';
import { PATTERNS } from './patterns.ts';
import type {
  OutputState,
  PatternCategory,
  PatternMatch,
  AnalysisResult,
} from './types.ts';

/** Penalty applied to other categories when exclusive pattern matches */
const EXCLUSIVE_PENALTY = 0.2;

/**
 * OutputAnalyzer class for state detection with confidence scoring
 */
export class OutputAnalyzer {
  /**
   * Analyze terminal output and determine state with confidence
   *
   * @param rawOutput Raw terminal output (may include ANSI codes)
   * @returns Analysis result with state, confidence, and match details
   */
  analyze(rawOutput: string): AnalysisResult {
    // Strip ANSI codes for pattern matching
    const cleanOutput = stripAnsi(rawOutput);

    // Match all patterns
    const matches = this.matchPatterns(cleanOutput);

    // Calculate per-category scores
    const categoryScores = this.calculateCategoryScores(matches);

    // Apply penalties for exclusive patterns
    this.applyExclusivePenalties(matches, categoryScores);

    // Determine winning state
    const state = this.determineState(categoryScores);

    // Overall confidence is the winning category's score
    const confidence = this.getConfidence(state, categoryScores);

    return {
      state,
      confidence,
      matches,
      cleanOutput,
      categoryScores,
    };
  }

  /**
   * Match all patterns against clean output
   */
  private matchPatterns(cleanOutput: string): PatternMatch[] {
    return PATTERNS.map((pw) => {
      const match = pw.pattern.exec(cleanOutput);
      return {
        name: pw.pattern.source,
        matched: match !== null,
        confidence: match !== null ? pw.weight : 0,
        evidence: match ? [match[0]] : [],
      };
    });
  }

  /**
   * Calculate scores per category by summing matched pattern weights
   */
  private calculateCategoryScores(
    matches: PatternMatch[]
  ): Map<PatternCategory, number> {
    const scores = new Map<PatternCategory, number>([
      ['completion', 0],
      ['error', 0],
      ['prompt_ready', 0],
      ['running', 0],
    ]);

    PATTERNS.forEach((pw, index) => {
      const match = matches[index];
      if (match && match.matched) {
        const current = scores.get(pw.category) ?? 0;
        // Cap at 1.0
        scores.set(pw.category, Math.min(1.0, current + pw.weight));
      }
    });

    return scores;
  }

  /**
   * Apply penalties when exclusive patterns match
   * Exclusive patterns indicate definitive signals that should override other categories
   */
  private applyExclusivePenalties(
    matches: PatternMatch[],
    scores: Map<PatternCategory, number>
  ): void {
    PATTERNS.forEach((pw, index) => {
      const match = matches[index];
      if (match && match.matched && pw.exclusive) {
        // Penalize all other categories
        for (const [category, score] of scores) {
          if (category !== pw.category) {
            scores.set(category, Math.max(0, score - EXCLUSIVE_PENALTY));
          }
        }
      }
    });
  }

  /**
   * Determine state from category scores
   * Returns 'running' if no significant matches
   */
  private determineState(scores: Map<PatternCategory, number>): OutputState {
    let maxScore = 0;
    let maxCategory: PatternCategory = 'running';

    for (const [category, score] of scores) {
      if (score > maxScore) {
        maxScore = score;
        maxCategory = category;
      }
    }

    // If no patterns matched, default to 'running'
    if (maxScore === 0) {
      return 'running';
    }

    // Map pattern category to output state
    // Note: PatternCategory 'completion' maps to OutputState 'completed'
    return this.categoryToState(maxCategory);
  }

  /**
   * Map PatternCategory to OutputState
   * Most categories map directly, but 'completion' -> 'completed'
   */
  private categoryToState(category: PatternCategory): OutputState {
    if (category === 'completion') {
      return 'completed';
    }
    return category;
  }

  /**
   * Get confidence score for the determined state
   */
  private getConfidence(
    state: OutputState,
    scores: Map<PatternCategory, number>
  ): number {
    // If running with no matches, confidence is 0
    if (state === 'running') {
      const runningScore = scores.get('running') ?? 0;
      return runningScore;
    }

    // Map state back to category for score lookup
    // Note: OutputState 'completed' maps to PatternCategory 'completion'
    const category = this.stateToCategory(state);
    return scores.get(category) ?? 0;
  }

  /**
   * Map OutputState to PatternCategory
   * Most states map directly, but 'completed' -> 'completion'
   */
  private stateToCategory(state: OutputState): PatternCategory {
    if (state === 'completed') {
      return 'completion';
    }
    return state as PatternCategory;
  }
}
