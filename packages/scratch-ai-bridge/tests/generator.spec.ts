/**
 * Generator Test Suite
 */

import { describe, it, expect } from 'vitest';
import { generateGame } from '../src/cli/generator.js';
import { getBlocks, getTargets, loadSb3 } from '../src/scratch/vm.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('Generator', () => {
  describe('generateGame', () => {
    it('should generate and preserve targets and block graphs from Canonical IR', async () => {
      const tempDir = '/tmp/scratch-test-' + Date.now();
      const designPath = path.resolve('src/core/ir/examples/06-platformer-core.json');
      const outputDir = path.join(tempDir, 'generated');

      const result = await generateGame(designPath, { outputDir });
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.manifest?.outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);

      const vm = await loadSb3(await fs.readFile(result.output!));
      try {
        const targets = getTargets(vm);
        expect(targets.map(target => target.getName())).toEqual(['Stage', 'Player', 'Platform']);
        expect(targets.reduce((total, target) => total + getBlocks(target).length, 0)).toBeGreaterThan(10);
      } finally {
        vm.quit();
      }

      await fs.rm(tempDir, { recursive: true, force: true });
    }, 10000);

    it('should reject the documented sprites array instead of generating an empty project', async () => {
      const tempDir = '/tmp/scratch-test-' + Date.now();
      await fs.mkdir(tempDir, { recursive: true });
      const designPath = path.join(tempDir, 'design.json');
      await fs.writeFile(designPath, JSON.stringify({ title: 'Test Game', sprites: [{ name: 'Player' }], scripts: [] }));

      const result = await generateGame(designPath, { outputDir: tempDir });
      expect(result.success).toBe(false);
      expect(result.diagnostics[0]?.message).toContain('sprites[] is not supported');

      await fs.rm(tempDir, { recursive: true, force: true });
    });
    
    it('should handle invalid design JSON', async () => {
      const tempDir = '/tmp/scratch-test-' + Date.now();
      await fs.mkdir(tempDir, { recursive: true });
      
      const invalidPath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(invalidPath, 'invalid json');
      
      const result = await generateGame(invalidPath, { outputDir: tempDir });
      
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      
      // Cleanup
      await fs.unlink(invalidPath);
      await fs.rmdir(tempDir);
    });
    
    it('should handle missing input file', async () => {
      const result = await generateGame('/nonexistent/file.json');
      
      expect(result.success).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });
});
