import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// The layout is described in AGENTS.md ("檔案放哪裡"). New plans, handoffs and experiments go in docs/history/ or
// research/, and tool output goes in the git-ignored output/, so none of them should show up here.
const tracked = (directory: string): string[] =>
  execFileSync('git', ['ls-files', directory], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)

const topLevel = (files: string[], prefix: string): string[] =>
  [...new Set(files.map((file) => file.slice(prefix.length).split('/')[0] ?? ''))].sort()

describe('package layout', () => {
  const files = tracked('.')

  it('keeps only the entry docs, config and the known folders at the top of the package', () => {
    expect(topLevel(files, '')).toEqual(
      [
        '.gitignore',
        '.prettierignore',
        'AGENTS.md',
        'CLAUDE.md',
        'README.md',
        'bin',
        'docs',
        'eslint.config.mjs',
        'examples',
        'index.html',
        'package.json',
        'prettier.config.mjs',
        'preview.html',
        'public',
        'research',
        'scripts',
        'src',
        'student-help.html',
        'tests',
        'tsconfig.json',
        'vite.config.ts',
      ].sort(),
    )
  })

  it('sorts docs and scripts into their subfolders', () => {
    expect(
      topLevel(
        files.filter((file) => file.startsWith('docs/')),
        'docs/',
      ),
    ).toEqual(['design', 'guide', 'history'])
    expect(
      topLevel(
        files.filter((file) => file.startsWith('scripts/')),
        'scripts/',
      ),
    ).toEqual(['bench', 'build', 'smoke', 'tools'])
  })

  it('never tracks tool output or OS and cache files', () => {
    expect(files.filter((file) => /(^|\/)(output\/|\.DS_Store$|__pycache__\/)|\.sb3$/.test(file))).toEqual(
      files.filter((file) => file.startsWith('research/') && file.endsWith('.sb3')),
    )
  })
})
