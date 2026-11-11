import { describe, expect, it } from 'vitest'
import { isAdpcmWav } from '../../src/core/compiler/compiler'

/**
 * @param format - WAVE format tag: 1 is PCM, 0x11 is IMA ADPCM.
 * @returns A minimal WAV file, base64-encoded.
 */
const wav = (format: number): string => {
  const bytes = new Uint8Array(60)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string): void => {
    for (const [index, char] of [...text].entries()) bytes[offset + index] = char.charCodeAt(0)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 52, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 20, true)
  view.setUint16(20, format, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 22050, true)
  view.setUint16(32, 512, true)
  ascii(40, 'data')
  return btoa(String.fromCharCode(...bytes))
}

describe('ADPCM sounds from the Scratch library', () => {
  it('recognizes an IMA ADPCM WAV, which browsers cannot decode but Scratch can', () => {
    expect(isAdpcmWav(wav(0x11))).toBe(true)
  })

  it('leaves other sounds to the browser decode check', () => {
    expect(isAdpcmWav(wav(1))).toBe(false)
    expect(isAdpcmWav(btoa('not a sound at all, just some text here'))).toBe(false)
    expect(isAdpcmWav('%%%not base64')).toBe(false)
  })
})
