import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { exportLosslessSb3, importLosslessSb3, patchLosslessSb3BlockGraphs } from '../../src/core/archive/sb3-archive'
import { projectJsonSignature } from '../../src/core/compatibility/project-signature'
import { extractProjectBlockGraphs, replaceProjectBlockGraphs, validateScratchBlockGraph } from '../../src/core/graph'

const fixture = (name: string) => fileURLToPath(new URL(`../../../scratch-vm/test/fixtures/${name}`, import.meta.url))
const CP437_REFERENCE =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄' +
  '▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

const findSignature = (bytes: Uint8Array, signature: number, startOffset = 0): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = startOffset; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset
  }
  throw new Error(`ZIP signature was not found: ${signature.toString(16)}`)
}

const minimalArchive = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('project.json', '{}')
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
}

const withEntryMetadata = async (): Promise<Uint8Array> => {
  let archive = await minimalArchive()
  const localExtra = Uint8Array.from([0xfe, 0xca, 3, 0, 0x11, 0x22, 0x33])
  const centralExtra = Uint8Array.from([0xad, 0xde, 2, 0, 0x44, 0x55])
  const entryComment = Uint8Array.from([0, 0xff, 0x41])
  const insert = (at: number, bytes: Uint8Array): void => {
    const next = new Uint8Array(archive.byteLength + bytes.byteLength)
    next.set(archive.subarray(0, at))
    next.set(bytes, at)
    next.set(archive.subarray(at), at + bytes.byteLength)
    archive = next
  }

  let view = new DataView(archive.buffer)
  let localHeader = findSignature(archive, 0x04034b50)
  const localNameLength = view.getUint16(localHeader + 26, true)
  const localExtraOffset = localHeader + 30 + localNameLength
  const localExtraLength = view.getUint16(localHeader + 28, true)
  insert(localExtraOffset + localExtraLength, localExtra)
  view = new DataView(archive.buffer)
  localHeader = findSignature(archive, 0x04034b50)
  view.setUint16(localHeader + 28, localExtraLength + localExtra.byteLength, true)

  let centralHeader = findSignature(archive, 0x02014b50)
  const centralNameLength = view.getUint16(centralHeader + 28, true)
  const centralExtraLength = view.getUint16(centralHeader + 30, true)
  const centralCommentLength = view.getUint16(centralHeader + 32, true)
  const centralExtraOffset = centralHeader + 46 + centralNameLength
  insert(centralExtraOffset + centralExtraLength, Uint8Array.from([...centralExtra, ...entryComment]))
  view = new DataView(archive.buffer)
  centralHeader = findSignature(archive, 0x02014b50)
  view.setUint16(centralHeader + 30, centralExtraLength + centralExtra.byteLength, true)
  view.setUint16(centralHeader + 32, centralCommentLength + entryComment.byteLength, true)
  view.setUint16(centralHeader + 4, 0x031e, true)
  view.setUint16(centralHeader + 6, 20, true)
  view.setUint16(centralHeader + 36, 0x1234, true)
  view.setUint32(centralHeader + 38, 0x81a40000, true)
  view.setUint16(centralHeader + 12, 0x4a21, true)
  view.setUint16(centralHeader + 14, 0x5c2d, true)
  view.setUint16(localHeader + 4, 20, true)
  view.setUint16(localHeader + 10, 0x4a21, true)
  view.setUint16(localHeader + 12, 0x5c2d, true)

  const end = findSignature(archive, 0x06054b50)
  view.setUint32(end + 12, view.getUint32(end + 12, true) + centralExtra.byteLength + entryComment.byteLength, true)
  view.setUint32(end + 16, view.getUint32(end + 16, true) + localExtra.byteLength, true)
  return archive
}

const replaceArchiveFilenameByte = (archive: Uint8Array, name: string, index: number, value: number): void => {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const directoryEnd = findSignature(archive, 0x06054b50)
  let centralEntry = findSignature(archive, 0x02014b50)
  while (centralEntry < directoryEnd) {
    const nameLength = view.getUint16(centralEntry + 28, true)
    const extraLength = view.getUint16(centralEntry + 30, true)
    const commentLength = view.getUint16(centralEntry + 32, true)
    const nameStart = centralEntry + 46
    const currentName = new TextDecoder().decode(archive.subarray(nameStart, nameStart + nameLength))
    if (currentName === name) {
      if (index >= nameLength) throw new Error(`Filename index ${index} exceeds ${name}`)
      const localHeader = view.getUint32(centralEntry + 42, true)
      archive[nameStart + index] = value
      archive[localHeader + 30 + index] = value
      return
    }
    centralEntry += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`ZIP fixture has no entry named ${name}`)
}

const findUnicodePathFieldOffsets = (
  archive: Uint8Array,
  name: string,
): { local: number; central: number; localHeader: number; centralHeader: number } => {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const directoryEnd = findSignature(archive, 0x06054b50)
  let centralEntry = findSignature(archive, 0x02014b50)
  while (centralEntry < directoryEnd) {
    const nameLength = view.getUint16(centralEntry + 28, true)
    const extraLength = view.getUint16(centralEntry + 30, true)
    const commentLength = view.getUint16(centralEntry + 32, true)
    const nameStart = centralEntry + 46
    const currentName = new TextDecoder().decode(archive.subarray(nameStart, nameStart + nameLength))
    if (currentName === name) {
      const localHeader = view.getUint32(centralEntry + 42, true)
      let centralExtra = nameStart + nameLength
      const centralExtraEnd = centralExtra + extraLength
      let localExtra = localHeader + 30 + nameLength
      const localExtraEnd = localExtra + view.getUint16(localHeader + 28, true)
      while (centralExtra + 4 <= centralExtraEnd) {
        const fieldSize = view.getUint16(centralExtra + 2, true)
        if (view.getUint16(centralExtra, true) === 0x7075) {
          return { local: localExtra + 4, central: centralExtra + 4, localHeader, centralHeader: centralEntry }
        }
        centralExtra += 4 + fieldSize
      }
      while (localExtra + 4 <= localExtraEnd) {
        const fieldSize = view.getUint16(localExtra + 2, true)
        localExtra += 4 + fieldSize
      }
      throw new Error(`ZIP fixture has no Unicode Path extra field for ${name}`)
    }
    centralEntry += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`ZIP fixture has no entry named ${name}`)
}

const duplicateUnicodePathField = (archive: Uint8Array, name: string): Uint8Array => {
  const initialOffsets = findUnicodePathFieldOffsets(archive, name)
  const initialView = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const fieldLength = 4 + initialView.getUint16(initialOffsets.central - 2, true)
  const duplicate = archive.slice(initialOffsets.central - 4, initialOffsets.central - 4 + fieldLength)
  const localNameLength = initialView.getUint16(initialOffsets.localHeader + 26, true)
  const localExtraLength = initialView.getUint16(initialOffsets.localHeader + 28, true)
  const localInsertOffset = initialOffsets.localHeader + 30 + localNameLength + localExtraLength
  const withLocalDuplicate = new Uint8Array(archive.byteLength + duplicate.byteLength)
  withLocalDuplicate.set(archive.subarray(0, localInsertOffset))
  withLocalDuplicate.set(duplicate, localInsertOffset)
  withLocalDuplicate.set(archive.subarray(localInsertOffset), localInsertOffset + duplicate.byteLength)
  new DataView(withLocalDuplicate.buffer).setUint16(
    initialOffsets.localHeader + 28,
    localExtraLength + duplicate.byteLength,
    true,
  )
  const localEndRecord = findSignature(withLocalDuplicate, 0x06054b50)
  const withLocalView = new DataView(withLocalDuplicate.buffer)
  withLocalView.setUint32(
    localEndRecord + 16,
    withLocalView.getUint32(localEndRecord + 16, true) + duplicate.byteLength,
    true,
  )

  const updatedOffsets = findUnicodePathFieldOffsets(withLocalDuplicate, name)
  const updatedView = new DataView(withLocalDuplicate.buffer)
  const centralNameLength = updatedView.getUint16(updatedOffsets.centralHeader + 28, true)
  const centralExtraLength = updatedView.getUint16(updatedOffsets.centralHeader + 30, true)
  const centralInsertOffset = updatedOffsets.centralHeader + 46 + centralNameLength + centralExtraLength
  const output = new Uint8Array(withLocalDuplicate.byteLength + duplicate.byteLength)
  output.set(withLocalDuplicate.subarray(0, centralInsertOffset))
  output.set(duplicate, centralInsertOffset)
  output.set(withLocalDuplicate.subarray(centralInsertOffset), centralInsertOffset + duplicate.byteLength)
  const outputView = new DataView(output.buffer)
  outputView.setUint16(updatedOffsets.centralHeader + 30, centralExtraLength + duplicate.byteLength, true)
  const endRecord = findSignature(output, 0x06054b50)
  outputView.setUint32(endRecord + 12, outputView.getUint32(endRecord + 12, true) + duplicate.byteLength, true)
  return output
}

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

