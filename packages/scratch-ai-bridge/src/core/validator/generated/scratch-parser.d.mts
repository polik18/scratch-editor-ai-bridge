import type { ErrorObject } from 'ajv'

interface ScratchSchemaValidator {
  (data: unknown): data is Record<string, unknown>
  errors?: ErrorObject[] | null
}

export const validateSb3Project: ScratchSchemaValidator
export const validateSb3Sprite: ScratchSchemaValidator
