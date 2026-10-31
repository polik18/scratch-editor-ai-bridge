import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

export const readPrivateToken = async (path: string): Promise<string> => {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (
      !info.isFile() ||
      info.size > 256 ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())
    )
      throw new Error('Token file must be owned by the current user and accessible only by that user.')
    const token = (await file.readFile('utf8')).trim()
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Token file must contain exactly 64 hexadecimal characters.')
    return token
  } finally {
    await file.close()
  }
}
