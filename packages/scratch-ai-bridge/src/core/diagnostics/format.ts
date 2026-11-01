/**
 * Diagnostic formatting utilities for CLI and Web output
 * 
 * This module provides functions to format diagnostics for different output types:
 * - JSON: Machine-readable format
 * - Markdown: Human-readable format for developers
 * - Student-Markdown: Simplified format for students
 */

import type { StudentDiagnostic } from './catalog';

/**
 * Format diagnostics as JSON
 * @param diagnostics - Array of student diagnostics
 * @returns JSON string
 */
export function formatDiagnosticsJSON(diagnostics: StudentDiagnostic[]): string {
  return JSON.stringify(
    diagnostics.map(d => ({
      type: d.type,
      code: d.code,
      category: d.category,
      severity: d.severity,
      title: d.title,
      explanation: d.explanation,
      impact: d.impact,
      fix: d.fix,
      location: d.location
    })),
    null,
    2
  );
}

/**
 * Format diagnostics as Markdown (for developers)
 * @param diagnostics - Array of student diagnostics
 * @returns Markdown string
 */
export function formatDiagnosticsMarkdown(diagnostics: StudentDiagnostic[]): string {
  const lines: string[] = [];
  
  lines.push('## 診斷結果\n');
  
  if (diagnostics.length === 0) {
    lines.push('✅ 沒有發現問題\n');
    return lines.join('');
  }
  
  lines.push(`| 嚴重度 | 類別 | 問題 | 建議 |\n`);
  lines.push(`|--------|------|------|------|\n`);
  
  for (const diagnostic of diagnostics) {
    const severityIcon = diagnostic.severity === 'high' ? '🔴' : diagnostic.severity === 'medium' ? '🟡' : '🟢';
    const categoryDisplay = diagnostic.category;
    const title = diagnostic.title;
    const fix = diagnostic.fix.split('\n')[0]; // Only first line
    
    lines.push(`| ${severityIcon} ${diagnostic.severity} | ${categoryDisplay} | ${title} | ${fix} |\n`);
  }
  
  return lines.join('');
}

/**
 * Format diagnostics as student-friendly Markdown
 * @param diagnostics - Array of student diagnostics
 * @param showAll - Whether to show all diagnostics or only high/medium priority
 * @returns Markdown string
 */
export function formatDiagnosticsStudentMarkdown(
  diagnostics: StudentDiagnostic[],
  showAll = false
): string {
  const lines: string[] = [];
  
  // Filter if needed
  const filtered = showAll ? diagnostics : getHighMediumPriorityDiagnostics(diagnostics);
  
  lines.push('## 📊 預期的問題\n');
  
  if (filtered.length === 0) {
    lines.push('✅ 沒有發現明顯問題！你的作品看來運作良好。\n');
    return lines.join('');
  }
  
  // Summary
  const highCount = filtered.filter(d => d.severity === 'high').length;
  const mediumCount = filtered.filter(d => d.severity === 'medium').length;
  const lowCount = filtered.filter(d => d.severity === 'low').length;
  
  lines.push(`| 類型 | 數量 |\n`);
  lines.push(`|------|------|\n`);
  lines.push(`| ⚠️ 高優先（需要修正） | ${highCount} |\n`);
  lines.push(`| 💡 中優先（建議修正） | ${mediumCount} |\n`);
  lines.push(`| ✨ 低優先（最佳實踐） | ${lowCount} |\n\n`);
  
  // Group by severity
  const highPriority = filtered.filter(d => d.severity === 'high');
  const mediumPriority = filtered.filter(d => d.severity === 'medium');
  const lowPriority = filtered.filter(d => d.severity === 'low');
  
  if (highPriority.length > 0) {
    lines.push('### ⚠️ 高優先問題（作品可能無法正常運作）\n');
    for (const diagnostic of highPriority) {
      lines.push(formatDiagnosticStudent(diagnostic));
    }
  }
  
  if (mediumPriority.length > 0) {
    lines.push('\n### 💡 中優先問題（建議修正以改善作品）\n');
    for (const diagnostic of mediumPriority) {
      lines.push(formatDiagnosticStudent(diagnostic));
    }
  }
  
  if (lowPriority.length > 0) {
    lines.push('\n### ✨ 低優先建議（改進後會更好）\n');
    for (const diagnostic of lowPriority) {
      lines.push(formatDiagnosticStudent(diagnostic));
    }
  }
  
  lines.push('\n---\n');
  lines.push('💡 **小提醒**：點擊「怎麼辦」按鈕可以獲得更詳細的修正步驟\n');
  
  return lines.join('');
}

/**
 * Format a single diagnostic for student output
 * @param diagnostic - Student diagnostic
 * @returns Markdown string
 */
export function formatDiagnosticStudent(diagnostic: StudentDiagnostic): string {
  const lines: string[] = [];
  
  lines.push(`#### ${diagnostic.title}\n`);
  lines.push(`${diagnostic.explanation}\n`);
  lines.push(`\n**影響**：${diagnostic.impact}\n`);
  lines.push(`\n**怎麼辦**：\n`);
  
  // Split fix into steps
  const fixSteps = diagnostic.fix.split('\n');
  for (let i = 0; i < fixSteps.length; i++) {
    const step = fixSteps[i].trim();
    if (step) {
      lines.push(`1. ${step}\n`);
    }
  }
  
  if (diagnostic.example) {
    lines.push(`\n**範例**：\n`);
    lines.push(`\`\`\`scratch\n${diagnostic.example}\n\`\`\`\n`);
  }
  
  lines.push('\n---\n');
  
  return lines.join('');
}

/**
 * Get high/medium priority diagnostics
 * @param diagnostics - Array of student diagnostics
 * @returns Filtered array
 */
function getHighMediumPriorityDiagnostics(diagnostics: StudentDiagnostic[]): StudentDiagnostic[] {
  return diagnostics.filter(d => d.severity === 'high' || d.severity === 'medium');
}
