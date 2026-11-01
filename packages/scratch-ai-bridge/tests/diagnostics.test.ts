/**
 * Tests for the student diagnostics module
 */

import { describe, it, expect } from 'vitest'
import {
  createStudentDiagnostic,
  getDiagnosticTypes,
  DIAGNOSTIC_MESSAGES
} from '../src/core/diagnostics/messages'
import { convertToStudentDiagnostic } from '../src/core/diagnostics/convert'

describe('Student Diagnostics', () => {
  describe('createStudentDiagnostic', () => {
    it('should create a diagnostic for missing-start-block', () => {
      const diagnostic = createStudentDiagnostic('missing-start-block')
      
      expect(diagnostic).toBeDefined()
      expect(diagnostic?.category).toBe('structure')
      expect(diagnostic?.severity).toBe('high')
      expect(diagnostic?.title).toContain('缺少')
      expect(diagnostic?.fix).toContain('當綠旗被點擊')
    })

    it('should create a diagnostic for undefined-variable with params', () => {
      const diagnostic = createStudentDiagnostic('undefined-variable', { name: 'score' })
      
      expect(diagnostic).toBeDefined()
      expect(diagnostic?.category).toBe('variable')
      expect(diagnostic?.title).toContain('score')
      expect(diagnostic?.explanation).toContain('score')
    })

    it('should return undefined for unknown diagnostic type', () => {
      const diagnostic = createStudentDiagnostic('unknown-type' as any)
      expect(diagnostic).toBeUndefined()
    })
  })

  describe('getDiagnosticTypes', () => {
    it('should return all diagnostic types', () => {
      const types = getDiagnosticTypes()
      expect(types.length).toBeGreaterThan(0)
      expect(types).toContain('missing-start-block')
      expect(types).toContain('undefined-variable')
    })
  })

  describe('convertToStudentDiagnostic', () => {
    it('should convert cloud-variable-offline diagnostic', () => {
      const diagnostic = convertToStudentDiagnostic({
        severity: 'warning',
        code: 'cloud-variable-offline',
        message: 'Cloud variable not available offline',
        variable: 'score'
      })
      
      expect(diagnostic).toBeDefined()
      expect(diagnostic?.type).toBe('error')
      expect(diagnostic?.category).toBe('variable')
    })

    it('should return undefined for unmapped diagnostic', () => {
      const diagnostic = convertToStudentDiagnostic({
        severity: 'warning',
        code: 'unknown-code',
        message: 'Unknown error'
      })
      
      expect(diagnostic).toBeUndefined()
    })
  })

  describe('Diagnostic Messages', () => {
    it('should have student-friendly explanations', () => {
      const types = getDiagnosticTypes()
      
      for (const type of types) {
        const message = DIAGNOSTIC_MESSAGES[type]
        expect(message).toBeDefined()
        expect(message.title).toBeDefined()
        expect(message.explanation).toBeDefined()
        expect(message.impact).toBeDefined()
        expect(message.fix).toBeDefined()
      }
    })
  })
})
