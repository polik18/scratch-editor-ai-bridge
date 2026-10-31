import { captureRendererPreview } from '../cli/renderer-preview.js'
import type { ScratchSession } from '../cli/session/session.js'

/**
 * Capture the actual Scratch renderer after validating the session archive.
 * @param session Current session.
 * @param outputPath Image path.
 * @returns Saved image path.
 */
export async function previewScreenshot(session: ScratchSession, outputPath = 'preview.png'): Promise<string> {
  const result = await captureRendererPreview(await session.compile(), outputPath)
  return String(result.path)
}

/**
 * Timed gameplay automation is not yet implemented.
 * @param _session Current session.
 * @param _duration Requested duration.
 * @returns A rejected promise until timed execution is available.
 */
export function previewRun(_session: ScratchSession, _duration = 5): Promise<void> {
  return Promise.reject(
    new Error('Timed gameplay preview is not implemented. Use previewScreenshot or scratch-session open.'),
  )
}
