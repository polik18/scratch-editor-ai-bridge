/**
 * Asset Validator - Validate assets (costumes, sounds)
 */

import { type Asset } from './asset-store.js';

/**
 * Asset validation result
 */
export interface AssetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an asset
 * @param asset - Asset to validate
 * @returns AssetValidationResult
 */
export function validateAsset(asset: Asset): AssetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check asset is valid
  if (!asset || typeof asset !== 'object') {
    errors.push('Asset is not a valid object');
    return { valid: false, errors, warnings };
  }
  
  // Check required fields
  if (typeof asset.md5 !== 'string' || asset.md5.length === 0) {
    errors.push('Asset has no valid MD5 hash');
  }
  
  if (typeof asset.name !== 'string' || asset.name.length === 0) {
    errors.push('Asset has no valid name');
  }
  
  if (typeof asset.format !== 'string' || asset.format.length === 0) {
    errors.push('Asset has no valid format');
  }
  
  if (typeof asset.size !== 'number' || asset.size < 0) {
    errors.push('Asset has no valid size');
  }
  
  if (!asset.data || !(asset.data instanceof Uint8Array)) {
    errors.push('Asset has no valid data');
  } else if (asset.data.length !== asset.size) {
    errors.push('Asset data size does not match reported size');
  }
  
  // Format-specific validation
  switch (asset.format.toLowerCase()) {
    case 'svg':
      validateSVG(asset, errors, warnings);
      break;
    case 'png':
      validatePNG(asset, errors, warnings);
      break;
    case 'wav':
      validateWAV(asset, errors, warnings);
      break;
    case 'mp3':
      validateMP3(asset, errors, warnings);
      break;
    default:
      warnings.push(`Unknown asset format: ${asset.format}`);
      break;
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate SVG format
 * @param asset - Asset to validate
 * @param errors - Error array
 * @param warnings - Warning array
 */
//@ts-ignore
function validateSVG(asset: Asset, errors: string[], _warnings: string[]): void {
  try {
    const text = new TextDecoder().decode(asset.data);
    if (!text.includes('<svg') || !text.includes('</svg>')) {
      errors.push('Asset is not a valid SVG file');
    }
  } catch (e) {
    errors.push('Cannot decode SVG asset as text');
  }
}

/**
 * Validate PNG format
 * @param asset - Asset to validate
 * @param errors - Error array
 * @param warnings - Warning array
 */
//@ts-ignore
function validatePNG(asset: Asset, errors: string[], _warnings: string[]): void {
  // Check PNG signature (8 bytes)
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  
  if (asset.data.length < 8) {
    errors.push('Asset is too small to be a PNG file');
    return;
  }
  
  for (let i = 0; i < 8; i++) {
    if (asset.data[i] !== pngSignature[i]) {
      errors.push('Asset does not have a valid PNG signature');
      break;
    }
  }
}

/**
 * Validate WAV format
 * @param asset - Asset to validate
 * @param errors - Error array
 * @param warnings - Warning array
 */
//@ts-ignore
function validateWAV(asset: Asset, errors: string[], _warnings: string[]): void {
  if (asset.data.length < 44) {
    errors.push('Asset is too small to be a WAV file');
    return;
  }
  
  // Check RIFF header
  const riff = new TextDecoder().decode(asset.data.subarray(0, 4));
  if (riff !== 'RIFF') {
    errors.push('Asset does not have a valid RIFF header');
    return;
  }
  
  // Check WAVE header
  const wave = new TextDecoder().decode(asset.data.subarray(8, 12));
  if (wave !== 'WAVE') {
    errors.push('Asset does not have a valid WAVE header');
  }
  
  // Check fmt chunk
  const fmt = new TextDecoder().decode(asset.data.subarray(12, 16));
  if (fmt !== 'fmt ') {
    errors.push('Asset does not have a valid fmt chunk');
  }
}

/**
 * Validate MP3 format
 * @param asset - Asset to validate
 * @param errors - Error array
 * @param warnings - Warning array
 */
function validateMP3(asset: Asset, errors: string[], warnings: string[]): void {
  if (asset.data.length < 4) {
    errors.push('Asset is too small to be an MP3 file');
    return;
  }
  
  // Check for ID3 tag or MP3 frame header
  const firstBytes = asset.data.subarray(0, 3);
  
  // ID3v2 tag
  if (firstBytes[0] === 0x49 && firstBytes[1] === 0x44 && firstBytes[2] === 0x33) {
    warnings.push('Asset has ID3 tag (common for MP3)');
  }
  // MP3 frame header
  else if ((asset.data[0] & 0xff) === 0xff && (asset.data[1] & 0xe0) === 0xe0) {
    warnings.push('Asset has MP3 frame header (common for MP3)');
  }
  else {
    errors.push('Asset does not have a valid MP3 header');
  }
}

/**
 * Validate multiple assets
 * @param assets - Assets to validate
 * @returns Map of asset MD5 to validation result
 */
export function validateAssets(assets: Asset[]): Map<string, AssetValidationResult> {
  const results = new Map<string, AssetValidationResult>();
  
  for (const asset of assets) {
    results.set(asset.md5, validateAsset(asset));
  }
  
  return results;
}
