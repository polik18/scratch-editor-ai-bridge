const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50
const UTF8_FILENAME_FLAG = 0x0800
const DATA_DESCRIPTOR_FLAG = 0x0008
const SUPPORTED_GENERAL_PURPOSE_FLAGS = 0x080e
const ENCRYPTION_FLAGS = 0x2041
const ZIP64_UINT16 = 0xffff
const ZIP64_UINT32 = 0xffffffff
const UNIX_FILE_TYPE_MASK = 0xf000
const UNIX_SYMLINK_TYPE = 0xa000
const UNICODE_PATH_EXTRA_FIELD = 0x7075
const CP437_HIGH_BYTES =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄' +
  '▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

export interface ZipDirectoryEntry {
  readonly index: number
  readonly name: string
  readonly filenameBytes: Uint8Array
  readonly filenameEncoding: 'utf-8' | 'legacy'
  readonly flags: number
  readonly compressionMethod: number
  readonly crc32: string
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly externalAttributes: number
  readonly versionMadeBy: number
  readonly versionNeeded: number
  readonly internalAttributes: number
  readonly dosTime: number
  readonly dosDate: number
  readonly localVersionNeeded: number
  readonly localExtraBytes: Uint8Array
  readonly centralExtraBytes: Uint8Array
  readonly commentBytes: Uint8Array
  readonly hasDataDescriptor: boolean
  readonly dataDescriptorHasSignature: boolean
  readonly localHeaderOffset: number
  readonly centralHeaderOffset: number
  readonly dataOffset: number
  readonly isDirectory: boolean
}

export interface ZipDirectory {
  readonly entries: readonly ZipDirectoryEntry[]
  readonly endRecordOffset: number
  readonly offset: number
  readonly size: number
}

const assertBounds = (end: number, limit: number, message: string): void => {
  if (!Number.isSafeInteger(end) || end > limit) throw new Error(message)
}

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

const decodeCp437 = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => (byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH_BYTES[byte - 0x80])).join('')

const decodeUnicodePathExtra = (bytes: Uint8Array, rawFilename: Uint8Array, strict: boolean): string | null => {
  let offset = 0
  let result: string | null = null
  let foundUnicodePath = false
  while (offset < bytes.byteLength) {
    if (offset + 4 > bytes.byteLength) {
      if (strict) throw new Error('SB3 ZIP extra field is truncated')
      return null
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset)
    const id = view.getUint16(0, true)
    const size = view.getUint16(2, true)
    offset += 4
    if (offset + size > bytes.byteLength) {
      if (strict) throw new Error('SB3 ZIP extra field exceeds its bounds')
      return null
    }
    if (id === UNICODE_PATH_EXTRA_FIELD) {
      if (foundUnicodePath) {
        if (strict) throw new Error('SB3 contains duplicate Unicode Path extra fields')
        return null
      }
      foundUnicodePath = true
      if (size < 5) {
        if (strict) throw new Error('SB3 Unicode Path extra field is truncated')
        return null
      }
      if (bytes[offset] === 1) {
        const fieldView = new DataView(bytes.buffer, bytes.byteOffset + offset, size)
        if (fieldView.getUint32(1, true) === crc32(rawFilename)) {
          try {
            result = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 5, offset + size))
          } catch {
            throw new Error('SB3 Unicode Path filename is not valid UTF-8')
          }
        }
      }
    }
    offset += size
  }
  return result
}

const decodeFilename = (bytes: Uint8Array, utf8: boolean, extra: Uint8Array, strictExtra = true): string => {
  if (!utf8) {
    const unicodePath = decodeUnicodePathExtra(extra, bytes, strictExtra)
    if (unicodePath !== null) return unicodePath
    return decodeCp437(bytes)
  }
  try {
    return new TextDecoder('utf-8', { fatal: utf8 }).decode(bytes)
  } catch {
    throw new Error('SB3 contains an invalid UTF-8 filename')
  }
}

/**
 * Decode a ZIP legacy filename using CP437.
 * @param bytes Filename bytes supplied by JSZip.
 * @returns The decoded CP437 string.
 */
