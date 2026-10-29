/**
 * Auto Asset Generator - Generate default assets for sprites
 */

import { createAssetStore, type Asset } from './asset-store.js';

/**
 * Generate a default costume (simple colored square)
 * @param size - Size of the square (default 100)
 * @param color - Color of the square (default: red #ff0000)
 * @param name - Asset name
 * @returns Asset
 */
export function generateDefaultCostume(
  size: number = 100,
  color: string = '#ff0000',
  name: string = 'costume1',
): Asset {
  const store = createAssetStore();
  
  // Create a simple SVG costume
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${color}"/>
</svg>`;
  
  const data = new TextEncoder().encode(svgContent);
  return store.addAsset(data, 'svg', name);
}

/**
 * Generate a default sound (simple tone)
 * @param duration - Duration in seconds (default: 1)
 * @param frequency - Frequency in Hz (default: 440)
 * @param name - Asset name
 * @returns Asset
 */
export function generateDefaultSound(
  duration: number = 1,
  frequency: number = 440,
  name: string = 'sound1',
): Asset {
  const store = createAssetStore();
  
  // Create a simple WAV file (mono, 8-bit, 8kHz)
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * duration);
  const numChannels = 1;
  const bitsPerSample = 8;
  
  // Calculate data size
  const dataLength = numSamples * numChannels * (bitsPerSample / 8);
  const subChunk1Size = 18; // WAV format for PCM
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  
  // Create buffer
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, subChunk1Size, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  // Generate audio samples (sine wave)
  const samples = new Uint8Array(dataLength);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * frequency * t);
    // Convert to 8-bit unsigned (0-255)
    samples[i] = Math.floor((value + 1) / 2 * 255);
  }
  
  // Write samples
  for (let i = 0; i < samples.length; i++) {
    view.setUint8(44 + i, samples[i]);
  }
  
  const data = new Uint8Array(buffer);
  return store.addAsset(data, 'wav', name);
}

/**
 * Write a string to DataView
 * @param view - DataView
 * @param offset - Offset
 * @param string - String to write
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Generate a default sprite with costume and sound
 * @param name - Sprite name
 * @param costumeSize - Costume size (default: 100)
 * @param costumeColor - Costume color (default: red)
 * @param soundDuration - Sound duration (default: 1)
 * @param soundFrequency - Sound frequency (default: 440)
 * @returns Object with sprite name, costume asset, and sound asset
 */
export function generateDefaultSprite(
  name: string = 'Sprite1',
  costumeSize: number = 100,
  costumeColor: string = '#ff0000',
  soundDuration: number = 1,
  soundFrequency: number = 440,
): { name: string; costume: Asset; sound: Asset } {
  const costume = generateDefaultCostume(costumeSize, costumeColor, 'costume1');
  const sound = generateDefaultSound(soundDuration, soundFrequency, 'meow');
  
  return { name, costume, sound };
}
