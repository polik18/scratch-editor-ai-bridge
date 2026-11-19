import { readPrivateToken } from '../local/private-token.js'
import { GradingApiServer } from './server.js'

const usage = 'Usage: npm run grading-api -- --token-file <path> [--port <port>]'
let tokenFile = ''
let port = 43140
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (!value) throw new Error(usage)
  if (key === '--token-file') tokenFile = value
  else if (key === '--port') {
    port = Number(value)
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
      throw new Error('Port must be between 1024 and 65535.')
  } else throw new Error(`Unknown option: ${key}. ${usage}`)
}
if (!tokenFile) throw new Error(usage)
const server = new GradingApiServer(await readPrivateToken(tokenFile))
const bound = await server.listen(port)
console.error(`Grading API listening on http://127.0.0.1:${bound}/v1 (bearer token required).`)
const close = (): void => void server.close()
process.once('SIGINT', close)
process.once('SIGTERM', close)
