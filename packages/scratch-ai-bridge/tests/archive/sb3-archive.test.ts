import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { exportLosslessSb3, importLosslessSb3 } from '../../src/core/archive/sb3-archive'

const fixture = (name: string) => fileURLToPath(new URL(`../../../scratch-vm/test/fixtures/${name}`, import.meta.url))

const findSignature = (bytes: Uint8Array, signature: number): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset
  }
  throw new Error(`ZIP signature was not found: ${signature.toString(16)}`)
}

const minimalArchive = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file('project.json', '{}')
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
}

describe('lossless SB3 archive path', () => {
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

  it('accepts a nested project.json and reports the archive boundary', async () => {
    const imported = await importLosslessSb3(await readFile(fixture('origin.sb3')))
    expect(imported.projectEntryName).toBe('origin/project.json')
    expect(imported.warnings).toEqual(['project.json is nested at origin/project.json'])
  })

  it('rejects malformed archive bytes', async () => {
    const source = await readFile(fixture('comments.sb3'))
    const corrupted = new Uint8Array(source)
    corrupted[0] = 0
    await expect(importLosslessSb3(corrupted)).rejects.toThrow()
  })

  it('rejects path traversal before JSZip sanitizes the filename', async () => {
    const zip = new JSZip()
    zip.file('../project.json', '{}')
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
    await expect(importLosslessSb3(archive)).rejects.toThrow('Unsafe SB3 entry path')
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

  it('rejects encrypted and ZIP64 archive declarations', async () => {
    const encrypted = await minimalArchive()
    const encryptedView = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength)
    const centralDirectory = findSignature(encrypted, 0x02014b50)
    encryptedView.setUint16(centralDirectory + 8, encryptedView.getUint16(centralDirectory + 8, true) | 1, true)
    await expect(importLosslessSb3(encrypted)).rejects.toThrow('Encrypted SB3')

    const zip64 = await minimalArchive()
    const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength)
    const directoryEnd = findSignature(zip64, 0x06054b50)
    zip64View.setUint16(directoryEnd + 10, 0xffff, true)
    await expect(importLosslessSb3(zip64)).rejects.toThrow('ZIP64 SB3')
  })
})
