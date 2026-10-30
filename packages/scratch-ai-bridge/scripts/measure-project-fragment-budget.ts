import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createProjectFragmentInstruction,
  createStudentProjectInstruction,
  estimatePromptSize,
} from '../src/core/capabilities/registry'
import type { CanonicalProject, CanonicalStage, CanonicalSprite } from '../src/core/ir/types'
import { PROJECT_FRAGMENT_FORMAT, PROJECT_FRAGMENT_VERSION } from '../src/core/normalizer'

const projectPath = resolve(
  fileURLToPath(
    new URL(
      '../../../research/tool-evaluation/2026-10-30-starport/starport-rift-expedition.canonical.json',
      import.meta.url,
    ),
  ),
)
const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      fileURLToPath(
        new URL(
          '../../../research/tool-evaluation/2026-10-30-starport/FRAGMENT-BUDGET-BASELINE.json',
          import.meta.url,
        ),
      ),
    )

const project = JSON.parse(await readFile(projectPath, 'utf8')) as CanonicalProject
const brief =
  '玩家操控星港守衛迎戰裂隙掠奪者，移動並發射脈衝彈，命中敵人得分；碰撞損失護盾，護盾耗盡則失敗，可重開再戰。'
const request = '製作一款星港守衛迎戰裂隙掠奪者的動作遊戲。'
const targets: readonly (CanonicalStage | CanonicalSprite)[] = [project.stage, ...project.sprites]
const existingTargets = targets.map((target) => target.name)
const sharedNames = [
  ...project.stage.variables.map((item) => `變數:${item.name}`),
  ...project.broadcasts.map((item) => `廣播:${item.name}`),
]
const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8')

const fragments = targets.map((target, index) => {
  const fragmentId = `${target.kind}-${index + 1}`
  const payload = {
    format: PROJECT_FRAGMENT_FORMAT,
    version: PROJECT_FRAGMENT_VERSION,
    projectName: project.name,
    fragmentId,
    target,
    ...(target.kind === 'stage'
      ? {
          broadcasts: project.broadcasts,
          ...(project.extensions ? { extensions: project.extensions } : {}),
          ...(project.meta ? { meta: project.meta } : {}),
        }
      : {}),
  }
  const prompt = createProjectFragmentInstruction({
    projectName: project.name,
    fragmentId,
    targetKind: target.kind,
    targetName: target.name,
    designBrief: brief,
    existingTargets: target.kind === 'stage' ? [] : existingTargets,
    sharedNames,
  })
  const sessionReusePrompt = createProjectFragmentInstruction({
    projectName: project.name,
    fragmentId,
    targetKind: target.kind,
    targetName: target.name,
    designBrief: brief,
    existingTargets: target.kind === 'stage' ? [] : existingTargets,
    sharedNames,
    reuseCapabilityContract: target.kind !== 'stage',
  })
  const json = JSON.stringify(payload)
  return {
    fragmentId,
    targetKind: target.kind,
    targetName: target.name,
    prompt: { ...estimatePromptSize(prompt), utf8Bytes: byteLength(prompt) },
    sessionReusePrompt: { ...estimatePromptSize(sessionReusePrompt), utf8Bytes: byteLength(sessionReusePrompt) },
    canonicalPayloadUtf8Bytes: byteLength(JSON.stringify(target)),
    fragmentEnvelopeUtf8Bytes: byteLength(json),
  }
})

const wholeProjectJson = JSON.stringify(project)
const wholeProjectPrompt = createStudentProjectInstruction(request, { confirmedBrief: brief })
const promptRows = fragments.map((fragment) => fragment.prompt)
const wholeProjectPromptSize = estimatePromptSize(wholeProjectPrompt)
const maxFragmentPromptSize = Math.max(...promptRows.map((prompt) => prompt.characters))
const totalFragmentPromptSize = promptRows.reduce((sum, prompt) => sum + prompt.characters, 0)
const sessionReusePromptRows = fragments.map((fragment) => fragment.sessionReusePrompt)
const maxSessionReusePromptSize = Math.max(...sessionReusePromptRows.map((prompt) => prompt.characters))
const totalSessionReusePromptSize = sessionReusePromptRows.reduce((sum, prompt) => sum + prompt.characters, 0)
const maxFragmentEnvelopeBytes = Math.max(...fragments.map((fragment) => fragment.fragmentEnvelopeUtf8Bytes))
const totalFragmentEnvelopeBytes = fragments.reduce((sum, fragment) => sum + fragment.fragmentEnvelopeUtf8Bytes, 0)
const result = {
  format: 'scratch-ai-bridge/project-fragment-budget',
  version: 1,
  measuredAt: new Date().toISOString(),
  method: {
    source: 'research/tool-evaluation/2026-10-30-starport/starport-rift-expedition.canonical.json',
    sample: project.name,
    unit: 'UTF-8 bytes and rough mixed-language token estimates',
    limitation:
      'Structural size comparison only. No provider tokenizer, model request, truncation event, quality score, or successful generation was measured.',
    fullProjectScope:
      'Canonical project JSON only; excludes any ai-response wrapper or natural-language explanation.',
    promptScope:
      'Compares this app production prompt with separate target prompts. Sum is reported because lower per-request size can still increase total repeated context.',
  },
  targetCount: targets.length,
  wholeProject: {
    canonicalJsonUtf8Bytes: byteLength(wholeProjectJson),
    prompt: { ...wholeProjectPromptSize, utf8Bytes: byteLength(wholeProjectPrompt) },
  },
  fragmented: {
    fragmentCount: fragments.length,
    maxCanonicalTargetUtf8Bytes: Math.max(...fragments.map((fragment) => fragment.canonicalPayloadUtf8Bytes)),
    maxEnvelopeOutputUtf8Bytes: Math.max(...fragments.map((fragment) => fragment.fragmentEnvelopeUtf8Bytes)),
    totalEnvelopeOutputUtf8Bytes: fragments.reduce((sum, fragment) => sum + fragment.fragmentEnvelopeUtf8Bytes, 0),
    maxPromptUtf8Bytes: Math.max(...promptRows.map((prompt) => prompt.utf8Bytes)),
    totalPromptUtf8BytesAcrossSeparateRequests: promptRows.reduce((sum, prompt) => sum + prompt.utf8Bytes, 0),
    sessionReuse: {
      assumption:
        'One AI conversation: first Stage prompt includes the full contract; later target prompts refer back to it.',
      maxPromptCharacters: maxSessionReusePromptSize,
      totalPromptCharacters: totalSessionReusePromptSize,
      totalPromptUtf8Bytes: sessionReusePromptRows.reduce((sum, prompt) => sum + prompt.utf8Bytes, 0),
    },
    fragments,
  },
  comparisons: {
    peakPromptCharacterReductionPercent:
      Math.round((1 - maxFragmentPromptSize / wholeProjectPromptSize.characters) * 1000) / 10,
    totalPromptCharacterInflationPercent:
      Math.round((totalFragmentPromptSize / wholeProjectPromptSize.characters - 1) * 1000) / 10,
    sessionReuseTotalPromptCharacterInflationPercent:
      Math.round((totalSessionReusePromptSize / wholeProjectPromptSize.characters - 1) * 1000) / 10,
    peakOutputUtf8ByteReductionPercent:
      Math.round((1 - maxFragmentEnvelopeBytes / byteLength(wholeProjectJson)) * 1000) / 10,
    totalOutputUtf8ByteInflationPercent:
      Math.round((totalFragmentEnvelopeBytes / byteLength(wholeProjectJson) - 1) * 1000) / 10,
  },
}

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ outputPath, targetCount: targets.length, result }, null, 2))
