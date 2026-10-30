/** Local game generation from Canonical IR or the supported GameDesign JSON contract. */

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { getProjectJson, loadSb3, saveSb3 } from '../scratch/vm.js';
import { validateArchive, validateProjectJson } from './archive-validator.js';
import { validateBlockGraph } from './graph-validator.js';
import { compileCanonicalProjectToSb3 } from '../core/compiler/compiler.js';
import { CANONICAL_IR_FORMAT, type CanonicalProject } from '../core/ir/types.js';
import { validateCanonicalProject, validateCanonicalSemantics } from '../core/validator/index.js';
import { designToCanonicalIR } from './design-to-ir.js';
import { createManifestEntry, type GateResult, type ManifestEntry } from './manifest.js';

export interface GeneratorOptions {
  /** Write to this exact path. Mutually exclusive with outputDir. */
  outputFile?: string;
  /** Write to a directory using the input basename. */
  outputDir?: string;
  /** Optional machine-readable generation report path. */
  reportPath?: string;
  /** Optional screenshot path; when set, the official browser renderer is exercised before output is written. */
  previewPath?: string;
  /** Allow replacing an existing output file. Defaults to false. */
  force?: boolean;
}

export interface GeneratorDiagnostic {
  type: 'error' | 'warning';
  stage: string;
  code: string;
  message: string;
  suggestion: string;
}

export interface GeneratorResult {
  format: 'scratch-ai-bridge/generation';
  version: 1;
  status: 'success' | 'failed';
  success: boolean;
  output?: string;
  manifest?: ManifestEntry;
  gates: GateResult[];
  diagnostics: GeneratorDiagnostic[];
}

interface ProjectCounts {
  targets: number;
  sprites: number;
  blocks: number;
  scripts: number;
  variables: number;
  lists: number;
  costumes: number;
  sounds: number;
}

const countProject = (project: Record<string, unknown>): ProjectCounts => {
  const targets = Array.isArray(project.targets) ? project.targets : [];
  const counts: ProjectCounts = {
    targets: targets.length,
    sprites: targets.filter((target) => (target as Record<string, unknown>)?.isStage !== true).length,
    blocks: 0,
    scripts: 0,
    variables: 0,
    lists: 0,
    costumes: 0,
    sounds: 0,
  };
  for (const targetValue of targets) {
    if (!targetValue || typeof targetValue !== 'object') continue;
    const target = targetValue as Record<string, unknown>;
    const blocks = target.blocks && typeof target.blocks === 'object' ? Object.values(target.blocks) : [];
    counts.blocks += blocks.length;
    counts.scripts += blocks.filter(
      (block) => Boolean(block && typeof block === 'object' && (block as Record<string, unknown>).topLevel),
    ).length;
    counts.variables += Object.keys(target.variables && typeof target.variables === 'object' ? target.variables : {}).length;
    counts.lists += Object.keys(target.lists && typeof target.lists === 'object' ? target.lists : {}).length;
    counts.costumes += Array.isArray(target.costumes) ? target.costumes.length : 0;
    counts.sounds += Array.isArray(target.sounds) ? target.sounds.length : 0;
  }
  return counts;
};

const assertAssetIntegrity = async (archive: Uint8Array): Promise<{ entries: number; assets: number }> => {
  const zip = await JSZip.loadAsync(archive);
  const projectEntry = zip.file('project.json');
  if (!projectEntry) throw new Error('SB3 archive has no project.json');
  const project = JSON.parse(await projectEntry.async('string')) as Record<string, unknown>;
  if (!Array.isArray(project.targets)) throw new Error('project.json targets must be an array');

  let assets = 0;
  for (const [targetIndex, targetValue] of project.targets.entries()) {
    if (!targetValue || typeof targetValue !== 'object') continue;
    const target = targetValue as Record<string, unknown>;
    for (const key of ['costumes', 'sounds'] as const) {
      const items = target[key];
      if (!Array.isArray(items)) continue;
      for (const [assetIndex, itemValue] of items.entries()) {
        if (!itemValue || typeof itemValue !== 'object') continue;
        const item = itemValue as Record<string, unknown>;
        const md5ext = item.md5ext;
        const assetId = item.assetId;
        if (typeof md5ext !== 'string' || typeof assetId !== 'string') {
          throw new Error(`/targets/${targetIndex}/${key}/${assetIndex} is missing md5ext or assetId`);
        }
        const entry = zip.file(md5ext);
        if (!entry) throw new Error(`Missing asset archive entry "${md5ext}"`);
        const bytes = await entry.async('uint8array');
        const actual = createHash('md5').update(bytes).digest('hex');
        if (actual !== assetId) throw new Error(`Asset checksum mismatch for "${md5ext}"`);
        assets += 1;
      }
    }
  }
  return { entries: Object.values(zip.files).filter((entry) => !entry.dir).length, assets };
};

