/**
 * Generate a shell-safe random ID without changing imported IDs.
 * @returns A random identifier.
 */
export function uid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  return Array.from(bytes, (byte) => alphabet[byte & 63]).join('')
}

/**
 * Generate a target ID (same format as block ID).
 * @returns A random identifier.
 */
export function uidTarget(): string {
  return uid()
}
