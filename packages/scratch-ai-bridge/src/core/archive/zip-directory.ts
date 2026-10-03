const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const UTF8_FILENAME_FLAG = 0x0800
const ENCRYPTED_FLAG = 0x0001
const ZIP64_UINT16 = 0xffff
const ZIP64_UINT32 = 0xffffffff
const UNIX_FILE_TYPE_MASK = 0xf000
const UNIX_SYMLINK_TYPE = 0xa000

export interface ZipDirectoryEntry {
  readonly index: number
  readonly name: string
  readonly filenameEncoding: 'utf-8' | 'legacy'
  readonly flags: number
  readonly compressionMethod: number
  readonly crc32: string
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly externalAttributes: number
  readonly localHeaderOffset: number
  readonly isDirectory: boolean
}

export interface ZipDirectory {
  readonly entries: readonly ZipDirectoryEntry[]
  readonly offset: number
  readonly size: number
}

const assertBounds = (end: number, limit: number, message: string): void => {
  if (!Number.isSafeInteger(end) || end > limit) throw new Error(message)
}

const decodeFilename = (bytes: Uint8Array, utf8: boolean): string => {
  try {
    return new TextDecoder('utf-8', { fatal: utf8 }).decode(bytes)
  } catch {
    throw new Error('SB3 contains an invalid UTF-8 filename')
  }
}

const validateName = (name: string): void => {
  const parts = name.split('/')
  if (
    name.length === 0 ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    parts.some((part) => part === '..')
  ) {
    throw new Error(`Unsafe SB3 entry path: ${name}`)
  }
}

const findDirectoryEnd = (view: DataView): number => {
  const minimumOffset = Math.max(0, view.byteLength - 65_557)
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === view.byteLength) return offset
  }
  throw new Error('The selected file is not a valid SB3 ZIP archive')
}

/**
 * Inspect and validate an SB3 ZIP central directory without decompressing it.
 * @param bytes Complete ZIP archive bytes.
 * @param maximumEntries Maximum accepted number of central-directory entries.
 * @param maximumUncompressedBytes Maximum sum of declared uncompressed sizes.
 * @returns Validated entry metadata in original archive order.
 */
export const inspectZipDirectory = (
  bytes: Uint8Array,
  maximumEntries: number,
  maximumUncompressedBytes: number,
): ZipDirectory => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const directoryEnd = findDirectoryEnd(view)
  const diskNumber = view.getUint16(directoryEnd + 4, true)
  const directoryDisk = view.getUint16(directoryEnd + 6, true)
  const diskEntryCount = view.getUint16(directoryEnd + 8, true)
  const entryCount = view.getUint16(directoryEnd + 10, true)
  const directorySize = view.getUint32(directoryEnd + 12, true)
  const directoryOffset = view.getUint32(directoryEnd + 16, true)

  if (
    diskEntryCount === ZIP64_UINT16 ||
    entryCount === ZIP64_UINT16 ||
    directorySize === ZIP64_UINT32 ||
    directoryOffset === ZIP64_UINT32
  ) {
    throw new Error('ZIP64 SB3 archives are not supported')
  }
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntryCount !== entryCount) {
    throw new Error('Multi-disk SB3 ZIP archives are not supported')
  }
  if (entryCount === 0 || entryCount > maximumEntries) {
    throw new Error(`SB3 contains an unsupported number of files (${entryCount})`)
  }
  assertBounds(directoryOffset + directorySize, directoryEnd, 'SB3 central directory is malformed')

  const entries: ZipDirectoryEntry[] = []
  const seenNames = new Set<string>()
  let offset = directoryOffset
  let totalUncompressedBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    assertBounds(offset + 46, directoryEnd, 'SB3 central directory entry is truncated')
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('SB3 central directory entry is malformed')
    }

    const versionMadeBy = view.getUint16(offset + 4, true)
    const flags = view.getUint16(offset + 8, true)
    const compressionMethod = view.getUint16(offset + 10, true)
    const crc32 = view.getUint32(offset + 16, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const filenameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const diskStart = view.getUint16(offset + 34, true)
    const externalAttributes = view.getUint32(offset + 38, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const entryEnd = offset + 46 + filenameLength + extraLength + commentLength
    assertBounds(entryEnd, directoryEnd, 'SB3 central directory entry exceeds archive bounds')

    if ((flags & ENCRYPTED_FLAG) !== 0) throw new Error('Encrypted SB3 files are not supported')
    if (
      compressedSize === ZIP64_UINT32 ||
      uncompressedSize === ZIP64_UINT32 ||
      localHeaderOffset === ZIP64_UINT32 ||
      diskStart === ZIP64_UINT16
    ) {
      throw new Error('ZIP64 SB3 entries are not supported')
    }
    if (diskStart !== 0) throw new Error('Multi-disk SB3 ZIP entries are not supported')
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(`Unsupported SB3 compression method: ${compressionMethod}`)
    }

    const filenameBytes = bytes.subarray(offset + 46, offset + 46 + filenameLength)
    const usesUtf8 = (flags & UTF8_FILENAME_FLAG) !== 0
    const name = decodeFilename(filenameBytes, usesUtf8)
    validateName(name)
    if (seenNames.has(name)) throw new Error(`SB3 contains a duplicate filename: ${name}`)
    seenNames.add(name)

    const unixMode = externalAttributes >>> 16
    if (versionMadeBy >>> 8 === 3 && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE) {
      throw new Error(`SB3 contains a symbolic-link entry: ${name}`)
    }

    assertBounds(localHeaderOffset + 30, directoryOffset, `SB3 local header is invalid: ${name}`)
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`SB3 local header is malformed: ${name}`)
    }
    const localFilenameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const contentOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength
    assertBounds(contentOffset + compressedSize, directoryOffset, `SB3 entry data exceeds archive bounds: ${name}`)

    totalUncompressedBytes += uncompressedSize
    if (totalUncompressedBytes > maximumUncompressedBytes) {
      throw new Error('SB3 exceeds the 256 MiB uncompressed-size limit')
    }

    entries.push({
      index,
      name,
      filenameEncoding: usesUtf8 ? 'utf-8' : 'legacy',
      flags,
      compressionMethod,
      crc32: crc32.toString(16).padStart(8, '0'),
      compressedSize,
      uncompressedSize,
      externalAttributes,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    })
    offset = entryEnd
  }

  if (offset !== directoryOffset + directorySize) {
    throw new Error('SB3 central directory size does not match its entries')
  }
  return { entries, offset: directoryOffset, size: directorySize }
}
