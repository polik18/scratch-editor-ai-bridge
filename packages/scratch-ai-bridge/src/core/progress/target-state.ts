export interface ProgressTargetState {
  readonly name: string
  readonly isStage: boolean
  readonly currentCostume: number
  readonly x?: number
  readonly y?: number
  readonly direction?: number
  readonly size?: number
  readonly visible?: boolean
}

/**
 * Parse untrusted target states without applying them to a VM.
 * @param value Serialized original target states.
 * @returns Validated target state records.
 */
export const parseProgressTargets = (value: unknown): readonly ProgressTargetState[] => {
  if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid saved target states.')
  const seen = new Set<string>()
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new Error('Invalid saved target state.')
    const entry = item as Record<string, unknown>
    if (
      Object.keys(entry).some(
        (key) => !['name', 'isStage', 'currentCostume', 'x', 'y', 'direction', 'size', 'visible'].includes(key),
      ) ||
      typeof entry.name !== 'string' ||
      entry.name.length > 256 ||
      typeof entry.isStage !== 'boolean' ||
      typeof entry.currentCostume !== 'number' ||
      !Number.isSafeInteger(entry.currentCostume) ||
      entry.currentCostume < 0
    )
      throw new Error('Invalid saved target state fields.')
    if (seen.has(entry.name)) throw new Error('Duplicate saved target name.')
    seen.add(entry.name)
    if (entry.isStage) {
      if (['x', 'y', 'direction', 'size', 'visible'].some((key) => Object.hasOwn(entry, key)))
        throw new Error('Stage state contains sprite fields.')
      return { name: entry.name, isStage: true, currentCostume: entry.currentCostume }
    }
    const finite = (number: unknown): number is number =>
      typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1_000_000
    if (
      !finite(entry.x) ||
      !finite(entry.y) ||
      !finite(entry.direction) ||
      !finite(entry.size) ||
      entry.size < 0 ||
      typeof entry.visible !== 'boolean'
    )
      throw new Error('Invalid saved sprite state.')
    return {
      name: entry.name,
      isStage: false,
      currentCostume: entry.currentCostume,
      x: entry.x,
      y: entry.y,
      direction: entry.direction,
      size: entry.size,
      visible: entry.visible,
    }
  })
}
