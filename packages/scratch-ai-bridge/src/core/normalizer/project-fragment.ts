import {
  CANONICAL_IR_FORMAT,
  CANONICAL_IR_VERSION,
  type CanonicalProject,
  type CanonicalSprite,
  type CanonicalStage,
  type CanonicalTargetBase,
} from '../ir/types'

export const PROJECT_FRAGMENT_FORMAT = 'scratch-ai-bridge/project-fragment' as const
export const PROJECT_FRAGMENT_VERSION = 1 as const

export interface ProjectFragment {
  format: typeof PROJECT_FRAGMENT_FORMAT
  version: typeof PROJECT_FRAGMENT_VERSION
  projectName: string
  fragmentId: string
  target: CanonicalStage | CanonicalSprite
  broadcasts?: CanonicalProject['broadcasts']
  extensions?: string[]
  meta?: CanonicalProject['meta']
}

export interface ProjectFragmentSession {
  project: CanonicalProject | null
  appliedFragmentIds: Set<string>
}

export const createEmptyProjectFragmentSession = (): ProjectFragmentSession => ({
  project: null,
  appliedFragmentIds: new Set(),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const parseTarget = (value: unknown): CanonicalStage | CanonicalSprite => {
  if (!isRecord(value) || (value.kind !== 'stage' && value.kind !== 'sprite')) {
    throw new Error('片段 target 必須是 kind 為 stage 或 sprite 的物件。')
  }
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('target.name 不可空白。')
  for (const key of ['variables', 'lists', 'costumes', 'sounds', 'scripts', 'procedures']) {
    if (!Array.isArray(value[key])) throw new Error(`target.${key} 必須是陣列。`)
  }
  if (value.kind === 'sprite') {
    for (const key of ['x', 'y', 'direction', 'size']) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
        throw new Error(`sprite ${key} 必須是有限數字。`)
    }
    if (typeof value.visible !== 'boolean' || typeof value.draggable !== 'boolean') {
      throw new Error('sprite.visible 與 sprite.draggable 必須是布林值。')
    }
    if (!['all around', 'left-right', "don't rotate"].includes(String(value.rotationStyle))) {
      throw new Error('sprite.rotationStyle 無效。')
    }
  }
  return structuredClone(value) as unknown as CanonicalStage | CanonicalSprite
}

export const parseProjectFragment = (value: unknown): ProjectFragment => {
  if (!isRecord(value) || value.format !== PROJECT_FRAGMENT_FORMAT || value.version !== PROJECT_FRAGMENT_VERSION) {
    throw new Error(`片段格式必須是 ${PROJECT_FRAGMENT_FORMAT} v${PROJECT_FRAGMENT_VERSION}。`)
  }
  if (typeof value.projectName !== 'string' || !value.projectName.trim()) throw new Error('projectName 不可空白。')
  if (typeof value.fragmentId !== 'string' || !/^[\w.-]{1,100}$/.test(value.fragmentId)) {
    throw new Error('fragmentId 僅可使用英數字、底線、句點或連字號，長度最多 100。')
  }
  const result: ProjectFragment = {
    format: PROJECT_FRAGMENT_FORMAT,
    version: PROJECT_FRAGMENT_VERSION,
    projectName: value.projectName.trim(),
    fragmentId: value.fragmentId,
    target: parseTarget(value.target),
  }
  if (value.broadcasts !== undefined) {
    if (
      !Array.isArray(value.broadcasts) ||
      value.broadcasts.some((item) => !isRecord(item) || typeof item.name !== 'string')
    ) {
      throw new Error('broadcasts 必須是含 name 欄位的物件陣列。')
    }
    result.broadcasts = structuredClone(value.broadcasts) as CanonicalProject['broadcasts']
  }
  if (value.extensions !== undefined) {
    if (!Array.isArray(value.extensions) || value.extensions.some((item) => typeof item !== 'string'))
      throw new Error('extensions 必須是字串陣列。')
    result.extensions = [...new Set(value.extensions as string[])]
  }
  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) throw new Error('meta 必須是物件。')
    result.meta = structuredClone(value.meta) as CanonicalProject['meta']
  }
  return result
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const mergeNamed = <T extends { name: string }>(base: T[], incoming: T[], label: string): T[] => {
  const result = structuredClone(base)
  for (const item of incoming) {
    const index = result.findIndex((existing) => existing.name === item.name)
    if (index < 0) result.push(structuredClone(item))
    else if (stableStringify(result[index]) !== stableStringify(item))
      throw new Error(`${label}「${item.name}」內容衝突。`)
  }
  return result
}

const mergeTarget = <T extends CanonicalTargetBase>(base: T, incoming: T): T => ({
  ...base,
  ...incoming,
  variables: mergeNamed(base.variables, incoming.variables, '變數'),
  lists: mergeNamed(base.lists, incoming.lists, '清單'),
  costumes: mergeNamed(base.costumes, incoming.costumes, '造型'),
  sounds: mergeNamed(base.sounds, incoming.sounds, '音效'),
  procedures: mergeNamed(base.procedures, incoming.procedures, '自訂積木'),
  scripts: [...structuredClone(base.scripts), ...structuredClone(incoming.scripts)],
  comments: [...structuredClone(base.comments ?? []), ...structuredClone(incoming.comments ?? [])],
})

export const mergeProjectFragment = (
  session: ProjectFragmentSession,
  rawFragment: unknown,
): ProjectFragmentSession => {
  const fragment = parseProjectFragment(rawFragment)
  if (session.appliedFragmentIds.has(fragment.fragmentId))
    throw new Error(`片段「${fragment.fragmentId}」已加入，不能重複套用。`)
  if (!session.project && fragment.target.kind !== 'stage') throw new Error('請先加入 Stage 片段，再加入角色片段。')

  let project: CanonicalProject
  if (!session.project) {
    const stage = fragment.target as CanonicalStage
    project = {
      format: CANONICAL_IR_FORMAT,
      version: CANONICAL_IR_VERSION,
      name: fragment.projectName,
      stage: structuredClone(stage),
      sprites: [],
      broadcasts: structuredClone(fragment.broadcasts ?? []),
      ...(fragment.extensions?.length ? { extensions: [...fragment.extensions] } : {}),
      ...(fragment.meta ? { meta: structuredClone(fragment.meta) } : {}),
    }
  } else {
    if (session.project.name !== fragment.projectName)
      throw new Error(`片段 projectName「${fragment.projectName}」與目前作品「${session.project.name}」不同。`)
    project = structuredClone(session.project)
    if (fragment.target.kind === 'stage') project.stage = mergeTarget(project.stage, fragment.target)
    else {
      const index = project.sprites.findIndex((sprite) => sprite.name === fragment.target.name)
      if (index < 0) project.sprites.push(structuredClone(fragment.target))
      else project.sprites[index] = mergeTarget(project.sprites[index], fragment.target)
    }
    project.broadcasts = mergeNamed(project.broadcasts, fragment.broadcasts ?? [], '廣播')
    project.extensions = [...new Set([...(project.extensions ?? []), ...(fragment.extensions ?? [])])]
    if (fragment.meta) project.meta = { ...(project.meta ?? {}), ...structuredClone(fragment.meta) }
  }
  if (project.sprites.some((sprite) => sprite.name === project.stage.name))
    throw new Error('Stage 與 Sprite 不可使用相同名稱。')
  return { project, appliedFragmentIds: new Set([...session.appliedFragmentIds, fragment.fragmentId]) }
}
