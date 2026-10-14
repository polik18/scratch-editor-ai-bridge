import type { ErrorObject } from 'ajv'
import { CANONICAL_JSON_MAX_DEPTH, CANONICAL_JSON_MAX_NODES, type CanonicalProject } from '../ir/types'
import validateProject from './generated/canonical-ir.mjs'

export interface CanonicalIRValidationIssue {
  instancePath: string
  schemaPath: string
  keyword: string
  message: string
  params: Record<string, unknown>
}

export type CanonicalIRValidationResult =
  { valid: true; data: CanonicalProject } | { valid: false; errors: CanonicalIRValidationIssue[] }

const normalizeError = (error: ErrorObject): CanonicalIRValidationIssue => ({
  instancePath: error.instancePath,
  schemaPath: error.schemaPath,
  keyword: error.keyword,
  message: error.message ?? 'Schema validation failed',
  params: error.params as Record<string, unknown>,
})

export const validateCanonicalProject = (input: unknown): CanonicalIRValidationResult => {
  if (typeof input === 'object' && input !== null && !Array.isArray(input) && 'meta' in input) {
    const meta = (input as { meta?: unknown }).meta
    if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
      const active = new WeakSet<object>()
      const stack: ({ value: unknown; depth: number } | { exit: object })[] = Object.values(
        meta as Record<string, unknown>,
      ).map((value: unknown) => ({ value, depth: 0 }))
      let nodes = 0
      while (stack.length > 0) {
        const current = stack.pop()
        if (!current) continue
        if ('exit' in current) {
          active.delete(current.exit)
          continue
        }
        nodes += 1
        if (nodes > CANONICAL_JSON_MAX_NODES) {
          return {
            valid: false,
            errors: [
              {
                instancePath: '/meta',
                schemaPath: '#/properties/meta',
                keyword: 'maxNodes',
                message: `Metadata exceeds the ${CANONICAL_JSON_MAX_NODES} node limit`,
                params: { limit: CANONICAL_JSON_MAX_NODES },
              },
            ],
          }
        }
        if (current.depth > CANONICAL_JSON_MAX_DEPTH) {
          return {
            valid: false,
            errors: [
              {
                instancePath: '/meta',
                schemaPath: '#/properties/meta',
                keyword: 'maxDepth',
                message: `Metadata exceeds the ${CANONICAL_JSON_MAX_DEPTH} level depth limit`,
                params: { limit: CANONICAL_JSON_MAX_DEPTH },
              },
            ],
          }
        }
        if (typeof current.value !== 'object' || current.value === null) continue
        if (active.has(current.value)) {
          return {
            valid: false,
            errors: [
              {
                instancePath: '/meta',
                schemaPath: '#/properties/meta',
                keyword: 'acyclic',
                message: 'Metadata must not contain cyclic references',
                params: {},
              },
            ],
          }
        }
        active.add(current.value)
        stack.push({ exit: current.value })
        for (const child of Object.values(current.value)) {
          stack.push({ value: child, depth: current.depth + 1 })
        }
      }
    }
  }

  if (validateProject(input)) {
    return { valid: true, data: input }
  }

  return {
    valid: false,
    errors: (validateProject.errors ?? []).map(normalizeError),
  }
}
