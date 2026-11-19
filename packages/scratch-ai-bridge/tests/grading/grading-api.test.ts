import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compileCanonicalProjectToSb3 } from '../../src/core/compiler'
import { approveRubric } from '../../src/core/grading'
import example02 from '../../src/core/ir/examples/02-green-flag-move-say.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { GradingApiServer } from '../../src/grading-api/server'
import { bigFishRubric } from './fixtures'

const token = 'ab'.repeat(32)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

const start = async () => {
  const root = await mkdtemp(join(tmpdir(), 'scratch-ai-bridge-api-'))
  await mkdir(join(root, 'classes', '601'), { recursive: true })
  const archive = await compileCanonicalProjectToSb3(structuredClone(example02) as CanonicalProject)
  const bytes = new Uint8Array(await archive.arrayBuffer())
  await writeFile(join(root, 'classes', '601', 'a.sb3'), bytes)
  const server = new GradingApiServer(token, root)
  const port = await server.listen(0)
  cleanups.push(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const call = (path: string, init: RequestInit = {}, auth = true) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  return { call, bytes }
}

describe('grading JSON API', () => {
  it('requires the bearer token and rejects browser origins', async () => {
    const { call } = await start()
    expect((await call('/v1/health', {}, false)).status).toBe(401)
    expect((await call('/v1/health', { headers: { origin: 'https://evil.example' } })).status).toBe(401)
    expect(await (await call('/v1/health')).json()).toMatchObject({ status: 'ok', version: 1 })
  })

  it('grades uploaded bytes with the same core and refuses unapproved rubrics', async () => {
    const { call, bytes } = await start()
    const sb3Base64 = Buffer.from(bytes).toString('base64')
    const refused = await call('/v1/grade', {
      method: 'POST',
      body: JSON.stringify({ sb3Base64, rubric: bigFishRubric() }),
    })
    expect(refused.status).toBe(400)
    const graded = await call('/v1/grade', {
      method: 'POST',
      body: JSON.stringify({ sb3Base64, rubric: approveRubric(bigFishRubric(), 'T1') }),
    })
    expect(await graded.json()).toMatchObject({
      format: 'scratch-ai-bridge/formal-grade',
      status: 'pending',
      runtimeStatus: 'not-run',
    })
  })

  it('runs a batch job and serves its CSV', async () => {
    const { call } = await start()
    const created = await call('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify({ directory: 'classes/601', rubric: approveRubric(bigFishRubric(), 'T1') }),
    })
    expect(created.status).toBe(202)
    const { jobId } = (await created.json()) as { jobId: string }
    let status = ''
    for (let attempt = 0; attempt < 100 && status !== 'done' && status !== 'failed'; attempt += 1) {
      status = ((await (await call(`/v1/jobs/${jobId}`)).json()) as { status: string }).status
      if (status !== 'done') await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(status).toBe('done')
    const csv = await call(`/v1/jobs/${jobId}/grades.csv`)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('S0001')
    expect((await call(`/v1/jobs/${jobId}/students/S0001`)).status).toBe(200)
  })
})
