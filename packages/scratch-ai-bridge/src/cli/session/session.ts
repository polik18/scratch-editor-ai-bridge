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
import { uid, uidTarget } from './uid.js'

const legacyBlankSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="none"/></svg>'
const blankSvg = legacyBlankSvg.replace('height="100">', 'height="100" viewBox="0 0 100 100">')

// ─── Local type aliases (avoids importing all scratch/vm internals) ──────────

/** Canonical input reference (used in block inputs). */
export interface CanonicalInputRef {
  block: string
  shadow: string
}

// Helper to convert to VM-compatible input format
export function toVmInputRef(ref: CanonicalInputRef): (number | string)[] {
  return ref.block === ref.shadow ? [1, ref.block] : ref.shadow ? [3, ref.block, ref.shadow] : [2, ref.block]
}

// ─── Session info types ──────────────────────────────────────────────────────

export interface SessionInfo {
  path: string | null
  isDirty: boolean
  targetCount: number
  targets: string[]
  name?: string
}

export interface TargetSummary {
  name: string
  isStage: boolean
  blockCount: number
  variableCount: number
  listCount: number
  broadcastCount: number
}

export interface InspectResult {
  projectPath: string | null
  targets: TargetSummary[]
}

// ─── ScratchSession ──────────────────────────────────────────────────────────

export class ScratchSession {
  /**
   * In-memory Scratch project JSON.
   * Using `Record<string, unknown>` to match scratch/vm's ScratchProjectJson type.
   * Structure: { targets: ScratchTarget[], monitors: [], extensions: [], meta: {} }
   */
  private project: Record<string, unknown> | null = null

  /** Absolute path to the loaded .sb3 (null for unsaved new projects). */
  private projectPath: string | null = null

  /** True if the in-memory state differs from what's on disk. */
  private dirty = false

  /**
   * ZIP entries from loaded .sb3 (md5ext → JSZipObject). null for new projects.
   * Kept to preserve original assets (costumes, sounds, etc.) during compile.
   */
  private zipEntries: Map<string, { async: (type: string) => Promise<Uint8Array> }> | null = null

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private targets(): Record<string, unknown>[] {
    const t = (this.project?.targets as Record<string, unknown>[] | undefined) ?? []
    return t
  }

