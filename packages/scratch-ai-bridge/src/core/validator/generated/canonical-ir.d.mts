import type { ErrorObject } from 'ajv'
import type { CanonicalProject } from '../../ir/types'

declare const validateCanonicalProjectSchema: {
  (data: unknown): data is CanonicalProject
  errors?: ErrorObject[] | null
}

export default validateCanonicalProjectSchema
