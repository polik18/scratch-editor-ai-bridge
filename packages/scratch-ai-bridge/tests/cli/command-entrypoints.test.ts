import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const run = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, [path.resolve(script), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 20_000,
  });

describe('CLI entry points', () => {
  it('documents the generate command in the installed bridge CLI', () => {
    const result = run('scripts/scratch-ai-bridge.mjs', '--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('generate <design.json> --out <new-file.sb3>');
    expect(result.stdout).toContain('--preview <stage.png>');
  });

  it('starts the session CLI through the package bin wrapper', () => {
    const result = run('scripts/scratch-session.mjs', '--help');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('new-game');
  });

  it('keeps generation stdout machine-readable JSON and writes a verified SB3', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'scratch-cli-generate-'));
    try {
      const result = run(
        'scripts/scratch-ai-bridge.mjs',
        'generate',
        'src/core/ir/examples/06-platformer-core.json',
        '--out',
        path.join(tempDir, 'platformer.sb3'),
        '--report',
        path.join(tempDir, 'report.json'),
      );
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.status).toBe('success');
      expect(output.gates).toContainEqual(expect.objectContaining({ name: 'scratch-vm-reload', status: 'pass' }));
      expect(output.gates).toContainEqual(expect.objectContaining({ name: 'runtime-behavior', status: 'not-run' }));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15000);
});
