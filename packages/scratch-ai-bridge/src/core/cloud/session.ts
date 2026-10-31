export interface CloudSessionGrant {
  readonly projectId: string
  readonly username: string
  readonly expiresAt: number
  readonly canRead: boolean
  readonly canWrite: boolean
}

export interface CloudUpdate {
  readonly projectId: string
  readonly name: string
  readonly value: string | number
}

export interface CloudSessionOptions {
  readonly grant: CloudSessionGrant
  readonly variableNames: readonly string[]
  readonly verifyGrant: (grant: CloudSessionGrant) => boolean
  readonly validValue: (value: string | number) => boolean
  readonly send: (update: CloudUpdate, signal: AbortSignal) => void | Promise<void>
  readonly applyIncoming: (name: string, value: string | number) => void
  readonly report: (reason: string) => void
  readonly now?: () => number
  readonly minWriteIntervalMs: number
}

/**
 * A transport-independent cloud gate. A production provider must verify the grant
 * and supply its current value and rate rules; this class does not authenticate.
 */
export class ScratchCloudSession {
  private readonly options: CloudSessionOptions
  private readonly names: ReadonlySet<string>
  private readonly now: () => number
  private connected = false
  private closed = false
  private lastWrite = -Infinity
  private readonly inFlight = new Set<AbortController>()
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  constructor(options: CloudSessionOptions) {
    this.options = { ...options, grant: Object.freeze({ ...options.grant }) }
    const { grant, variableNames, minWriteIntervalMs } = options
    this.now = options.now ?? Date.now
    if (
      !grant.projectId ||
      !grant.username ||
      !grant.canRead ||
      !Number.isFinite(grant.expiresAt) ||
      grant.expiresAt <= this.now() ||
      !options.verifyGrant(grant)
    )
      throw new Error('Cloud grant is missing, expired or unverified.')
    if (!Number.isFinite(minWriteIntervalMs) || minWriteIntervalMs < 0)
      throw new Error('Cloud write interval is invalid.')
    if (
      variableNames.length < 1 ||
      variableNames.length > 100 ||
      new Set(variableNames).size !== variableNames.length ||
      variableNames.some((name) => !name || name.length > 256)
    )
      throw new Error('Cloud variable allowlist is invalid.')
    this.names = new Set(variableNames)
    this.scheduleExpiry()
  }
  private scheduleExpiry(): void {
    if (this.closed) return
    const remaining = this.options.grant.expiresAt - this.now()
    if (remaining <= 0) {
      this.requestCloseConnection()
      return
    }
    this.expiryTimer = setTimeout(() => this.scheduleExpiry(), Math.min(remaining, 2_147_483_647))
    if (typeof this.expiryTimer === 'object' && 'unref' in this.expiryTimer) this.expiryTimer.unref()
  }
  setConnected(connected: boolean): void {
    if (this.closed) throw new Error('Cloud session is closed.')
    this.connected = connected
    if (!connected) this.abortInFlight()
  }
  private abortInFlight(): void {
    for (const controller of this.inFlight) controller.abort()
    this.inFlight.clear()
  }
  private usable(): boolean {
    try {
      return (
        !this.closed &&
        this.connected &&
        this.options.grant.expiresAt > this.now() &&
        this.options.verifyGrant(this.options.grant)
      )
    } catch {
      return false
    }
  }
  private valid(name: string, value: unknown): value is string | number {
    try {
      return (
        this.names.has(name) &&
        ((typeof value === 'string' && value.length <= 1024) ||
          (typeof value === 'number' && Number.isFinite(value))) &&
        this.options.validValue(value)
      )
    } catch {
      return false
    }
  }
  updateVariable(name: string, value: unknown): void {
    if (!this.usable() || !this.options.grant.canWrite || !this.valid(name, value)) {
      this.options.report('Cloud update rejected.')
      return
    }
    const now = this.now()
    if (now - this.lastWrite < this.options.minWriteIntervalMs) {
      this.options.report('Cloud update rate limited.')
      return
    }
    this.lastWrite = now
    const controller = new AbortController()
    this.inFlight.add(controller)
    try {
      const sent = this.options.send({ projectId: this.options.grant.projectId, name, value }, controller.signal)
      void Promise.resolve(sent)
        .catch(() => {
          if (!this.closed && !controller.signal.aborted) {
            this.options.report('Cloud transport failed.')
            this.setConnected(false)
          }
        })
        .finally(() => this.inFlight.delete(controller))
    } catch {
      this.inFlight.delete(controller)
      this.options.report('Cloud transport failed.')
      this.setConnected(false)
    }
  }
  receive(update: unknown): boolean {
    if (!this.usable() || typeof update !== 'object' || update === null || Array.isArray(update)) return false
    const message = update as Record<string, unknown>
    if (
      Object.keys(message).some((key) => !['projectId', 'name', 'value'].includes(key)) ||
      message.projectId !== this.options.grant.projectId ||
      typeof message.name !== 'string' ||
      !this.valid(message.name, message.value)
    )
      return false
    try {
      this.options.applyIncoming(message.name, message.value)
      return true
    } catch {
      this.options.report('Cloud project or variable is no longer available.')
      this.setConnected(false)
      return false
    }
  }
  createVariable(): void {
    this.options.report('Cloud variable creation is disabled.')
  }
  renameVariable(): void {
    this.options.report('Cloud variable renaming is disabled.')
  }
  deleteVariable(): void {
    this.options.report('Cloud variable deletion is disabled.')
  }
  requestCloseConnection(): void {
    this.closed = true
    this.connected = false
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer)
    this.expiryTimer = null
    this.abortInFlight()
  }
}
