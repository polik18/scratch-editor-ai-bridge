/**
 * scratch-session: Stateful Scratch project editing session.
 *
 * Maintains an in-memory Scratch project JSON (the same format used by
 * scratch-vm and the official Scratch editor) and provides a high-level API
 * for CLI agents to read, add, modify, and remove Scratch targets and blocks.
 *
 * All mutations are reflected immediately in the in-memory state.
 * Use `compile()` or `saveSb3()` to persist to disk.
 */

import { uid, uidTarget } from './uid.js';

// ─── Local type aliases (avoids importing all scratch/vm internals) ──────────

/** Canonical input reference (used in block inputs). */
export interface CanonicalInputRef {
  block: string;
  shadow: string;
}

// Helper to convert to VM-compatible input format
export function toVmInputRef(ref: CanonicalInputRef): Record<string, string> {
  return { block: ref.block, shadow: ref.shadow };
}

// ─── Session info types ──────────────────────────────────────────────────────

export interface SessionInfo {
  path: string | null;
  isDirty: boolean;
  targetCount: number;
  targets: string[];
  name?: string;
}

export interface TargetSummary {
  name: string;
  isStage: boolean;
  blockCount: number;
  variableCount: number;
  listCount: number;
  broadcastCount: number;
}

export interface InspectResult {
  projectPath: string | null;
  targets: TargetSummary[];
}

// ─── ScratchSession ──────────────────────────────────────────────────────────

export class ScratchSession {
  /**
   * In-memory Scratch project JSON.
   * Using `Record<string, unknown>` to match scratch/vm's ScratchProjectJson type.
   * Structure: { targets: ScratchTarget[], monitors: [], extensions: [], meta: {} }
   */
  private project: Record<string, unknown> | null = null;

  /** Absolute path to the loaded .sb3 (null for unsaved new projects). */
  private projectPath: string | null = null;

  /** True if the in-memory state differs from what's on disk. */
  private dirty = false;

/**
   * ZIP entries from loaded .sb3 (md5ext → JSZipObject). null for new projects.
   * Kept to preserve original assets (costumes, sounds, etc.) during compile.
   */
  private zipEntries: Map<string, { async: (type: string) => Promise<Uint8Array> }> | null = null;

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private targets(): Record<string, unknown>[] {
    const t = (this.project?.['targets'] as Record<string, unknown>[] | undefined) ?? [];
    return t;
  }

