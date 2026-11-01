/** 
 * Diagnostic Catalog - Types and categories for diagnostics
 * 
 * This module defines:
 * - DiagnosticType: The specific diagnostic codes
 * - DiagnosticCategory: Logical grouping for aggregation
 * - DiagnosticSeverity: Priority levels (high/medium/low)
 */

// Import Diagnostic from compiler/diagnostics.ts
import type { Diagnostic } from '../compiler/diagnostics';

/** Diagnostic type - specific code for each diagnostic issue */
export type DiagnosticType = 
  // Structure issues
  | 'missing-start-block'
  | 'script-disconnected'
  | 'missing-sprite'
  // Variable issues
  | 'undefined-variable'
  | 'variable-scope-mismatch'
  | 'variable-shadowing'
  // Asset issues
  | 'missing-costume'
  | 'missing-sound'
  | 'unsupported-file-format'
  // Block issues
  | 'unsupported-block'
  | 'invalid-block-argument'
  | 'unknown-opcode'
  // Logic issues
  | 'infinite-loop'
  | 'condition-always-true'
  | 'condition-always-false'
  // Sprite issues
  | 'sprite-invisible'
  | 'sprite-off-screen'
  // Stage issues
  | 'variable-conflict'
  | 'monitor-position-error'
  // Extension issues
  | 'extension-not-loaded'
  | 'hardware-required'
  | 'external-service-required'
  // Best practice
  | 'performance-concern'
  | 'maintainability-concern'
  | 'code-smell';

/** Diagnostic category - for aggregation and grouping */
export type DiagnosticCategory = 
  | 'structure'
  | 'variable'
  | 'asset'
  | 'block'
  | 'logic'
  | 'sprite'
  | 'stage'
  | 'extension'
  | 'best-practice';

/** Diagnostic severity - priority for ordering and display */
export type DiagnosticSeverity = 'high' | 'medium' | 'low';

/**
 * Extended diagnostic interface with student-facing information
 */
export interface StudentDiagnostic extends Diagnostic {
  /** Category for aggregation */
  category: DiagnosticCategory;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Student-friendly title */
  title: string;
  /** Detailed explanation with analogy */
  explanation: string;
  /** Impact on the project */
  impact: string;
  /** Step-by-step fix instructions */
  fix: string;
  /** Optional code example */
  example?: string;
  /** Category ID for aggregation */
  categoryId: string;
}

/**
 * Diagnostic group - aggregated diagnostics by category and severity
 */
export interface DiagnosticGroup {
  /** Category of diagnostics in this group */
  category: DiagnosticCategory;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Number of diagnostics in this group */
  count: number;
  /** List of diagnostics */
  diagnostics: StudentDiagnostic[];
  /** Category ID for display */
  categoryId: string;
}

/**
 * Diagnostic summary for CLI/Web output
 */
export interface DiagnosticSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  categories: Record<DiagnosticCategory, {
    high: number;
    medium: number;
    low: number;
  }>;
}

/**
 * Severity order for sorting
 */
export const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2
};

/**
 * Category display names (for student-facing output)
 */
export const CATEGORY_DISPLAY_NAMES: Record<DiagnosticCategory, string> = {
  structure: '結構問題',
  variable: '變數問題',
  asset: '素材問題',
  block: '積木問題',
  logic: '邏輯問題',
  sprite: '角色問題',
  stage: '舞台問題',
  extension: '擴充功能',
  'best-practice': '最佳實踐'
};

/**
 * Severity display names
 */
export const SEVERITY_DISPLAY_NAMES: Record<DiagnosticSeverity, string> = {
  high: '高優先',
  medium: '中優先',
  low: '低優先'
};
