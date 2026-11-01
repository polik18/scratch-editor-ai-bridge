import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { inspectSb3Bytes, inspectionToMarkdown, inspectionToStudentMarkdown } from '../src/cli/inspect'
import {
  analyzeCanonicalProject,
  createProjectFeedback,
  createProjectMap,
  createProjectScore,
  diagnosticFeedbackId,
} from '../src/core/analyzer'
import { importLosslessSb3 } from '../src/core/archive'
import { projectJsonToCanonicalWithReport } from '../src/core/decompiler/project-json'
import { extractProjectBlockGraphs } from '../src/core/graph'
import { createEvidencePacket } from '../src/core/prompt/evidence-packet'
import { createAnalysisPrompt } from '../src/core/prompt/prompt'
import { createScoringFeedbackPrompt } from '../src/core/prompt/scoring-feedback'

const fixturePath = process.argv[2]
if (!fixturePath) throw new Error('Usage: tsx scripts/verify-analysis-improvement.ts <Untitled-20.sb3>')
const bytes = new Uint8Array(await readFile(fixturePath))
const archive = await importLosslessSb3(bytes)
const conversion = projectJsonToCanonicalWithReport(archive.projectJson, 'Scratch Project')
const project = conversion.canonical
const graphs = extractProjectBlockGraphs(archive.projectJson)
const analysis = analyzeCanonicalProject(project, graphs)
const map = createProjectMap(project, analysis, graphs, conversion.canonicalBlockMappings, archive.projectJson)
const feedback = createProjectFeedback(analysis, map)
const score = createProjectScore(project, analysis, map)
const packet = createEvidencePacket(analysis, map)
const prompt = createScoringFeedbackPrompt(score, map)
const inspection = await inspectSb3Bytes(bytes)
const outputs = [
  JSON.stringify(inspection),
  inspectionToMarkdown(inspection),
  inspectionToStudentMarkdown(inspection),
  JSON.stringify(packet),
  createAnalysisPrompt({ analysis, canonical: project, projectMap: map, mode: 'student' }),
  createAnalysisPrompt({ analysis, canonical: project, projectMap: map, mode: 'teacher' }),
  prompt,
]
assert(packet.observations.length >= 30 && packet.observations.length <= 37)
assert(JSON.stringify(packet).length <= 24000)
assert(!prompt.includes('角色「作品文字已省略」'))
for (const [format, expected] of [
  ['json', JSON.stringify(inspection)],
  ['markdown', inspectionToMarkdown(inspection)],
  ['student-markdown', inspectionToStudentMarkdown(inspection)],
] as const) {
  const result = spawnSync(
    process.execPath,
    ['scripts/scratch-ai-bridge.mjs', 'inspect', fixturePath, '--format', format],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
  )
  assert.equal(result.status, 0, `CLI ${format} failed`)
  const output = format === 'json' ? JSON.stringify(JSON.parse(result.stdout)) : result.stdout.trimEnd()
  assert.equal(output, expected, `CLI ${format} differs from the inspection renderer`)
}

for (const target of project.sprites)
  for (const output of outputs) assert(!output.includes(target.name), `target exposed: ${target.name}`)
for (const graph of graphs)
  for (const id of Object.keys(graph.blocks))
    if (id.length >= 8) for (const output of outputs) assert(!output.includes(id), 'raw block id exposed')
const expected: Record<string, string[]> = {
  'condition-variable-mismatch-in-loop': ['Sprite6', 'Sprite7', 'Sprite8'],
  'overlapping-comparison-chain': ['Sprite22', 'Sprite28'],
  'duplicate-script-in-target': ['Ball', 'Ball2'],
  'single-costume-nextcostume-loop': ['Clouds', 'Sprite11'],
  'delete-clone-under-non-clone-hat': ['Sprite24'],
  'empty-event-hat': ['Sprite11'],
  'concurrent-event-state-conflict': ['Sprite14', 'Sprite15'],
}
for (const [code, targets] of Object.entries(expected))
  for (const target of targets) {
    const found = analysis.diagnostics.find((d) => d.code === code && d.target === target)
    assert(found, `${code} missing for ${target}`)
    const item = feedback.items.find((f) => f.id === diagnosticFeedbackId(found))
    assert(item && item.evidenceIds.length > 0, `${code} missing evidence for ${target}`)
    for (const id of item.evidenceIds)
      assert(
        map.evidence.some((e) => e.id === id && e.targetName === target),
        `${code} invalid evidence`,
      )
    if (found.evidencePaths) {
      const paths = item.evidenceIds.map((id) => map.evidence.find((entry) => entry.id === id)?.path)
      assert(
        paths.every((path) => path !== undefined && found.evidencePaths?.includes(path)),
        `${code} does not point to the triggering blocks`,
      )
      if (code === 'overlapping-comparison-chain')
        assert(paths.length >= 3, 'comparison chain lacks three block references')
    }
  }
const available = new Set(inspection.evidence.map(({ id }) => id))
for (const diagnostic of inspection.diagnostics.filter(({ severity }) => severity === 'warning')) {
  assert(diagnostic.evidenceIds?.length, `warning ${diagnostic.code} lacks evidence`)
  for (const id of diagnostic.evidenceIds) assert(available.has(id), 'diagnostic evidence missing')
}
for (const item of inspection.feedback.items)
  for (const id of item.evidenceIds) assert(available.has(id), 'feedback evidence missing')
for (const criterion of inspection.score.criteria)
  for (const id of criterion.evidenceIds) assert(available.has(id), 'score evidence missing')
console.log(
  JSON.stringify({
    summary: inspection.summary,
    score: inspection.score.total,
    observations: packet.observations.length,
    packetChars: JSON.stringify(packet).length,
    packetTargets: new Set(packet.evidence.map((e) => e.target)).size,
    feedback: inspection.feedback.items.length,
    coveredRules: Object.keys(expected).length,
    outputForms: outputs.length,
  }),
)
