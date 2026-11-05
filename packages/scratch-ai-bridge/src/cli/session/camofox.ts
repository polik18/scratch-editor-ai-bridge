import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ScratchSession } from './session.js'

const runFile = promisify(execFile)
const cli = '/Users/huangjianzhe/bin/camofox-cli'
type Caller = 'codex' | 'hermes' | 'opencode' | 'antigravity'

/**
 * Import a checked session into a new, task-scoped Camoufox Scratch GUI tab.
 * @param session Current Scratch session.
 * @param caller Agent namespace used by the shared browser.
 * @param address Local Scratch GUI URL.
 * @param sb3Path Optional path to an .sb3 file to load directly.
 */
export async function openInCamofox(
  session: ScratchSession,
  caller: Caller,
  address: string,
  sb3Path?: string,
): Promise<void> {
  const url = new URL(address)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('Camoufox Scratch GUI URL must be a local HTTP address.')
  }
  const archive = sb3Path ? await importSB3(sb3Path) : await session.compile()
  const task = `scratch-open-${randomUUID()}`
  const common = ['--caller', caller, '--task', task]
  const call = async (args: string[]) => {
    try {
      const result = await runFile(cli, args, { maxBuffer: 2 * 1024 * 1024, timeout: 45000 })
      return JSON.parse(result.stdout) as Record<string, unknown>
    } catch {
      throw new Error('Camoufox CLI command failed; check browser status and workflow lease ownership.')
    }
  }
  const status = await call(['--caller', caller, 'status'])
  const cache = status.tab_cache as { duplicate_tab_ids?: number } | undefined
  const health = status.health as { ok?: boolean } | undefined
  if (status.http_status !== 200 || health?.ok !== true || cache?.duplicate_tab_ids !== 0) {
    throw new Error('Camoufox status is unhealthy or has duplicate tab IDs; no browser action was taken.')
  }
  const lease = await call([...common, 'lease', 'acquire', '--ttl', '120'])
  if (lease.success !== true || typeof lease.lease_file !== 'string')
    throw new Error('Cannot acquire Camoufox lease.')
  const guarded = [...common, '--lease-file', lease.lease_file]
  let temp: string | undefined
  try {
    const navigation = await call([...guarded, 'nav', url.href])
    if (navigation.success !== true || navigation.title !== 'Scratch 3.0 GUI') {
      throw new Error('The local URL did not open the Scratch 3.0 GUI.')
    }
    const menu = await call([
      ...guarded,
      'eval',
      `(() => { const b = document.querySelector('button[aria-label="File menu"]'); if (!b) throw Error('Scratch GUI File menu not found'); b.click(); return true; })()`,
    ])
    if (menu.success !== true) throw new Error('Cannot open the Scratch GUI File menu.')
    temp = await mkdtemp(path.join(os.tmpdir(), 'scratch-camofox-'))
    const scriptPath = path.join(temp, 'import.js')
    const base64 = Buffer.from(archive).toString('base64')
    const filename = sb3Path ? path.basename(sb3Path) : 'scratch-session.sb3'
    const script = `(() => {
      window.__scratchImportErrors = [];
      window.addEventListener('error', e => window.__scratchImportErrors.push(String(e.message)));
      window.addEventListener('unhandledrejection', e => window.__scratchImportErrors.push(String(e.reason)));
      const original = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function() { if (this.type !== 'file' || !this.accept.includes('.sb3')) return original.call(this); };
      try {
        const item = Array.from(document.querySelectorAll('[role="menuitem"],li')).find(e => ['Load from your computer','從電腦載入','从电脑中上传'].includes(e.textContent.trim()));
        if (!item) throw Error('Scratch GUI load menu item not found');
        item.click();
        const input = document.querySelector('input[type=file][accept*=".sb3"]');
        if (!input) throw Error('Scratch GUI project file input not found');
        const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], ${JSON.stringify(filename)}, {type:'application/zip'}));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', {bubbles:true}));
        return true;
      } finally { HTMLInputElement.prototype.click = original; }
    })()`
    await writeFile(scriptPath, script, { mode: 0o600 })
    const imported = await call([...guarded, 'eval', '--file', scriptPath])
    if (imported.success !== true) throw new Error('Scratch GUI did not accept the project import.')
    let loaded = false
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = await call([
        ...guarded,
        'eval',
        `document.querySelector('input[placeholder="Project title here"]')?.value === '${sb3Path ? path.basename(sb3Path).replace(/\.sb3$/, '') : 'scratch-session'}'`,
      ])
      if (state.result === true) {
        loaded = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!loaded) {
      const diagnostics = await call([...guarded, 'eval', '(window.__scratchImportErrors || []).slice(0, 5)'])
      throw new Error(
        `Scratch GUI did not finish loading the project within 30 seconds (task ${task}). Browser errors: ${JSON.stringify(diagnostics.result)}`,
      )
    }
    console.log(`✓ Scratch session loaded in Camoufox (${task}) at ${url.origin}.`)
    console.log(
      'GUI changes are not synchronized to the CLI; save the project and load it again to continue in the CLI.',
    )
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true })
    await call([...guarded, 'lease', 'release'])
  }
}

/**
 * Import an external .sb3 file and return its content.
 * @param sb3Path Path to the target SB3 file.
 * @returns Buffer containing file payload.
 */
async function importSB3(sb3Path: string): Promise<Buffer> {
  const fs = await import('node:fs/promises')
  return fs.readFile(sb3Path)
}
