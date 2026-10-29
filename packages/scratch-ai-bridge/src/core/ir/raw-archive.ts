/**
 * Raw Archive IR - Intermediate representation of raw SB3 archive
 */

/**
 * Raw archive entry - preserves original bytes
 */
export interface RawArchiveEntry {
  path: string;
  bytes: Uint8Array;
  compressed: boolean;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
}

/**
 * Raw Archive IR - preserves original SB3 archive structure
 * Used for round-trip preservation of assets and structure
 */
export interface RawArchiveIR {
  projectJson: unknown;
  entries: Record<string, Uint8Array>;
  comment: string;
  warnings: string[];
}

/**
 * Create a RawArchiveIR from raw archive bytes
 * @param archive - Raw archive bytes
 * @returns RawArchiveIR object
 */
export async function createRawArchiveIR(archive: Uint8Array): Promise<RawArchiveIR> {
  // Import JSZip here to avoid browser-only dependency issues
  const JSZip = (await import('jszip')).default;
  
  const zip = await JSZip.loadAsync(archive);
  
  const entries: Record<string, Uint8Array> = {};
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) {
      entries[name] = new Uint8Array(await file.async('uint8array'));
    }
  }
  
  // Get comment if exists
  let comment = '';
  try {
    const commentEntry = zip.files['.comment'];
    if (commentEntry) {
      comment = new TextDecoder().decode(await commentEntry.async('uint8array'));
    }
  } catch {
    // Ignore comment errors
  }
  
  return {
    projectJson: JSON.parse(entries['project.json'] ? new TextDecoder().decode(entries['project.json']) : '{}'),
    entries,
    comment,
    warnings: [],
  };
}