  private targetByName(name: string): Record<string, unknown> {
    const t = this.targets().find((t2) => t2.name === name)
    if (!t) throw new Error(`Target not found: "${name}". Available: ${this.listTargets().join(', ')}`)
    return t
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Create a new blank project with a Stage and the default empty costume.
   * @param _name Project name (stored in meta, not used for display)
   */
  newProject(_name = 'Untitled'): void {
    const stageId = uidTarget()
    const blankCostumeId = 'cd21514d0531fdffb22204e0ec5ed84a' // blank costume MD5

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
          rotationStyle: 'all around',
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
        name: _name,
      },
    }
    this.projectPath = null
    this.zipEntries = null // new project, no ZIP entries
    this.dirty = false
  }

  /**
   * Load an .sb3 file from disk into the session.
   * Extracts project.json directly from the ZIP archive (no VM needed).
   * @param sb3Path Absolute or relative path to .sb3 file
   */
  async loadSb3(sb3Path: string): Promise<void> {
    const [{ resolve }, fs] = await Promise.all([import('node:path'), import('node:fs/promises')])
    const resolved = resolve(sb3Path)
    const buf = await fs.readFile(resolved)
    const result = await this._loadSb3WithEntries(buf)
    this.project = result.project
    this.zipEntries = result.zipEntries
    this.projectPath = resolved
    this.dirty = false
  }

  /**
   * Load a Scratch project JSON object directly (for advanced use).
   * @param json Project JSON object
   */
  loadProjectJson(json: Record<string, unknown>): void {
    this.project = json
    this.projectPath = null
    this.zipEntries = null
    this.dirty = false
  }

  /**
   * Get the raw Scratch project JSON for direct manipulation.
   * @returns Raw Scratch project JSON data object.
   */
  getProjectJson(): Record<string, unknown> {
    if (!this.project) throw new Error('No project loaded. Use newProject() or loadSb3() first.')
    return this.project
  }

  /**
   * Serialize the current project and retain all source assets and archive entries.
   * @returns Serialized zip archive bytes as Uint8Array.
   */
  async archive(): Promise<Uint8Array> {
    if (!this.project) throw new Error('No project loaded. Use newProject() or loadSb3() first.')
    const { default: JSZip } = await import('jszip')
    const { createHash } = await import('node:crypto')
    const zip = new JSZip()
    const project = structuredClone(this.project)
    if (this.zipEntries) {
      for (const [name, entry] of this.zipEntries) {
        if (name !== 'project.json') zip.file(name, await entry.async('uint8array'))
      }
    }
    for (const [targetIndex, target] of ((project.targets ?? []) as Record<string, unknown>[]).entries()) {
      for (const kind of ['costumes', 'sounds'] as const) {
        for (const [index, asset] of ((target[kind] ?? []) as Record<string, unknown>[]).entries()) {
          if (asset.data === undefined) continue
          const data = asset.data
          const format = asset.dataFormat
          const match = typeof data === 'string' ? /^data:[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(data) : null
          if (!match?.[1] || match[1].length % 4 !== 0 || typeof format !== 'string' || !/^[a-z0-9]+$/.test(format)) {
            throw new Error(`Invalid embedded asset at /targets/${targetIndex}/${kind}/${index}`)
          }
          let bytes = Buffer.from(match[1], 'base64')
          if (format === 'svg' && bytes.toString('utf8') === legacyBlankSvg) bytes = Buffer.from(blankSvg)
          const assetId = createHash('md5').update(bytes).digest('hex')
          const md5ext = `${assetId}.${format}`
          zip.file(md5ext, bytes)
          asset.assetId = assetId
          asset.md5ext = md5ext
          delete asset.data
        }
      }
    }
    // The built-in blank costume is used by new Stage/sprite targets.
    const blankName = 'cd21514d0531fdffb22204e0ec5ed84a.svg'
    if (
      !zip.file(blankName) &&
      this.targets().some(
        (target) =>
          Array.isArray(target.costumes) &&
          target.costumes.some((costume: { md5ext?: string }) => costume.md5ext === blankName),
      )
    ) {
      const blankData =
        '<svg version="1.1" width="2" height="2" viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n  <!-- Exported by Scratch - http://scratch.mit.edu/ -->\n</svg>\n'
      const assetId = createHash('md5').update(blankData).digest('hex')
      const md5ext = `${assetId}.svg`
      zip.file(md5ext, blankData)
      for (const target of project.targets as Record<string, unknown>[]) {
        for (const costume of (target.costumes ?? []) as Record<string, unknown>[]) {
          if (costume.md5ext === blankName) {
            costume.assetId = assetId
            costume.md5ext = md5ext
          }
        }
      }
    }
    zip.file('project.json', JSON.stringify(project))
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  }

  /**
   * Save a draft without requiring an unfinished block graph to validate.
   * @param outputPath - Optional destination file path on disk.
   * @returns Resolved file path where the SB3 archive was saved.
   */
  async saveSb3(outputPath?: string): Promise<string> {
    const [{ resolve }, fs] = await Promise.all([import('node:path'), import('node:fs/promises')])
    const resolved = outputPath ? resolve(outputPath) : this.projectPath
    if (!resolved) throw new Error('No output path. Pass an explicit output path.')
    await fs.writeFile(resolved, await this.archive())
    this.projectPath = resolved
    this.dirty = false
    return resolved
  }

  // ─── Internal SB3 → project.json + ZIP entries loader ────────────────────

  private async _loadSb3WithEntries(buf: Buffer | Uint8Array): Promise<{
    project: Record<string, unknown>
    zipEntries: Map<string, { async: (type: string) => Promise<Uint8Array> }>
  }> {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(buf instanceof Buffer ? buf : Buffer.from(buf))
    const jsonStr = await zip.file('project.json')?.async('string')
    if (!jsonStr) throw new Error('SB3 archive is missing project.json')

    const project = JSON.parse(jsonStr) as Record<string, unknown>
    const zipEntries = new Map<string, { async: (type: string) => Promise<Uint8Array> }>()

    // Extract all ZIP entries (excluding project.json which we just parsed)
    for (const [name, entry] of Object.entries(zip.files)) {
      if (name === 'project.json') continue
      // Wrap entry to provide the required async interface
      zipEntries.set(name, {
        async: (type: string) =>
          // @ts-expect-error - entry.async returns a promise
          entry.async(type) as Promise<Uint8Array>,
      })
    }

    return { project, zipEntries }
  }

  /**
   * @param buf
   * @deprecated Use _loadSb3WithEntries instead. Kept for compatibility.
   */

  // @ts-expect-error - _loadProjectJsonFromSb3 is kept for backward compatibility but not currently used
  private async _loadProjectJsonFromSb3(buf: Buffer | Uint8Array): Promise<Record<string, unknown>> {
    const result = await this._loadSb3WithEntries(buf)
    return result.project
  }

  // ─── Project info ─────────────────────────────────────────────────────────

  info(): SessionInfo {
    return {
      path: this.projectPath,
      isDirty: this.dirty,
      targetCount: this.targets().length,
      targets: this.targets().map((t) => t.name as string),
    }
  }

  inspect(): InspectResult {
    if (!this.project) throw new Error('No project loaded.')
    return {
      projectPath: this.projectPath,
      targets: this.targets().map((t) => ({
        name: t.name as string,
        isStage: Boolean(t.isStage),
        blockCount: t.blocks ? Object.keys(t.blocks as Record<string, unknown>).length : 0,
        variableCount: t.variables ? Object.keys(t.variables as Record<string, unknown>).length : 0,
        listCount: t.lists ? Object.keys(t.lists as Record<string, unknown>).length : 0,
        broadcastCount: t.broadcasts ? Object.keys(t.broadcasts as Record<string, unknown>).length : 0,
      })),
    }
  }

  // ─── Target operations ────────────────────────────────────────────────────

  /**
   * List all target names, stage first.
   * @returns Array of target names.
   */
  listTargets(): string[] {
    if (!this.project) throw new Error('No project loaded.')
    return this.targets().map((t) => t.name as string)
  }

  // Placeholder — kept for API compat, actual lookup delegated to targetByName

  /**
   * Add a new sprite (non-stage target) to the project.
   * @param name Display name for the sprite
   * @param opts Optional sprite properties
   * @returns The ID of the newly created target
   */
  addSprite(name: string, opts: AddSpriteOptions = {}): string {
    if (!this.project) throw new Error('No project loaded.')
    if (this.targets().some((t) => t.name === name)) {
      throw new Error(`A target named "${name}" already exists.`)
    }
    const id = uidTarget()
    const {
      x = 0,
      y = 0,
      direction = 90,
      rotationStyle = 'all around',
      visible = true,
      draggable = false,
      size = 100,
    } = opts
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
          name: `${name} costume1`,
          dataFormat: 'svg',
          data: `data:image/svg+xml;base64,${Buffer.from(blankSvg).toString('base64')}`,
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
    }

    ;(this.project.targets as Record<string, unknown>[]).push(newTarget)
    this.dirty = true
    return id
  }

  /**
   * Remove a sprite (non-stage target) from the project.
   * @param name Target name
   */
  removeSprite(name: string): void {
    if (!this.project) throw new Error('No project loaded.')
    const idx = this.targets().findIndex((t) => t.name === name)
    if (idx === -1) throw new Error(`Target not found: "${name}"`)
    if (this.targets()[idx].isStage) {
      throw new Error('Cannot remove the Stage target.')
    }
    ;(this.project.targets as Record<string, unknown>[]).splice(idx, 1)
    this.dirty = true
  }

  /**
   * Rename a target.
   * @param currentName - Existing target name.
   * @param newName - Replacement identifier to assign.
   */
  renameTarget(currentName: string, newName: string): void {
    if (!this.project) throw new Error('No project loaded.')
    const t = this.targetByName(currentName)
    if (this.targets().some((t2) => t2.name === newName && t2 !== t)) {
      throw new Error(`A target named "${newName}" already exists.`)
    }
    t.name = newName
    this.dirty = true
  }

  // ─── Block operations ─────────────────────────────────────────────────────

  /**
   * Get a block by ID within a target.
   * @param targetName - Target sprite or stage name.
   * @param blockId - Block identifier.
   * @returns The block data object.
   */
  getBlock(targetName: string, blockId: string): Record<string, unknown> {
    const t = this.targetByName(targetName)
    const blocks = ((t.blocks as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >
    const b = blocks[blockId]
    if (!b) throw new Error(`Block "${blockId}" not found in target "${targetName}".`)
    return b
  }

  /**
   * Add a block to a target's block graph.
   * Automatically maintains graph reciprocity (parent/next links).
   * @param targetName - Target sprite or stage name.
   * @param opcode - Scratch block opcode to instantiate.
   * @param opts - Block properties and attachments.
   * @param opts.fields - Initial block fields.
   * @param opts.inputs - Initial block inputs.
   * @param opts.parent - Parent block ID.
   * @param opts.next - Next block ID.
   * @param opts.shadow - Whether block is a shadow.
   * @returns Newly generated block ID.
   */
  addBlock(
    targetName: string,
    opcode: string,
    opts: {
      fields?: Record<string, [string, string | null]>
      inputs?: Record<
        string,
        CanonicalInputRef | { type: 'literal'; value: number | string } | { type: 'variable'; name: string }
      >
      parent?: string | null
      next?: string | null
      shadow?: boolean
    } = {},
  ): string {
    const t = this.targetByName(targetName)
    const id = uid()
    const { fields = {}, inputs = {}, parent = null, next = null, shadow = false } = opts

    // Scratch project.json stores input descriptors as arrays, not VM objects.
    const convertedInputs: Record<string, unknown> = {}
    for (const [inputName, inputValue] of Object.entries(inputs)) {
      if ('block' in inputValue && 'shadow' in inputValue) {
        convertedInputs[inputName] = toVmInputRef(inputValue)
      } else if (inputValue.type === 'literal') {
        const value = inputValue.value
        convertedInputs[inputName] = [1, [typeof value === 'number' ? 4 : 10, String(value)]]
      } else {
        const varId = this.addVariable(targetName, inputValue.name)
        convertedInputs[inputName] = [3, [12, inputValue.name, varId], [10, '']]
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
    }

    const blocks = ((t.blocks as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >
    blocks[id] = block
    t.blocks = blocks

    // Maintain graph reciprocity
    if (parent !== null) {
      const parentBlock = blocks[parent]
      if (!parentBlock) throw new Error(`Parent block "${parent}" not found in "${targetName}".`)

      const existingNext = parentBlock.next as string | null
      if (next !== null && existingNext !== null && next !== existingNext) {
        throw new Error(
          `Parent block "${parent}" already points to "${existingNext}"; cannot insert before "${next}".`,
        )
      }

      const followingBlockId = next ?? existingNext
      if (followingBlockId !== null) {
        const followingBlock = blocks[followingBlockId]
        if (!followingBlock) throw new Error(`Next block "${followingBlockId}" not found in "${targetName}".`)
        followingBlock.parent = id
      }

      parentBlock.next = id
      block.next = followingBlockId
    } else if (next !== null) {
      throw new Error('A top-level block cannot be inserted into another block sequence.')
    }

    this.dirty = true
    return id
  }

  /**
   * Remove a block and all its descendants from a target.
   * Automatically updates adjacent blocks' parent/next pointers.
   * @param targetName - Target sprite or stage name.
   * @param blockId - Block ID to remove.
   */
  removeBlock(targetName: string, blockId: string): void {
    const t = this.targetByName(targetName)
    const blocks = ((t.blocks as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >
    const targetBlock = blocks[blockId]
    if (!targetBlock) throw new Error(`Block "${blockId}" not found in "${targetName}".`)

    const toRemove = new Set<string>()
    const queue = [blockId]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current || toRemove.has(current)) continue
      toRemove.add(current)
      const b = blocks[current]
      if (!b) continue
      if (b.next) queue.push(b.next as string)
      const inputs = (b.inputs as Record<string, unknown> | undefined) ?? {}
      for (const input of Object.values(inputs)) {
        if (Array.isArray(input)) {
          for (const ref of input.slice(1)) {
            if (typeof ref === 'string' && blocks[ref] !== undefined) queue.push(ref)
          }
        } else if (input && typeof input === 'object') {
          const refs = input as { block?: unknown; shadow?: unknown }
          for (const ref of [refs.block, refs.shadow]) {
            if (typeof ref === 'string' && blocks[ref] !== undefined) queue.push(ref)
          }
        }
      }
    }

    // Before removing, update adjacent blocks' pointers
    const prevBlockId = targetBlock.parent as string | null
    if (prevBlockId !== null) {
      const prevBlock = blocks[prevBlockId]
      if (prevBlock) {
        if (prevBlock.next === blockId) prevBlock.next = null
        const inputs = (prevBlock.inputs ?? {}) as Record<string, unknown>
        for (const [name, input] of Object.entries(inputs)) {
          if (Array.isArray(input) && input.slice(1).includes(blockId)) delete inputs[name]
        }
      }
    }

    // Remove the blocks
    for (const id of toRemove) {
      delete blocks[id]
    }
    this.dirty = true
  }

  /**
   * Edit fields, inputs, parent, or next of an existing block.
   * @param targetName - Target sprite or stage name.
   * @param blockId - Block ID to edit.
   * @param patch - Fields, inputs, parent or next updates.
   * @param patch.fields - Updated field values or null to clear.
   * @param patch.inputs - Updated input references or null to clear.
   * @param patch.parent - New parent block ID.
   * @param patch.next - New next block ID.
   * @param patch.shadow - Whether block is a shadow.
   */
  editBlock(
    targetName: string,
    blockId: string,
    patch: {
      fields?: Record<string, [string, string | null] | null> | null
      inputs?: Record<string, CanonicalInputRef | null> | null
      parent?: string | null
      next?: string | null
      shadow?: boolean
    },
  ): void {
    const t = this.targetByName(targetName)
    const blocks = ((t.blocks as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >
    const b = blocks[blockId]
    if (!b) throw new Error(`Block "${blockId}" not found in "${targetName}".`)

    if (patch.fields !== undefined) {
      if (patch.fields === null) {
        b.fields = {}
      } else {
        const existingFields = (b.fields as Record<string, [string, string | null]> | undefined) ?? {}
        for (const [key, val] of Object.entries(patch.fields)) {
          if (val === null) {
            delete existingFields[key]
          } else {
            existingFields[key] = val
          }
        }
        b.fields = existingFields
      }
    }

    if (patch.inputs !== undefined) {
      if (patch.inputs === null) {
        b.inputs = {}
      } else {
        const existingInputs = (b.inputs as Record<string, unknown> | undefined) ?? {}
        for (const [key, val] of Object.entries(patch.inputs)) {
          if (val === null) {
            delete existingInputs[key]
          } else {
            // Convert CanonicalInputRef to VM-compatible format
            existingInputs[key] = toVmInputRef(val)
          }
        }
        b.inputs = existingInputs
      }
    }

    if (patch.parent !== undefined) b.parent = patch.parent
    if (patch.next !== undefined) b.next = patch.next
    if (patch.shadow !== undefined) b.shadow = patch.shadow

    // Recalculate topLevel
    b.topLevel = b.parent === null
    this.dirty = true
  }

  // ─── Variable / List / Broadcast ─────────────────────────────────────────

  /**
   * Attach a detached reporter or stack to an input in the same target.
   * @param targetName - Target sprite or stage name.
   * @param ownerId - Block ID that receives the input.
   * @param inputName - Name of the input slot.
   * @param childId - Block ID to attach into the input slot.
   */
  connectInput(targetName: string, ownerId: string, inputName: string, childId: string): void {
    const target = this.targetByName(targetName)
    const blocks = ((target.blocks as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >
    const owner = blocks[ownerId]
    const child = blocks[childId]
    if (!owner || !child) throw new Error(`Input connection requires existing blocks on "${targetName}".`)
    if (!inputName || ownerId === childId || child.parent !== null || child.topLevel !== true) {
      throw new Error('Input child must be a detached top-level block distinct from its owner.')
    }
    let ancestor: Record<string, unknown> | undefined = owner
    const seen = new Set<string>()
    while (ancestor) {
      const parent: unknown = ancestor.parent
      if (typeof parent !== 'string') break
      if (parent === childId || seen.has(parent)) throw new Error('Input connection would create a block cycle.')
      seen.add(parent)
      ancestor = blocks[parent]
    }
    const inputs = owner.inputs as Record<string, unknown>
    if (inputs[inputName] !== undefined) throw new Error(`Input "${inputName}" is already connected.`)
    inputs[inputName] = [2, childId]
    child.parent = ownerId
    child.topLevel = false
    this.dirty = true
  }

  /**
   * Create a variable on a target.
   * @param targetName - Target sprite or stage name.
   * @param name - Variable display name.
   * @param value - Initial value (default: 0).
   * @returns Generated variable identifier.
   */
  addVariable(targetName: string, name: string, value: number | string = 0): string {
    const t = this.targetByName(targetName)
    const vars = (t.variables as Record<string, [string, number | string]> | undefined) ?? {}
    if (Object.values(vars).some(([existingName]) => existingName === name))
      throw new Error(`Variable "${name}" already exists on "${targetName}".`)
    const id = uid()
    vars[id] = [name, value]
    t.variables = vars
    this.dirty = true
    return id
  }

  /**
   * Create a list on a target.
   * @param targetName - Target sprite or stage name.
   * @param name - List display name.
   * @param initialValues - Initial list contents.
   * @returns Generated list identifier.
   */
  addList(targetName: string, name: string, initialValues: (number | string)[] = []): string {
    const t = this.targetByName(targetName)
    const lists = (t.lists as Record<string, [string, (number | string)[]]> | undefined) ?? {}
    if (Object.prototype.hasOwnProperty.call(lists, name))
      throw new Error(`List "${name}" already exists on "${targetName}".`)
    const id = uid()
    lists[name] = [id, initialValues]
    t.lists = lists
    this.dirty = true
    return id
  }

  // ─── Compile ─────────────────────────────────────────────────────────────

  /**
   * Validate the same archive bytes that will be written, including a Scratch VM load.
   * @returns Compiled archive bytes as Uint8Array.
   */
  async compile(): Promise<Uint8Array> {
    const archive = await this.archive()
    const { verifyEndToEnd, generateVerificationReport } = await import('../verification.js')
    const result = await verifyEndToEnd(archive)
    if (result.status === 'fail') throw new Error(`Project validation failed:\n${generateVerificationReport(result)}`)
    const { loadSb3 } = await import('../../scratch/vm.js')
    let vm: Awaited<ReturnType<typeof loadSb3>> | undefined
    try {
      vm = await loadSb3(archive)
    } catch (error) {
      throw new Error(
        `Scratch VM could not load the project: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      vm?.quit()
    }
    return archive
  }

  /**
   * Plan a patch operation without applying it.
   * @param patch - The patch to plan.
   * @returns Planning result structure.
   */
  plan(patch: unknown): Record<string, unknown> {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return { status: 'invalid', message: 'Patch must be a JSON object.' }
    }
    return {
      status: 'unsupported',
      message: 'Patch planning and operation validation are not implemented; no changes were made.',
    }
  }

  /**
   * Apply a patch and save to new SB3 file.
   * @param patch - The patch to apply.
   * @param _outputPath - Output SB3 path.
   * @returns Apply result.
   */
  async apply(patch: unknown, _outputPath: string): Promise<Record<string, unknown>> {
    await Promise.resolve()
    const planResult = this.plan(patch)
    const message =
      typeof planResult.message === 'string' ? planResult.message : 'Patch application is not implemented.'
    throw new Error(message)
  }

  /**
   * Undo the last operation.
   * @returns Undo result object.
   */
  undo(): Record<string, unknown> {
    return {
      status: 'unsupported',
      message: 'Undo history is not implemented; no changes were made.',
    }
  }

  /**
   * Show differences from original project.
   * @returns Diff result object.
   */
  diff(): Record<string, unknown> {
    return {
      status: 'unsupported',
      message: 'Project diff is not implemented; no comparison was performed.',
    }
  }

  // ─── Hat wiring ──────────────────────────────────────────────────────────

  /**
   * Wire a block as the body of an event hat (e.g. greenFlag hat).
   * @param targetName - Target sprite or stage name.
   * @param hatOpcode - Event hat block opcode to search for.
   * @param bodyBlockId - ID of the block to attach as the hat body.
   */
  attachBlockToHat(targetName: string, hatOpcode: string, bodyBlockId: string): void {
    const t = this.targetByName(targetName)
    const blocks = ((t.blocks as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >
    const hatBlock = Object.values(blocks).find((b) => b?.opcode === hatOpcode && b.topLevel === true)
    if (!hatBlock) throw new Error(`No top-level hat block with opcode "${hatOpcode}" found in "${targetName}".`)
    const bodyBlock = blocks[bodyBlockId]
    if (!bodyBlock) throw new Error(`Body block "${bodyBlockId}" not found in "${targetName}".`)
    if (hatBlock.next && hatBlock.next !== bodyBlockId) {
      throw new Error(`Hat block "${hatOpcode}" already has a body in "${targetName}".`)
    }
    hatBlock.next = bodyBlockId
    bodyBlock.parent = hatBlock.id
    bodyBlock.topLevel = false
    this.dirty = true
  }
}

// ─── Options type ────────────────────────────────────────────────────────────

export interface AddSpriteOptions {
  x?: number
  y?: number
  direction?: number
  rotationStyle?: 'normal' | 'left-right' | "don't rotate"
  visible?: boolean
  draggable?: boolean
  size?: number
}