export const decodeZipFilename = (bytes: Uint8Array | string[]): string =>
  decodeCp437(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes))

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
    if (offset + 22 + commentLength !== view.byteLength) continue
    // ZIP comments are arbitrary bytes and can end in this signature. Skip
    // empty false candidates so the real EOCD earlier in the comment range wins.
    if (view.getUint16(offset + 10, true) === 0) continue
    return offset
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
  const localRecordRanges: { name: string; start: number; end: number }[] = []
  const seenNames = new Set<string>()
  let offset = directoryOffset
  let totalUncompressedBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    assertBounds(offset + 46, directoryEnd, 'SB3 central directory entry is truncated')
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('SB3 central directory entry is malformed')
    }

    const versionMadeBy = view.getUint16(offset + 4, true)
    const versionNeeded = view.getUint16(offset + 6, true)
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
    const internalAttributes = view.getUint16(offset + 36, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    const entryEnd = offset + 46 + filenameLength + extraLength + commentLength
    assertBounds(entryEnd, directoryEnd, 'SB3 central directory entry exceeds archive bounds')

    if ((flags & ENCRYPTION_FLAGS) !== 0) throw new Error('Encrypted SB3 files are not supported')
    if ((flags & ~SUPPORTED_GENERAL_PURPOSE_FLAGS) !== 0) {
      throw new Error(`Unsupported SB3 general-purpose ZIP flags: 0x${flags.toString(16).padStart(4, '0')}`)
    }
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
    const extraBytes = bytes.subarray(offset + 46 + filenameLength, offset + 46 + filenameLength + extraLength)
    const usesUtf8 = (flags & UTF8_FILENAME_FLAG) !== 0
    const name = decodeFilename(filenameBytes, usesUtf8, extraBytes)
    validateName(name)
    if (seenNames.has(name)) throw new Error(`SB3 contains a duplicate filename: ${name}`)
    seenNames.add(name)
    if (name.endsWith('/') && (compressedSize !== 0 || uncompressedSize !== 0 || crc32 !== 0)) {
      throw new Error(`SB3 directory entry contains file data: ${name}`)
    }

    const unixMode = externalAttributes >>> 16
    if (versionMadeBy >>> 8 === 3 && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE) {
      throw new Error(`SB3 contains a symbolic-link entry: ${name}`)
    }

    assertBounds(localHeaderOffset + 30, directoryOffset, `SB3 local header is invalid: ${name}`)
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`SB3 local header is malformed: ${name}`)
    }
    const localFlags = view.getUint16(localHeaderOffset + 6, true)
    const localVersionNeeded = view.getUint16(localHeaderOffset + 4, true)
    const localCompressionMethod = view.getUint16(localHeaderOffset + 8, true)
    const localCrc32 = view.getUint32(localHeaderOffset + 14, true)
    const localCompressedSize = view.getUint32(localHeaderOffset + 18, true)
    const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true)
    const localFilenameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    assertBounds(
      localHeaderOffset + 30 + localFilenameLength + localExtraLength,
      directoryOffset,
      `SB3 local header exceeds archive bounds: ${name}`,
    )
    const localNameBytes = bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localFilenameLength)
    if (
      localNameBytes.byteLength !== filenameBytes.byteLength ||
      localNameBytes.some((byte, byteIndex) => byte !== filenameBytes[byteIndex])
    ) {
      throw new Error(`SB3 local and central filenames do not match: ${name}`)
    }
    const localExtraBytes = bytes.subarray(
      localHeaderOffset + 30 + localFilenameLength,
      localHeaderOffset + 30 + localFilenameLength + localExtraLength,
    )
    if (decodeFilename(localNameBytes, usesUtf8, localExtraBytes, false) !== name) {
      throw new Error(`SB3 local and central filenames do not match: ${name}`)
    }
    if (localFlags !== flags || localCompressionMethod !== compressionMethod) {
      throw new Error(`SB3 local and central compression metadata do not match: ${name}`)
    }
    const hasDataDescriptor = (flags & DATA_DESCRIPTOR_FLAG) !== 0
    if ((!hasDataDescriptor || localCrc32 !== 0) && localCrc32 !== crc32) {
      throw new Error(`SB3 local and central CRC values do not match: ${name}`)
    }
    if ((!hasDataDescriptor || localCompressedSize !== 0) && localCompressedSize !== compressedSize) {
      throw new Error(`SB3 local and central compressed sizes do not match: ${name}`)
    }
    if ((!hasDataDescriptor || localUncompressedSize !== 0) && localUncompressedSize !== uncompressedSize) {
      throw new Error(`SB3 local and central uncompressed sizes do not match: ${name}`)
    }
    const contentOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength
    const dataEnd = contentOffset + compressedSize
    assertBounds(dataEnd, directoryOffset, `SB3 entry data exceeds archive bounds: ${name}`)
    let localRecordEnd = dataEnd
    let dataDescriptorHasSignature = false
    if (hasDataDescriptor) {
      const descriptorHasSignature = view.getUint32(dataEnd, true) === DATA_DESCRIPTOR_SIGNATURE
      const signedDescriptorOffset = dataEnd + 4
      const signedDescriptorMatches =
        descriptorHasSignature &&
        signedDescriptorOffset + 12 <= directoryOffset &&
        view.getUint32(signedDescriptorOffset, true) === crc32 &&
        view.getUint32(signedDescriptorOffset + 4, true) === compressedSize &&
        view.getUint32(signedDescriptorOffset + 8, true) === uncompressedSize
      const unsignedDescriptorMatches =
        dataEnd + 12 <= directoryOffset &&
        view.getUint32(dataEnd, true) === crc32 &&
        view.getUint32(dataEnd + 4, true) === compressedSize &&
        view.getUint32(dataEnd + 8, true) === uncompressedSize
      if (!signedDescriptorMatches && !unsignedDescriptorMatches) {
        throw new Error(`SB3 data descriptor does not match its central directory: ${name}`)
      }
      dataDescriptorHasSignature = signedDescriptorMatches
      localRecordEnd = signedDescriptorMatches ? signedDescriptorOffset + 12 : dataEnd + 12
    }
    localRecordRanges.push({ name, start: localHeaderOffset, end: localRecordEnd })

    totalUncompressedBytes += uncompressedSize
    if (totalUncompressedBytes > maximumUncompressedBytes) {
      throw new Error(
        `SB3 exceeds the ${Math.floor(maximumUncompressedBytes / (1024 * 1024))} MiB uncompressed-size limit`,
      )
    }

    entries.push({
      index,
      name,
      filenameBytes: filenameBytes.slice(),
      filenameEncoding: usesUtf8 ? 'utf-8' : 'legacy',
      flags,
      compressionMethod,
      crc32: crc32.toString(16).padStart(8, '0'),
      compressedSize,
      uncompressedSize,
      externalAttributes,
      versionMadeBy,
      versionNeeded,
      internalAttributes,
      dosTime: view.getUint16(offset + 12, true),
      dosDate: view.getUint16(offset + 14, true),
      localVersionNeeded,
      localExtraBytes: localExtraBytes.slice(),
      centralExtraBytes: extraBytes.slice(),
      commentBytes: bytes.subarray(offset + 46 + filenameLength + extraLength, entryEnd).slice(),
      hasDataDescriptor,
      dataDescriptorHasSignature,
      localHeaderOffset,
      centralHeaderOffset: offset,
      dataOffset: contentOffset,
      isDirectory: name.endsWith('/'),
    })
    offset = entryEnd
  }

  if (offset !== directoryOffset + directorySize) {
    throw new Error('SB3 central directory size does not match its entries')
  }
  localRecordRanges.sort((left, right) => left.start - right.start)
  for (let index = 1; index < localRecordRanges.length; index += 1) {
    const previous = localRecordRanges[index - 1]
    const current = localRecordRanges[index]
    if (current.start < previous.end) {
      throw new Error(`SB3 local records overlap: ${previous.name} and ${current.name}`)
    }
  }
  return { entries, endRecordOffset: directoryEnd, offset: directoryOffset, size: directorySize }
}
