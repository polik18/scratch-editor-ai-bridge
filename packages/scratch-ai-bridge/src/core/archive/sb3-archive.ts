import { SHA256 } from '@noble/hashes/sha2'
import JSZip from 'jszip'
import { patchProjectBlockGraphs, type ScratchTargetBlockPatch } from '../graph'
import { decodeZipFilename, inspectZipDirectory } from './zip-directory'

export type Sb3ArchiveInput = Blob | ArrayBuffer | ArrayBufferView

export interface RawSb3ArchiveEntry {
  readonly centralDirectoryIndex: number
  readonly name: string
  readonly filenameBytes: Uint8Array
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
  readonly versionMadeBy?: number
  readonly versionNeeded?: number
  readonly internalAttributes?: number
  readonly dosTime?: number
  readonly dosDate?: number
  readonly localVersionNeeded?: number
  readonly localExtraBytes?: Uint8Array
  readonly centralExtraBytes?: Uint8Array
  readonly commentBytes?: Uint8Array
  readonly hasDataDescriptor?: boolean
  readonly dataDescriptorHasSignature?: boolean
  readonly localHeaderOffset: number
  readonly date: string
}

export interface RawSb3Project {
  readonly projectEntryName: string
  readonly projectJsonBytes: Uint8Array
  readonly projectJson: Record<string, unknown>
  readonly entries: readonly RawSb3ArchiveEntry[]
  readonly archiveCommentBytes?: Uint8Array
  readonly warnings: readonly string[]
}

const MAX_SB3_BYTES = 64 * 1024 * 1024
const MAX_SB3_ENTRIES = 2_048
const MAX_SB3_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_PROJECT_JSON_BYTES = 16 * 1024 * 1024
const UTF8_FILENAME_FLAG = 0x0800
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  return crc >>> 0
})

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

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

interface ExtractedEntryData {
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly crc32: string
}

interface ZipEntryStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): ZipEntryStream
  on(event: 'error', listener: (error: Error) => void): ZipEntryStream
  on(event: 'end', listener: () => void): ZipEntryStream
  resume(): ZipEntryStream
  pause(): ZipEntryStream
}

const extractEntryBytes = async (
  entry: JSZip.JSZipObject,
  expectedSize: number,
  expectedCrc32: string,
  name: string,
): Promise<ExtractedEntryData> => {
  // JSZip's async() retains every output chunk and then concatenates them into
  // another full-size buffer. Stream into the single retained archive buffer.
  const streamable = entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): ZipEntryStream }
  const output = new Uint8Array(expectedSize)
  const stream = streamable.internalStream('uint8array')
  const hash = new SHA256()
  return new Promise((resolve, reject) => {
    let offset = 0
    let failed = false
    let crc = 0xffffffff
    let nextYieldOffset = 1024 * 1024
    stream
      .on('data', (chunk) => {
        if (failed) return
        if (offset + chunk.byteLength > output.byteLength) {
          failed = true
          stream.pause()
          reject(new Error(`SB3 entry size exceeds the central directory: ${name}`))
          return
        }
        hash.update(chunk)
        for (const byte of chunk) crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0)
        output.set(chunk, offset)
        offset += chunk.byteLength
        if (offset >= nextYieldOffset && offset < expectedSize) {
          nextYieldOffset += 1024 * 1024
          stream.pause()
          setTimeout(() => stream.resume(), 0)
        }
      })
      .on('error', (error) => {
        failed = true
        reject(error)
      })
      .on('end', () => {
        if (failed) return
        if (offset !== expectedSize) {
          reject(new Error(`SB3 entry size does not match the central directory: ${name}`))
          return
        }
        const actualCrc32 = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
        if (actualCrc32 !== expectedCrc32) {
          reject(new Error(`SB3 entry CRC does not match the central directory: ${name}`))
          return
        }
        resolve({ bytes: output, sha256: bytesToHex(hash.digest()), crc32: actualCrc32 })
      })
    stream.resume()
  })
}

