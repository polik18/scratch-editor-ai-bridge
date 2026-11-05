import path from 'node:path'
import { generateGame } from './generator.js'

/**
 * Compatibility wrapper used by the stateful CLI.
 * @param designPath Path to the design specification JSON file.
 * @param outputDir Target directory for generated SB3 bundle.
 * @returns Resolved filesystem path to generated SB3 archive.
 */
export async function generateGameFromDesign(designPath: string, outputDir: string): Promise<string> {
  const result = await generateGame(designPath, { outputDir })
  if (!result.success || !result.output) {
    const reason = result.diagnostics.map((item) => `${item.stage}: ${item.message}`).join('\n')
    throw new Error(`Game generation failed${reason ? `:\n${reason}` : ''}`)
  }
  return path.resolve(result.output)
}

export const generateGameFromDesignJson = generateGameFromDesign
