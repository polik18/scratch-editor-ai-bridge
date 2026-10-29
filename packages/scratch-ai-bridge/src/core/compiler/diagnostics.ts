/**
 * Compiler Diagnostics - Diagnostic types and utilities for compilation
 */

/**
 * Diagnostic type
 */
export interface Diagnostic {
  type: 'error' | 'warning' | 'info';
  stage: ProjectCompileFailureStage | 'unknown';
  code: string;
  message: string;
  suggestion?: string;
  location?: DiagnosticLocation;
  metadata?: Record<string, unknown>;
}

/**
 * Diagnostic location
 */
export interface DiagnosticLocation {
  target?: string;
  costumeIndex?: number;
  soundIndex?: number;
  blockId?: string;
  line?: number;
  column?: number;
}

/**
 * Project compile failure stage
 */
export type ProjectCompileFailureStage =
  | 'svg-preflight'
  | 'raster-preflight'
  | 'audio-preflight'
  | 'archive-generation'
  | 'scratch-vm-load'
  | 'scratch-vm-save'
  | 'unknown';

/**
 * Generate human-readable diagnostic message
 * @param diagnostic - Diagnostic
 * @returns Human-readable message
 */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const prefix = diagnostic.type === 'error' ? 'ERROR' : diagnostic.type === 'warning' ? 'WARNING' : 'INFO';
  const location = formatLocation(diagnostic.location);
  const msg = location ? `[${location}] ${diagnostic.message}` : diagnostic.message;
  return `${prefix}: ${diagnostic.code} - ${msg}`;
}

/**
 * Format diagnostic location
 * @param location - Diagnostic location
 * @returns Formatted location string
 */
export function formatLocation(location?: DiagnosticLocation): string {
  if (!location) return '';
  
  const parts: string[] = [];
  if (location.target) parts.push(`target:${location.target}`);
  if (location.costumeIndex !== undefined) parts.push(`costume:${location.costumeIndex}`);
  if (location.soundIndex !== undefined) parts.push(`sound:${location.soundIndex}`);
  if (location.blockId) parts.push(`block:${location.blockId}`);
  if (location.line !== undefined && location.column !== undefined) {
    parts.push(`line:${location.line},col:${location.column}`);
  }
  
  return parts.length > 0 ? parts.join('/') : '';
}

/**
 * Create an error diagnostic
 * @param stage - Compile stage
 * @param code - Diagnostic code
 * @param message - Error message
 * @param suggestion - Suggested fix
 * @param location - Location
 * @returns Diagnostic
 */
export function createErrorDiagnostic(
  stage: ProjectCompileFailureStage,
  code: string,
  message: string,
  suggestion?: string,
  location?: DiagnosticLocation,
): Diagnostic {
  return {
    type: 'error',
    stage,
    code,
    message,
    suggestion,
    location,
  };
}

/**
 * Create a warning diagnostic
 * @param stage - Compile stage
 * @param code - Diagnostic code
 * @param message - Warning message
 * @param suggestion - Suggested fix
 * @param location - Location
 * @returns Diagnostic
 */
export function createWarningDiagnostic(
  stage: ProjectCompileFailureStage,
  code: string,
  message: string,
  suggestion?: string,
  location?: DiagnosticLocation,
): Diagnostic {
  return {
    type: 'warning',
    stage,
    code,
    message,
    suggestion,
    location,
  };
}

/**
 * Create an info diagnostic
 * @param stage - Compile stage
 * @param code - Diagnostic code
 * @param message - Info message
 * @param location - Location
 * @returns Diagnostic
 */
export function createInfoDiagnostic(
  stage: ProjectCompileFailureStage,
  code: string,
  message: string,
  location?: DiagnosticLocation,
): Diagnostic {
  return {
    type: 'info',
    stage,
    code,
    message,
    location,
  };
}

/**
 * Aggregate diagnostics into a summary
 * @param diagnostics - Diagnostics
 * @returns Summary string
 */
export function aggregateDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return 'No diagnostics';
  
  const errors = diagnostics.filter(d => d.type === 'error');
  const warnings = diagnostics.filter(d => d.type === 'warning');
  const infos = diagnostics.filter(d => d.type === 'info');
  
  const lines: string[] = [];
  lines.push(`Diagnostics Summary: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} infos`);
  
  if (errors.length > 0) {
    lines.push('\nErrors:');
    for (const error of errors) {
      lines.push(`  - ${formatDiagnostic(error)}`);
    }
  }
  
  if (warnings.length > 0) {
    lines.push('\nWarnings:');
    for (const warning of warnings) {
      lines.push(`  - ${formatDiagnostic(warning)}`);
    }
  }
  
  if (infos.length > 0) {
    lines.push('\nInfos:');
    for (const info of infos) {
      lines.push(`  - ${formatDiagnostic(info)}`);
    }
  }
  
  return lines.join('\n');
}
