import { describe, expect, it, vi } from 'vitest'
import { ScratchCloudSession, type CloudSessionOptions } from '../../src/core/cloud/session'

const setup = (overrides: Partial<CloudSessionOptions> = {}) => {
  let now = 1000
  let authorized = true
  const sent = vi.fn()
  const incoming = vi.fn()
  const report = vi.fn()
  const options: CloudSessionOptions = {
    grant: { projectId: 'project-1', username: 'owner', expiresAt: 10000, canRead: true, canWrite: true },
    variableNames: ['☁ score'],
    verifyGrant: () => authorized,
    validValue: (value) => /^-?\d+(?:\.\d+)?$/.test(String(value)),
    send: sent,
    applyIncoming: incoming,
    report,
    now: () => now,
    minWriteIntervalMs: 100,
    ...overrides,
  }
  return {
    options,
    sent,
    incoming,
    report,
    advance: (value: number) => {
      now = value
    },
    revoke: () => {
      authorized = false
    },
  }
}

describe('transport-independent Scratch cloud gate', () => {
  it('rejects unverified, expired and ambiguous grants or allowlists', () => {
    const config = setup()
    expect(() => new ScratchCloudSession({ ...config.options, verifyGrant: () => false })).toThrow(/unverified/)
    expect(
      () => new ScratchCloudSession({ ...config.options, grant: { ...config.options.grant, expiresAt: 0 } }),
    ).toThrow(/expired/)
    expect(() => new ScratchCloudSession({ ...config.options, variableNames: ['x', 'x'] })).toThrow(/allowlist/)
  })
  it('enforces connection, project, value, write permission and rate limits without queuing', async () => {
    const config = setup()
    const session = new ScratchCloudSession(config.options)
    session.updateVariable('☁ score', 1)
    expect(config.sent).not.toHaveBeenCalled()
    session.setConnected(true)
    session.updateVariable('☁ score', 1)
    expect(config.sent).toHaveBeenCalledTimes(1)
    session.updateVariable('☁ score', 2)
    session.updateVariable('not allowed', 3)
    expect(config.sent).toHaveBeenCalledTimes(1)
    expect(session.receive({ projectId: 'other', name: '☁ score', value: 1 })).toBe(false)
    expect(session.receive({ projectId: 'project-1', name: '☁ score', value: 'text' })).toBe(false)
    expect(session.receive({ projectId: 'project-1', name: '☁ score', value: '9' })).toBe(true)
    expect(config.incoming).toHaveBeenCalledWith('☁ score', '9')
    session.setConnected(false)
    config.advance(1200)
    session.setConnected(true)
    expect(config.sent).toHaveBeenCalledTimes(1)
    config.revoke()
    session.updateVariable('☁ score', 4)
    expect(config.sent).toHaveBeenCalledTimes(1)
    session.requestCloseConnection()
    expect(session.receive({ projectId: 'project-1', name: '☁ score', value: 2 })).toBe(false)
    await Promise.resolve()
  })
  it('aborts in-flight writes when disconnected and rejects writes for read-only grants', async () => {
    let signal: AbortSignal | undefined
    const config = setup({
      send: (_update, received) => {
        signal = received
        return new Promise<void>(() => undefined)
      },
    })
    const session = new ScratchCloudSession(config.options)
    session.setConnected(true)
    session.updateVariable('☁ score', 1)
    session.setConnected(false)
    expect(signal?.aborted).toBe(true)
    const readOnly = setup()
    const another = new ScratchCloudSession({
      ...readOnly.options,
      grant: { ...readOnly.options.grant, canWrite: false },
    })
    another.setConnected(true)
    another.updateVariable('☁ score', 2)
    expect(readOnly.sent).not.toHaveBeenCalled()
    expect(another.receive({ projectId: 'project-1', name: '☁ score', value: 2 })).toBe(true)
    await Promise.resolve()
  })
  it('aborts pending writes when the grant expires', () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const config = setup({
        now: Date.now,
        grant: { projectId: 'p', username: 'u', expiresAt: Date.now() + 500, canRead: true, canWrite: true },
        send: (_update, value) => {
          signal = value
          return new Promise<void>(() => undefined)
        },
      })
      const session = new ScratchCloudSession(config.options)
      session.setConnected(true)
      session.updateVariable('☁ score', 1)
      expect(signal?.aborted).toBe(false)
      vi.advanceTimersByTime(501)
      expect(signal?.aborted).toBe(true)
      expect(session.receive({ projectId: 'p', name: '☁ score', value: 2 })).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
