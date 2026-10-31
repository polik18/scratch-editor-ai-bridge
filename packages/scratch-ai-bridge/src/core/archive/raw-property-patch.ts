import { sha256 } from '@noble/hashes/sha256'
import type { RawSb3Project } from './sb3-archive'

export interface RawPropertyChange {
  readonly targetName: string
  readonly property: 'x' | 'y' | 'direction' | 'size' | 'visible' | 'currentCostume' | 'volume' | 'tempo'
  readonly expected: number | boolean
  readonly value: number | boolean
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * Hash archive content independently of ZIP compression and metadata.
 * @param project Imported archive.
 * @returns Content revision.
 */
export const rawSb3Revision = (project: RawSb3Project): string => {
  const entries = project.entries
    .filter((entry) => entry.name !== project.projectEntryName)
    .map((entry) => [entry.name, hex(sha256(entry.bytes))])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const manifest = JSON.stringify([
    'raw-sb3-v1',
    project.projectEntryName,
    hex(sha256(project.projectJsonBytes)),
    entries,
  ])
  return `sha256:${hex(sha256(new TextEncoder().encode(manifest)))}`
}

/**
 * Prepare a new archive state after checking the revision and all old values.
 * @param project Imported archive.
 * @param baseRevision Expected content revision.
 * @param changes Property edits to validate and apply.
 * @returns Updated archive without modifying the original.
 */
export const patchRawSb3Properties = (
  project: RawSb3Project,
  baseRevision: string,
  changes: readonly RawPropertyChange[],
): RawSb3Project => {
  if (rawSb3Revision(project) !== baseRevision) throw new Error('SB3 revision has changed')
  if (changes.length === 0 || changes.length > 100) throw new Error('SB3 patch must contain 1 to 100 changes')
  const sourceTargets = project.projectJson.targets
  if (!Array.isArray(sourceTargets)) throw new Error('SB3 project targets are missing')
  const targets = sourceTargets.map((target: unknown) => {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) throw new Error('Invalid SB3 target')
    return { ...(target as Record<string, unknown>) }
  })
  const seen = new Set<string>()
  for (const change of changes) {
    if (typeof change.targetName !== 'string') throw new Error('Invalid target selector')
    const matches = targets.filter((target) => target.name === change.targetName)
    if (matches.length !== 1) throw new Error(`SB3 target is missing or ambiguous: ${change.targetName}`)
    const target = matches[0]
    const spriteFields = ['x', 'y', 'direction', 'size', 'visible', 'currentCostume', 'volume']
    const stageFields = ['currentCostume', 'volume', 'tempo']
    if (!(target.isStage === true ? stageFields : spriteFields).includes(change.property))
      throw new Error(`Unsupported SB3 property: ${change.property}`)
    const key = JSON.stringify([change.targetName, change.property])
    if (seen.has(key)) throw new Error('Duplicate SB3 property change')
    seen.add(key)
    if (target[change.property] !== change.expected) throw new Error('SB3 property old value does not match')
    const valid =
      change.property === 'visible'
        ? typeof change.value === 'boolean'
        : typeof change.value === 'number' && Number.isFinite(change.value)
    if (!valid) throw new Error(`Invalid value for SB3 property: ${change.property}`)
    if (change.property === 'size' && Number(change.value) < 0) throw new Error('SB3 size cannot be negative')
    if (change.property === 'volume' && (Number(change.value) < 0 || Number(change.value) > 100))
      throw new Error('SB3 volume must be between 0 and 100')
    if (change.property === 'currentCostume') {
      const costumes = target.costumes
      if (
        !Array.isArray(costumes) ||
        !Number.isInteger(change.value) ||
        Number(change.value) < 0 ||
        Number(change.value) >= costumes.length
      )
        throw new Error('SB3 costume index is out of range')
    }
    target[change.property] = change.value
  }
  const projectJson = { ...project.projectJson, targets }
  const projectJsonBytes = new TextEncoder().encode(JSON.stringify(projectJson))
  if (projectJsonBytes.byteLength > 16 * 1024 * 1024)
    throw new Error('Patched SB3 project.json exceeds the 16 MiB limit')
  return { ...project, projectJson, projectJsonBytes }
}

export interface RawVariableChange {
  readonly targetName: string
  readonly variableId: string
  readonly expected: string | number | boolean
  readonly value: string | number | boolean
}

/**
 * Prepare changes to existing non-cloud scalar variables in an imported archive.
 * @param project Imported archive.
 * @param baseRevision Expected content revision.
 * @param changes Variables to update by ID.
 * @returns Updated archive without modifying the original.
 */
export const patchRawSb3Variables = (
  project: RawSb3Project,
  baseRevision: string,
  changes: readonly RawVariableChange[],
): RawSb3Project => {
  if (rawSb3Revision(project) !== baseRevision) throw new Error('SB3 revision has changed')
  if (changes.length === 0 || changes.length > 100) throw new Error('SB3 patch must contain 1 to 100 changes')
  const sourceTargets = project.projectJson.targets
  if (!Array.isArray(sourceTargets)) throw new Error('SB3 project targets are missing')
  const targets = sourceTargets.map((target: unknown) => {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) throw new Error('Invalid SB3 target')
    return { ...(target as Record<string, unknown>) }
  })
  const seen = new Set<string>()
  for (const change of changes) {
    const matches = targets.filter((target) => target.name === change.targetName)
    if (matches.length !== 1) throw new Error(`SB3 target is missing or ambiguous: ${change.targetName}`)
    const target = matches[0]
    const source = target.variables
    if (typeof source !== 'object' || source === null || Array.isArray(source))
      throw new Error('SB3 variables are missing')
    const variables = { ...(source as Record<string, unknown>) }
    if (!Object.hasOwn(variables, change.variableId)) throw new Error('SB3 variable ID not found')
    const variable: unknown = variables[change.variableId]
    if (!Array.isArray(variable) || variable.length < 2 || typeof variable[0] !== 'string' || variable[2] === true)
      throw new Error('Only existing non-cloud scalar variables can be changed')
    const key = JSON.stringify([change.targetName, change.variableId])
    if (seen.has(key)) throw new Error('Duplicate SB3 variable change')
    seen.add(key)
    if (variable[1] !== change.expected) throw new Error('SB3 variable old value does not match')
    const value = change.value
    if (!(
      (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000) ||
      (typeof value === 'string' && value.length <= 512) ||
      typeof value === 'boolean'
    ))
      throw new Error('Invalid SB3 variable value')
    variables[change.variableId] = [variable[0], value, ...(variable.slice(2) as unknown[])]
    target.variables = variables
  }
  const projectJson = { ...project.projectJson, targets }
  const projectJsonBytes = new TextEncoder().encode(JSON.stringify(projectJson))
  if (projectJsonBytes.byteLength > 16 * 1024 * 1024)
    throw new Error('Patched SB3 project.json exceeds the 16 MiB limit')
  return { ...project, projectJson, projectJsonBytes }
}
