/**
 * Asset Store - Store and manage assets (costumes, sounds)
 */

import crypto from 'node:crypto';

/**
 * Asset interface
 */
export interface Asset {
  md5: string;
  name: string;
  format: string;
  size: number;
  data: Uint8Array;
}

/**
 * Asset Store class
 */
export class AssetStore {
  private assets: Map<string, Asset> = new Map();

  /**
   * Add an asset to the store
   * @param data - Asset data
   * @param format - Asset format (png, svg, wav, mp3, etc.)
   * @param name - Asset name
   * @returns Asset
   */
  addAsset(data: Uint8Array, format: string, name: string = 'asset'): Asset {
    const md5 = this.calculateMD5(data);
    const asset: Asset = {
      md5,
      name,
      format,
      size: data.length,
      data,
    };
    this.assets.set(md5, asset);
    return asset;
  }

  /**
   * Get an asset by MD5 hash
   * @param md5 - MD5 hash
   * @returns Asset or null
   */
  getAsset(md5: string): Asset | null {
    return this.assets.get(md5) ?? null;
  }

  /**
   * Get asset data by MD5 hash
   * @param md5 - MD5 hash
   * @returns Uint8Array or null
   */
  getAssetBytes(md5: string): Uint8Array | null {
    const asset = this.assets.get(md5);
    return asset ? asset.data : null;
  }

  /**
   * Check if an asset exists
   * @param md5 - MD5 hash
   * @returns boolean
   */
  hasAsset(md5: string): boolean {
    return this.assets.has(md5);
  }

  /**
   * Remove an asset from the store
   * @param md5 - MD5 hash
   * @returns boolean
   */
  removeAsset(md5: string): boolean {
    return this.assets.delete(md5);
  }

  /**
   * Calculate MD5 hash of data
   * @param data - Data to hash
   * @returns MD5 hash string
   */
  private calculateMD5(data: Uint8Array): string {
    const buffer = Buffer.from(data);
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  /**
   * Get all assets
   * @returns Map of assets
   */
  getAllAssets(): Map<string, Asset> {
    return this.assets;
  }
}

/**
 * Create a new Asset Store
 * @returns AssetStore instance
 */
export function createAssetStore(): AssetStore {
  return new AssetStore();
}
