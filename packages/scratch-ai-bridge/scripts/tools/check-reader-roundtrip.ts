// Checks that every reader script section in a local SB3 corpus can be safely
// accepted by the lossless script patch path without writing any project.
// Usage (from packages/scratch-ai-bridge):
//   npx tsx scripts/tools/check-reader-roundtrip.ts <folder> [--json]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildScriptPatch } from '../../src/core/ai/line-patch'
import { importLosslessSb3 } from '../../src/core/archive/sb3-archive'
import { readProjectForAi } from '../../src/core/reader'

interface Failure {
  readonly project: string
  readonly section: string
  readonly target: string
  readonly error: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const main = async (): Promise<void> => {
  const [folder, flag] = process.argv.slice(2)
  if (!folder) throw new Error('請提供包含 .sb3 檔案的資料夾。')

  let projects = 0
  let scripts = 0
  let roundtripped = 0
  const failures: Failure[] = []
  for (const name of readdirSync(folder)
    .filter((file) => file.endsWith('.sb3'))
    .sort()) {
    projects += 1
    const project = await importLosslessSb3(readFileSync(join(folder, name)))
    const reader = readProjectForAi(project.projectJson, { entries: project.entries })
    for (const section of reader.sections.filter((candidate) => candidate.id.startsWith('script:'))) {
      scripts += 1
      const rawTargets: readonly unknown[] = Array.isArray(project.projectJson.targets)
        ? (project.projectJson.targets as readonly unknown[])
        : []
      const target = section.targetIndex === undefined ? undefined : rawTargets[section.targetIndex]
      const targetName = isRecord(target) && typeof target.name === 'string' ? target.name : ''
      try {
        buildScriptPatch(project, targetName, section.id, section.text)
        roundtripped += 1
      } catch (error) {
        failures.push({
          project: name,
          section: section.id,
          target: targetName,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const result = { projects, scripts, roundtripped, failed: failures.length, failures }
  if (flag === '--json') console.log(JSON.stringify(result, null, 2))
  else {
    console.table({ projects, scripts, roundtripped, failed: failures.length })
    if (failures.length > 0) console.table(failures.slice(0, 20))
  }
  if (failures.length > 0) process.exitCode = 1
}

void main()
