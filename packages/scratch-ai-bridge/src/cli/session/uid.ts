/**
 * UID generator, matching scratch-vm/src/util/uid.js
 * Legal characters should be all on a US keyboard. No XML special characters or control codes.
 */
const SOUP =
  '!#%()*+,-./:;=?@[]^_`{|}~' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const SOUP_LEN = SOUP.length;

/**
 * Generate a globally unique ID string.
 * 87 characters ^ 20 length > 128 bits (better than a UUID).
 */
export function uid(): string {
  const id: string[] = [];
  for (let i = 0; i < 20; i++) {
    id.push(SOUP[Math.floor(Math.random() * SOUP_LEN)]);
  }
  return id.join('');
}

/**
 * Generate a target ID (same format as block ID).
 */
export function uidTarget(): string {
  return uid();
}
