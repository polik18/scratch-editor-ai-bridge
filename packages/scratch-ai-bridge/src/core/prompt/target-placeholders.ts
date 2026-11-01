/**
 * Replace target names in one pass so names cannot corrupt generated placeholders.
 * @param value Text containing target names.
 * @param names Mapping from private names to public labels.
 * @returns The masked text and generated placeholders.
 */
export const hideTargetNames = (
  value: string,
  names: ReadonlyMap<string, string>,
): { text: string; placeholders: ReadonlyMap<string, string> } => {
  const entries = [...names].filter(([name]) => name.length > 0).sort(([a], [b]) => b.length - a.length)
  const placeholders = new Map<string, string>()
  if (entries.length === 0) return { text: value, placeholders }
  const byName = new Map(entries)
  const pattern = new RegExp(entries.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  const text = value.replace(pattern, (name) => {
    const token = `__SCRATCH_TARGET_${placeholders.size}__`
    placeholders.set(token, byName.get(name) ?? '角色')
    return token
  })
  return { text, placeholders }
}

export const restoreTargetNames = (value: string, placeholders: ReadonlyMap<string, string>): string => {
  let output = value
  for (const [token, label] of placeholders) output = output.replaceAll(token, label)
  return output
}