const withDirectoryPayload = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('project.json', '{}', { compression: 'STORE', createFolders: false })
  zip.folder('assets')
  const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const centralDirectory = findSignature(archive, 0x02014b50)
  const endOfCentralDirectory = findSignature(archive, 0x06054b50)
  let directoryEntry = -1
  let offset = centralDirectory
  while (offset < endOfCentralDirectory) {
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = new TextDecoder().decode(archive.subarray(offset + 46, offset + 46 + nameLength))
    if (name === 'assets/') directoryEntry = offset
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (directoryEntry < 0) throw new Error('ZIP fixture has no directory entry')

  const payload = new Uint8Array([0x78])
  const localHeader = view.getUint32(directoryEntry + 42, true)
  const localNameLength = view.getUint16(localHeader + 26, true)
  const localExtraLength = view.getUint16(localHeader + 28, true)
  const payloadOffset = localHeader + 30 + localNameLength + localExtraLength
  const result = new Uint8Array(archive.byteLength + payload.byteLength)
  result.set(archive.subarray(0, payloadOffset))
  result.set(payload, payloadOffset)
  result.set(archive.subarray(payloadOffset), payloadOffset + payload.byteLength)

  const resultView = new DataView(result.buffer)
  const centralEntryAfterInsert = directoryEntry + payload.byteLength
  const endRecordAfterInsert = endOfCentralDirectory + payload.byteLength
  const checksum = crc32(payload)
  resultView.setUint32(localHeader + 14, checksum, true)
  resultView.setUint32(localHeader + 18, payload.byteLength, true)
  resultView.setUint32(localHeader + 22, payload.byteLength, true)
  resultView.setUint32(centralEntryAfterInsert + 16, checksum, true)
  resultView.setUint32(centralEntryAfterInsert + 20, payload.byteLength, true)
  resultView.setUint32(centralEntryAfterInsert + 24, payload.byteLength, true)
  resultView.setUint32(
    endRecordAfterInsert + 16,
    view.getUint32(endOfCentralDirectory + 16, true) + payload.byteLength,
    true,
  )
  return result
}

const withEndOfCentralDirectorySignatureInComment = async (commentPrefix = new Uint8Array()): Promise<Uint8Array> => {
  const archive = await minimalArchive()
  const endOfCentralDirectory = findSignature(archive, 0x06054b50)
  const fakeEndRecord = new Uint8Array(22)
  new DataView(fakeEndRecord.buffer).setUint32(0, 0x06054b50, true)
  const comment = new Uint8Array(commentPrefix.byteLength + fakeEndRecord.byteLength)
  comment.set(commentPrefix)
  comment.set(fakeEndRecord, commentPrefix.byteLength)
  const result = new Uint8Array(archive.byteLength + comment.byteLength)
  result.set(archive)
  result.set(comment, archive.byteLength)
  new DataView(result.buffer).setUint16(endOfCentralDirectory + 20, comment.byteLength, true)
  return result
}

const withDataDescriptor = async (withSignature: boolean): Promise<Uint8Array> => {
  const archive = await minimalArchive()
  const localHeader = findSignature(archive, 0x04034b50)
  const centralDirectory = findSignature(archive, 0x02014b50)
  const endOfCentralDirectory = findSignature(archive, 0x06054b50)
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const filenameLength = view.getUint16(localHeader + 26, true)
  const extraLength = view.getUint16(localHeader + 28, true)
  const compressedSize = view.getUint32(localHeader + 18, true)
  const payloadEnd = localHeader + 30 + filenameLength + extraLength + compressedSize
  const descriptorLength = withSignature ? 16 : 12
  const descriptor = new Uint8Array(descriptorLength)
  const descriptorView = new DataView(descriptor.buffer)
  const descriptorOffset = withSignature ? 4 : 0
  if (withSignature) descriptorView.setUint32(0, 0x08074b50, true)
  descriptorView.setUint32(descriptorOffset, view.getUint32(localHeader + 14, true), true)
  descriptorView.setUint32(descriptorOffset + 4, compressedSize, true)
  descriptorView.setUint32(descriptorOffset + 8, view.getUint32(localHeader + 22, true), true)

  const result = new Uint8Array(archive.byteLength + descriptorLength)
  result.set(archive.subarray(0, payloadEnd))
  result.set(descriptor, payloadEnd)
  result.set(archive.subarray(payloadEnd), payloadEnd + descriptorLength)
  const resultView = new DataView(result.buffer)
  resultView.setUint16(localHeader + 6, view.getUint16(localHeader + 6, true) | 0x0008, true)
  resultView.setUint32(localHeader + 14, 0, true)
  resultView.setUint32(localHeader + 18, 0, true)
  resultView.setUint32(localHeader + 22, 0, true)
  resultView.setUint16(
    centralDirectory + descriptorLength + 8,
    view.getUint16(centralDirectory + 8, true) | 0x0008,
    true,
  )
  resultView.setUint32(
    endOfCentralDirectory + descriptorLength + 16,
    view.getUint32(endOfCentralDirectory + 16, true) + descriptorLength,
    true,
  )
  return result
}

const withOverlappingLocalRecord = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('project.json', '{}', { compression: 'STORE', createFolders: false })
  zip.file('assets/x.bin', new Uint8Array([120]), { compression: 'STORE', createFolders: false })
  const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
  const localHeader = findSignature(archive, 0x04034b50)
  const secondLocalHeader = findSignature(archive, 0x04034b50, localHeader + 4)
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const secondRecordLength =
    30 +
    view.getUint16(secondLocalHeader + 26, true) +
    view.getUint16(secondLocalHeader + 28, true) +
    view.getUint32(secondLocalHeader + 18, true)
  const embeddedRecord = archive.slice(secondLocalHeader, secondLocalHeader + secondRecordLength)
  const firstFilenameLength = view.getUint16(localHeader + 26, true)
  const firstExtraLength = view.getUint16(localHeader + 28, true)
  const insertionOffset = localHeader + 30 + firstFilenameLength + firstExtraLength
  const result = new Uint8Array(archive.byteLength + embeddedRecord.byteLength)
  result.set(archive.subarray(0, insertionOffset))
  result.set(embeddedRecord, insertionOffset)
  result.set(archive.subarray(insertionOffset), insertionOffset + embeddedRecord.byteLength)

  const resultView = new DataView(result.buffer)
  resultView.setUint16(localHeader + 28, firstExtraLength + embeddedRecord.byteLength, true)
  const secondCentralEntry = findSignature(result, 0x02014b50, findSignature(result, 0x02014b50) + 4)
  resultView.setUint32(secondCentralEntry + 42, insertionOffset, true)
  const endOfCentralDirectory = findSignature(result, 0x06054b50)
  resultView.setUint32(
    endOfCentralDirectory + 16,
    resultView.getUint32(endOfCentralDirectory + 16, true) + embeddedRecord.byteLength,
    true,
  )
  return result
}

