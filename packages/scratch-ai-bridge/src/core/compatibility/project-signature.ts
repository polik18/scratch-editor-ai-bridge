/**
 * A deterministic JSON signature used by the compatibility fixture matrix.
 *
 * This is deliberately separate from the Canonical IR. The signature keeps
 * fields that the Canonical IR does not understand yet, so a failed comparison
 * is evidence for expanding the lossless path instead of silently hiding data.
 */
export interface JsonObject {
  [key: string]: JsonValue
}

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stableValue = (value: unknown): JsonValue => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (isRecord(value)) {
    const entries: [string, JsonValue][] = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]): [string, JsonValue] => [key, stableValue(entry)])
    return entries.reduce<JsonObject>((result, [key, entry]) => {
      result[key] = entry
      return result
    }, {})
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  return null
}

/**
 * Return a stable, JSON-serializable representation of a Scratch project.
 * @param project Scratch project JSON or any value returned by a parser.
 * @returns A recursively key-sorted JSON value.
 */
export const projectJsonSignature = (project: unknown): JsonValue => stableValue(project)

export interface ProjectJsonComparison {
  equal: boolean
  left: JsonValue
  right: JsonValue
}

/**
 * Compare project JSON without depending on object insertion order.
 * @param left First project JSON value.
 * @param right Second project JSON value.
 * @returns Both stable signatures and whether they are identical.
 */
export const compareProjectJson = (left: unknown, right: unknown): ProjectJsonComparison => {
  const leftSignature = projectJsonSignature(left)
  const rightSignature = projectJsonSignature(right)
  return {
    equal: JSON.stringify(leftSignature) === JSON.stringify(rightSignature),
    left: leftSignature,
    right: rightSignature,
  }
}
