// Downloads public Scratch 3 projects into a local folder for evaluation: each project as .sb3 plus a .json with the
// title, Instructions, Notes and Credits, author and license. Downloads stay under output/ and never enter git.
// Usage (from the repo root):
//   node packages/scratch-ai-bridge/scripts/corpus/fetch-scratch.mjs <outDir> --user <username>
//   node packages/scratch-ai-bridge/scripts/corpus/fetch-scratch.mjs <outDir> <projectId> [projectId...]
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'

const [outDir, ...rest] = process.argv.slice(2)
if (!outDir || rest.length === 0) {
  console.error('usage: fetch-scratch.mjs <outDir> (--user <username> | <projectId>...)')
  process.exit(2)
}
const headers = { 'user-agent': 'scratch-sample-fetcher' }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const get = async (url, kind) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers })
    if (response.ok) return kind === 'json' ? response.json() : Buffer.from(await response.arrayBuffer())
    if (response.status === 404) throw new Error(`404 ${url}`)
    await sleep(1500)
  }
  throw new Error(`failed ${url}`)
}
const userProjects = async (username) => {
  const ids = []
  for (let offset = 0; ; offset += 40) {
    const page = await get(`https://api.scratch.mit.edu/users/${username}/projects?limit=40&offset=${offset}`, 'json')
    if (page.length === 0) return ids
    ids.push(...page.map((project) => String(project.id)))
  }
}

const ids = rest[0] === '--user' ? await userProjects(rest[1]) : rest
await mkdir(outDir, { recursive: true })
let saved = 0
for (const id of ids) {
  try {
    const meta = await get(`https://api.scratch.mit.edu/projects/${id}`, 'json')
    const base = `${id}-${meta.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}`
    const file = join(outDir, `${base}.sb3`)
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    ) {
      console.log('skip', base)
      continue
    }
    const project = await get(`https://projects.scratch.mit.edu/${id}?token=${meta.project_token}`, 'json')
    if (!Array.isArray(project.targets)) {
      console.log('not-sb3', id, '(Scratch 2 project)')
      continue
    }
    const zip = new JSZip()
    zip.file('project.json', JSON.stringify(project))
    const assets = new Set()
    for (const target of project.targets)
      for (const asset of [...target.costumes, ...target.sounds])
        assets.add(asset.md5ext ?? `${asset.assetId}.${asset.dataFormat}`)
    for (const name of assets) {
      zip.file(name, await get(`https://assets.scratch.mit.edu/internalapi/asset/${name}/get/`))
      await sleep(50)
    }
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    const info = {
      id,
      url: `https://scratch.mit.edu/projects/${id}/`,
      title: meta.title,
      author: meta.author?.username,
      license: 'CC BY-SA 2.0',
      instructions: meta.instructions,
      notes: meta.description,
    }
    await writeFile(join(outDir, `${base}.json`), JSON.stringify(info, null, 2))
    saved += 1
    console.log('ok', base, assets.size, 'assets')
  } catch (error) {
    console.log('fail', id, error instanceof Error ? error.message : String(error))
  }
  await sleep(500)
}
console.log(`saved ${saved} of ${ids.length}`)
