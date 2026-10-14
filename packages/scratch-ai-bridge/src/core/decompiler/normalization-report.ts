import { sha256 } from '@noble/hashes/sha2'
import type { RawSb3Project } from '../archive'

export const VM_NORMALIZATION_REPORT_FORMAT = 'scratch-ai-bridge/vm-normalization-report' as const
export const VM_NORMALIZATION_REPORT_VERSION = 1 as const

export type NormalizationChangeKind = 'added' | 'removed' | 'replaced'

export interface ProjectJsonNormalizationChange {
  readonly path: string
  readonly kind: NormalizationChangeKind
  readonly beforeType: string | null
  readonly afterType: string | null
}

export interface ArchiveEntryNormalizationChange {
  readonly name: string
  readonly kind: 'added' | 'removed' | 'content-changed' | 'unchanged'
  readonly sourceSha256: string | null
  readonly normalizedSha256: string | null
}

export interface ArchiveCommentNormalizationChange {
  readonly kind: 'added' | 'removed' | 'content-changed' | 'unchanged'
  readonly sourceSha256: string | null
  readonly normalizedSha256: string | null
}

export interface VmNormalizationReport {
  readonly format: typeof VM_NORMALIZATION_REPORT_FORMAT
  readonly version: typeof VM_NORMALIZATION_REPORT_VERSION
  readonly sourceProjectJsonSha256: string
  readonly normalizedProjectJsonSha256: string
  readonly projectJsonChanges: readonly ProjectJsonNormalizationChange[]
  readonly archiveEntryChanges: readonly ArchiveEntryNormalizationChange[]
  readonly archiveCommentChange: ArchiveCommentNormalizationChange
}

const hashBytes = (bytes: Uint8Array | undefined): string | null => {
  if (!bytes?.byteLength) return null
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const typeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const escapePointerSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
  typeof value === 'object' && value !== null

const isArrayIndex = (value: unknown): value is number => typeof value === 'number'

const collectProjectJsonChanges = (
  source: Record<string, unknown>,
  normalized: Record<string, unknown>,
): ProjectJsonNormalizationChange[] => {
  const changes: ProjectJsonNormalizationChange[] = []
  const stack: { source: unknown; normalized: unknown; path: string }[] = [{ source, normalized, path: '' }]

  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) continue
    const { source: before, normalized: after, path } = entry
    if (Object.is(before, after)) continue

    if (!isContainer(before) || !isContainer(after) || Array.isArray(before) !== Array.isArray(after)) {
      changes.push({
        path: path || '/',
        kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'replaced',
        beforeType: before === undefined ? null : typeOf(before),
        afterType: after === undefined ? null : typeOf(after),
      })
      continue
    }

    const beforeKeys = Array.isArray(before) ? before.map((_, index) => index) : Object.keys(before)
    const afterKeys = Array.isArray(after) ? after.map((_, index) => index) : Object.keys(after)
    const keys = new Set([...beforeKeys, ...afterKeys])
    if (keys.size === 0) continue

    for (const key of keys) {
      const beforeHasKey = isArrayIndex(key)
        ? Array.isArray(before) && key < before.length
        : !Array.isArray(before) && Object.hasOwn(before, key)
      const afterHasKey = isArrayIndex(key)
        ? Array.isArray(after) && key < after.length
        : !Array.isArray(after) && Object.hasOwn(after, key)
      const beforeValue = beforeHasKey ? (before as Record<string | number, unknown>)[key] : undefined
      const afterValue = afterHasKey ? (after as Record<string | number, unknown>)[key] : undefined
      const segment = String(key)
      stack.push({
        source: beforeValue,
        normalized: afterValue,
        path: `${path}/${escapePointerSegment(segment)}`,
      })
    }
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Describe all changed JSON leaves and archive entry hashes after Scratch VM save.
 * Raw values are intentionally omitted; callers can safely offer this report as a local download.
 * @param source Original lossless SB3 archive.
 * @param normalized SB3 archive emitted by Scratch VM.
 * @returns Versioned machine-readable normalization report.
 */
export const createVmNormalizationReport = (
  source: RawSb3Project,
  normalized: RawSb3Project,
): VmNormalizationReport => {
  const sourceEntries = new Map(
    source.entries.filter(({ isDirectory }) => !isDirectory).map((entry) => [entry.name, entry]),
  )
  const normalizedEntries = new Map(
    normalized.entries.filter(({ isDirectory }) => !isDirectory).map((entry) => [entry.name, entry]),
  )
  const archiveEntryChanges = [...new Set([...sourceEntries.keys(), ...normalizedEntries.keys()])]
    .sort()
    .map((name): ArchiveEntryNormalizationChange => {
      const sourceEntry = sourceEntries.get(name)
      const normalizedEntry = normalizedEntries.get(name)
      return {
        name,
        kind:
          sourceEntry === undefined
            ? 'added'
            : normalizedEntry === undefined
              ? 'removed'
              : sourceEntry.sha256 === normalizedEntry.sha256
                ? 'unchanged'
                : 'content-changed',
        sourceSha256: sourceEntry?.sha256 ?? null,
        normalizedSha256: normalizedEntry?.sha256 ?? null,
      }
    })
  const sourceCommentSha256 = hashBytes(source.archiveCommentBytes)
  const normalizedCommentSha256 = hashBytes(normalized.archiveCommentBytes)
  const archiveCommentChange: ArchiveCommentNormalizationChange = {
    kind:
      sourceCommentSha256 === null
        ? normalizedCommentSha256 === null
          ? 'unchanged'
          : 'added'
        : normalizedCommentSha256 === null
          ? 'removed'
          : sourceCommentSha256 === normalizedCommentSha256
            ? 'unchanged'
            : 'content-changed',
    sourceSha256: sourceCommentSha256,
    normalizedSha256: normalizedCommentSha256,
  }

  return {
    format: VM_NORMALIZATION_REPORT_FORMAT,
    version: VM_NORMALIZATION_REPORT_VERSION,
    sourceProjectJsonSha256: source.entries.find(({ name }) => name === source.projectEntryName)?.sha256 ?? '',
    normalizedProjectJsonSha256:
      normalized.entries.find(({ name }) => name === normalized.projectEntryName)?.sha256 ?? '',
    projectJsonChanges: collectProjectJsonChanges(source.projectJson, normalized.projectJson),
    archiveEntryChanges,
    archiveCommentChange,
  }
}
