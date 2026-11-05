/**
 * Auto Asset Generator - Generate default assets for sprites.
 */
import { createAssetStore, type Asset } from './asset-store.js'

/**
 * Generate a default costume (simple colored square).
 * @param size - Width and height of the generated square geometry.
 * @param color - Hex color code for filling the costume.
 * @param name - Display label assigned to the asset.
 * @returns In-memory generated costume asset.
 */
export function generateDefaultCostume(size = 100, color = '#ff0000', name = 'costume1'): Asset {
  const store = createAssetStore()

  // Create a simple SVG costume
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${color}"/>
</svg>`

  const data = new TextEncoder().encode(svgContent)
  return store.addAsset(data, 'svg', name)
}

/**
 * Generate a default sound (simple tone).
 * @param duration - Length of audio clip in seconds.
 * @param frequency - Tone pitch in Hz.
 * @param name - Display label assigned to the audio track.
 * @returns In-memory generated sound asset.
 */
export function generateDefaultSound(duration = 1, frequency = 440, name = 'sound1'): Asset {
  const store = createAssetStore()

  // Create a simple WAV file (mono, 8-bit, 8kHz)
  const sampleRate = 8000
  const numSamples = Math.floor(sampleRate * duration)
  const numChannels = 1
  const bitsPerSample = 8

  // Calculate data size
  const dataLength = numSamples * numChannels * (bitsPerSample / 8)
  const subChunk1Size = 18 // WAV format for PCM
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)

  // Create buffer
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, subChunk1Size, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  // Generate audio samples (sine wave)
  const samples = new Uint8Array(dataLength)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const value = Math.sin(2 * Math.PI * frequency * t)
    // Convert to 8-bit unsigned (0-255)
    samples[i] = Math.floor(((value + 1) / 2) * 255)
  }

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    view.setUint8(44 + i, samples[i])
  }

  const data = new Uint8Array(buffer)
  return store.addAsset(data, 'wav', name)
}

/**
 * Write an ASCII string directly into a DataView buffer.
 * @param view - Target DataView instance to write into.
 * @param offset - Byte index where characters start.
 * @param text - String characters to encode sequentially.
 */
function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

/**
 * Generate a default sprite with costume and sound.
 * @param name - Display label of the sprite to create.
 * @param costumeSize - Width and height of costume box.
 * @param costumeColor - Hex color code for costume fill.
 * @param soundDuration - Length of audio tone in seconds.
 * @param soundFrequency - Tone frequency in Hz.
 * @returns Object with sprite name, costume asset, and sound asset.
 */
export function generateDefaultSprite(
  name = 'Sprite1',
  costumeSize = 100,
  costumeColor = '#ff0000',
  soundDuration = 1,
  soundFrequency = 440,
): { name: string; costume: Asset; sound: Asset } {
  const costume = generateDefaultCostume(costumeSize, costumeColor, 'costume1')
  const sound = generateDefaultSound(soundDuration, soundFrequency, 'meow')

  return { name, costume, sound }
}
