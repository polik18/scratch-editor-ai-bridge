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

import * as fs from 'node:fs';
import * as path from 'node:path';
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

  /** ZIP entries from loaded .sb3 (md5ext → JSZipObject). null for new projects. */
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
    const resolved = path.resolve(sb3Path);
    const buf = await fs.promises.readFile(resolved);
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

  /**
   /** Save the current project to an .sb3 file using jszip. */
   async saveSb3(outputPath?: string): Promise<string> {
     if (!this.project) throw new Error('No project loaded. Use newProject() or loadSb3() first.');
     const resolved = outputPath ? path.resolve(outputPath) : this.projectPath;
     if (!resolved) throw new Error('No output path. Pass an explicit output path.');

     const { default: JSZip } = await import('jszip');
     const zip = new JSZip();

     // Add project.json (UTF-8 bytes)
     const projectJson = JSON.stringify(this.project);
     zip.file('project.json', new TextEncoder().encode(projectJson));

     // Retain original ZIP entries (costumes, sounds, etc.)
     if (this.zipEntries) {
       for (const [name, entry] of this.zipEntries) {
         // Skip project.json — we just overwrote it
         if (name === 'project.json') continue;
         // Re-add entry preserving its original content
         const c = await (entry as any).async('uint8array');
         zip.file(name, c);
       }
     }

     const blob = await zip.generateAsync({
       type: 'blob',
       compression: 'DEFLATE',
       compressionOptions: { level: 6 },
     });
     const buf = new Uint8Array(await blob.arrayBuffer());
     await fs.promises.writeFile(resolved, buf);
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
      zipEntries.set(name, entry);
    }

    return { project, zipEntries };
  }

  /**
   * @deprecated Use _loadSb3WithEntries instead. Kept for compatibility.
   */
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
      blocks: {
        // Placeholder procedure definition so the sprite isn't empty
        [id]: {
          id,
          opcode: 'procedures_defnoreturn',
          next: null,
          parent: null,
          topLevel: true,
          shadow: false,
          fields: {},
          inputs: {},
          mutation: {
            tagName: 'mutation',
            children: '[]',
            attributes: JSON.stringify({ argumentids: '[]', argumentnames: '[]', warp: 'false' }),
          },
        },
      },
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
  addBlock(
    targetName: string,
    opcode: string,
    opts: {
      fields?: Record<string, [string, string | null]>;
      inputs?: Record<string, CanonicalInputRef>;
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

    const block: Record<string, unknown> = {
      id,
      opcode,
      fields: { ...fields },
      inputs: { ...inputs },
      topLevel: parent === null,
      parent,
      next,
      shadow,
    };

    const blocks = (t['blocks'] as Record<string, Record<string, unknown>>) ?? {};
    blocks[id] = block;
    t['blocks'] = blocks;
    this.dirty = true;
    return id;
  }

  /**
   * Remove a block and all its descendants from a target.
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

  /**
   /** Compile the current Scratch project JSON to SB3 bytes. */
   async compile(): Promise<Uint8Array> {
     if (!this.project) throw new Error('No project loaded.');
     const { default: JSZip } = await import('jszip');
     const zip = new JSZip();

     // Add project.json (UTF-8 bytes)
     const projectJson = JSON.stringify(this.project);
     zip.file('project.json', new TextEncoder().encode(projectJson));

     // Generate async blob then convert to Uint8Array
     const blob = await zip.generateAsync({
       type: 'blob',
       compression: 'DEFLATE',
       compressionOptions: { level: 6 },
     });
     return new Uint8Array(await blob.arrayBuffer());
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
    hatBlock['next'] = bodyBlockId;
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
