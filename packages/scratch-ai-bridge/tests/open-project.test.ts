import { describe, expect, it } from 'vitest'
import {
  MAX_PROJECT_FILE_BYTES,
  chooseProjectFile,
  friendlyOpenError,
  isFileDrag,
  projectFileProblem,
} from '../src/open-project'

describe('opening a student project', () => {
  it('accepts a Scratch 3 project', () => {
    expect(projectFileProblem({ name: '我的遊戲.SB3', size: 1000 })).toBeUndefined()
  })

  it('explains how to convert a Scratch 2 project', () => {
    expect(projectFileProblem({ name: 'old.sb2', size: 1000 })).toMatch(/Scratch 2.*\.sb3/)
  })

  it('names files that are not projects', () => {
    expect(projectFileProblem({ name: 'cat.png', size: 1000 })).toMatch(/「cat\.png」不是 Scratch 作品/)
  })

  it('rejects projects over the size limit with both sizes', () => {
    expect(projectFileProblem({ name: 'big.sb3', size: MAX_PROJECT_FILE_BYTES + 1 })).toMatch(/64\.0 MB.*64\.0 MB/)
  })

  it('opens the first .sb3 of several dropped files and says so', () => {
    const files = [
      { name: 'a.png', size: 1 },
      { name: 'b.sb3', size: 1 },
      { name: 'c.sb3', size: 1 },
    ]
    expect(chooseProjectFile(files)).toEqual({ file: files[1], note: '一次只能打開一個作品，先打開「b.sb3」。' })
    expect(chooseProjectFile([files[2]])).toEqual({ file: files[2] })
    expect(chooseProjectFile([])).toEqual({})
  })

  it('turns archive errors into plain advice', () => {
    expect(friendlyOpenError('SB3 project.json is not valid JSON')).toMatch(
      /^這個檔案不是 Scratch 3 作品，或已經損壞/,
    )
    expect(friendlyOpenError('SB3 exceeds the 64 MiB compressed-size limit')).toMatch(/^這個作品太大.*64 MiB/)
    expect(friendlyOpenError('SB3 exceeds the 256 MiB uncompressed-size limit')).toMatch(/^這個作品太大.*256 MiB/)
    expect(friendlyOpenError('something else')).toBe('這個作品打不開。（something else）')
  })

  it('only reacts to drags that carry files', () => {
    expect(isFileDrag(['Files'])).toBe(true)
    expect(isFileDrag(['text/plain', 'text/uri-list'])).toBe(false)
  })
})
