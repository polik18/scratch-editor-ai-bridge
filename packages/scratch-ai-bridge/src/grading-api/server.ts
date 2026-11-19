import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gradeSb3Bytes } from '../cli/grade'
import { validateRubric, type CriterionJudgment, type Rubric } from '../core/grading'
import {
  draftRubricTool,
  getGradeReportTool,
  gradeBatchTool,
  gradeSb3Tool,
  validateRubricTool,
} from '../mcp/grade-tools'

const MAX_BODY_BYTES = 30 * 1024 * 1024
const MAX_JOBS = 100

interface Job {
  readonly id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  readonly createdAt: string
  reportDirectory?: string
  summary?: unknown
  error?: string
}

/**
 * Versioned local JSON API over the same grading core as the CLI and MCP. It listens on 127.0.0.1 only, needs a
 * bearer token, rejects browser requests (any Origin header), and reads class folders only inside the Bridge output
 * folder. Batch jobs run one at a time and keep each file's failure isolated.
 */
export class GradingApiServer {
  private readonly server: Server
  private readonly token: Buffer
  private readonly jobs = new Map<string, Job>()
  private queue: Promise<void> = Promise.resolve()
  private readonly root?: string

  constructor(token: string, root?: string) {
    this.root = root
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('API token must be 64 hexadecimal characters.')
    this.token = Buffer.from(token, 'utf8')
    this.server = createServer((request, response) => {
      void this.handle(request, response)
    })
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '127.0.0.1', () => resolve((this.server.address() as AddressInfo).port))
    })
  }

  close(): Promise<void> {
    this.token.fill(0)
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private send(
    response: ServerResponse,
    status: number,
    body: unknown,
    type = 'application/json; charset=utf-8',
  ): void {
    response.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  private authorized(request: IncomingMessage): boolean {
    let host = ''
    try {
      host = new URL(`http://${request.headers.host ?? ''}`).hostname
    } catch {
      return false
    }
    if (!['127.0.0.1', 'localhost'].includes(host) || request.headers.origin) return false
    const header = request.headers.authorization ?? ''
    const received = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '', 'utf8')
    return received.length === this.token.length && timingSafeEqual(received, this.token)
  }

  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY_BYTES) throw new Error('request-too-large')
      chunks.push(chunk as Buffer)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('body-invalid')
    return parsed as Record<string, unknown>
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.authorized(request)) {
      this.send(response, 401, { error: 'unauthorized' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const route = `${request.method ?? 'GET'} ${url.pathname}`
    try {
      if (route === 'GET /v1/health')
        return this.send(response, 200, { format: 'scratch-ai-bridge/grading-api', version: 1, status: 'ok' })
      if (route === 'POST /v1/rubrics/validate')
        return this.send(response, 200, validateRubricTool((await this.body(request)).rubric))
      if (route === 'POST /v1/rubrics/draft') {
        const body = await this.body(request)
        return this.send(
          response,
          200,
          draftRubricTool({
            text: typeof body.text === 'string' ? body.text : '',
            id: typeof body.id === 'string' ? body.id : '',
            title: typeof body.title === 'string' ? body.title : '',
            projectType: typeof body.projectType === 'string' ? body.projectType : '',
          }),
        )
      }
      if (route === 'POST /v1/grade') {
        const body = await this.body(request)
        if (typeof body.sb3Base64 === 'string') {
          const rubric = body.rubric as Rubric
          const validation = validateRubric(rubric)
          if (!validation.ok) return this.send(response, 400, { error: 'rubric-invalid', issues: validation.errors })
          if (!validation.approved && body.trial !== true)
            return this.send(response, 400, { error: 'rubric-not-approved' })
          let runner: import('../cli/playtest').PlaytestRunner | undefined
          if (body.playtest === true) {
            const { PlaytestRunner } = await import('../cli/playtest')
            runner = await PlaytestRunner.create()
          }
          try {
            const { grade } = await gradeSb3Bytes(new Uint8Array(Buffer.from(body.sb3Base64, 'base64')), {
              rubric,
              ...(runner ? { runner } : {}),
              ...(Array.isArray(body.judgments) ? { judgments: body.judgments as CriterionJudgment[] } : {}),
            })
            return this.send(response, 200, grade)
          } finally {
            await runner?.close()
          }
        }
        return this.send(response, 200, await gradeSb3Tool(body as Parameters<typeof gradeSb3Tool>[0], this.root))
      }
      if (route === 'POST /v1/jobs') {
        if (this.jobs.size >= MAX_JOBS) return this.send(response, 429, { error: 'too-many-jobs' })
        const body = await this.body(request)
        const job: Job = { id: randomUUID(), status: 'queued', createdAt: new Date().toISOString() }
        this.jobs.set(job.id, job)
        this.queue = this.queue.then(async () => {
          job.status = 'running'
          try {
            const { reportDirectory, summary } = await gradeBatchTool(
              { ...(body as Parameters<typeof gradeBatchTool>[0]), reportName: `job-${job.id}` },
              this.root,
            )
            Object.assign(job, { status: 'done', reportDirectory, summary })
          } catch (error) {
            Object.assign(job, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
          }
        })
        return this.send(response, 202, { jobId: job.id, status: job.status })
      }
      const jobMatch =
        /^\/v1\/jobs\/([0-9a-f-]{36})(?:\/(summary|grades\.csv|review-queue\.csv|students\/([A-Za-z0-9_-]{1,64})))?$/.exec(
          url.pathname,
        )
      if (request.method === 'GET' && jobMatch) {
        const job = this.jobs.get(jobMatch[1])
        if (!job) return this.send(response, 404, { error: 'job-not-found' })
        if (!jobMatch[2]) return this.send(response, 200, job)
        if (job.status !== 'done' || !job.reportDirectory)
          return this.send(response, 409, { error: 'job-not-done', status: job.status })
        const part = (jobMatch[3] as string | undefined) ?? jobMatch[2]
        const report = await getGradeReportTool({ reportDirectory: job.reportDirectory, part }, this.root)
        if (part.endsWith('.csv'))
          return this.send(response, 200, `\uFEFF${(report as { csv: string }).csv}`, 'text/csv; charset=utf-8')
        return this.send(response, 200, report)
      }
      return this.send(response, 404, { error: 'not-found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.send(response, message === 'request-too-large' ? 413 : 400, { error: message })
    }
  }
}
