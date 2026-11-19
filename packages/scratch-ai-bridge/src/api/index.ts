// scratch-session API: Export ScratchSession for AI agent calling
// Usage: import { ScratchSession } from '@scratch/scratch-ai-bridge/api';

export { ScratchSession } from '../cli/session/session.js'
export type { SessionInfo, TargetSummary, InspectResult } from '../cli/session/session.js'
export type { CanonicalInputRef, toVmInputRef } from '../cli/session/session.js'

// Helper to create new session (mimic static method)
export async function createSession(path?: string) {
  const { ScratchSession } = await import('../cli/session/session.js')
  const session = new ScratchSession()
  if (path) {
    await session.loadSb3(path)
  } else {
    session.newProject('Untitled')
  }
  return session
}

// Formal grading core (browser-safe): the same rubric, evidence, evaluation and calibration code the CLI `grade`
// command, the MCP grading tools and the local grading HTTP API (`npm run grading-api`) use.
export * from '../core/grading/index.js'
