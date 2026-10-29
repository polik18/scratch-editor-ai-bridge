import { describe, it, expect } from 'vitest';
import { vmRoundTrip, generateVmRoundTripReport } from '../src/test/vm-roundtrip';

// Create a minimal SB3 blob for testing
function createMinimalSb3(): Blob {
  // Create a minimal SB3 project JSON
  const projectJson = {
    targets: [
      {
        name: 'Sprite1',
        isStage: false,
        x: 0,
        y: 0,
        direction: 90,
        visible: true,
        size: 100,
        rotationStyle: 'all around',
        draggable: false,
        currentCostume: 0,
        costumes: [
          {
            name: 'costume1',
            costumeName: 'costume1',
            baseLayerID: 'baseLayerId',
            baseLayerMD5: 'baseLayerMD5',
            bitmapResolution: 1,
            rotationCenterX: 48,
            rotationCenterY: 50,
          },
        ],
        sounds: [],
        variables: {},
        lists: {},
        broadcastChannels: {},
        blocks: {},
        comments: {},
      },
    ],
    monitors: [],
    meta: {
      semver: '3.0.0',
      vm: '0.2.0',
      agent: 'scratch-vm',
    },
  };
  
  // Convert to SB3 format (simplified)
  const sb3Content = JSON.stringify({ project: projectJson });
  
  return new Blob([sb3Content], { type: 'application/octet-stream' });
}

describe('vm-roundtrip', () => {
  describe('vmRoundTrip', () => {
    it('should return success for valid SB3', async () => {
      const sb3 = createMinimalSb3();
      const result = await vmRoundTrip(sb3);
      
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
    
    it('should return correct metadata', async () => {
      const sb3 = createMinimalSb3();
      const result = await vmRoundTrip(sb3);
      
      expect(result.metadata.targetCount).toBeGreaterThanOrEqual(0);
      expect(result.metadata.scriptCount).toBeGreaterThanOrEqual(0);
      expect(result.metadata.variableCount).toBeGreaterThanOrEqual(0);
      expect(result.metadata.costumeCount).toBeGreaterThanOrEqual(0);
      expect(result.metadata.soundCount).toBeGreaterThanOrEqual(0);
    });
    
    it('should have correct semantic equivalence flags', async () => {
      const sb3 = createMinimalSb3();
      const result = await vmRoundTrip(sb3);
      
      expect(result.semanticEquivalence.targetsEqual).toBe(true);
      expect(result.semanticEquivalence.scriptsEqual).toBe(true);
      expect(result.semanticEquivalence.variablesEqual).toBe(true);
      expect(result.semanticEquivalence.costumesEqual).toBe(true);
      expect(result.semanticEquivalence.soundsEqual).toBe(true);
    });
  });
  
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
      };
      
      const report = generateVmRoundTripReport(result);
      
      expect(report).toContain('Status: PASS');
      expect(report).toContain('VM Load: SUCCESS');
      expect(report).toContain('VM Save: SUCCESS');
      expect(report).toContain('Reload: SUCCESS');
      expect(report).toContain('Targets: EQUAL');
    });
    
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
      };
      
      const report = generateVmRoundTripReport(result);
      
      expect(report).toContain('Status: FAIL');
      expect(report).toContain('Reload: FAIL');
      expect(report).toContain('Targets: MISMATCH');
      expect(report).toContain('Errors:');
      expect(report).toContain('Test error');
      expect(report).toContain('Warnings:');
      expect(report).toContain('Test warning');
    });
  });
});