const extractDeflatedEntryWithNativeStream = async (
  compressedBytes: Uint8Array,
  expectedSize: number,
  expectedCrc32: string,
  name: string,
): Promise<ExtractedEntryData | null> => {
  if (typeof DecompressionStream === 'undefined') return null
  let decompressed: ReadableStream<Uint8Array>
  try {
    const blobBytes = Uint8Array.from(compressedBytes)
    decompressed = new Blob([blobBytes.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  } catch {
    return null
  }

  const output = new Uint8Array(expectedSize)
  const hash = new SHA256()
  const reader = decompressed.getReader()
  let offset = 0
  let crc = 0xffffffff
  let nextYieldOffset = 1024 * 1024
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.byteLength > output.byteLength) {
        throw new Error(`SB3 entry size exceeds the central directory: ${name}`)
      }
      hash.update(value)
      for (const byte of value) crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0)
      output.set(value, offset)
      offset += value.byteLength
      if (offset >= nextYieldOffset && offset < expectedSize) {
        nextYieldOffset += 1024 * 1024
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (offset !== expectedSize) throw new Error(`SB3 entry size does not match the central directory: ${name}`)
  const actualCrc32 = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
  if (actualCrc32 !== expectedCrc32) throw new Error(`SB3 entry CRC does not match the central directory: ${name}`)
  return { bytes: output, sha256: bytesToHex(hash.digest()), crc32: actualCrc32 }
}

/**
 * Import an SB3 archive without passing its project through Scratch VM.
 * @param input SB3 bytes or a browser Blob.
 * @returns A raw project representation containing every archive entry.
 */
export const importLosslessSb3 = async (input: Sb3ArchiveInput): Promise<RawSb3Project> => {
  const bytes = await readInput(input)
  const directory = inspectZipDirectory(bytes, MAX_SB3_ENTRIES, MAX_SB3_UNCOMPRESSED_BYTES)
  const directoryEndView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const archiveCommentLength = directoryEndView.getUint16(directory.endRecordOffset + 20, true)
  const archiveCommentBytes = bytes.slice(directory.endRecordOffset + 22)
  const zipBytes = archiveCommentLength > 0 ? bytes.subarray(0, directory.endRecordOffset + 22) : bytes
  if (archiveCommentLength > 0) directoryEndView.setUint16(directory.endRecordOffset + 20, 0, true)
  // Verify CRC after the single decompression used to retain each entry. JSZip's
  // checkCRC32 option eagerly decompresses all entries once before extraction.
  // Drop the opaque archive comment from JSZip's temporary view: it can contain
  // an EOCD signature that JSZip mistakes for the real end record.
  const zip = await JSZip.loadAsync(zipBytes, { createFolders: false, decodeFileName: decodeZipFilename })
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
    const compressedBytes = bytes.subarray(metadata.dataOffset, metadata.dataOffset + metadata.compressedSize)
    const nativeDeflated =
      !metadata.isDirectory && metadata.compressionMethod === 8 && metadata.uncompressedSize >= 1024 * 1024
        ? await extractDeflatedEntryWithNativeStream(
            compressedBytes,
            metadata.uncompressedSize,
            metadata.crc32,
            metadata.name,
          )
        : null
    const entryData = metadata.isDirectory
      ? { bytes: new Uint8Array(), sha256: bytesToHex(new SHA256().digest()), crc32: '00000000' }
      : (nativeDeflated ??
        (await extractEntryBytes(zipEntry, metadata.uncompressedSize, metadata.crc32, metadata.name)))
    entries.push({
      centralDirectoryIndex: metadata.index,
      name: metadata.name,
      filenameBytes: metadata.filenameBytes,
      filenameEncoding: metadata.filenameEncoding,
      isDirectory: metadata.isDirectory,
      bytes: entryData.bytes,
      sha256: entryData.sha256,
      compressionMethod: metadata.compressionMethod,
      crc32: entryData.crc32,
      compressedSize: metadata.compressedSize,
      uncompressedSize: metadata.uncompressedSize,
      flags: metadata.flags,
      externalAttributes: metadata.externalAttributes,
      versionMadeBy: metadata.versionMadeBy,
      versionNeeded: metadata.versionNeeded,
      internalAttributes: metadata.internalAttributes,
      dosTime: metadata.dosTime,
      dosDate: metadata.dosDate,
      localVersionNeeded: metadata.localVersionNeeded,
      localExtraBytes: metadata.localExtraBytes,
      centralExtraBytes: metadata.centralExtraBytes,
      commentBytes: metadata.commentBytes,
      hasDataDescriptor: metadata.hasDataDescriptor,
      dataDescriptorHasSignature: metadata.dataDescriptorHasSignature,
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
    projectJsonBytes: projectEntry.bytes,
    projectJson,
    entries,
    ...(archiveCommentLength > 0 ? { archiveCommentBytes } : {}),
    warnings: projectEntry.name === 'project.json' ? [] : [`project.json is nested at ${projectEntry.name}`],
  }
}

const joinByteParts = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

/**
 * Rebuild generated ZIP records while restoring the source entry metadata.
 * @param generated ZIP records produced by JSZip.
 * @param entries Source archive entry metadata.
 * @param sourceComment Optional archive comment bytes.
 * @returns A ZIP with source entry metadata restored.
 */
const restoreZipEntryMetadata = (
  generated: Uint8Array,
  entries: readonly RawSb3ArchiveEntry[],
  sourceComment: Uint8Array | undefined,
): Uint8Array => {
  const parsed = inspectZipDirectory(generated, MAX_SB3_ENTRIES, MAX_SB3_UNCOMPRESSED_BYTES)
  const generatedView = new DataView(generated.buffer, generated.byteOffset, generated.byteLength)
  const sourceByName = new Map(entries.map((entry) => [entry.name, entry]))
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const localOffsets = new Map<string, number>()
  let localOffset = 0

  for (const metadata of parsed.entries) {
    const source = sourceByName.get(metadata.name)
    const localHeader = metadata.localHeaderOffset
    const filenameLength = generatedView.getUint16(localHeader + 26, true)
    const generatedExtraLength = generatedView.getUint16(localHeader + 28, true)
    const filenameStart = localHeader + 30
    const filename = generated.subarray(filenameStart, filenameStart + filenameLength)
    const localExtra =
      source?.localExtraBytes ??
      generated.subarray(filenameStart + filenameLength, filenameStart + filenameLength + generatedExtraLength)
    const localVersion = source?.localVersionNeeded ?? generatedView.getUint16(localHeader + 4, true)
    const flags = source?.flags ?? metadata.flags
    const useDataDescriptor = source?.hasDataDescriptor ?? (flags & 0x0008) !== 0
    const descriptorHasSignature = source?.dataDescriptorHasSignature ?? true
    const descriptorLength = useDataDescriptor ? (descriptorHasSignature ? 16 : 12) : 0
    const localRecord = new Uint8Array(
      30 + filename.byteLength + localExtra.byteLength + metadata.compressedSize + descriptorLength,
    )
    localRecord.set(generated.subarray(localHeader, localHeader + 30))
    const localView = new DataView(localRecord.buffer)
    localView.setUint16(4, localVersion, true)
    localView.setUint16(6, flags, true)
    localView.setUint16(26, filename.byteLength, true)
    localView.setUint16(28, localExtra.byteLength, true)
    if (useDataDescriptor) {
      localView.setUint32(14, 0, true)
      localView.setUint32(18, 0, true)
      localView.setUint32(22, 0, true)
    }
    localRecord.set(filename, 30)
    localRecord.set(localExtra, 30 + filename.byteLength)
    const payloadEnd = 30 + filename.byteLength + localExtra.byteLength + metadata.compressedSize
    localRecord.set(
      generated.subarray(metadata.dataOffset, metadata.dataOffset + metadata.compressedSize),
      30 + filename.byteLength + localExtra.byteLength,
    )
    if (useDataDescriptor) {
      const descriptorView = new DataView(localRecord.buffer)
      let descriptorOffset = payloadEnd
      if (descriptorHasSignature) {
        descriptorView.setUint32(descriptorOffset, 0x08074b50, true)
        descriptorOffset += 4
      }
      descriptorView.setUint32(descriptorOffset, Number.parseInt(metadata.crc32, 16), true)
      descriptorView.setUint32(descriptorOffset + 4, metadata.compressedSize, true)
      descriptorView.setUint32(descriptorOffset + 8, metadata.uncompressedSize, true)
    }
    if (source?.dosTime !== undefined && source.dosDate !== undefined) {
      localView.setUint16(10, source.dosTime, true)
      localView.setUint16(12, source.dosDate, true)
    }
    localOffsets.set(metadata.name, localOffset)
    localParts.push(localRecord)
    localOffset += localRecord.byteLength

    const centralHeader = metadata.centralHeaderOffset
    const centralNameLength = generatedView.getUint16(centralHeader + 28, true)
    const centralExtraLength = generatedView.getUint16(centralHeader + 30, true)
    const commentLength = generatedView.getUint16(centralHeader + 32, true)
    const centralNameStart = centralHeader + 46
    const centralName = generated.subarray(centralNameStart, centralNameStart + centralNameLength)
    const centralExtra =
      source?.centralExtraBytes ??
      generated.subarray(
        centralNameStart + centralNameLength,
        centralNameStart + centralNameLength + centralExtraLength,
      )
    const comment =
      source?.commentBytes ??
      generated.subarray(
        centralNameStart + centralNameLength + centralExtraLength,
        centralNameStart + centralNameLength + centralExtraLength + commentLength,
      )
    const centralRecord = new Uint8Array(46 + centralName.byteLength + centralExtra.byteLength + comment.byteLength)
    centralRecord.set(generated.subarray(centralHeader, centralHeader + 46))
    const centralView = new DataView(centralRecord.buffer)
    centralView.setUint16(4, source?.versionMadeBy ?? generatedView.getUint16(centralHeader + 4, true), true)
    centralView.setUint16(6, source?.versionNeeded ?? generatedView.getUint16(centralHeader + 6, true), true)
    centralView.setUint16(8, flags, true)
    centralView.setUint16(28, centralName.byteLength, true)
    centralView.setUint16(30, centralExtra.byteLength, true)
    centralView.setUint16(32, comment.byteLength, true)
    centralView.setUint16(36, source?.internalAttributes ?? generatedView.getUint16(centralHeader + 36, true), true)
    centralView.setUint32(38, source?.externalAttributes ?? generatedView.getUint32(centralHeader + 38, true), true)
    centralView.setUint32(42, localOffsets.get(metadata.name) ?? 0, true)
    if (source?.dosTime !== undefined && source.dosDate !== undefined) {
      centralView.setUint16(12, source.dosTime, true)
      centralView.setUint16(14, source.dosDate, true)
    }
    centralRecord.set(centralName, 46)
    centralRecord.set(centralExtra, 46 + centralName.byteLength)
    centralRecord.set(comment, 46 + centralName.byteLength + centralExtra.byteLength)
    centralParts.push(centralRecord)
  }

  const localData = joinByteParts(localParts)
  const centralData = joinByteParts(centralParts)
  const directory = new Uint8Array(22)
  const directoryView = new DataView(directory.buffer)
  directoryView.setUint32(0, 0x06054b50, true)
  directoryView.setUint16(8, parsed.entries.length, true)
  directoryView.setUint16(10, parsed.entries.length, true)
  directoryView.setUint32(12, centralData.byteLength, true)
  directoryView.setUint32(16, localData.byteLength, true)
  directoryView.setUint16(20, sourceComment?.byteLength ?? 0, true)
  if (sourceComment && sourceComment.byteLength > 0xffff)
    throw new Error('ZIP archive comment exceeds the 65,535-byte limit')
  return joinByteParts([localData, centralData, directory, ...(sourceComment?.byteLength ? [sourceComment] : [])])
}

/**
 * Export a Raw SB3 project without invoking Scratch VM normalization.
 * @param project Raw project representation returned by importLosslessSb3.
 * @returns A browser Blob containing the reconstructed SB3 archive.
 */
export const exportLosslessSb3 = async (project: RawSb3Project): Promise<Blob> => {
  const archive = new JSZip()
  const entries = [...project.entries].sort((left, right) => left.centralDirectoryIndex - right.centralDirectoryIndex)
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
  for (const entry of entries) {
    const bytes = entry.name === project.projectEntryName ? project.projectJsonBytes : entry.bytes
    archive.file(entry.name, bytes, {
      binary: true,
      compression: entry.compressionMethod === 8 ? 'DEFLATE' : 'STORE',
      createFolders: false,
      date: new Date(entry.date),
      dir: entry.isDirectory,
    })
  }
  const generated = new Uint8Array(
    await archive.generateAsync({
      type: 'uint8array',
      compression: 'STORE',
      encodeFileName: (name) => {
        const bytes = entriesByName.get(name)?.filenameBytes ?? new TextEncoder().encode(name)
        return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
      },
    }),
  )
  const restored = restoreZipEntryMetadata(generated, entries, project.archiveCommentBytes)
  const directory = inspectZipDirectory(restored, MAX_SB3_ENTRIES, MAX_SB3_UNCOMPRESSED_BYTES)
  const restoredView = new DataView(restored.buffer, restored.byteOffset, restored.byteLength)
  let centralOffset = directory.offset
  for (const metadata of directory.entries) {
    if (entriesByName.get(metadata.name)?.filenameEncoding === 'utf-8') {
      restoredView.setUint16(metadata.localHeaderOffset + 6, metadata.flags | UTF8_FILENAME_FLAG, true)
      restoredView.setUint16(centralOffset + 8, metadata.flags | UTF8_FILENAME_FLAG, true)
    }
    const filenameLength = restoredView.getUint16(centralOffset + 28, true)
    const extraLength = restoredView.getUint16(centralOffset + 30, true)
    const commentLength = restoredView.getUint16(centralOffset + 32, true)
    centralOffset += 46 + filenameLength + extraLength + commentLength
  }
  const blobBytes = Uint8Array.from(restored)
  return new Blob([blobBytes.buffer], { type: 'application/zip' })
}

/**
 * Apply validated raw block graph edits to an imported SB3 while retaining every other archive entry byte-for-byte.
 * @param project Imported raw SB3 project.
 * @param patches Target-identified block edits.
 * @returns A raw project ready for `exportLosslessSb3`.
 */
export const patchLosslessSb3BlockGraphs = (
  project: RawSb3Project,
  patches: readonly ScratchTargetBlockPatch[],
): RawSb3Project => {
  const projectJson = patchProjectBlockGraphs(project.projectJson, patches)
  const projectJsonBytes = new TextEncoder().encode(JSON.stringify(projectJson))
  if (projectJsonBytes.byteLength > MAX_PROJECT_JSON_BYTES) {
    throw new Error('Patched SB3 project.json exceeds the 16 MiB limit')
  }
  return {
    ...project,
    projectJson,
    projectJsonBytes,
  }
}
