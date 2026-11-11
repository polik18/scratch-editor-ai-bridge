import { describe, expect, it } from 'vitest'
import { LIBRARY_BACKDROPS, LIBRARY_SOUNDS, LIBRARY_SPRITES } from '../../src/core/visuals/library'
import {
  APPROXIMATIONS,
  BACKDROP_CATALOG,
  NAMED_SOUND_NAMES,
  soundInfo,
  SPRITE_CATALOG,
} from '../../src/core/visuals/library-catalog'

describe('library catalog covers the whole official library', () => {
  it('gives every sprite, backdrop and sound a Chinese name and a category', () => {
    expect(
      LIBRARY_SPRITES.filter((sprite) => !SPRITE_CATALOG[sprite.name]?.zh.length).map((sprite) => sprite.name),
    ).toEqual([])
    expect(
      LIBRARY_BACKDROPS.filter((backdrop) => !BACKDROP_CATALOG[backdrop.name]?.zh.length).map(
        (backdrop) => backdrop.name,
      ),
    ).toEqual([])
    expect(LIBRARY_SOUNDS.filter((sound) => !soundInfo(sound.name)?.zh.length).map((sound) => sound.name)).toEqual([])
  })

  it('names only entries that exist', () => {
    const sprites = new Set(LIBRARY_SPRITES.map((sprite) => sprite.name))
    const backdrops = new Set(LIBRARY_BACKDROPS.map((backdrop) => backdrop.name))
    const sounds = new Set(LIBRARY_SOUNDS.map((sound) => sound.name))
    expect(Object.keys(SPRITE_CATALOG).filter((name) => !sprites.has(name))).toEqual([])
    expect(Object.keys(BACKDROP_CATALOG).filter((name) => !backdrops.has(name))).toEqual([])
    expect(NAMED_SOUND_NAMES.filter((name) => !sounds.has(name))).toEqual([])
    expect(Object.values(APPROXIMATIONS.sprite).filter(({ name }) => !sprites.has(name))).toEqual([])
    expect(Object.values(APPROXIMATIONS.backdrop).filter(({ name }) => !backdrops.has(name))).toEqual([])
    expect(Object.values(APPROXIMATIONS.sound).filter(({ name }) => !sounds.has(name))).toEqual([])
  })
})
