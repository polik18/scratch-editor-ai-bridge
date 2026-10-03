import JSZip from 'jszip'
import { inspectZipDirectory } from './zip-directory'

export type Sb3ArchiveInput = Blob | ArrayBuffer | ArrayBufferView

export interface RawSb3ArchiveEntry {
  readonly centralDirectoryIndex: number
  readonly name: string
  readonly filenameEncoding: 'utf-8' | 'legacy'
  readonly isDirectory: boolean
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly compressionMethod: number
  readonly crc32: string
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly flags: number
  readonly externalAttributes: number
  readonly localHeaderOffset: number
  readonly date: string
}

export interface RawSb3Project {
  readonly projectEntryName: string
  readonly projectJsonBytes: Uint8Array
  readonly projectJson: Record<string, unknown>
  readonly entries: readonly RawSb3ArchiveEntry[]
  readonly warnings: readonly string[]
}

const MAX_SB3_BYTES = 64 * 1024 * 1024
const MAX_SB3_ENTRIES = 2_048
const MAX_SB3_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_PROJECT_JSON_BYTES = 16 * 1024 * 1024

const asBytes = (input: ArrayBuffer | ArrayBufferView): Uint8Array =>
  input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

const readInput = async (input: Sb3ArchiveInput): Promise<Uint8Array> => {
  if (input instanceof Blob) {
    if (input.size > MAX_SB3_BYTES) throw new Error('SB3 exceeds the 64 MiB compressed-size limit')
    return new Uint8Array(await input.arrayBuffer())
  }
  const bytes = asBytes(input)
  if (bytes.byteLength > MAX_SB3_BYTES) throw new Error('SB3 exceeds the 64 MiB compressed-size limit')
  return new Uint8Array(bytes)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digestInput = new Uint8Array(bytes.byteLength)
  digestInput.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Import an SB3 archive without passing its project through Scratch VM.
 * @param input SB3 bytes or a browser Blob.
 * @returns A raw project representation containing every archive entry.
 */
export const importLosslessSb3 = async (input: Sb3ArchiveInput): Promise<RawSb3Project> => {
  const bytes = await readInput(input)
  const directory = inspectZipDirectory(bytes, MAX_SB3_ENTRIES, MAX_SB3_UNCOMPRESSED_BYTES)
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false })
  if (Object.keys(zip.files).length !== directory.entries.length) {
    throw new Error('SB3 ZIP entries do not match the central directory')
  }

  const entries: RawSb3ArchiveEntry[] = []
  for (const metadata of directory.entries) {
    if (!Object.hasOwn(zip.files, metadata.name)) {
      throw new Error(`SB3 entry is missing after decompression: ${metadata.name}`)
    }
    const zipEntry = zip.files[metadata.name]
    const originalName = zipEntry.unsafeOriginalName ?? zipEntry.name
    if (originalName !== metadata.name)
      throw new Error(`SB3 entry name changed during decompression: ${metadata.name}`)
    const entryBytes = metadata.isDirectory ? new Uint8Array() : await zipEntry.async('uint8array')
    if (entryBytes.byteLength !== metadata.uncompressedSize) {
      throw new Error(`SB3 entry size does not match the central directory: ${metadata.name}`)
    }
    entries.push({
      centralDirectoryIndex: metadata.index,
      name: metadata.name,
      filenameEncoding: metadata.filenameEncoding,
      isDirectory: metadata.isDirectory,
      bytes: new Uint8Array(entryBytes),
      sha256: await sha256(entryBytes),
      compressionMethod: metadata.compressionMethod,
      crc32: metadata.crc32,
      compressedSize: metadata.compressedSize,
      uncompressedSize: metadata.uncompressedSize,
      flags: metadata.flags,
      externalAttributes: metadata.externalAttributes,
      localHeaderOffset: metadata.localHeaderOffset,
      date: zipEntry.date.toISOString(),
    })
  }

  const projectEntries = entries.filter(
    (entry) => !entry.isDirectory && entry.name.split('/').at(-1) === 'project.json',
  )
  if (projectEntries.length !== 1) {
    throw new Error(`SB3 must contain exactly one project.json entry (found ${projectEntries.length})`)
  }
  const projectEntry = projectEntries[0]
  if (projectEntry.bytes.byteLength > MAX_PROJECT_JSON_BYTES) {
    throw new Error('SB3 project.json exceeds the 16 MiB limit')
  }

  let projectJson: unknown
  try {
    projectJson = JSON.parse(new TextDecoder().decode(projectEntry.bytes))
  } catch {
    throw new Error('SB3 project.json is not valid JSON')
  }
  if (!isRecord(projectJson)) throw new Error('SB3 project.json must contain a JSON object')

  return {
    projectEntryName: projectEntry.name,
    projectJsonBytes: new Uint8Array(projectEntry.bytes),
    projectJson,
    entries,
    warnings: projectEntry.name === 'project.json' ? [] : [`project.json is nested at ${projectEntry.name}`],
  }
}

/**
 * Export a Raw SB3 project without invoking Scratch VM normalization.
 * @param project Raw project representation returned by importLosslessSb3.
 * @returns A browser Blob containing the reconstructed SB3 archive.
 */
export const exportLosslessSb3 = async (project: RawSb3Project): Promise<Blob> => {
  const archive = new JSZip()
  const entries = [...project.entries].sort((left, right) => left.centralDirectoryIndex - right.centralDirectoryIndex)
  for (const entry of entries) {
    archive.file(entry.name, entry.bytes, {
      binary: true,
      compression: entry.compressionMethod === 8 ? 'DEFLATE' : 'STORE',
      createFolders: false,
      date: new Date(entry.date),
      dir: entry.isDirectory,
    })
  }
  return archive.generateAsync({ type: 'blob', compression: 'STORE' })
}
