import { fileURLToPath } from 'node:url'

export type FixtureExpectation = 'parse-only' | 'lossless' | 'vm-normalized' | 'behavioral'
export type FixtureFormat = 'sb2' | 'sb3' | 'sprite2' | 'sprite3'

export interface OfficialFixture {
  readonly name: string
  readonly format: FixtureFormat
  readonly expectation: FixtureExpectation
  readonly category: string
  readonly path: string
  readonly notes: string
}

const fixtureRoot = fileURLToPath(new URL('../../../scratch-vm/test/fixtures/', import.meta.url))

const fixture = (
  name: string,
  format: FixtureFormat,
  expectation: FixtureExpectation,
  category: string,
  notes: string,
): OfficialFixture => ({
  name,
  format,
  expectation,
  category,
  path: `${fixtureRoot}/${name}`,
  notes,
})

/**
 * First compatibility baseline. Keep this list explicit: upstream fixture
 * additions must be reviewed and classified rather than silently entering CI.
 */
export const OFFICIAL_FIXTURE_MATRIX: readonly OfficialFixture[] = [
  fixture('default.sb3', 'sb3', 'vm-normalized', 'baseline', 'minimal default project'),
  fixture('comments.sb3', 'sb3', 'lossless', 'comments', 'block and workspace comments'),
  fixture('comments_no_duplicate_id_serialization.sb3', 'sb3', 'vm-normalized', 'comments', 'comment ID remapping'),
  fixture('draggable.sb3', 'sb3', 'vm-normalized', 'target-metadata', 'draggable sprite metadata'),
  fixture('edge-triggered-hat.sb3', 'sb3', 'vm-normalized', 'events', 'edge-triggered hat'),
  fixture('list-monitor-rename.sb3', 'sb3', 'lossless', 'monitors', 'list monitor metadata'),
  fixture('monitored_variables.sb3', 'sb3', 'lossless', 'monitors', 'variable watcher'),
  fixture('monitors.sb3', 'sb3', 'lossless', 'monitors', 'monitor collection'),
  fixture('origin.sb3', 'sb3', 'parse-only', 'target-metadata', 'prefixed project.json path; archive boundary'),
  fixture('origin-absent.sb3', 'sb3', 'vm-normalized', 'target-metadata', 'missing origin defaults'),
  fixture('top-level-reporters.sb3', 'sb3', 'vm-normalized', 'block-graph', 'detached reporter blocks'),
  fixture('variable_characters.sb3', 'sb3', 'lossless', 'symbols', 'special variable characters'),
  fixture('broadcast_special_chars.sb3', 'sb3', 'lossless', 'symbols', 'special broadcast characters'),
  fixture('cloud_variables_limit.sb3', 'sb3', 'vm-normalized', 'cloud', 'cloud variable limit'),
  fixture('cloud_variables_local.sb3', 'sb3', 'vm-normalized', 'cloud', 'local cloud variable'),
  fixture('cloud_variables_simple.sb3', 'sb3', 'vm-normalized', 'cloud', 'simple cloud variable'),
  fixture('cloud_variables_exceeded_limit.sb3', 'sb3', 'parse-only', 'cloud', 'expected cloud limit rejection'),
  fixture('corrupt_png.sb3', 'sb3', 'parse-only', 'assets', 'corrupted PNG asset'),
  fixture('corrupt_sound.sb3', 'sb3', 'parse-only', 'assets', 'corrupted sound asset'),
  fixture('corrupt_svg.sb3', 'sb3', 'parse-only', 'assets', 'corrupted SVG asset'),
  fixture('missing_png.sb3', 'sb3', 'parse-only', 'assets', 'missing PNG asset'),
  fixture('missing_sound.sb3', 'sb3', 'parse-only', 'assets', 'missing sound asset'),
  fixture('missing_svg.sb3', 'sb3', 'parse-only', 'assets', 'missing SVG asset'),
  fixture('timer-monitor.sb3', 'sb3', 'lossless', 'monitors', 'timer monitor'),
  fixture('cat.sprite3', 'sprite3', 'parse-only', 'sprite-archive', 'sprite archive boundary'),
  fixture('corrupt_png.sprite3', 'sprite3', 'parse-only', 'sprite-archive', 'corrupt sprite asset'),
  fixture('missing_png.sprite3', 'sprite3', 'parse-only', 'sprite-archive', 'missing sprite asset'),
  fixture('missing_svg.sprite3', 'sprite3', 'parse-only', 'sprite-archive', 'missing sprite SVG'),
  fixture('comments.sb2', 'sb2', 'parse-only', 'legacy', 'legacy Scratch 2 source fixture'),
  fixture('procedure.sb2', 'sb2', 'parse-only', 'legacy', 'legacy procedure source fixture'),
] as const

export const fixtureByName = (name: string): OfficialFixture => {
  const result = OFFICIAL_FIXTURE_MATRIX.find((entry) => entry.name === name)
  if (!result) throw new Error(`Fixture is not in the compatibility matrix: ${name}`)
  return result
}