const writeAtomically = async (filePath: string, data: Uint8Array | string, force: boolean): Promise<void> => {
  const absolutePath = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  if (!force) {
    try {
      await fs.access(absolutePath);
      throw new Error(`Output already exists: ${absolutePath}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Output already exists:')) throw error;
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, data);
    if (force) await fs.rename(temporaryPath, absolutePath);
    else {
      await fs.link(temporaryPath, absolutePath);
      await fs.unlink(temporaryPath);
    }
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

const isCanonicalProject = (value: unknown): value is CanonicalProject =>
  typeof value === 'object' && value !== null && 'format' in value && value.format === CANONICAL_IR_FORMAT;

const parseDesign = (text: string, inputPath: string): unknown => {
  if (path.extname(inputPath).toLowerCase() !== '.json') {
    throw new Error('Only JSON design files are supported. Markdown frontmatter is not a complete game design format.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid design JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const toCanonicalProject = (value: unknown): CanonicalProject => {
  if (isCanonicalProject(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Design file must contain a JSON object');
  const design = value as Record<string, unknown>;
  if (Array.isArray(design.sprites) && !Array.isArray(design.spritesDef)) {
    throw new Error('GameDesign sprites[] is not supported; use spritesDef or provide Canonical IR.');
  }
  return designToCanonicalIR(value as Parameters<typeof designToCanonicalIR>[0]);
};

/** Generate and independently verify an SB3. Runtime behavior remains explicitly not-run. */
export async function generateGame(input: string, options: GeneratorOptions = {}): Promise<GeneratorResult> {
  const gates: GateResult[] = [];
  const diagnostics: GeneratorDiagnostic[] = [];
  let inputHash = '';
  let outputPath: string | undefined;
  let failureStage = 'design-parse';

  try {
    if (options.outputFile && options.outputDir) throw new Error('Specify either outputFile or outputDir, not both');
    const inputPath = path.resolve(input);
    const inputText = await fs.readFile(inputPath, 'utf-8');
    inputHash = createHash('sha256').update(inputText).digest('hex');
    failureStage = 'design-input-validation';
    const canonical = toCanonicalProject(parseDesign(inputText, inputPath));
    gates.push({ name: 'design-input-validation', status: 'pass' });
    failureStage = 'canonical-schema-validation';
    const schema = validateCanonicalProject(canonical);
    if (!schema.valid) {
      throw new Error(`Canonical IR schema validation failed: ${schema.errors.map((item) => `${item.instancePath || '/'} ${item.message}`).join('; ')}`);
    }
    gates.push({ name: 'canonical-schema-validation', status: 'pass' });
    failureStage = 'canonical-semantic-validation';
    const semanticErrors = validateCanonicalSemantics(schema.data).filter((item) => item.severity === 'error');
    if (semanticErrors.length > 0) {
      throw new Error(`Canonical IR semantic validation failed: ${semanticErrors.map((item) => `${item.path} [${item.code}] ${item.message}`).join('; ')}`);
    }
    gates.push({ name: 'canonical-semantic-validation', status: 'pass' });

    failureStage = 'scratch-vm-compile-save';
    const compiled = await compileCanonicalProjectToSb3(canonical);
    const bytes = new Uint8Array(await compiled.arrayBuffer());
    gates.push({ name: 'scratch-vm-compile-save', status: 'pass' });
    if (options.previewPath) {
      failureStage = 'renderer-preview';
      const { captureRendererPreview } = await import('./renderer-preview.js');
      const preview = await captureRendererPreview(bytes, options.previewPath, options.force ?? false);
      gates.push({ name: 'renderer-preview', status: 'pass', details: preview });
    }

    failureStage = 'archive-validation';
    const archiveResult = await validateArchive(bytes);
    const archiveProject = await JSZip.loadAsync(bytes);
    const projectJson = JSON.parse(await archiveProject.file('project.json')!.async('string')) as Record<string, unknown>;
    failureStage = 'project-json-validation';
    const projectResult = validateProjectJson(projectJson);
    failureStage = 'block-graph-validation';
    const graphResult = validateBlockGraph(projectJson);
    if (archiveResult.status !== 'pass') throw new Error(`Archive validation failed: ${archiveResult.errors.join('; ')}`);
    gates.push({ name: 'archive-validation', status: 'pass', details: archiveResult.diagnostics });
    if (projectResult.status !== 'pass') throw new Error(`Project JSON validation failed: ${projectResult.errors.join('; ')}`);
    gates.push({ name: 'project-json-validation', status: 'pass' });
    if (graphResult.status !== 'pass') throw new Error(`Block graph validation failed: ${graphResult.errors.join('; ')}`);
    gates.push({ name: 'block-graph-validation', status: 'pass', details: graphResult.diagnostics });
    failureStage = 'asset-presence-and-md5';
    const assetResult = await assertAssetIntegrity(bytes);
    gates.push({ name: 'asset-presence-and-md5', status: 'pass', details: assetResult });

    const beforeCounts = countProject(projectJson);
    failureStage = 'scratch-vm-load';
    let firstVm: Awaited<ReturnType<typeof loadSb3>> | undefined;
    let secondVm: Awaited<ReturnType<typeof loadSb3>> | undefined;
    try {
      firstVm = await loadSb3(bytes);
      const vmCounts = countProject(getProjectJson(firstVm));
      if (JSON.stringify(vmCounts) !== JSON.stringify(beforeCounts)) {
        throw new Error(`VM load changed project contents (${JSON.stringify(beforeCounts)} -> ${JSON.stringify(vmCounts)})`);
      }
      gates.push({ name: 'scratch-vm-load', status: 'pass', details: { ...vmCounts } });
      failureStage = 'scratch-vm-save';
      const roundTrip = new Uint8Array(await (await saveSb3(firstVm)).arrayBuffer());
      gates.push({ name: 'scratch-vm-save', status: 'pass' });
      failureStage = 'scratch-vm-reload';
      const roundTripAssets = await assertAssetIntegrity(roundTrip);
      secondVm = await loadSb3(roundTrip);
      const afterCounts = countProject(getProjectJson(secondVm));
      if (JSON.stringify(afterCounts) !== JSON.stringify(beforeCounts)) {
        throw new Error(`VM reload changed project contents (${JSON.stringify(beforeCounts)} -> ${JSON.stringify(afterCounts)})`);
      }
      gates.push({ name: 'scratch-vm-reload', status: 'pass', details: { ...afterCounts, ...roundTripAssets } });
    } finally {
      firstVm?.quit();
      secondVm?.quit();
    }

    failureStage = 'atomic-output-write';
    gates.push({ name: 'runtime-behavior', status: 'not-run', message: 'No deterministic gameplay scenario was supplied.' });
    if (!options.previewPath) gates.push({ name: 'renderer-preview', status: 'not-run', message: 'Pass --preview <png> to load the project in the official browser renderer and capture the stage.' });

    outputPath = options.outputFile
      ? path.resolve(options.outputFile)
      : options.outputDir
        ? path.resolve(options.outputDir, `${path.basename(inputPath, path.extname(inputPath))}.sb3`)
        : undefined;
    if (outputPath) {
      failureStage = 'atomic-output-write';
      await writeAtomically(outputPath, bytes, options.force ?? false);
      gates.push({ name: 'atomic-output-write', status: 'pass' });
    }

    const outputHash = createHash('sha256').update(bytes).digest('hex');
    const manifest = createManifestEntry(inputHash, '0.1.0', gates, outputPath, { input: inputPath }) as ManifestEntry;
    manifest.outputHash = `sha256:${outputHash}`;
    const result: GeneratorResult = {
      format: 'scratch-ai-bridge/generation',
      version: 1,
      status: 'success',
      success: true,
      ...(outputPath ? { output: outputPath } : {}),
      manifest,
      gates,
      diagnostics,
    };
    if (options.reportPath) {
      try {
        await writeAtomically(options.reportPath, `${JSON.stringify(result, null, 2)}\n`, true);
      } catch (error) {
        diagnostics.push({ type: 'warning', stage: 'report-write', code: 'REPORT_WRITE_FAILED', message: error instanceof Error ? error.message : String(error), suggestion: 'Choose a writable report path; the validated SB3 result remains successful.' });
      }
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push({ type: 'error', stage: failureStage, code: 'GENERATE_ERROR', message, suggestion: 'Review the stage and JSON path in the diagnostic, then correct the design before retrying.' });
    gates.push({ name: failureStage, status: 'fail', message });
    if (!gates.some(({ name }) => name === 'runtime-behavior')) {
      gates.push({ name: 'runtime-behavior', status: 'not-run', message: 'Generation failed before runtime verification.' });
    }
    if (!gates.some(({ name }) => name === 'renderer-preview')) {
      gates.push({ name: 'renderer-preview', status: 'not-run', message: 'Generation failed before renderer preview.' });
    }
    const manifest = inputHash ? createManifestEntry(inputHash, '0.1.0', gates, undefined, { input: path.resolve(input) }) : undefined;
    const result: GeneratorResult = {
      format: 'scratch-ai-bridge/generation',
      version: 1,
      status: 'failed',
      success: false,
      manifest,
      gates,
      diagnostics,
    };
    if (options.reportPath) {
      try {
        await writeAtomically(options.reportPath, `${JSON.stringify(result, null, 2)}\n`, true);
      } catch (reportError) {
        diagnostics.push({ type: 'warning', stage: 'report-write', code: 'REPORT_WRITE_FAILED', message: reportError instanceof Error ? reportError.message : String(reportError), suggestion: 'Choose a writable report path.' });
      }
    }
    return result;
  }
}
