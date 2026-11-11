import { describe, expect, it } from 'vitest'
import {
  costumeSize,
  describePick,
  eventSound,
  motionCostumes,
  pickBackdrop,
  pickSound,
  pickSprite,
  searchAssets,
  soundSeconds,
} from '../../src/core/visuals/assets'
import { findLibrarySprite } from '../../src/core/visuals/library'

const sprite = (name: string) => {
  const found = findLibrarySprite(name)
  if (!found) throw new Error(`no sprite ${name}`)
  return found
}

describe('asset picker', () => {
  it('matches exact names, Chinese words and Taiwan-specific stand-ins', () => {
    expect(pickSprite('Pufferfish')).toMatchObject({ name: 'Pufferfish', match: 'exact' })
    expect(pickSprite('小貓')).toMatchObject({ match: 'keyword' })
    expect(pickSprite('螃蟹')).toMatchObject({ name: 'Crab', match: 'keyword' })
    const kuhua = pickSprite('苦花魚')
    expect(kuhua).toMatchObject({ name: 'Fish', match: 'approximate' })
    expect(kuhua.note).toContain('苦花')
    expect(pickSprite('黑面琵鷺')).toMatchObject({ name: 'Dove', match: 'approximate' })
  })

  it('reads the head noun at the end of a Chinese name', () => {
    expect(pickSprite('渡船伯')).toMatchObject({ name: 'Wizard', match: 'approximate' })
    expect(pickSprite('毒魚陷阱')).toMatchObject({ name: 'Rocks', match: 'approximate' })
    expect(pickSprite('小石魚')).toMatchObject({ name: 'Fish', match: 'keyword' })
    expect(pickSprite('曹謹知縣')).toMatchObject({ name: 'Prince', match: 'approximate' })
    expect(pickBackdrop('山上的溪流')).toMatchObject({ name: 'Water And Rocks', match: 'keyword' })
    expect(pickBackdrop('淡水河')).toMatchObject({ name: 'Water And Rocks' })
    expect(pickBackdrop('清代河港')).toMatchObject({ name: 'Boardwalk', match: 'approximate' })
  })

  it('offers same-category alternatives', () => {
    const fish = pickSprite('魚')
    expect(fish.alternatives).toEqual(expect.arrayContaining(['Pufferfish']))
    expect(fish.alternatives).not.toContain(fish.name)
  })

  it('falls back to a category, and says when nothing fits', () => {
    expect(pickSprite('一個奇怪的東西', { category: 'bird' })).toMatchObject({ match: 'category' })
    expect(pickSprite('一個奇怪的東西')).toMatchObject({ match: 'none' })
  })

  it('picks river and city backdrops, with stand-ins for places the library lacks', () => {
    expect(pickBackdrop('溪流')).toMatchObject({ name: 'Water And Rocks', match: 'keyword' })
    expect(pickBackdrop('水底')).toMatchObject({ match: 'keyword' })
    expect(pickBackdrop('河口濕地')).toMatchObject({ name: 'Wetland' })
    expect(pickBackdrop('河濱公園')).toMatchObject({ name: 'City With Water', match: 'approximate' })
    expect(pickBackdrop('Underwater 2')).toMatchObject({ name: 'Underwater 2', match: 'exact' })
  })

  it('picks sounds by word or event, preferring a sprite’s own sound', () => {
    expect(pickSound('水花')).toMatchObject({ name: 'Splash' })
    expect(pickSound('勝利')).toMatchObject({ match: 'keyword' })
    expect(pickSound('什麼都不是', { category: 'collect' })).toMatchObject({ name: 'Collect', match: 'category' })
    expect(eventSound('win')).toBe('Win')
    expect(eventSound('collect')).toBe('Collect')
  })

  it('knows motion loops, sizes and sound lengths', () => {
    expect(motionCostumes(sprite('Fish'))).toEqual(['Fish-a', 'Fish-b', 'Fish-c', 'Fish-d'])
    expect(motionCostumes(sprite('Giga Walking'))).toEqual(['Giga Walk1', 'Giga Walk2', 'Giga Walk3'])
    expect(motionCostumes(sprite('Apple'))).toEqual([])
    expect(costumeSize(sprite('Fish'))).toEqual({ width: 113, height: 65 })
    expect(soundSeconds('Win')).toBeGreaterThan(1)
  })

  it('searches the whole library in Chinese or English, by category', () => {
    expect(searchAssets({ kind: 'sprite', query: '魚' }).map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['Fish', 'Pufferfish']),
    )
    expect(
      searchAssets({ kind: 'sprite', category: 'water-animal', limit: 50 }).every(
        (entry) => entry.category === 'water-animal',
      ),
    ).toBe(true)
    expect(searchAssets({ kind: 'backdrop', query: 'river' })[0]?.name).toBe('Water And Rocks')
    expect(searchAssets({ kind: 'sound', category: 'music', limit: 3 })[0]?.seconds).toBeGreaterThan(1)
  })

  it('describes a pick for reports', () => {
    expect(describePick(pickSprite('苦花魚'), '苦花魚')).toMatch(/^苦花魚 → Fish（近似：.*）；也可換成/)
  })
})
