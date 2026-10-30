import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { validateArchive } from '../../src/cli/archive-validator.js';

const makeArchive = async (assetEntry?: string) => {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify({
    targets: [{ costumes: [{ md5ext: 'costume.svg' }], sounds: [] }],
  }));
  if (assetEntry) zip.file(assetEntry, '<svg/>');
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
};

describe('validateArchive', () => {
  it('counts and checks Scratch root-level costume entries referenced by md5ext', async () => {
    const result = await validateArchive(await makeArchive('costume.svg'));
    expect(result.status).toBe('pass');
    expect(result.diagnostics).toMatchObject({ hasAssets: true, assetCount: 1, md5extCoverage: 1 });
  });

  it('fails when a project references a missing costume entry', async () => {
    const result = await validateArchive(await makeArchive());
    expect(result.status).toBe('fail');
    expect(result.errors).toContain('Missing referenced asset entry "costume.svg"');
  });
});