describe('lossless SB3 archive path', () => {
  it('shares the extracted project bytes and isolates all entries from later input mutation', async () => {
    const zip = new JSZip()
    const asset = new Uint8Array([0, 1, 2, 127, 255])
    zip.file('project.json', '{"targets":[]}')
    zip.file('assets/tiny.bin', asset)
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })

    const imported = await importLosslessSb3(source)
    const projectEntry = imported.entries.find((entry) => entry.name === 'project.json')
    const assetEntry = imported.entries.find((entry) => entry.name === 'assets/tiny.bin')

    expect(imported.projectJsonBytes).toBe(projectEntry?.bytes)
    source.fill(0)
    expect(new TextDecoder().decode(imported.projectJsonBytes)).toBe('{"targets":[]}')
    expect(assetEntry?.bytes).toEqual(asset)
    expect(assetEntry?.sha256).toBe(createHash('sha256').update(asset).digest('hex'))
  })

  it('preserves an explicit UTF-8 filename flag on an ASCII path', async () => {
    const archive = await minimalArchive()
    const localHeader = findSignature(archive, 0x04034b50)
    const centralDirectory = findSignature(archive, 0x02014b50)
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    view.setUint16(localHeader + 6, view.getUint16(localHeader + 6, true) | 0x0800, true)
    view.setUint16(centralDirectory + 8, view.getUint16(centralDirectory + 8, true) | 0x0800, true)

    const imported = await importLosslessSb3(archive)
    expect(imported.entries[0].filenameEncoding).toBe('utf-8')
    const exported = await exportLosslessSb3(imported)
    const restored = await importLosslessSb3(await exported.arrayBuffer())
    expect(restored.entries[0].filenameEncoding).toBe('utf-8')
    expect(restored.entries[0].filenameBytes).toEqual(imported.entries[0].filenameBytes)
  })

  it('preserves local/central extra fields, entry comments, versions, attributes, and raw DOS timestamps', async () => {
    const source = await withEntryMetadata()
    const imported = await importLosslessSb3(source)
    const original = imported.entries[0]
    expect(original).toMatchObject({
      versionMadeBy: 0x031e,
      versionNeeded: 20,
      localVersionNeeded: 20,
      internalAttributes: 0x1234,
      externalAttributes: 0x81a40000,
      dosTime: 0x4a21,
      dosDate: 0x5c2d,
    })
    expect(original.localExtraBytes).toEqual(Uint8Array.from([0xfe, 0xca, 3, 0, 0x11, 0x22, 0x33]))
    expect(original.centralExtraBytes).toEqual(Uint8Array.from([0xad, 0xde, 2, 0, 0x44, 0x55]))
    expect(original.commentBytes).toEqual(Uint8Array.from([0, 0xff, 0x41]))

    const restored = await importLosslessSb3(await (await exportLosslessSb3(imported)).arrayBuffer())
    expect(restored.entries[0]).toMatchObject({
      versionMadeBy: original.versionMadeBy,
      versionNeeded: original.versionNeeded,
      localVersionNeeded: original.localVersionNeeded,
      internalAttributes: original.internalAttributes,
      externalAttributes: original.externalAttributes,
      dosTime: original.dosTime,
      dosDate: original.dosDate,
    })
    expect(restored.entries[0]?.localExtraBytes).toEqual(original.localExtraBytes)
    expect(restored.entries[0]?.centralExtraBytes).toEqual(original.centralExtraBytes)
    expect(restored.entries[0]?.commentBytes).toEqual(original.commentBytes)
    expect(restored.entries[0]?.bytes).toEqual(original.bytes)
  })

  it('rejects directory entries that carry payload bytes instead of silently dropping them', async () => {
    await expect(importLosslessSb3(await withDirectoryPayload())).rejects.toThrow(
      'SB3 directory entry contains file data: assets/',
    )
  })

  it('keeps project JSON bytes and asset hashes without invoking Scratch VM', async () => {
    const source = await readFile(fixture('comments.sb3'))
    const imported = await importLosslessSb3(source)
    const projectEntry = imported.entries.find((entry) => entry.name === 'project.json')

    expect(imported.projectEntryName).toBe('project.json')
    expect(projectEntry?.sha256).toHaveLength(64)
    expect(projectEntry?.centralDirectoryIndex).toBeGreaterThanOrEqual(0)
    expect([0, 8]).toContain(projectEntry?.compressionMethod)
    expect(projectEntry?.uncompressedSize).toBe(imported.projectJsonBytes.byteLength)
    expect(projectEntry?.crc32).toMatch(/^[0-9a-f]{8}$/)
    expect(imported.projectJsonBytes).toEqual(projectEntry?.bytes)
    expect(imported.projectJson.targets).toBeDefined()

    const exported = await exportLosslessSb3(imported)
    const reimported = await importLosslessSb3(await exported.arrayBuffer())
    expect(reimported.projectJsonBytes).toEqual(imported.projectJsonBytes)
    expect(reimported.entries.map((entry) => [entry.name, entry.sha256])).toEqual(
      imported.entries.map((entry) => [entry.name, entry.sha256]),
    )
  })

  it('preserves separate entries when two assets have identical bytes', async () => {
    const zip = new JSZip()
    const sharedBytes = new TextEncoder().encode('same asset bytes\u0000'.repeat(64))
    zip.file('project.json', '{"targets":[]}')
    zip.file('assets/costume-one.svg', sharedBytes, { compression: 'STORE' })
    zip.file('assets/costume-two.svg', sharedBytes, { compression: 'DEFLATE' })

    const source = await zip.generateAsync({ type: 'uint8array' })
    const imported = await importLosslessSb3(source)
    const assets = imported.entries.filter((entry) => entry.name.startsWith('assets/') && !entry.name.endsWith('/'))

    expect(assets.map(({ name }) => name)).toEqual(['assets/costume-one.svg', 'assets/costume-two.svg'])
    expect(assets.map(({ sha256 }) => sha256)).toEqual([
      createHash('sha256').update(sharedBytes).digest('hex'),
      createHash('sha256').update(sharedBytes).digest('hex'),
    ])
    expect(assets[0]?.bytes).not.toBe(assets[1]?.bytes)

    const restored = await importLosslessSb3(await (await exportLosslessSb3(imported)).arrayBuffer())
    const restoredAssets = restored.entries.filter(
      (entry) => entry.name.startsWith('assets/') && !entry.name.endsWith('/'),
    )
    expect(restoredAssets.map(({ name, sha256, compressionMethod }) => [name, sha256, compressionMethod])).toEqual([
      ['assets/costume-one.svg', createHash('sha256').update(sharedBytes).digest('hex'), 0],
      ['assets/costume-two.svg', createHash('sha256').update(sharedBytes).digest('hex'), 8],
    ])
    expect(restoredAssets.map(({ bytes }) => bytes)).toEqual([sharedBytes, sharedBytes])
  })

  it('accepts a nested project.json and reports the archive boundary', async () => {
    const imported = await importLosslessSb3(await readFile(fixture('origin.sb3')))
    expect(imported.projectEntryName).toBe('origin/project.json')
    expect(imported.warnings).toEqual(['project.json is nested at origin/project.json'])
  })

  it('patches selected raw blocks and keeps every other archive entry unchanged', async () => {
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        meta: { custom: 'preserved' },
        targets: [
          {
            name: 'Stage',
            isStage: true,
            blocks: {
              opaque: {
                opcode: 'thirdparty_custom',
                next: null,
                parent: null,
                inputs: {},
                fields: { VALUE: ['before', null] },
                pluginData: { keep: true },
                mutation: { obsolete: true, vendor: { keep: true, remove: 'selected' } },
                topLevel: true,
              },
            },
          },
          { name: 'Sprite1', isStage: false, blocks: {} },
        ],
      }),
    )
    zip.file('assets/costume.svg', '<svg/>')
    const imported = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const patched = patchLosslessSb3BlockGraphs(imported, [
      {
        targetIndex: 0,
        targetName: 'Stage',
        isStage: true,
        blocks: {
          opaque: {
            fields: { VALUE: ['after', null] },
            setPaths: [{ path: '/mutation/obsolete', value: false }],
            removePaths: ['/mutation/vendor/remove'],
          },
        },
      },
    ])
    const exported = await exportLosslessSb3(patched)
    const result = await importLosslessSb3(await exported.arrayBuffer())
    const targets = result.projectJson.targets as {
      blocks: Record<
        string,
        { fields?: unknown; pluginData?: unknown; mutation?: { obsolete?: unknown; vendor?: unknown } }
      >
    }[]

    expect(targets[0].blocks.opaque.fields).toEqual({ VALUE: ['after', null] })
    expect(targets[0].blocks.opaque.pluginData).toEqual({ keep: true })
    expect(targets[0].blocks.opaque.mutation).toEqual({ obsolete: false, vendor: { keep: true } })
    expect(targets[1].blocks).toEqual({})
    expect(result.projectJson.meta).toEqual({ custom: 'preserved' })
    expect(result.entries.find(({ name }) => name === 'assets/costume.svg')?.sha256).toBe(
      imported.entries.find(({ name }) => name === 'assets/costume.svg')?.sha256,
    )
  })

  it('round-trips and patches an unknown-opcode SB3 without losing opaque graph data', async () => {
    const zip = new JSZip()
    const project = {
      targets: [
        {
          name: 'Stage',
          isStage: true,
          blocks: {
            extension_root: {
              opcode: 'thirdparty_unknown_reporter',
              next: null,
              parent: null,
              inputs: {},
              fields: { MODE: ['custom', null] },
              mutation: { vendor: 'thirdparty', payload: ['a', 'b'] },
              comment: 'opaque comment',
              extensionData: { version: 7 },
              topLevel: true,
              shadow: false,
            },
          },
        },
      ],
      monitors: [],
      extensions: ['thirdparty'],
      meta: { semver: '3.0.0' },
    }
    zip.file('project.json', JSON.stringify(project))
    zip.file('assets/unchanged.dat', new Uint8Array([0, 1, 2, 255]))

    const imported = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
    const snapshots = extractProjectBlockGraphs(imported.projectJson)
    expect(snapshots[0].issues).toEqual([])
    expect(validateScratchBlockGraph(snapshots[0].blocks)).toEqual([])
    expect(projectJsonSignature(replaceProjectBlockGraphs(imported.projectJson, snapshots))).toEqual(
      projectJsonSignature(imported.projectJson),
    )

    const patched = patchLosslessSb3BlockGraphs(imported, [
      {
        targetIndex: 0,
        targetName: 'Stage',
        isStage: true,
        blocks: { extension_root: { fields: { MODE: ['edited', null] } } },
      },
    ])
    const exported = await exportLosslessSb3(patched)
    const restored = await importLosslessSb3(await exported.arrayBuffer())
    const restoredGraph = extractProjectBlockGraphs(restored.projectJson)[0]

    expect(restoredGraph.issues).toEqual([])
    expect(restoredGraph.blocks.extension_root).toMatchObject({
      opcode: 'thirdparty_unknown_reporter',
      fields: { MODE: ['edited', null] },
      mutation: { vendor: 'thirdparty', payload: ['a', 'b'] },
      comment: 'opaque comment',
      extensionData: { version: 7 },
    })
    expect(restored.entries.find(({ name }) => name === 'assets/unchanged.dat')?.sha256).toBe(
      imported.entries.find(({ name }) => name === 'assets/unchanged.dat')?.sha256,
    )
  })

  it('preserves seeded opaque fields through Raw IR patches and SB3 export', async () => {
    let state = 0x0ddba11
    const nextRandom = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const ids = Array.from({ length: 24 }, (_, sample) => `vendor_${sample}_${nextRandom().toString(36)}`)
    const blockIds = ids.map((id) => ({
      root: id,
      next: `${id}_next`,
      active: `${id}_active`,
      shadow: `${id}_shadow`,
    }))
    const blocks = Object.fromEntries(
      blockIds.flatMap(({ root, next, active, shadow }, sample) =>
        [
          { id: root, role: 'root' },
          { id: next, role: 'next' },
          { id: active, role: 'active' },
          { id: shadow, role: 'shadow' },
        ].map(({ id, role }) => [
          id,
          {
            opcode: `thirdparty_unknown_${sample}_${role}`,
            next: role === 'root' ? next : null,
            parent: role === 'root' ? null : root,
            inputs: role === 'root' ? { 'vendor/input': [3, active, shadow] } : {},
            fields: { MODE: [`before-${sample}`, null] },
            mutation: {
              seed: nextRandom(),
              nested: { value: `opaque-${sample}-${role}` },
              'vendor/data': { seed: sample, text: `before/${sample}~/${role}` },
            },
            extensionData: { vendor: 'test', sample, role, values: [nextRandom(), '中😀'] },
            topLevel: role === 'root',
            shadow: role === 'shadow',
          },
        ]),
      ),
    )
    const zip = new JSZip()
    zip.file(
      'project.json',
      JSON.stringify({
        targets: [
          { name: 'Stage', isStage: true, blocks },
          { name: 'Sprite1', isStage: false, blocks: {} },
        ],
      }),
    )
    zip.file('assets/unchanged.dat', new Uint8Array([0, 1, 2, 255]))

    const imported = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
    const snapshot = extractProjectBlockGraphs(imported.projectJson)[0]
    expect(snapshot.issues).toEqual([])
    expect(validateScratchBlockGraph(snapshot.blocks)).toEqual([])

    const patched = patchLosslessSb3BlockGraphs(imported, [
      {
        targetIndex: 0,
        targetName: 'Stage',
        isStage: true,
        blocks: Object.fromEntries(
          blockIds.flatMap(({ root, next, active, shadow }, sample) =>
            [root, next, active, shadow].map((id) => [
              id,
              {
                fields: { MODE: [`after-${sample}`, null] },
                setPaths: [
                  { path: '/mutation/vendor~1data', value: { seed: sample, text: `patched/${sample}~/${id}` } },
                ],
              },
            ]),
          ),
        ),
      },
    ])
    const exported = await exportLosslessSb3(patched)
    const restored = await importLosslessSb3(await exported.arrayBuffer())
    const restoredBlocks = (restored.projectJson.targets as { blocks: Record<string, Record<string, unknown>> }[])[0]
      .blocks

    for (let sample = 0; sample < blockIds.length; sample += 1) {
      const { root, next, active, shadow } = blockIds[sample]
      expect(restoredBlocks[root].next, `sample ${sample} next chain`).toBe(next)
      expect(restoredBlocks[root].inputs, `sample ${sample} active/shadow input`).toEqual({
        'vendor/input': [3, active, shadow],
      })
      for (const [id, role] of [
        [root, 'root'],
        [next, 'next'],
        [active, 'active'],
        [shadow, 'shadow'],
      ] as const) {
        const block = restoredBlocks[id]
        expect(block.fields, `sample ${sample} ${role}`).toEqual({ MODE: [`after-${sample}`, null] })
        const extensionData = block.extensionData as {
          vendor: string
          sample: number
          role: string
          values: unknown[]
        }
        expect(extensionData).toMatchObject({ vendor: 'test', sample, role })
        expect(extensionData.values).toHaveLength(2)
        expect(typeof extensionData.values[0]).toBe('number')
        expect(extensionData.values[1]).toBe('中😀')
        expect(block.mutation, `sample ${sample} ${role}`).toMatchObject({
          'vendor/data': { seed: sample, text: `patched/${sample}~/${id}` },
        })
        expect(block.parent).toBe(role === 'root' ? null : root)
        expect(block.shadow).toBe(role === 'shadow')
      }
    }
    expect(restored.entries.find(({ name }) => name === 'assets/unchanged.dat')?.sha256).toBe(
      imported.entries.find(({ name }) => name === 'assets/unchanged.dat')?.sha256,
    )
  })

  it('rejects malformed archive bytes', async () => {
    const source = await readFile(fixture('comments.sb3'))
    const corrupted = new Uint8Array(source)
    corrupted[0] = 0
    await expect(importLosslessSb3(corrupted)).rejects.toThrow()
  })

  it('finds the real end record when a ZIP comment ends with a fake signature', async () => {
    const imported = await importLosslessSb3(await withEndOfCentralDirectorySignatureInComment())
    expect(imported.projectJson).toEqual({})
    expect(imported.entries.map(({ name }) => name)).toEqual(['project.json'])
    expect(imported.archiveCommentBytes).toHaveLength(22)

    const restored = await importLosslessSb3(await (await exportLosslessSb3(imported)).arrayBuffer())
    expect(restored.archiveCommentBytes).toEqual(imported.archiveCommentBytes)
    expect(restored.entries.map(({ name, sha256 }) => [name, sha256])).toEqual(
      imported.entries.map(({ name, sha256 }) => [name, sha256]),
    )
  })

  it('round-trips seeded arbitrary ZIP comments ending in false EOCD records', async () => {
    let state = 0x5a17c0de
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state >>> 0
    }

    for (let sample = 0; sample < 24; sample += 1) {
      const prefixLength = sample === 23 ? 65_513 : nextRandom() % 2_049
      const prefix = new Uint8Array(prefixLength)
      for (let index = 0; index < prefix.byteLength; index += 1) prefix[index] = nextRandom() & 0xff
      const source = await withEndOfCentralDirectorySignatureInComment(prefix)
      const imported = await importLosslessSb3(source)
      const expectedComment = new Uint8Array(prefix.byteLength + 22)
      expectedComment.set(prefix)
      expectedComment.set(source.subarray(source.byteLength - 22), prefix.byteLength)
      expect(imported.archiveCommentBytes, `source comment seed ${sample}`).toEqual(expectedComment)

      const restored = await importLosslessSb3(await (await exportLosslessSb3(imported)).arrayBuffer())
      expect(restored.archiveCommentBytes, `export comment seed ${sample}`).toEqual(expectedComment)
      expect(restored.entries.map(({ name, sha256 }) => [name, sha256])).toEqual(
        imported.entries.map(({ name, sha256 }) => [name, sha256]),
      )
    }
  })

  it('rejects seeded structure-aware ZIP header and directory mutations', async () => {
    const mutationCount = 128
    for (let sample = 0; sample < mutationCount; sample += 1) {
      const archive = await minimalArchive()
      const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
      const localHeader = findSignature(archive, 0x04034b50)
      const centralDirectory = findSignature(archive, 0x02014b50)
      const endOfCentralDirectory = findSignature(archive, 0x06054b50)
      const mutation = sample % 12

      switch (mutation) {
        case 0:
          view.setUint16(endOfCentralDirectory + 10, 2 + sample, true)
          break
        case 1:
          view.setUint32(endOfCentralDirectory + 12, 1 + sample, true)
          break
        case 2:
          view.setUint32(endOfCentralDirectory + 16, 1 + sample, true)
          break
        case 3:
          view.setUint16(centralDirectory + 28, 0, true)
          break
        case 4:
          view.setUint16(centralDirectory + 32, 1 + sample, true)
          break
        case 5:
          view.setUint32(centralDirectory + 42, archive.byteLength + sample, true)
          break
        case 6:
          view.setUint32(localHeader, 0, true)
          break
        case 7:
          view.setUint16(localHeader + 26, view.getUint16(localHeader + 26, true) + 1 + sample, true)
          break
        case 8:
          view.setUint16(localHeader + 28, 1 + sample, true)
          break
        case 9:
          view.setUint16(centralDirectory + 8, 1, true)
          break
        case 10:
          view.setUint16(centralDirectory + 10, 99 + sample, true)
          break
        case 11:
          view.setUint32(centralDirectory + 16, view.getUint32(centralDirectory + 16, true) ^ (1 + sample), true)
          break
      }

      await expect(importLosslessSb3(archive), `mutation seed ${sample} / kind ${mutation}`).rejects.toThrow()
    }
  })

  it('rejects structure-aware mutations across generated multi-entry SB3 archives', async () => {
    const mutationKinds = 15
    const samplesPerKind = 8
    for (let sample = 0; sample < mutationKinds * samplesPerKind; sample += 1) {
      const zip = new JSZip()
      zip.file('project.json', JSON.stringify({ targets: [], meta: { generatedMutationSeed: sample } }), {
        compression: 'STORE',
        createFolders: false,
      })
      const firstPayload = Uint8Array.from(
        { length: 96 + (sample % 31) },
        (_, index) => (sample * 29 + index * 17) & 0xff,
      )
      const secondPayload = Uint8Array.from(
        { length: 64 + (sample % 47) },
        (_, index) => (sample * 11 + index * 43) & 0xff,
      )
      const firstName = `assets/first-${sample}.bin`
      const secondName = `assets/second-${sample}.bin`
      zip.file(firstName, firstPayload, { compression: 'STORE', createFolders: false })
      zip.file(secondName, secondPayload, { compression: 'DEFLATE', createFolders: false })
      const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
      const endRecord = findSignature(archive, 0x06054b50)
      let centralEntry = findSignature(archive, 0x02014b50)
      const centralEntries: { offset: number; name: string }[] = []
      while (centralEntry < endRecord) {
        const nameLength = view.getUint16(centralEntry + 28, true)
        const extraLength = view.getUint16(centralEntry + 30, true)
        const commentLength = view.getUint16(centralEntry + 32, true)
        const name = new TextDecoder().decode(archive.subarray(centralEntry + 46, centralEntry + 46 + nameLength))
        centralEntries.push({ offset: centralEntry, name })
        centralEntry += 46 + nameLength + extraLength + commentLength
      }
      const targetName = sample % 2 === 0 ? firstName : secondName
      const targetCentral = centralEntries.find((entry) => entry.name === targetName)?.offset
      if (targetCentral === undefined) throw new Error(`Generated ZIP has no central entry for ${targetName}`)
      const localHeader = view.getUint32(targetCentral + 42, true)
      const mutation = Math.floor(sample / samplesPerKind)

      switch (mutation) {
        case 0:
          view.setUint16(endRecord + 10, view.getUint16(endRecord + 10, true) + 1, true)
          break
        case 1:
          view.setUint32(endRecord + 12, view.getUint32(endRecord + 12, true) + 1, true)
          break
        case 2:
          view.setUint32(endRecord + 16, view.getUint32(endRecord + 16, true) + 1, true)
          break
        case 3:
          view.setUint16(targetCentral + 28, 0, true)
          break
        case 4:
          view.setUint16(targetCentral + 32, view.getUint16(targetCentral + 32, true) + 1, true)
          break
        case 5:
          view.setUint32(targetCentral + 42, localHeader + 1, true)
          break
        case 6:
          view.setUint32(localHeader, 0, true)
          break
        case 7:
          view.setUint16(localHeader + 26, view.getUint16(localHeader + 26, true) + 1, true)
          break
        case 8:
          view.setUint16(localHeader + 28, view.getUint16(localHeader + 28, true) + 1, true)
          break
        case 9:
          view.setUint16(localHeader + 6, view.getUint16(localHeader + 6, true) | 1, true)
          break
        case 10:
          view.setUint16(targetCentral + 10, view.getUint16(targetCentral + 10, true) === 0 ? 8 : 0, true)
          break
        case 11:
          view.setUint32(targetCentral + 16, view.getUint32(targetCentral + 16, true) ^ 0x01010101, true)
          break
        case 12:
          view.setUint32(targetCentral + 20, view.getUint32(targetCentral + 20, true) + 1, true)
          break
        case 13:
          view.setUint32(localHeader + 22, view.getUint32(localHeader + 22, true) + 1, true)
          break
        case 14: {
          const localNameLength = view.getUint16(localHeader + 26, true)
          const localExtraLength = view.getUint16(localHeader + 28, true)
          const payloadOffset = localHeader + 30 + localNameLength + localExtraLength
          archive[payloadOffset + 2] ^= 0x80
          break
        }
        default:
          throw new Error(`Unknown ZIP mutation kind ${mutation}`)
      }

      await expect(
        importLosslessSb3(archive),
        `generated archive seed ${sample} / kind ${mutation}`,
      ).rejects.toThrow()
    }
  })

  it('rejects every strict prefix of a valid SB3 archive', async () => {
    const archive = await minimalArchive()
    for (let length = 0; length < archive.byteLength; length += 1) {
      await expect(
        importLosslessSb3(archive.subarray(0, length)),
        `truncated archive prefix of ${length}/${archive.byteLength} bytes`,
      ).rejects.toThrow()
    }
    await expect(importLosslessSb3(archive)).resolves.toMatchObject({ projectJson: {} })
  })

  it('rejects seeded invalid UTF-8 names when ZIP headers declare UTF-8 encoding', async () => {
    const invalidLeadingBytes = [0x80, 0xbf, 0xc0, 0xc1, 0xf5, 0xff]
    for (let sample = 0; sample < 24; sample += 1) {
      const archive = await minimalArchive()
      const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
      const localHeader = findSignature(archive, 0x04034b50)
      const centralDirectory = findSignature(archive, 0x02014b50)
      const filenameByte = invalidLeadingBytes[sample % invalidLeadingBytes.length]
      view.setUint16(localHeader + 6, view.getUint16(localHeader + 6, true) | 0x0800, true)
      view.setUint16(centralDirectory + 8, view.getUint16(centralDirectory + 8, true) | 0x0800, true)
      archive[localHeader + 30] = filenameByte
      archive[centralDirectory + 46] = filenameByte

      await expect(importLosslessSb3(archive), `UTF-8 seed ${sample}, first byte ${filenameByte}`).rejects.toThrow(
        'invalid UTF-8 filename',
      )
    }
  })

  it('decodes CP437 legacy filenames and preserves their logical names across lossless export', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { createFolders: false })
    zip.file('assets/x.bin', new Uint8Array([7, 8, 9]), { createFolders: false })
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const firstCentralDirectory = findSignature(archive, 0x02014b50)
    const firstNameLength = view.getUint16(firstCentralDirectory + 28, true)
    const firstExtraLength = view.getUint16(firstCentralDirectory + 30, true)
    const firstCommentLength = view.getUint16(firstCentralDirectory + 32, true)
    const secondCentralDirectory =
      firstCentralDirectory + 46 + firstNameLength + firstExtraLength + firstCommentLength
    const secondNameLength = view.getUint16(secondCentralDirectory + 28, true)
    const secondName = new TextDecoder().decode(
      archive.subarray(secondCentralDirectory + 46, secondCentralDirectory + 46 + secondNameLength),
    )
    expect(secondName).toBe('assets/x.bin')
    const localHeader = view.getUint32(secondCentralDirectory + 42, true)
    archive[localHeader + 30 + 'assets/'.length] = 0x82
    const assetCentralDirectory = secondCentralDirectory
    archive[assetCentralDirectory + 46 + 'assets/'.length] = 0x82

    const imported = await importLosslessSb3(archive)
    expect(imported.entries.some((entry) => entry.name === 'assets/é.bin')).toBe(true)
    const exported = await exportLosslessSb3(imported)
    const reimported = await importLosslessSb3(await exported.arrayBuffer())
    expect(reimported.entries.some((entry) => entry.name === 'assets/é.bin')).toBe(true)
  })

  it('uses a valid Unicode Path extra field when the legacy filename bytes differ', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { createFolders: false })
    zip.file('assets/é.bin', new Uint8Array([4, 5, 6]), { createFolders: false })
    const archive = await zip.generateAsync({
      type: 'uint8array',
      compression: 'STORE',
      encodeFileName: (name) => name.replace('é', String.fromCharCode(0x82)),
    })

    const imported = await importLosslessSb3(archive)
    expect(imported.entries.some((entry) => entry.name === 'assets/é.bin')).toBe(true)
    const exported = await exportLosslessSb3(imported)
    const reimported = await importLosslessSb3(await exported.arrayBuffer())
    expect(reimported.entries.some((entry) => entry.name === 'assets/é.bin')).toBe(true)
  })

  it('ignores a stale Unicode Path extra field when the filename CRC no longer matches', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { createFolders: false })
    zip.file('assets/é.bin', new Uint8Array([4, 5, 6]), { createFolders: false })
    const archive = await zip.generateAsync({
      type: 'uint8array',
      compression: 'STORE',
      encodeFileName: (name) => name.replace('é', String.fromCharCode(0x82)),
    })
    replaceArchiveFilenameByte(archive, 'assets/�.bin', 'assets/'.length, 0x83)

    const imported = await importLosslessSb3(archive)
    expect(imported.entries.some((entry) => entry.name === 'assets/â.bin')).toBe(true)
    const exported = await exportLosslessSb3(imported)
    const reimported = await importLosslessSb3(await exported.arrayBuffer())
    expect(reimported.entries.some((entry) => entry.name === 'assets/â.bin')).toBe(true)
  })

  it('rejects a truncated Unicode Path extra field', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { createFolders: false })
    zip.file('assets/é.bin', new Uint8Array([4]), { createFolders: false })
    const archive = await zip.generateAsync({
      type: 'uint8array',
      encodeFileName: (name) => name.replace('é', String.fromCharCode(0x82)),
    })
    const offsets = findUnicodePathFieldOffsets(archive, 'assets/�.bin')
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    view.setUint16(offsets.central - 2, 4, true)
    view.setUint16(offsets.local - 2, 4, true)

    await expect(importLosslessSb3(archive)).rejects.toThrow('Unicode Path extra field is truncated')
  })

  it('rejects duplicate Unicode Path extra fields', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { createFolders: false })
    zip.file('assets/é.bin', new Uint8Array([4]), { createFolders: false })
    const archive = await zip.generateAsync({
      type: 'uint8array',
      encodeFileName: (name) => name.replace('é', String.fromCharCode(0x82)),
    })
    const duplicated = duplicateUnicodePathField(archive, 'assets/�.bin')

    await expect(importLosslessSb3(duplicated)).rejects.toThrow('duplicate Unicode Path extra fields')
  })

  it('rejects invalid UTF-8 in a CRC-valid Unicode Path extra field', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { createFolders: false })
    zip.file('assets/é.bin', new Uint8Array([4]), { createFolders: false })
    const archive = await zip.generateAsync({
      type: 'uint8array',
      encodeFileName: (name) => name.replace('é', String.fromCharCode(0x82)),
    })
    const offsets = findUnicodePathFieldOffsets(archive, 'assets/�.bin')
    archive[offsets.central + 5 + 'assets/'.length] = 0xff
    archive[offsets.local + 5 + 'assets/'.length] = 0xff

    await expect(importLosslessSb3(archive)).rejects.toThrow('Unicode Path filename is not valid UTF-8')
  })

  it('decodes all 128 high-byte CP437 filename values without changing asset bytes', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { createFolders: false })
    const expectedNames = new Map<string, number>()
    for (let byte = 0x80; byte <= 0xff; byte += 1) {
      const sourceName = `assets/x${byte.toString(16)}.bin`
      const name = `assets/${CP437_REFERENCE[byte - 0x80]}${byte.toString(16)}.bin`
      expectedNames.set(name, byte)
      zip.file(sourceName, new Uint8Array([byte, byte ^ 0xff]), { createFolders: false })
    }
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    for (let byte = 0x80; byte <= 0xff; byte += 1) {
      replaceArchiveFilenameByte(archive, `assets/x${byte.toString(16)}.bin`, 'assets/'.length, byte)
    }

    const imported = await importLosslessSb3(archive)
    const actualEntries = new Map(
      imported.entries.filter(({ name }) => name.startsWith('assets/')).map(({ name, bytes }) => [name, bytes]),
    )
    expect([...actualEntries.keys()].sort()).toEqual([...expectedNames.keys()].sort())
    for (const [name, seed] of expectedNames) {
      expect(actualEntries.get(name)).toEqual(new Uint8Array([seed, seed ^ 0xff]))
    }

    const exported = await exportLosslessSb3(imported)
    const reimported = await importLosslessSb3(await exported.arrayBuffer())
    const restoredAssets = reimported.entries.filter(({ name }) => name.startsWith('assets/'))
    expect(restoredAssets.map(({ name }) => name).sort()).toEqual([...expectedNames.keys()].sort())
    for (const { name, filenameBytes, filenameEncoding } of restoredAssets) {
      expect(filenameEncoding).toBe('legacy')
      expect(filenameBytes['assets/'.length]).toBe(expectedNames.get(name))
    }
  })

  it('keeps payloads intact or rejects seeded single-bit ZIP mutations', async () => {
    const zip = new JSZip()
    const projectBytes = new TextEncoder().encode('{"targets":[],"meta":{"seed":17}}')
    const assetBytes = new Uint8Array(Array.from({ length: 256 }, (_, index) => (index * 37) & 0xff))
    zip.file('project.json', projectBytes)
    zip.file('assets/seed.bin', assetBytes)
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const original = await importLosslessSb3(source)
    const originalPayloads = original.entries.map(({ name, bytes }) => [name, [...bytes]])
    let randomState = 0x5eedf00d
    const random = (): number => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0
      return randomState
    }

    for (let sample = 0; sample < 512; sample += 1) {
      const mutated = new Uint8Array(source)
      const offset = random() % mutated.byteLength
      mutated[offset] ^= 1 << (random() % 8)
      let imported: Awaited<ReturnType<typeof importLosslessSb3>>
      try {
        imported = await importLosslessSb3(mutated)
      } catch {
        // A malformed archive is an expected result for a mutated sample.
        continue
      }
      expect(imported.projectJsonBytes, `sample ${sample}, byte ${offset}`).toEqual(original.projectJsonBytes)
      expect(
        imported.entries.map(({ name, bytes }) => [name, [...bytes]]),
        `sample ${sample}, byte ${offset}`,
      ).toEqual(originalPayloads)
    }
  })

  it('round-trips seeded valid archives across compression and native-decompression size boundaries', async () => {
    const threshold = 1024 * 1024
    let randomState = 0x71c39a2d
    const randomByte = (): number => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0
      return randomState >>> 24
    }
    const expectedEntries = new Map<string, { sha256: string; compressionMethod: number }>()

    for (let sample = 0; sample < 12; sample += 1) {
      const zip = new JSZip()
      const projectJson = JSON.stringify({ targets: [], meta: { generatedArchiveSeed: sample } })
      zip.file('project.json', projectJson, { compression: sample % 2 === 0 ? 'STORE' : 'DEFLATE' })
      const boundarySize = threshold + (sample % 3) - 1
      const assetSizes = [boundarySize, randomState % 4097, (sample * 17) % 257]

      for (let assetIndex = 0; assetIndex < assetSizes.length; assetIndex += 1) {
        const name = `assets/generated-${sample}-${assetIndex}.bin`
        const payload = new Uint8Array(assetSizes[assetIndex] ?? 0)
        for (let index = 0; index < payload.byteLength; index += 1) payload[index] = randomByte()
        const compressionMethod = (sample + assetIndex) % 2 === 0 ? 0 : 8
        expectedEntries.set(name, { sha256: createHash('sha256').update(payload).digest('hex'), compressionMethod })
        zip.file(name, payload, {
          compression: compressionMethod === 0 ? 'STORE' : 'DEFLATE',
          createFolders: false,
        })
      }

      const archiveBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      const imported = await importLosslessSb3(archiveBytes)
      expect(imported.projectJson).toEqual({ targets: [], meta: { generatedArchiveSeed: sample } })
      const expectedSampleEntries = new Map(
        [...expectedEntries.entries()].filter(([name]) => name.startsWith(`assets/generated-${sample}-`)),
      )
      const actualSampleEntries = (entries: Awaited<ReturnType<typeof importLosslessSb3>>['entries']) =>
        new Map(
          entries
            .filter(({ name }) => name.startsWith('assets/'))
            .map(({ name, sha256, compressionMethod }) => [name, { sha256, compressionMethod }]),
        )
      expect(actualSampleEntries(imported.entries)).toEqual(expectedSampleEntries)
      const exported = await exportLosslessSb3(imported)
      const restored = await importLosslessSb3(await exported.arrayBuffer())
      expect(restored.projectJsonBytes).toEqual(imported.projectJsonBytes)
      expect(actualSampleEntries(restored.entries)).toEqual(expectedSampleEntries)
    }
  })

  it('round-trips seeded UTF-8 asset paths and payloads through Raw Archive IR', async () => {
    let state = 0x6d2b79f5
    const nextRandom = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state >>> 0
    }
    const pathSegments = ['角色', 'café', 'λ', '雪🚀', 'a+b % ~']

    for (let sample = 0; sample < 32; sample += 1) {
      const name = `assets/${pathSegments[nextRandom() % pathSegments.length]}/${sample}-${pathSegments[nextRandom() % pathSegments.length]}.bin`
      const payload = new Uint8Array(nextRandom() % 1024)
      for (let index = 0; index < payload.length; index += 1) payload[index] = nextRandom() & 0xff
      const zip = new JSZip()
      zip.file('project.json', JSON.stringify({ targets: [], meta: { seed: sample } }), {
        compression: sample % 2 === 0 ? 'STORE' : 'DEFLATE',
      })
      zip.file(name, payload, { compression: sample % 2 === 0 ? 'DEFLATE' : 'STORE', createFolders: false })

      const imported = await importLosslessSb3(await zip.generateAsync({ type: 'uint8array' }))
      const asset = imported.entries.find((entry) => entry.name === name)
      const expectedEncoding = [...name].some((character) => character.charCodeAt(0) > 0x7f) ? 'utf-8' : 'legacy'
      expect(asset?.filenameEncoding, `source encoding seed ${sample}`).toBe(expectedEncoding)
      expect(asset?.filenameBytes, `source filename bytes seed ${sample}`).toEqual(new TextEncoder().encode(name))
      expect(asset?.bytes, `source seed ${sample}`).toEqual(payload)
      expect(asset?.sha256, `source hash seed ${sample}`).toBe(createHash('sha256').update(payload).digest('hex'))

      const exported = await exportLosslessSb3(imported)
      const restored = await importLosslessSb3(await exported.arrayBuffer())
      const restoredAsset = restored.entries.find((entry) => entry.name === name)
      expect(restoredAsset?.filenameEncoding, `export encoding seed ${sample}`).toBe(expectedEncoding)
      expect(restoredAsset?.filenameBytes, `export filename bytes seed ${sample}`).toEqual(asset?.filenameBytes)
      expect(restoredAsset?.bytes, `export seed ${sample}`).toEqual(payload)
      expect(restoredAsset?.sha256, `export hash seed ${sample}`).toBe(asset?.sha256)
      expect(restored.entries.map(({ name: entryName }) => entryName)).toContain(name)
    }
  })

  it('preserves generated multi-entry archive structure across repeated lossless exports', async () => {
    let state = 0x4f1bbcdc
    const nextRandom = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state >>> 0
    }
    const segments = ['sprites', '角色', 'costumes', '音效', 'café', 'λ']
    const filenameAlphabet = ['a', 'Z', '0', '雪', '角', 'é', 'λ', '中', '🚀', '_', '-']
    const randomText = (): string =>
      Array.from({ length: nextRandom() % 48 }, () => String.fromCodePoint(0x20 + (nextRandom() % 0x2fff))).join('')
    const randomFilename = (): string =>
      Array.from(
        { length: 1 + (nextRandom() % 24) },
        () => filenameAlphabet[nextRandom() % filenameAlphabet.length],
      ).join('')

    for (let sample = 0; sample < 96; sample += 1) {
      const zip = new JSZip()
      const targetComment = `generated-${sample}-${randomText()}`
      const projectJson = {
        targets: [],
        meta: {
          seed: sample,
          label: randomText(),
          opaque: { nested: [nextRandom(), randomText(), { keep: true }] },
        },
        extensions: sample % 3 === 0 ? [`vendor_${sample}`] : [],
      }
      const projectCompression = sample % 2 === 0 ? 'STORE' : 'DEFLATE'
      const projectJsonBytes = new TextEncoder().encode(JSON.stringify(projectJson))
      zip.file('project.json', projectJsonBytes, { compression: projectCompression })

      const assetCount = 1 + (nextRandom() % 6)
      const expectedEntries: { name: string; bytes: Uint8Array; compressionMethod: number }[] = [
        { name: 'project.json', bytes: projectJsonBytes, compressionMethod: projectCompression === 'STORE' ? 0 : 8 },
      ]
      for (let index = 0; index < assetCount; index += 1) {
        const name = `assets/${segments[nextRandom() % segments.length]}/${sample}-${index}-${randomFilename()}.bin`
        const bytes = new Uint8Array(nextRandom() % 2_048)
        for (let offset = 0; offset < bytes.byteLength; offset += 1) bytes[offset] = nextRandom() & 0xff
        const compressionMethod = (sample + index) % 2 === 0 ? 0 : 8
        expectedEntries.push({ name, bytes, compressionMethod })
        zip.file(name, bytes, {
          compression: compressionMethod === 0 ? 'STORE' : 'DEFLATE',
          createFolders: false,
        })
      }

      const source = await zip.generateAsync({ type: 'uint8array', comment: targetComment })
      const imported = await importLosslessSb3(source)
      expect(imported.projectJson, `project seed ${sample}`).toEqual(projectJson)
      expect(imported.projectJsonBytes, `project bytes seed ${sample}`).toEqual(projectJsonBytes)
      expect(imported.archiveCommentBytes, `comment seed ${sample}`).toEqual(new TextEncoder().encode(targetComment))
      expect(
        imported.entries.map(({ name }) => name),
        `entry order seed ${sample}`,
      ).toEqual(expectedEntries.map(({ name }) => name))

      const expectedByName = new Map(expectedEntries.map((entry) => [entry.name, entry]))
      const assertRoundTrip = (entries: Awaited<ReturnType<typeof importLosslessSb3>>['entries']): void => {
        expect(
          entries.map(({ name }) => name),
          `entry order seed ${sample}`,
        ).toEqual(expectedEntries.map(({ name }) => name))
        for (const entry of entries) {
          const expected = expectedByName.get(entry.name)
          expect(expected, `unexpected entry ${entry.name} / seed ${sample}`).toBeDefined()
          expect(entry.bytes, `payload ${entry.name} / seed ${sample}`).toEqual(expected?.bytes)
          expect(entry.compressionMethod, `compression ${entry.name} / seed ${sample}`).toBe(
            expected?.compressionMethod,
          )
          expect(entry.sha256, `hash ${entry.name} / seed ${sample}`).toBe(
            createHash('sha256')
              .update(expected?.bytes ?? new Uint8Array())
              .digest('hex'),
          )
        }
      }
      assertRoundTrip(imported.entries)

      const firstExport = await exportLosslessSb3(imported)
      const firstReload = await importLosslessSb3(await firstExport.arrayBuffer())
      expect(firstReload.projectJsonBytes, `project bytes seed ${sample}`).toEqual(imported.projectJsonBytes)
      expect(firstReload.archiveCommentBytes, `first export comment seed ${sample}`).toEqual(
        imported.archiveCommentBytes,
      )
      assertRoundTrip(firstReload.entries)

      const secondExport = await exportLosslessSb3(firstReload)
      const secondReload = await importLosslessSb3(await secondExport.arrayBuffer())
      expect(secondReload.projectJsonBytes, `second project bytes seed ${sample}`).toEqual(imported.projectJsonBytes)
      expect(secondReload.archiveCommentBytes, `second export comment seed ${sample}`).toEqual(
        imported.archiveCommentBytes,
      )
      assertRoundTrip(secondReload.entries)
    }
  })

  it('rejects local and central directory filename disagreement', async () => {
    const archive = await minimalArchive()
    const localHeader = findSignature(archive, 0x04034b50)
    archive[localHeader + 30] = 'X'.charCodeAt(0)
    await expect(importLosslessSb3(archive)).rejects.toThrow('local and central filenames do not match')
  })

  it('rejects local and central directory compression metadata disagreement', async () => {
    const archive = await minimalArchive()
    const localHeader = findSignature(archive, 0x04034b50)
    new DataView(archive.buffer, archive.byteOffset, archive.byteLength).setUint16(localHeader + 8, 8, true)
    await expect(importLosslessSb3(archive)).rejects.toThrow('local and central compression metadata do not match')
  })

  it.each([
    { label: 'flags', offset: 6, value: 1 },
    { label: 'compressed size', offset: 18, value: 1 },
    { label: 'uncompressed size', offset: 22, value: 1 },
  ])('rejects local and central directory $label disagreement', async ({ offset, value }) => {
    const archive = await minimalArchive()
    const localHeader = findSignature(archive, 0x04034b50)
    const width = offset === 6 ? 2 : 4
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    if (width === 2) view.setUint16(localHeader + offset, value, true)
    else view.setUint32(localHeader + offset, value, true)
    await expect(importLosslessSb3(archive)).rejects.toThrow(
      offset === 6
        ? 'local and central compression metadata do not match'
        : offset === 18
          ? 'local and central compressed sizes do not match'
          : 'local and central uncompressed sizes do not match',
    )
  })

  it('rejects local and central directory CRC disagreement', async () => {
    const archive = await minimalArchive()
    const localHeader = findSignature(archive, 0x04034b50)
    new DataView(archive.buffer, archive.byteOffset, archive.byteLength).setUint32(localHeader + 14, 1, true)
    await expect(importLosslessSb3(archive)).rejects.toThrow('local and central CRC values do not match')
  })

  it.each([true, false])('accepts a matching %s data descriptor signature mode', async (withSignature) => {
    const imported = await importLosslessSb3(await withDataDescriptor(withSignature))
    expect(imported.projectJson).toEqual({})
  })

  it('rejects a data descriptor that disagrees with the central directory', async () => {
    const archive = await withDataDescriptor(true)
    const centralDirectory = findSignature(archive, 0x02014b50)
    const localHeader = findSignature(archive, 0x04034b50)
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const payloadEnd =
      localHeader +
      30 +
      view.getUint16(localHeader + 26, true) +
      view.getUint16(localHeader + 28, true) +
      view.getUint32(centralDirectory + 20, true)
    view.setUint32(payloadEnd + 4, view.getUint32(payloadEnd + 4, true) ^ 1, true)
    await expect(importLosslessSb3(archive)).rejects.toThrow('data descriptor does not match its central directory')
  })

  it('rejects seeded data-descriptor signature, CRC, and size mutations', async () => {
    let mutationCount = 0
    for (const withSignature of [true, false]) {
      for (let sample = 0; sample < (withSignature ? 16 : 12); sample += 1) {
        const archive = await withDataDescriptor(withSignature)
        const localHeader = findSignature(archive, 0x04034b50)
        const centralDirectory = findSignature(archive, 0x02014b50)
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
        const descriptorOffset =
          localHeader +
          30 +
          view.getUint16(localHeader + 26, true) +
          view.getUint16(localHeader + 28, true) +
          view.getUint32(centralDirectory + 20, true)
        const fieldIndex = withSignature ? sample % 4 : sample % 3
        const fieldOffset = withSignature ? (fieldIndex === 0 ? 0 : 4 + (fieldIndex - 1) * 4) : fieldIndex * 4
        const valueOffset = descriptorOffset + fieldOffset
        view.setUint32(valueOffset, view.getUint32(valueOffset, true) ^ (sample + 1), true)

        await expect(
          importLosslessSb3(archive),
          `data descriptor seed ${sample}, signature=${withSignature}`,
        ).rejects.toThrow('data descriptor does not match its central directory')
        mutationCount += 1
      }
    }
    expect(mutationCount).toBe(28)
  })

  it('rejects distinct entries whose local record ranges overlap', async () => {
    await expect(importLosslessSb3(await withOverlappingLocalRecord())).rejects.toThrow('local records overlap')
  })

  it('rejects decompressed entry bytes that do not match the declared CRC', async () => {
    const archive = await minimalArchive()
    const localHeader = findSignature(archive, 0x04034b50)
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const contentOffset =
      localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true)
    archive[contentOffset] = (archive[contentOffset] ?? 0) ^ 1

    await expect(importLosslessSb3(archive)).rejects.toThrow('entry CRC does not match the central directory')
  })

  it('streams large DEFLATE entries through the native decompressor and verifies their payload hash', async () => {
    const zip = new JSZip()
    const asset = new Uint8Array(2 * 1024 * 1024).fill(0x5a)
    zip.file('project.json', '{}')
    zip.file('assets/large.bin', asset, { createFolders: false })
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const imported = await importLosslessSb3(archive)
    const entry = imported.entries.find(({ name }) => name === 'assets/large.bin')

    expect(entry?.bytes.byteLength).toBe(asset.byteLength)
    expect(entry?.bytes[0]).toBe(asset[0])
    expect(entry?.bytes.at(-1)).toBe(asset.at(-1))
    expect(entry?.sha256).toBe(createHash('sha256').update(asset).digest('hex'))
  })

  it('falls back to JSZip for large DEFLATE entries when native decompression is unavailable', async () => {
    const zip = new JSZip()
    const asset = new Uint8Array(2 * 1024 * 1024).fill(0x37)
    zip.file('project.json', '{}')
    zip.file('assets/fallback.bin', asset, { createFolders: false })
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    vi.stubGlobal('DecompressionStream', undefined)

    try {
      const imported = await importLosslessSb3(archive)
      const entry = imported.entries.find(({ name }) => name === 'assets/fallback.bin')
      expect(entry?.sha256).toBe(createHash('sha256').update(asset).digest('hex'))
      expect(entry?.bytes.byteLength).toBe(asset.byteLength)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('checks CRC for large entries decompressed by the native stream', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}')
    zip.file('assets/large.bin', new Uint8Array(2 * 1024 * 1024).fill(0x61), { createFolders: false })
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const localHeaders = findSignature(archive, 0x04034b50)
    const assetLocalHeader = findSignature(archive, 0x04034b50, localHeaders + 4)
    const centralDirectories = findSignature(archive, 0x02014b50)
    const assetCentralDirectory = findSignature(archive, 0x02014b50, centralDirectories + 4)
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    view.setUint32(assetLocalHeader + 14, 0, true)
    view.setUint32(assetCentralDirectory + 16, 0, true)

    await expect(importLosslessSb3(archive)).rejects.toThrow('entry CRC does not match the central directory')
  })

  it('stops inflating when actual data exceeds the declared entry size', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}')
    zip.file('assets/bomb.bin', new Uint8Array(2 * 1024 * 1024), { createFolders: false })
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const centralDirectory = findSignature(archive, 0x02014b50)
    const assetCentralDirectory = findSignature(archive, 0x02014b50, centralDirectory + 4)
    const localHeaderStart = findSignature(archive, 0x04034b50)
    const assetLocalHeader = findSignature(archive, 0x04034b50, localHeaderStart + 4)
    const declaredSize = 1024 * 1024
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    view.setUint32(assetCentralDirectory + 24, declaredSize, true)
    view.setUint32(assetLocalHeader + 22, declaredSize, true)

    await expect(importLosslessSb3(archive)).rejects.toThrow('entry size exceeds the central directory')
  })

  it('rejects native DEFLATE output shorter than the declared entry size', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}')
    zip.file('assets/short.bin', new Uint8Array(2 * 1024 * 1024).fill(0x43), { createFolders: false })
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const firstCentralDirectory = findSignature(archive, 0x02014b50)
    const assetCentralDirectory = findSignature(archive, 0x02014b50, firstCentralDirectory + 4)
    const firstLocalHeader = findSignature(archive, 0x04034b50)
    const assetLocalHeader = findSignature(archive, 0x04034b50, firstLocalHeader + 4)
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    view.setUint32(assetCentralDirectory + 24, view.getUint32(assetCentralDirectory + 24, true) + 1, true)
    view.setUint32(assetLocalHeader + 22, view.getUint32(assetLocalHeader + 22, true) + 1, true)

    await expect(importLosslessSb3(archive)).rejects.toThrow('entry size does not match the central directory')
  })

  it('rejects path traversal before JSZip sanitizes the filename', async () => {
    const zip = new JSZip()
    zip.file('../project.json', '{}')
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    await expect(importLosslessSb3(archive)).rejects.toThrow('Unsafe SB3 entry path')
  })

  it('rejects symbolic-link ZIP entries', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}', { unixPermissions: 0o120777 })
    const archive = await zip.generateAsync({ type: 'uint8array', platform: 'UNIX' })
    await expect(importLosslessSb3(archive)).rejects.toThrow('symbolic-link entry')
  })

  it('rejects duplicate central-directory filenames', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}')
    zip.file('project.JSON', '{}')
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    const uppercase = new TextEncoder().encode('project.JSON')
    const lowercase = new TextEncoder().encode('project.json')

    for (let offset = 0; offset <= archive.byteLength - uppercase.byteLength; offset += 1) {
      if (uppercase.every((byte, index) => archive[offset + index] === byte)) {
        archive.set(lowercase, offset)
      }
    }

    await expect(importLosslessSb3(archive)).rejects.toThrow('duplicate filename')
  })

  it.each([0x0001, 0x0040, 0x2000])('rejects encrypted ZIP flag 0x%s', async (flag) => {
    const encrypted = await minimalArchive()
    const encryptedView = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength)
    const centralDirectory = findSignature(encrypted, 0x02014b50)
    encryptedView.setUint16(centralDirectory + 8, encryptedView.getUint16(centralDirectory + 8, true) | flag, true)
    await expect(importLosslessSb3(encrypted)).rejects.toThrow('Encrypted SB3')
  })

  it.each([0x0010, 0x0020, 0x1000, 0x4000, 0x8000])('rejects unsupported ZIP flag 0x%s', async (flag) => {
    const archive = await minimalArchive()
    const archiveView = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const centralDirectory = findSignature(archive, 0x02014b50)
    archiveView.setUint16(centralDirectory + 8, archiveView.getUint16(centralDirectory + 8, true) | flag, true)
    await expect(importLosslessSb3(archive)).rejects.toThrow('Unsupported SB3 general-purpose ZIP flags')
  })

  it('rejects ZIP64 archive declarations', async () => {
    const zip64 = await minimalArchive()
    const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength)
    const directoryEnd = findSignature(zip64, 0x06054b50)
    zip64View.setUint16(directoryEnd + 10, 0xffff, true)
    await expect(importLosslessSb3(zip64)).rejects.toThrow('ZIP64 SB3')
  })

  it('rejects an oversized asset declaration before decompressing that entry', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}')
    zip.file('assets/oversized.bin', new Uint8Array())
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    const declaredSize = 256 * 1024 * 1024 + 1
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    const centralDirectoryStart = findSignature(archive, 0x02014b50)
    const endOfCentralDirectory = findSignature(archive, 0x06054b50)
    let centralDirectory = centralDirectoryStart
    while (centralDirectory < endOfCentralDirectory) {
      const nameLength = view.getUint16(centralDirectory + 28, true)
      const extraLength = view.getUint16(centralDirectory + 30, true)
      const commentLength = view.getUint16(centralDirectory + 32, true)
      const name = new TextDecoder().decode(
        archive.subarray(centralDirectory + 46, centralDirectory + 46 + nameLength),
      )
      if (name === 'assets/oversized.bin') break
      centralDirectory += 46 + nameLength + extraLength + commentLength
    }
    if (centralDirectory >= endOfCentralDirectory) throw new Error('ZIP fixture has no oversized asset entry')
    const localHeader = view.getUint32(centralDirectory + 42, true)
    view.setUint32(centralDirectory + 24, declaredSize, true)
    view.setUint32(localHeader + 22, declaredSize, true)
    await expect(importLosslessSb3(archive)).rejects.toThrow('256 MiB uncompressed-size limit')
  })

  it('rejects declared decompressed-size bombs before reading entry data', async () => {
    const archive = await minimalArchive()
    const centralDirectory = findSignature(archive, 0x02014b50)
    const declaredSize = 256 * 1024 * 1024 + 1
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    view.setUint32(centralDirectory + 24, declaredSize, true)
    const localHeader = findSignature(archive, 0x04034b50)
    view.setUint32(localHeader + 22, declaredSize, true)
    await expect(importLosslessSb3(archive)).rejects.toThrow('uncompressed-size limit')
  })
})