  private targetByName(name: string): Record<string, unknown> {
    const t = this.targets().find((t2) => t2['name'] === name);
    if (!t) throw new Error(`Target not found: "${name}". Available: ${this.listTargets().join(', ')}`);
    return t;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Create a new blank project with a Stage and the default empty costume.
   * @param _name Project name (stored in meta, not used for display)
   */
  newProject(_name = 'Untitled'): void {
    const stageId = uidTarget();
    const blankCostumeId = 'cd21514d0531fdffb22204e0ec5ed84a'; // blank costume MD5

    this.project = {
      targets: [
        {
          id: stageId,
          name: 'Stage',
          isStage: true,
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              assetId: blankCostumeId,
              name: 'backdrop1',
              md5ext: `${blankCostumeId}.svg`,
              dataFormat: 'svg',
              rotationCenterX: 240,
              rotationCenterY: 180,
              bitmapResolution: 1,
            },
          ],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 0,
          videoState: 'on',
          textToSpeechLanguage: null,
          visible: true,
          size: 100,
          direction: 90,
          draggable: false,
          rotationStyle: 'normal',
          x: 0,
          y: 0,
        },
      ],
      monitors: [],
      extensions: [],
      meta: {
        semver: '3.0.0',
        vm: '0.2.0',
        agent: 'scratch-session/0.1.0',
        // @ts-ignore - name is a string, TypeScript infers {} for meta
        name: _name,
      },
    };
    this.projectPath = null;
    this.zipEntries = null; // new project, no ZIP entries
    this.dirty = false;
  }

  /**
   * Load an .sb3 file from disk into the session.
   * Extracts project.json directly from the ZIP archive (no VM needed).
   * @param sb3Path Absolute or relative path to .sb3 file
   */
  async loadSb3(sb3Path: string): Promise<void> {
    const [{ resolve }, fs] = await Promise.all([import('node:path'), import('node:fs/promises')]);
    const resolved = resolve(sb3Path);
    const buf = await fs.readFile(resolved);
    const result = await this._loadSb3WithEntries(buf);
    this.project = result.project;
    this.zipEntries = result.zipEntries;
    this.projectPath = resolved;
    this.dirty = false;
  }

  /**
   * Load a Scratch project JSON object directly (for advanced use).
   * @param json Project JSON object
   */
  loadProjectJson(json: Record<string, unknown>): void {
    this.project = json;
    this.projectPath = null;
    this.zipEntries = null;
    this.dirty = false;
  }

  /**
   * Get the raw Scratch project JSON for direct manipulation.
   */
  getProjectJson(): Record<string, unknown> {
    if (!this.project) throw new Error('No project loaded. Use newProject() or loadSb3() first.');
    return this.project;
  }

  /** Serialize the current project and retain all source assets and archive entries. */
  async archive(): Promise<Uint8Array> {
    if (!this.project) throw new Error('No project loaded. Use newProject() or loadSb3() first.');
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(this.project));
    if (this.zipEntries) {
      for (const [name, entry] of this.zipEntries) {
        if (name !== 'project.json') zip.file(name, await entry.async('uint8array'));
      }
    }
    // The built-in blank costume is used by new Stage/sprite targets.
    const blankName = 'cd21514d0531fdffb22204e0ec5ed84a.svg';
    if (!zip.file(blankName) && this.targets().some((target) =>
      Array.isArray(target['costumes']) && target['costumes'].some((costume: { md5ext?: string }) => costume.md5ext === blankName))) {
      zip.file(blankName, '<svg version="1.1" width="2" height="2" viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n  <!-- Exported by Scratch - http://scratch.mit.edu/ -->\n</svg>\n');
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  /** Save a draft without requiring an unfinished block graph to validate. */
  async saveSb3(outputPath?: string): Promise<string> {
    const [{ resolve }, fs] = await Promise.all([import('node:path'), import('node:fs/promises')]);
    const resolved = outputPath ? resolve(outputPath) : this.projectPath;
    if (!resolved) throw new Error('No output path. Pass an explicit output path.');
    await fs.writeFile(resolved, await this.archive());
    this.projectPath = resolved;
    this.dirty = false;
    return resolved;
  }

  // ─── Internal SB3 → project.json + ZIP entries loader ────────────────────

  private async _loadSb3WithEntries(buf: Buffer | Uint8Array): Promise<{ project: Record<string, unknown>; zipEntries: Map<string, { async: (type: string) => Promise<Uint8Array> }> }> {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf instanceof Buffer ? buf : Buffer.from(buf));
    const jsonStr = await zip.file('project.json')?.async('string');
    if (!jsonStr) throw new Error('SB3 archive is missing project.json');

    const project = JSON.parse(jsonStr);
    const zipEntries = new Map<string, { async: (type: string) => Promise<Uint8Array> }>();

    // Extract all ZIP entries (excluding project.json which we just parsed)
    for (const [name, entry] of Object.entries(zip.files)) {
      if (name === 'project.json') continue;
      // Wrap entry to provide the required async interface
      zipEntries.set(name, {
        async: (type: string) => {
          // @ts-ignore - entry.async returns a promise
          return entry.async(type) as Promise<Uint8Array>;
        }
      });
    }

    return { project, zipEntries };
  }

  /**
   * @deprecated Use _loadSb3WithEntries instead. Kept for compatibility.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-expect-error - _loadProjectJsonFromSb3 is kept for backward compatibility but not currently used
  private async _loadProjectJsonFromSb3(buf: Buffer | Uint8Array): Promise<Record<string, unknown>> {
    const result = await this._loadSb3WithEntries(buf);
    return result.project;
  }

  // ─── Project info ─────────────────────────────────────────────────────────

  info(): SessionInfo {
    return {
      path: this.projectPath,
      isDirty: this.dirty,
      targetCount: this.targets().length,
      targets: this.targets().map((t) => t['name'] as string),
    };
  }

  inspect(): InspectResult {
    if (!this.project) throw new Error('No project loaded.');
    return {
      projectPath: this.projectPath,
      targets: this.targets().map((t) => ({
        name: t['name'] as string,
        isStage: Boolean(t['isStage']),
        blockCount: Object.keys(t['blocks'] as Record<string, unknown> ?? {}).length,
        variableCount: Object.keys(t['variables'] as Record<string, unknown> ?? {}).length,
        listCount: Object.keys(t['lists'] as Record<string, unknown> ?? {}).length,
        broadcastCount: Object.keys(t['broadcasts'] as Record<string, unknown> ?? {}).length,
      })),
    };
  }

  // ─── Target operations ────────────────────────────────────────────────────

  /** List all target names, stage first. */
  listTargets(): string[] {
    if (!this.project) throw new Error('No project loaded.');
    return this.targets().map((t) => t['name'] as string);
  }

  // Placeholder — kept for API compat, actual lookup delegated to targetByName

  /**
   * Add a new sprite (non-stage target) to the project.
   *
   * @param name Display name for the sprite
   * @param opts Optional sprite properties
   * @returns The ID of the newly created target
   */
  addSprite(name: string, opts: AddSpriteOptions = {}): string {
    if (!this.project) throw new Error('No project loaded.');
    if (this.targets().some((t) => t['name'] === name)) {
      throw new Error(`A target named "${name}" already exists.`);
    }
    const id = uidTarget();
    const {
      x = 0,
      y = 0,
      direction = 90,
      rotationStyle = 'normal',
      visible = true,
      draggable = false,
      size = 100,
    } = opts;

    const blankCostumeId = 'cd21514d0531fdffb22204e0ec5ed84a';
    const newTarget: Record<string, unknown> = {
      id,
      name,
      isStage: false,
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [
        {
          assetId: blankCostumeId,
          name: `${name} costume1`,
          md5ext: `${blankCostumeId}.svg`,
          dataFormat: 'svg',
          rotationCenterX: 47,
          rotationCenterY: 55,
          bitmapResolution: 1,
        },
      ],
      sounds: [],
      volume: 100,
      layerOrder: this.targets().length,
      tempo: 60,
      videoTransparency: 0,
      videoState: 'on',
      textToSpeechLanguage: null,
      visible,
      size,
      direction,
      draggable,
      rotationStyle,
      x,
      y,
    };

    (this.project['targets'] as Record<string, unknown>[]).push(newTarget);
    this.dirty = true;
    return id;
  }

  /**
   * Remove a sprite (non-stage target) from the project.
   * @param name Target name
   */
  removeSprite(name: string): void {
    if (!this.project) throw new Error('No project loaded.');
    const idx = this.targets().findIndex((t) => t['name'] === name);
    if (idx === -1) throw new Error(`Target not found: "${name}"`);
    if (this.targets()[idx]['isStage']) {
      throw new Error('Cannot remove the Stage target.');
    }
    (this.project['targets'] as Record<string, unknown>[]).splice(idx, 1);
    this.dirty = true;
  }

  /**
   * Rename a target.
   * @param currentName Current name
   * @param newName New name
   */
  renameTarget(currentName: string, newName: string): void {
    if (!this.project) throw new Error('No project loaded.');
    const t = this.targetByName(currentName);
    if (this.targets().some((t2) => t2['name'] === newName && t2 !== t)) {
      throw new Error(`A target named "${newName}" already exists.`);
    }
    t['name'] = newName;
    this.dirty = true;
  }

  // ─── Block operations ─────────────────────────────────────────────────────

  /**
   * Get a block by ID within a target.
   * @param targetName Target name
   * @param blockId Block ID
   */
  getBlock(targetName: string, blockId: string): Record<string, unknown> {
    const t = this.targetByName(targetName);
    const blocks = t['blocks'] as Record<string, Record<string, unknown>> ?? {};
    const b = blocks[blockId];
    if (!b) throw new Error(`Block "${blockId}" not found in target "${targetName}".`);
    return b;
  }

  /**
   * Add a new top-level block to a target.
   *
   * @param targetName Target name
   * @param opcode Scratch block opcode (e.g. 'motion_movesteps', 'looks_say')
   * @param opts Fields and inputs for the block, plus parent/next placement
   * @returns The new block ID
   */
  /**
   * Add a block to a target's block graph.
   * Automatically maintains graph reciprocity (parent/next links).
   * @param targetName Target name
   * @param opcode Block opcode
   * @param opts Block properties
   * @returns Block ID
   */
  addBlock(
    targetName: string,
    opcode: string,
    opts: {
      fields?: Record<string, [string, string | null]>;
      inputs?: Record<string, CanonicalInputRef | { type: 'literal'; value: number | string } | { type: 'variable'; name: string }>;
      parent?: string | null;
      next?: string | null;
      shadow?: boolean;
    } = {},
  ): string {
    const t = this.targetByName(targetName);
    const id = uid();
    const {
      fields = {},
      inputs = {},
      parent = null,
      next = null,
      shadow = false,
    } = opts;

    // Convert inputs to CanonicalInputRef format
    const convertedInputs: Record<string, CanonicalInputRef> = {};
    for (const [inputName, inputValue] of Object.entries(inputs)) {
      if (typeof inputValue === 'object' && inputValue !== null) {
        if ('block' in inputValue && 'shadow' in inputValue) {
          // Already in CanonicalInputRef format
          convertedInputs[inputName] = inputValue as CanonicalInputRef;
        } else if (inputValue.type === 'literal' && 'value' in inputValue) {
          // Literal value - create a reporter block
          const reporterId = uid();
          const shadowId = reporterId + '_shadow';
          const reporterBlock: Record<string, unknown> = {
            id: reporterId,
            opcode: 'math_number',
            fields: { NUM: [String(inputValue.value), null] },
            inputs: {},
            topLevel: true,
            parent: null,
            next: null,
            shadow: false,
          };
          const shadowBlock: Record<string, unknown> = {
            id: shadowId,
            opcode: 'math_number',
            fields: { NUM: [String(inputValue.value), null] },
            inputs: {},
            topLevel: true,
            parent: null,
            next: null,
            shadow: true,
          };
          const blocks = (t['blocks'] as Record<string, Record<string, unknown>>) ?? {};
          blocks[reporterId] = reporterBlock;
          blocks[shadowId] = shadowBlock;
          t['blocks'] = blocks;
          convertedInputs[inputName] = { block: reporterId, shadow: shadowId };
        } else if (inputValue.type === 'variable' && 'name' in inputValue) {
          // Variable - create a variable reporter block
          const varId = this.addVariable(targetName, String(inputValue.name));
          const reporterId = uid();
          const shadowId = reporterId + '_shadow';
          const reporterBlock: Record<string, unknown> = {
            id: reporterId,
            opcode: 'data_variable',
            fields: { VARIABLE: ['variableName', varId] },
            inputs: {},
            topLevel: true,
            parent: null,
            next: null,
            shadow: false,
          };
          const shadowBlock: Record<string, unknown> = {
            id: shadowId,
            opcode: 'data_variable',
            fields: { VARIABLE: ['variableName', varId] },
            inputs: {},
            topLevel: true,
            parent: null,
            next: null,
            shadow: true,
          };
          const blocks = (t['blocks'] as Record<string, Record<string, unknown>>) ?? {};
          blocks[reporterId] = reporterBlock;
          blocks[shadowId] = shadowBlock;
          t['blocks'] = blocks;
          convertedInputs[inputName] = { block: reporterId, shadow: shadowId };
        } else {
          // Unknown format, use as-is (will fail validation)
          convertedInputs[inputName] = inputValue as CanonicalInputRef;
        }
      } else {
        // Not an object, use as-is (will fail validation)
        convertedInputs[inputName] = inputValue as CanonicalInputRef;
      }
    }

    const block: Record<string, unknown> = {
      id,
      opcode,
      fields: { ...fields },
      inputs: { ...convertedInputs },
      topLevel: parent === null,
      parent,
      next,
      shadow,
    };

    const blocks = (t['blocks'] as Record<string, Record<string, unknown>>) ?? {};
    blocks[id] = block;
    t['blocks'] = blocks;

    // Maintain graph reciprocity
    if (parent !== null) {
      const parentBlock = blocks[parent];
      if (!parentBlock) throw new Error(`Parent block "${parent}" not found in "${targetName}".`);

      const existingNext = parentBlock['next'] as string | null;
      if (next !== null && existingNext !== null && next !== existingNext) {
        throw new Error(`Parent block "${parent}" already points to "${existingNext}"; cannot insert before "${next}".`);
      }

      const followingBlockId = next ?? existingNext;
      if (followingBlockId !== null && !blocks[followingBlockId]) {
        throw new Error(`Next block "${followingBlockId}" not found in "${targetName}".`);
      }

      parentBlock['next'] = id;
      block['next'] = followingBlockId;
      if (followingBlockId !== null) blocks[followingBlockId]['parent'] = id;
    } else if (next !== null) {
      throw new Error('A top-level block cannot be inserted into another block sequence.');
    }

    this.dirty = true;
    return id;
  }

  /**
   * Remove a block and all its descendants from a target.
   * Automatically updates adjacent blocks' parent/next pointers.
   * @param targetName Target name
   * @param blockId Block ID to remove
   */
  removeBlock(targetName: string, blockId: string): void {
    const t = this.targetByName(targetName);
    const blocks = t['blocks'] as Record<string, Record<string, unknown>>;
    if (!blocks || !blocks[blockId]) throw new Error(`Block "${blockId}" not found in "${targetName}".`);

    const toRemove = new Set<string>();
    const queue = [blockId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (toRemove.has(current)) continue;
      toRemove.add(current);
      const b = blocks[current];
      if (!b) continue;
      if (b['next']) queue.push(b['next'] as string);
      const inputs = b['inputs'] as Record<string, Record<string, string> | null> ?? {};
      for (const input of Object.values(inputs)) {
        if (input?.['block']) toRemove.add(input['block']);
        if (input?.['shadow']) toRemove.add(input['shadow']);
      }
    }

    // Before removing, update adjacent blocks' pointers
    const blockToRemove = blocks[blockId];
    if (blockToRemove) {
      const prevBlockId = blockToRemove['parent'] as string | null;
      const nextBlockId = blockToRemove['next'] as string | null;

      // Update previous block's next pointer
      if (prevBlockId !== null && blocks[prevBlockId]) {
        const prevBlock = blocks[prevBlockId];
        // If the previous block's next is this block, update it to this block's next
        if (prevBlock['next'] === blockId) {
          prevBlock['next'] = nextBlockId;
        }
      }

      // Update next block's parent pointer
      if (nextBlockId !== null && blocks[nextBlockId]) {
        const nextBlock = blocks[nextBlockId];
        // If the next block's parent is this block, update it to this block's parent
        if (nextBlock['parent'] === blockId) {
          nextBlock['parent'] = blockToRemove['parent'] as string | null;
        }
      }
    }

    // Remove the blocks
    for (const id of toRemove) {
      delete blocks[id];
    }
    this.dirty = true;
  }

  /**
   * Edit fields, inputs, parent, or next of an existing block.
   * @param targetName Target name
   * @param blockId Block ID
   * @param patch Fields/inputs/parent/next changes
   */
  editBlock(
    targetName: string,
    blockId: string,
    patch: {
      fields?: Record<string, [string, string | null] | null>;
      inputs?: Record<string, CanonicalInputRef | null>;
      parent?: string | null;
      next?: string | null;
      shadow?: boolean;
    },
  ): void {
    const t = this.targetByName(targetName);
    const blocks = t['blocks'] as Record<string, Record<string, unknown>>;
    const b = blocks[blockId];
    if (!b) throw new Error(`Block "${blockId}" not found in "${targetName}".`);

    if (patch.fields !== undefined) {
      if (patch.fields === null) {
        b['fields'] = {};
      } else {
        const existingFields = (b['fields'] as Record<string, [string, string | null]>) ?? {};
        for (const [key, val] of Object.entries(patch.fields)) {
          if (val === null) {
            delete existingFields[key];
          } else {
            existingFields[key] = val;
          }
        }
        b['fields'] = existingFields;
      }
    }

    if (patch.inputs !== undefined) {
      if (patch.inputs === null) {
        b['inputs'] = {};
      } else {
        const existingInputs = (b['inputs'] as Record<string, Record<string, string>>) ?? {};
        for (const [key, val] of Object.entries(patch.inputs)) {
          if (val === null) {
            delete existingInputs[key];
          } else {
            // Convert CanonicalInputRef to VM-compatible format
            existingInputs[key] = toVmInputRef(val);
          }
        }
        b['inputs'] = existingInputs;
      }
    }

    if (patch.parent !== undefined) b['parent'] = patch.parent;
    if (patch.next !== undefined) b['next'] = patch.next;
    if (patch.shadow !== undefined) b['shadow'] = patch.shadow;

    // Recalculate topLevel
    b['topLevel'] = b['parent'] === null;
    this.dirty = true;
  }

  // ─── Variable / List / Broadcast ─────────────────────────────────────────

  /**
   * Create a variable on a target.
   * @param targetName Target name
   * @param name Variable display name
   * @param value Initial value (default: 0)
   */
  addVariable(targetName: string, name: string, value: number | string = 0): string {
    const t = this.targetByName(targetName);
    const vars = (t['variables'] as Record<string, [string, number | string]> | undefined) ?? {};
    if (vars[name]) throw new Error(`Variable "${name}" already exists on "${targetName}".`);
    const id = uid();
    vars[name] = [id, value];
    t['variables'] = vars;
    this.dirty = true;
    return id;
  }

  /**
   * Create a list on a target.
   * @param targetName Target name
   * @param name List display name
   * @param initialValues Initial list contents
   */
  addList(targetName: string, name: string, initialValues: (number | string)[] = []): string {
    const t = this.targetByName(targetName);
    const lists = (t['lists'] as Record<string, [string, (number | string)[]]> | undefined) ?? {};
    if (lists[name]) throw new Error(`List "${name}" already exists on "${targetName}".`);
    const id = uid();
    lists[name] = [id, initialValues];
    t['lists'] = lists;
    this.dirty = true;
    return id;
  }

  // ─── Compile ─────────────────────────────────────────────────────────────

  /** Validate the same archive bytes that will be written, including a Scratch VM load. */
  async compile(): Promise<Uint8Array> {
    const archive = await this.archive();
    const { verifyEndToEnd, generateVerificationReport } = await import('../verification.js');
    const result = await verifyEndToEnd(archive);
    if (result.status === 'fail') throw new Error(`Project validation failed:\n${generateVerificationReport(result)}`);
    const { loadSb3 } = await import('../../scratch/vm.js');
    let vm: Awaited<ReturnType<typeof loadSb3>> | undefined;
    try {
      vm = await loadSb3(archive);
    } catch (error) {
      throw new Error(`Scratch VM could not load the project: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      vm?.quit();
    }
    return archive;
  }

  /**
   * Plan a patch operation without applying it.
   * @param patch The patch to plan
   * @returns Planning result
   */
  plan(patch: Record<string, unknown>): Record<string, unknown> {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return { status: 'invalid', message: 'Patch must be a JSON object.' };
    }
    return {
      status: 'unsupported',
      message: 'Patch planning and operation validation are not implemented; no changes were made.',
    };
  }

  /**
   * Apply a patch and save to new SB3 file.
   * @param patch The patch to apply
   * @param outputPath Output SB3 path
   * @returns Apply result
   */
  async apply(patch: Record<string, unknown>, _outputPath: string): Promise<Record<string, unknown>> {
    const planResult = this.plan(patch);
    throw new Error(String(planResult['message'] ?? 'Patch application is not implemented.'));
  }

  /**
   * Undo the last operation.
   * @returns Undo result
   */
  undo(): Record<string, unknown> {
    return {
      status: 'unsupported',
      message: 'Undo history is not implemented; no changes were made.',
    };
  }

  /**
   * Show differences from original project.
   * @returns Diff result
   */
  diff(): Record<string, unknown> {
    return {
      status: 'unsupported',
      message: 'Project diff is not implemented; no comparison was performed.',
    };
  }

  // ─── Hat wiring ──────────────────────────────────────────────────────────

  /**
   * Wire a block as the body of an event hat (e.g. greenFlag hat).
   * The hat must already exist; this sets the hat's `next` to point to the body.
   *
   * @param targetName Target name
   * @param hatOpcode Opcode of the hat block (e.g. 'event_whenflagclicked')
   * @param bodyBlockId ID of the block to attach as the hat's body
   */
  attachBlockToHat(targetName: string, hatOpcode: string, bodyBlockId: string): void {
    const t = this.targetByName(targetName);
    const blocks = t['blocks'] as Record<string, Record<string, unknown>>;
    const hatBlock = Object.values(blocks).find(
      (b) => b['opcode'] === hatOpcode && b['topLevel'] === true,
    );
    if (!hatBlock) throw new Error(`No top-level hat block with opcode "${hatOpcode}" found in "${targetName}".`);
    const bodyBlock = blocks[bodyBlockId];
    if (!bodyBlock) throw new Error(`Body block "${bodyBlockId}" not found in "${targetName}".`);
    if (hatBlock['next'] !== null && hatBlock['next'] !== undefined && hatBlock['next'] !== bodyBlockId) {
      throw new Error(`Hat block "${hatOpcode}" already has a body in "${targetName}".`);
    }
    hatBlock['next'] = bodyBlockId;
    bodyBlock['parent'] = hatBlock['id'];
    bodyBlock['topLevel'] = false;
    this.dirty = true;
  }
}

// ─── Options type ────────────────────────────────────────────────────────────

export interface AddSpriteOptions {
  x?: number;
  y?: number;
  direction?: number;
  rotationStyle?: 'normal' | 'left-right' | "don't rotate";
  visible?: boolean;
  draggable?: boolean;
  size?: number;
}
