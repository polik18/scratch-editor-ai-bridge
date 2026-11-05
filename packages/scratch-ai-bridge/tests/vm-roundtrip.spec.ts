import { describe, it, expect } from 'vitest'
import { vmRoundTrip, generateVmRoundTripReport } from '../src/test/vm-roundtrip'

describe('vm-roundtrip', () => {
  describe('vmRoundTrip', () => {
    it('does not report success for invalid or untested archives', async () => {
      await expect(vmRoundTrip(new Blob(['not an sb3']))).rejects.toThrow(/not implemented/i)
    })
  })

  describe('generateVmRoundTripReport', () => {
    it('should generate correct report for success', () => {
      const result = {
        success: true,
        errors: [],
        warnings: [],
        vmLoadSuccess: true,
        vmSaveSuccess: true,
        reloadSuccess: true,
        semanticEquivalence: {
          targetsEqual: true,
          scriptsEqual: true,
          variablesEqual: true,
          costumesEqual: true,
          soundsEqual: true,
        },
        metadata: {
          targetCount: 1,
          scriptCount: 3,
          variableCount: 2,
          costumeCount: 1,
          soundCount: 0,
        },
      }

      const report = generateVmRoundTripReport(result)

      expect(report).toContain('Status: PASS')
      expect(report).toContain('VM Load: SUCCESS')
      expect(report).toContain('VM Save: SUCCESS')
      expect(report).toContain('Reload: SUCCESS')
      expect(report).toContain('Targets: EQUAL')
    })

    it('should generate correct report for failure', () => {
      const result = {
        success: false,
        errors: ['Test error'],
        warnings: ['Test warning'],
        vmLoadSuccess: true,
        vmSaveSuccess: true,
        reloadSuccess: false,
        semanticEquivalence: {
          targetsEqual: false,
          scriptsEqual: false,
          variablesEqual: false,
          costumesEqual: false,
          soundsEqual: false,
        },
        metadata: {
          targetCount: 0,
          scriptCount: 0,
          variableCount: 0,
          costumeCount: 0,
          soundCount: 0,
        },
      }

      const report = generateVmRoundTripReport(result)

      expect(report).toContain('Status: FAIL')
      expect(report).toContain('Reload: FAIL')
      expect(report).toContain('Targets: MISMATCH')
      expect(report).toContain('Errors:')
      expect(report).toContain('Test error')
      expect(report).toContain('Warnings:')
      expect(report).toContain('Test warning')
    })
  })
})
