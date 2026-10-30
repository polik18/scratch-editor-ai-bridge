import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildScratchProjectArchive, buildScratchProjectJson } from '../../src/core/compiler/project-json'
import emptyVisuals from '../../src/core/ir/examples/02-green-flag-move-say.json'
import example from '../../src/core/ir/examples/03-repeat-score.json'
import platformer from '../../src/core/ir/examples/06-platformer-core.json'
import type { CanonicalProject } from '../../src/core/ir/types'
import { normalizeAiDraft } from '../../src/core/normalizer/ai-draft'
import { validateCanonicalProject } from '../../src/core/validator/canonical-ir'
import geminiPlatformer from '../fixtures/gemini-platformer-shorthand.json'

describe('Scratch project JSON compiler', () => {
  it('creates visible themed assets instead of a white stage and transparent sprites', async () => {
    const archive = await buildScratchProjectArchive(emptyVisuals as CanonicalProject)
    const zip = await JSZip.loadAsync(archive)
    const projectFile = zip.file('project.json')
    expect(projectFile).not.toBeNull()
    if (!projectFile) return
    const project = JSON.parse(await projectFile.async('string')) as any
    const stage = project.targets[0]
    const sprite = project.targets[1]
    const stageFile = zip.file(stage.costumes[0].md5ext)
    const spriteFile = zip.file(sprite.costumes[0].md5ext)
    expect(stageFile).not.toBeNull()
    expect(spriteFile).not.toBeNull()
    if (!stageFile || !spriteFile) return
    const stageSvg = await stageFile.async('string')
    const spriteSvg = await spriteFile.async('string')

    expect(stageSvg).toContain('data-sab-preset="platform-day"')
    expect(stageSvg).toContain('linearGradient')
    expect(spriteSvg).toContain('data-sab-preset="generic-character"')
    expect(spriteSvg).toContain('Sprite1')
    expect(sprite.costumes[0].rotationCenterX).toBe(38)
    expect(sprite.costumes[0].rotationCenterY).toBe(38)
    expect(stage.costumes[0].assetId).not.toBe(sprite.costumes[0].assetId)
  })

  it('gives the reported Gemini platformer distinct role-based artwork', async () => {
    const normalized = normalizeAiDraft(geminiPlatformer)
    const validation = validateCanonicalProject(normalized.data)
    expect(validation.valid).toBe(true)
    if (!validation.valid) return

    const archive = await buildScratchProjectArchive(validation.data)
    const zip = await JSZip.loadAsync(archive)
    const projectFile = zip.file('project.json')
    expect(projectFile).not.toBeNull()
    if (!projectFile) return
    const project = JSON.parse(await projectFile.async('string')) as any
    const presets = await Promise.all(
      project.targets.map(async (target: any) => {
        const costumeFile = zip.file(target.costumes[0].md5ext)
        expect(costumeFile).not.toBeNull()
        return costumeFile ? /data-sab-preset="([^"]+)"/.exec(await costumeFile.async('string'))?.[1] : undefined
      }),
    )

    expect(presets).toEqual(['platform-day', 'platform-hero', 'platform-enemy', 'coin', 'generic-character'])
  })

  it('compiles Breakout target names into correctly sized paddle, walls, and bricks', async () => {
    const project = structuredClone(emptyVisuals) as CanonicalProject
    project.name = 'Breakout Game'
    project.sprites = [
      ['Paddle', 'platform'],
      ['TopWall', 'platform'],
      ['LeftWall', 'platform'],
      ['Brick1', 'coin'],
    ].map(([name, costumeName]) => ({
      kind: 'sprite' as const,
      name,
      x: 0,
      y: 0,
      direction: 90,
      size: 100,
      visible: true,
      draggable: false,
      rotationStyle: 'all around' as const,
      variables: [],
      lists: [],
      costumes: [{ name: costumeName, dataFormat: 'svg' as const }],
      sounds: [],
      scripts: [],
      procedures: [],
    }))

    const archive = await buildScratchProjectArchive(project)
    const zip = await JSZip.loadAsync(archive)
    const projectFile = zip.file('project.json')
    expect(projectFile).not.toBeNull()
    if (!projectFile) return
    const compiled = JSON.parse(await projectFile.async('string')) as any
    const visuals = await Promise.all(
      compiled.targets.slice(1).map(async (target: any) => {
        const asset = zip.file(target.costumes[0].md5ext)
        expect(asset).not.toBeNull()
        return asset ? await asset.async('string') : ''
      }),
    )

    expect(visuals[0]).toContain('data-sab-preset="paddle"')
    expect(visuals[0]).toContain('width="104" height="18"')
    expect(visuals[1]).toContain('data-sab-preset="wall"')
    expect(visuals[1]).toContain('width="480" height="18"')
    expect(visuals[2]).toContain('data-sab-preset="wall"')
    expect(visuals[2]).toContain('width="18" height="360"')
    expect(visuals[3]).toContain('data-sab-preset="brick"')
    expect(visuals[3]).toContain('width="64" height="28"')
  })

  it('creates deterministic block graph, symbols and nested substacks', async () => {
    const result = await buildScratchProjectJson(example as CanonicalProject)
    const stage = result.targets[0]
    expect(stage.isStage).toBe(true)
    expect(Object.keys(stage.variables)).toHaveLength(1)

    const blocks = Object.values(stage.blocks)
    expect(blocks.some((block) => block.opcode === 'event_whenflagclicked')).toBe(true)
    expect(blocks.some((block) => block.opcode === 'control_repeat')).toBe(true)
    expect(blocks.some((block) => block.opcode === 'data_changevariableby')).toBe(true)
  })

  it('compiles nested canonical metadata without flattening JSON values', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.meta = { custom: { array: [null, 1, { enabled: true }] } }
    expect(validateCanonicalProject(project)).toMatchObject({ valid: true })
    expect((await buildScratchProjectJson(project)).meta.custom).toEqual({ array: [null, 1, { enabled: true }] })
  })

  it('preserves WAV and MP3 bytes and sound metadata through archive compilation', async () => {
    const project = structuredClone(example as CanonicalProject)
    const wavBytes = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4])
    const mp3Bytes = Uint8Array.from([73, 68, 51, 5, 6, 7])
    const asBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    project.stage.sounds = [
      {
        name: 'wav-data-url',
        dataFormat: 'wav',
        data: `data:audio/wav;base64,${asBase64(wavBytes)}`,
        rate: 32_000,
        sampleCount: 12,
      },
      {
        name: 'mp3-base64',
        dataFormat: 'mp3',
        data: asBase64(mp3Bytes),
        rate: 44_100,
        sampleCount: 34,
      },
    ]

    const compiled = await buildScratchProjectJson(project)
    const archive = await buildScratchProjectArchive(project)
    const zip = await JSZip.loadAsync(archive)
    for (const [index, expectedBytes] of [wavBytes, mp3Bytes].entries()) {
      const sound = compiled.targets[0].sounds[index]
      const stored = await zip.file(sound.md5ext)?.async('uint8array')
      expect(stored, sound.name).toEqual(expectedBytes)
      expect(sound).toMatchObject({
        dataFormat: index === 0 ? 'wav' : 'mp3',
        rate: index === 0 ? 32_000 : 44_100,
        sampleCount: index === 0 ? 12 : 34,
      })
    }
  })

  it('compiles newly registered arithmetic and text reporters through the generic graph path', async () => {
    const project = structuredClone(example as CanonicalProject)
    const assigned = project.stage.scripts[0].blocks[1]
    if (!assigned.inputs) throw new Error('Expected score assignment in the example project')
    assigned.inputs.VALUE = {
      type: 'block',
      block: {
        opcode: 'operator_add',
        inputs: {
          NUM1: { type: 'literal', value: 1 },
          NUM2: {
            type: 'block',
            block: {
              opcode: 'operator_random',
              inputs: {
                FROM: {
                  type: 'block',
                  block: { opcode: 'operator_length', inputs: { STRING: { type: 'literal', value: 'two' } } },
                },
                TO: { type: 'literal', value: 5 },
              },
            },
          },
        },
      },
    }
    project.stage.scripts.push({
      blocks: [
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: {
                opcode: 'operator_join',
                inputs: {
                  STRING1: { type: 'literal', value: 'score=' },
                  STRING2: { type: 'literal', value: 10 },
                },
              },
            },
          },
        },
      ],
    })
    project.stage.scripts.push({
      blocks: [
        {
          opcode: 'control_if',
          inputs: {
            CONDITION: {
              type: 'block',
              block: {
                opcode: 'operator_contains',
                inputs: {
                  STRING1: { type: 'literal', value: 'Scratch blocks' },
                  STRING2: { type: 'literal', value: 'blocks' },
                },
              },
            },
            SUBSTACK: {
              type: 'stack',
              blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'found' } } }],
            },
          },
        },
      ],
    })
    project.stage.scripts.push({
      blocks: [
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: {
                opcode: 'operator_join',
                inputs: {
                  STRING1: {
                    type: 'block',
                    block: {
                      opcode: 'operator_letter_of',
                      inputs: {
                        LETTER: {
                          type: 'block',
                          block: { opcode: 'operator_round', inputs: { NUM: { type: 'literal', value: 1.4 } } },
                        },
                        STRING: { type: 'literal', value: 'abc' },
                      },
                    },
                  },
                  STRING2: {
                    type: 'block',
                    block: {
                      opcode: 'operator_mathop',
                      fields: { OPERATOR: 'sqrt' },
                      inputs: { NUM: { type: 'literal', value: 16 } },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    })
    project.stage.scripts.push({
      blocks: [
        { opcode: 'event_whenflagclicked' },
        { opcode: 'sensing_resettimer' },
        {
          opcode: 'control_if',
          inputs: {
            CONDITION: {
              type: 'block',
              block: {
                opcode: 'operator_and',
                inputs: {
                  OPERAND1: { type: 'block', block: { opcode: 'sensing_mousedown' } },
                  OPERAND2: {
                    type: 'block',
                    block: {
                      opcode: 'sensing_keypressed',
                      inputs: { KEY_OPTION: { type: 'literal', value: 'space' } },
                    },
                  },
                },
              },
            },
            SUBSTACK: {
              type: 'stack',
              blocks: [
                {
                  opcode: 'looks_say',
                  inputs: {
                    MESSAGE: {
                      type: 'block',
                      block: {
                        opcode: 'operator_join',
                        inputs: {
                          STRING1: { type: 'block', block: { opcode: 'sensing_timer' } },
                          STRING2: {
                            type: 'block',
                            block: {
                              opcode: 'operator_join',
                              inputs: {
                                STRING1: { type: 'block', block: { opcode: 'sensing_mousex' } },
                                STRING2: { type: 'block', block: { opcode: 'sensing_mousey' } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    })
    project.stage.scripts.push({
      blocks: [
        {
          opcode: 'control_wait_until',
          inputs: { CONDITION: { type: 'block', block: { opcode: 'sensing_mousedown' } } },
        },
        {
          opcode: 'control_repeat_until',
          inputs: {
            CONDITION: {
              type: 'block',
              block: { opcode: 'sensing_keypressed', inputs: { KEY_OPTION: { type: 'literal', value: 'space' } } },
            },
            SUBSTACK: {
              type: 'stack',
              blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'waiting' } } }],
            },
          },
        },
        { opcode: 'control_stop', fields: { STOP_OPTION: 'this script' } },
      ],
    })
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    project.sprites[0].scripts.push({
      blocks: [
        { opcode: 'control_start_as_clone' },
        { opcode: 'control_create_clone_of', inputs: { CLONE_OPTION: { type: 'literal', value: '_myself_' } } },
        { opcode: 'control_delete_this_clone' },
        { opcode: 'motion_turnright', inputs: { DEGREES: { type: 'literal', value: 15 } } },
        { opcode: 'motion_turnleft', inputs: { DEGREES: { type: 'literal', value: 15 } } },
        { opcode: 'motion_pointindirection', inputs: { DIRECTION: { type: 'literal', value: 90 } } },
        { opcode: 'motion_pointtowards', inputs: { TOWARDS: { type: 'literal', value: '_mouse_' } } },
        { opcode: 'motion_goto', inputs: { TO: { type: 'literal', value: '_mouse_' } } },
        {
          opcode: 'motion_glidesecstoxy',
          inputs: {
            SECS: { type: 'literal', value: 1 },
            X: { type: 'literal', value: 10 },
            Y: { type: 'literal', value: 20 },
          },
        },
        { opcode: 'looks_show' },
        { opcode: 'looks_hide' },
        { opcode: 'looks_nextcostume' },
        { opcode: 'looks_changesizeby', inputs: { CHANGE: { type: 'literal', value: 10 } } },
        { opcode: 'looks_setsizeto', inputs: { SIZE: { type: 'literal', value: 100 } } },
        {
          opcode: 'looks_sayforsecs',
          inputs: { MESSAGE: { type: 'literal', value: 'hello' }, SECS: { type: 'literal', value: 2 } },
        },
        { opcode: 'looks_think', inputs: { MESSAGE: { type: 'literal', value: 'hmm' } } },
        {
          opcode: 'looks_thinkforsecs',
          inputs: { MESSAGE: { type: 'literal', value: 'hmm' }, SECS: { type: 'literal', value: 2 } },
        },
      ],
    })

    const stage = (await buildScratchProjectJson(project)).targets[0]
    expect(Object.values(stage.blocks).map(({ opcode }) => opcode)).toEqual(
      expect.arrayContaining([
        'operator_add',
        'operator_random',
        'operator_join',
        'operator_contains',
        'operator_length',
        'operator_letter_of',
        'operator_round',
        'operator_mathop',
        'sensing_timer',
        'sensing_resettimer',
        'sensing_mousex',
        'sensing_mousey',
        'sensing_mousedown',
        'sensing_keypressed',
        'control_wait_until',
        'control_repeat_until',
        'control_stop',
      ]),
    )
    const keyPressed = Object.values(stage.blocks).find(({ opcode }) => opcode === 'sensing_keypressed')
    const keyMenuId = keyPressed?.inputs.KEY_OPTION[1]
    expect(typeof keyMenuId).toBe('string')
    if (typeof keyMenuId === 'string') {
      expect(stage.blocks[keyMenuId]).toMatchObject({
        opcode: 'sensing_keyoptions',
        fields: { KEY_OPTION: ['space'] },
        shadow: true,
      })
    }
    const spriteBlocks =
      (await buildScratchProjectJson(project)).targets.find(({ isStage }) => !isStage)?.blocks ?? {}
    expect(Object.values(spriteBlocks).map(({ opcode }) => opcode)).toEqual(
      expect.arrayContaining([
        'motion_turnright',
        'motion_turnleft',
        'motion_pointindirection',
        'motion_pointtowards',
        'motion_goto',
        'motion_glidesecstoxy',
        'looks_show',
        'looks_hide',
        'looks_nextcostume',
        'looks_changesizeby',
        'looks_setsizeto',
        'looks_sayforsecs',
        'looks_think',
        'looks_thinkforsecs',
        'control_start_as_clone',
        'control_create_clone_of',
        'control_delete_this_clone',
      ]),
    )
    const towards = Object.values(spriteBlocks).find(({ opcode }) => opcode === 'motion_pointtowards')
    const towardsMenuId = towards?.inputs.TOWARDS[1]
    expect(typeof towardsMenuId).toBe('string')
    if (typeof towardsMenuId === 'string') {
      expect(spriteBlocks[towardsMenuId]).toMatchObject({
        opcode: 'motion_pointtowards_menu',
        fields: { TOWARDS: ['_mouse_'] },
        shadow: true,
      })
    }
    const goTo = Object.values(spriteBlocks).find(({ opcode }) => opcode === 'motion_goto')
    const goToMenuId = goTo?.inputs.TO[1]
    expect(typeof goToMenuId).toBe('string')
    if (typeof goToMenuId === 'string') {
      expect(spriteBlocks[goToMenuId]).toMatchObject({
        opcode: 'motion_goto_menu',
        fields: { TO: ['_mouse_'] },
        shadow: true,
      })
    }
    const cloneBlock = Object.values(spriteBlocks).find(({ opcode }) => opcode === 'control_create_clone_of')
    const cloneMenuId = cloneBlock?.inputs.CLONE_OPTION[1]
    expect(typeof cloneMenuId).toBe('string')
    if (typeof cloneMenuId === 'string') {
      expect(spriteBlocks[cloneMenuId]).toMatchObject({
        opcode: 'control_create_clone_of_menu',
        fields: { CLONE_OPTION: ['_myself_'] },
        shadow: true,
      })
    }
  })

  it('creates official menu shadows for platformer collision and costume blocks', async () => {
    const result = await buildScratchProjectJson(platformer as CanonicalProject)
    const player = result.targets.find((target) => target.name === 'Player')
    expect(player).toBeDefined()
    if (!player) return

    const blocks = Object.values(player.blocks)
    const keyHat = blocks.find((block) => block.opcode === 'event_whenkeypressed')
    expect(keyHat?.fields.KEY_OPTION).toEqual(['right arrow'])

    const touching = blocks.find((block) => block.opcode === 'sensing_touchingobject')
    const touchingInput = touching?.inputs.TOUCHINGOBJECTMENU
    expect(touchingInput?.[0]).toBe(1)
    const touchingShadowId = touchingInput?.[1]
    expect(typeof touchingShadowId).toBe('string')
    if (typeof touchingShadowId !== 'string') return
    expect(player.blocks[touchingShadowId]).toMatchObject({
      opcode: 'sensing_touchingobjectmenu',
      fields: { TOUCHINGOBJECTMENU: ['Platform'] },
      shadow: true,
      topLevel: false,
    })

    const costume = blocks.find((block) => block.opcode === 'looks_switchcostumeto')
    const costumeShadowId = costume?.inputs.COSTUME[1]
    expect(typeof costumeShadowId).toBe('string')
    if (typeof costumeShadowId !== 'string') return
    expect(player.blocks[costumeShadowId]).toMatchObject({
      opcode: 'looks_costume',
      fields: { COSTUME: ['player'] },
      shadow: true,
    })
  })

  it('compiles list commands, reporters, and list fields from the capability registry', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.stage.lists.push({ name: 'items', value: [] })
    project.stage.scripts.push({
      blocks: [
        {
          opcode: 'data_addtolist',
          fields: { LIST: 'items' },
          inputs: { ITEM: { type: 'literal', value: 'apple' } },
        },
        {
          opcode: 'data_insertatlist',
          fields: { LIST: 'items' },
          inputs: {
            ITEM: { type: 'literal', value: 'pear' },
            INDEX: { type: 'literal', value: 1 },
          },
        },
        {
          opcode: 'data_replaceitemoflist',
          fields: { LIST: 'items' },
          inputs: {
            ITEM: { type: 'literal', value: 'plum' },
            INDEX: { type: 'literal', value: 2 },
          },
        },
        {
          opcode: 'data_deleteoflist',
          fields: { LIST: 'items' },
          inputs: { INDEX: { type: 'literal', value: 'last' } },
        },
        { opcode: 'data_deletealloflist', fields: { LIST: 'items' } },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: {
                opcode: 'operator_join',
                inputs: {
                  STRING1: {
                    type: 'block',
                    block: {
                      opcode: 'data_itemoflist',
                      fields: { LIST: 'items' },
                      inputs: { INDEX: { type: 'literal', value: 1 } },
                    },
                  },
                  STRING2: { type: 'block', block: { opcode: 'data_lengthoflist', fields: { LIST: 'items' } } },
                },
              },
            },
          },
        },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: { type: 'block', block: { opcode: 'data_listcontents', fields: { LIST: 'items' } } },
          },
        },
        {
          opcode: 'control_if',
          inputs: {
            CONDITION: {
              type: 'block',
              block: {
                opcode: 'data_listcontainsitem',
                fields: { LIST: 'items' },
                inputs: { ITEM: { type: 'literal', value: 'apple' } },
              },
            },
            SUBSTACK: {
              type: 'stack',
              blocks: [
                {
                  opcode: 'looks_say',
                  inputs: {
                    MESSAGE: {
                      type: 'block',
                      block: {
                        opcode: 'data_itemnumoflist',
                        fields: { LIST: 'items' },
                        inputs: { ITEM: { type: 'literal', value: 'apple' } },
                      },
                    },
                  },
                },
                {
                  opcode: 'data_addtolist',
                  fields: { LIST: 'items' },
                  inputs: { ITEM: { type: 'literal', value: 'new' } },
                },
              ],
            },
          },
        },
      ],
    })

    project.stage.scripts.push({
      blocks: [
        { opcode: 'data_showvariable', fields: { VARIABLE: 'score' } },
        { opcode: 'data_hidevariable', fields: { VARIABLE: 'score' } },
        { opcode: 'data_showlist', fields: { LIST: 'items' } },
        { opcode: 'data_hidelist', fields: { LIST: 'items' } },
        {
          opcode: 'control_while',
          inputs: {
            CONDITION: { type: 'block', block: { opcode: 'sensing_mousedown' } },
            SUBSTACK: {
              type: 'stack',
              blocks: [{ opcode: 'control_wait', inputs: { DURATION: { type: 'literal', value: 0.1 } } }],
            },
          },
        },
        {
          opcode: 'control_for_each',
          fields: { VARIABLE: 'score' },
          inputs: {
            VALUE: { type: 'literal', value: 3 },
            SUBSTACK: {
              type: 'stack',
              blocks: [
                {
                  opcode: 'data_changevariableby',
                  fields: { VARIABLE: 'score' },
                  inputs: { VALUE: { type: 'literal', value: 1 } },
                },
              ],
            },
          },
        },
        {
          opcode: 'control_all_at_once',
          inputs: {
            SUBSTACK: {
              type: 'stack',
              blocks: [{ opcode: 'control_incr_counter' }, { opcode: 'control_clear_counter' }],
            },
          },
        },
        { opcode: 'looks_say', inputs: { MESSAGE: { type: 'block', block: { opcode: 'control_get_counter' } } } },
      ],
    })

    const stage = (await buildScratchProjectJson(project)).targets[0]
    const blocks = Object.values(stage.blocks)
    expect(blocks.map(({ opcode }) => opcode)).toEqual(
      expect.arrayContaining([
        'data_addtolist',
        'data_insertatlist',
        'data_replaceitemoflist',
        'data_deleteoflist',
        'data_deletealloflist',
        'data_itemoflist',
        'data_itemnumoflist',
        'data_lengthoflist',
        'data_listcontainsitem',
        'data_listcontents',
        'data_showvariable',
        'data_hidevariable',
        'data_showlist',
        'data_hidelist',
        'control_while',
        'control_for_each',
        'control_all_at_once',
        'control_get_counter',
        'control_incr_counter',
        'control_clear_counter',
      ]),
    )
    expect(
      blocks
        .filter(({ opcode }) => opcode.startsWith('data_') && opcode.includes('list'))
        .filter(({ fields }) => fields.LIST[0] === 'items'),
    ).not.toHaveLength(0)
    expect(blocks.find(({ opcode }) => opcode === 'data_itemoflist')?.fields.LIST).toEqual([
      'items',
      expect.any(String),
    ])
  })

  it('compiles additional event hats and the broadcast-and-wait block', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.broadcasts.push({ name: 'finish' })
    project.stage.scripts.push({
      blocks: [
        { opcode: 'event_whenstageclicked' },
        { opcode: 'event_whenbackdropswitchesto', fields: { BACKDROP: 'platform-day' } },
        {
          opcode: 'event_whengreaterthan',
          fields: { WHENGREATERTHANMENU: 'TIMER' },
          inputs: { VALUE: { type: 'literal', value: 30 } },
        },
        { opcode: 'event_broadcastandwait', inputs: { BROADCAST_INPUT: { type: 'broadcast', name: 'finish' } } },
      ],
    })
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    project.sprites[0].scripts.push({ blocks: [{ opcode: 'event_whenthisspriteclicked' }] })

    const result = await buildScratchProjectJson(project)
    expect(Object.values(result.targets[0].blocks).map(({ opcode }) => opcode)).toEqual(
      expect.arrayContaining([
        'event_whenstageclicked',
        'event_whenbackdropswitchesto',
        'event_whengreaterthan',
        'event_broadcastandwait',
      ]),
    )
    expect(Object.values(result.targets[1].blocks).map(({ opcode }) => opcode)).toContain(
      'event_whenthisspriteclicked',
    )
  })

  it('compiles backdrop, graphic-effect, layer, and looks reporter capabilities', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    project.stage.scripts.push({
      blocks: [
        { opcode: 'looks_switchbackdropto', inputs: { BACKDROP: { type: 'literal', value: 'platform-day' } } },
        {
          opcode: 'looks_switchbackdroptoandwait',
          inputs: { BACKDROP: { type: 'literal', value: 'platform-day' } },
        },
        { opcode: 'looks_nextbackdrop' },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: { opcode: 'looks_backdropnumbername', fields: { NUMBER_NAME: 'name' } },
            },
          },
        },
      ],
    })
    project.sprites[0].scripts.push({
      blocks: [
        {
          opcode: 'looks_changeeffectby',
          fields: { EFFECT: 'color' },
          inputs: { CHANGE: { type: 'literal', value: 25 } },
        },
        {
          opcode: 'looks_seteffectto',
          fields: { EFFECT: 'ghost' },
          inputs: { VALUE: { type: 'literal', value: 10 } },
        },
        { opcode: 'looks_cleargraphiceffects' },
        { opcode: 'looks_gotofrontback', fields: { FRONT_BACK: 'front' } },
        {
          opcode: 'looks_goforwardbackwardlayers',
          fields: { FORWARD_BACKWARD: 'forward' },
          inputs: { NUM: { type: 'literal', value: 1 } },
        },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: {
                opcode: 'operator_join',
                inputs: {
                  STRING1: { type: 'block', block: { opcode: 'looks_size' } },
                  STRING2: {
                    type: 'block',
                    block: { opcode: 'looks_costumenumbername', fields: { NUMBER_NAME: 'number' } },
                  },
                },
              },
            },
          },
        },
      ],
    })

    const result = await buildScratchProjectJson(project)
    const stageOpcodes = Object.values(result.targets[0].blocks).map(({ opcode }) => opcode)
    const spriteOpcodes = Object.values(result.targets[1].blocks).map(({ opcode }) => opcode)
    expect(stageOpcodes).toEqual(
      expect.arrayContaining([
        'looks_switchbackdropto',
        'looks_switchbackdroptoandwait',
        'looks_nextbackdrop',
        'looks_backdropnumbername',
      ]),
    )
    expect(spriteOpcodes).toEqual(
      expect.arrayContaining([
        'looks_changeeffectby',
        'looks_seteffectto',
        'looks_cleargraphiceffects',
        'looks_size',
        'looks_costumenumbername',
        'looks_gotofrontback',
        'looks_goforwardbackwardlayers',
      ]),
    )
  })

  it('compiles common sensing inputs, reporters, and browser capability blocks', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    project.sprites[0].scripts.push({
      blocks: [
        { opcode: 'event_whentouchingobject', fields: { TOUCHINGOBJECTMENU: '_mouse_' } },
        { opcode: 'sensing_setdragmode', fields: { DRAG_MODE: 'draggable' } },
        { opcode: 'looks_say', inputs: { MESSAGE: { type: 'block', block: { opcode: 'sensing_userid' } } } },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: {
                opcode: 'sensing_of',
                fields: { PROPERTY: 'x position' },
                inputs: { OBJECT: { type: 'literal', value: '_stage_' } },
              },
            },
          },
        },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: {
                opcode: 'operator_join',
                inputs: {
                  STRING1: {
                    type: 'block',
                    block: {
                      opcode: 'sensing_distanceto',
                      inputs: { DISTANCETOMENU: { type: 'literal', value: '_mouse_' } },
                    },
                  },
                  STRING2: { type: 'block', block: { opcode: 'sensing_loudness' } },
                },
              },
            },
          },
        },
        {
          opcode: 'sensing_askandwait',
          inputs: { QUESTION: { type: 'literal', value: 'Your name?' } },
        },
        { opcode: 'looks_say', inputs: { MESSAGE: { type: 'block', block: { opcode: 'sensing_answer' } } } },
        {
          opcode: 'control_if',
          inputs: {
            CONDITION: {
              type: 'block',
              block: {
                opcode: 'sensing_coloristouchingcolor',
                inputs: {
                  COLOR: { type: 'literal', value: '#ff0000' },
                  COLOR2: { type: 'literal', value: '#00ff00' },
                },
              },
            },
            SUBSTACK: {
              type: 'stack',
              blocks: [
                {
                  opcode: 'control_if',
                  inputs: {
                    CONDITION: {
                      type: 'block',
                      block: {
                        opcode: 'sensing_touchingcolor',
                        inputs: { COLOR: { type: 'literal', value: '#0000ff' } },
                      },
                    },
                    SUBSTACK: {
                      type: 'stack',
                      blocks: [
                        {
                          opcode: 'looks_say',
                          inputs: { MESSAGE: { type: 'block', block: { opcode: 'sensing_loud' } } },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: { type: 'block', block: { opcode: 'sensing_current', fields: { CURRENTMENU: 'year' } } },
          },
        },
        { opcode: 'looks_say', inputs: { MESSAGE: { type: 'block', block: { opcode: 'sensing_dayssince2000' } } } },
        { opcode: 'looks_say', inputs: { MESSAGE: { type: 'block', block: { opcode: 'sensing_username' } } } },
        {
          opcode: 'control_if',
          inputs: {
            CONDITION: { type: 'block', block: { opcode: 'sensing_online' } },
            SUBSTACK: {
              type: 'stack',
              blocks: [{ opcode: 'looks_say', inputs: { MESSAGE: { type: 'literal', value: 'online' } } }],
            },
          },
        },
      ],
    })

    const sprite = (await buildScratchProjectJson(project)).targets.find(({ isStage }) => !isStage)
    expect(sprite).toBeDefined()
    if (!sprite) return
    const blocks = Object.values(sprite.blocks)
    expect(blocks.map(({ opcode }) => opcode)).toEqual(
      expect.arrayContaining([
        'sensing_distanceto',
        'sensing_touchingcolor',
        'sensing_coloristouchingcolor',
        'sensing_askandwait',
        'sensing_answer',
        'sensing_loudness',
        'sensing_loud',
        'sensing_current',
        'sensing_dayssince2000',
        'sensing_online',
        'sensing_username',
        'event_whentouchingobject',
        'sensing_setdragmode',
        'sensing_userid',
        'sensing_of',
      ]),
    )
    const distance = blocks.find(({ opcode }) => opcode === 'sensing_distanceto')
    const menuId = distance?.inputs.DISTANCETOMENU[1]
    expect(typeof menuId).toBe('string')
    if (typeof menuId === 'string')
      expect(sprite.blocks[menuId]).toMatchObject({ opcode: 'sensing_distancetomenu', shadow: true })
    const ofBlock = blocks.find(({ opcode }) => opcode === 'sensing_of')
    const objectMenuId = ofBlock?.inputs.OBJECT[1]
    expect(typeof objectMenuId).toBe('string')
    if (typeof objectMenuId === 'string')
      expect(sprite.blocks[objectMenuId]).toMatchObject({ opcode: 'sensing_of_object_menu', shadow: true })
  })

  it('compiles remaining common motion reporters and glide controls', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    project.sprites[0].scripts.push({
      blocks: [
        {
          opcode: 'motion_glideto',
          inputs: { SECS: { type: 'literal', value: 1 }, TO: { type: 'literal', value: '_mouse_' } },
        },
        { opcode: 'motion_ifonedgebounce' },
        { opcode: 'motion_setrotationstyle', fields: { STYLE: 'left-right' } },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: {
              type: 'block',
              block: {
                opcode: 'operator_join',
                inputs: {
                  STRING1: { type: 'block', block: { opcode: 'motion_xposition' } },
                  STRING2: {
                    type: 'block',
                    block: {
                      opcode: 'operator_join',
                      inputs: {
                        STRING1: { type: 'block', block: { opcode: 'motion_yposition' } },
                        STRING2: { type: 'block', block: { opcode: 'motion_direction' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        {
          opcode: 'looks_say',
          inputs: {
            MESSAGE: { type: 'block', block: { opcode: 'data_variable', fields: { VARIABLE: 'score' } } },
          },
        },
      ],
    })
    const sprite = (await buildScratchProjectJson(project)).targets.find(({ isStage }) => !isStage)
    expect(sprite).toBeDefined()
    if (!sprite) return
    expect(Object.values(sprite.blocks).map(({ opcode }) => opcode)).toEqual(
      expect.arrayContaining([
        'motion_glideto',
        'motion_ifonedgebounce',
        'motion_setrotationstyle',
        'motion_xposition',
        'motion_yposition',
        'motion_direction',
        'data_variable',
      ]),
    )
    const glide = Object.values(sprite.blocks).find(({ opcode }) => opcode === 'motion_glideto')
    const glideMenuId = glide?.inputs.TO[1]
    expect(typeof glideMenuId).toBe('string')
    if (typeof glideMenuId === 'string')
      expect(sprite.blocks[glideMenuId]).toMatchObject({ opcode: 'motion_glideto_menu', shadow: true })
  })

  it('compiles sound playback, effect, volume, and reporter blocks', async () => {
    const project = structuredClone(example as CanonicalProject)
    project.sprites.push(structuredClone((platformer as CanonicalProject).sprites[0]))
    project.sprites[0].scripts.push({
      blocks: [
        { opcode: 'sound_play', inputs: { SOUND_MENU: { type: 'literal', value: 'pop' } } },
        { opcode: 'sound_playuntildone', inputs: { SOUND_MENU: { type: 'literal', value: 'pop' } } },
        { opcode: 'sound_stopallsounds' },
        {
          opcode: 'sound_changeeffectby',
          fields: { EFFECT: 'pitch' },
          inputs: { VALUE: { type: 'literal', value: 10 } },
        },
        { opcode: 'sound_seteffectto', fields: { EFFECT: 'pan' }, inputs: { VALUE: { type: 'literal', value: 20 } } },
        { opcode: 'sound_cleareffects' },
        { opcode: 'sound_changevolumeby', inputs: { VOLUME: { type: 'literal', value: -10 } } },
        { opcode: 'sound_setvolumeto', inputs: { VOLUME: { type: 'literal', value: 80 } } },
        { opcode: 'looks_say', inputs: { MESSAGE: { type: 'block', block: { opcode: 'sound_volume' } } } },
      ],
    })
    const sprite = (await buildScratchProjectJson(project)).targets.find(({ isStage }) => !isStage)
    expect(sprite).toBeDefined()
    if (!sprite) return
    const blocks = Object.values(sprite.blocks)
    expect(blocks.map(({ opcode }) => opcode)).toEqual(
      expect.arrayContaining([
        'sound_play',
        'sound_playuntildone',
        'sound_stopallsounds',
        'sound_changeeffectby',
        'sound_seteffectto',
        'sound_cleareffects',
        'sound_changevolumeby',
        'sound_setvolumeto',
        'sound_volume',
      ]),
    )
    const playback = blocks.find(({ opcode }) => opcode === 'sound_play')
    const menuId = playback?.inputs.SOUND_MENU[1]
    expect(typeof menuId).toBe('string')
    if (typeof menuId === 'string') {
      expect(sprite.blocks[menuId]).toMatchObject({
        opcode: 'sound_sounds_menu',
        fields: { SOUND_MENU: ['pop'] },
        shadow: true,
      })
    }
  })

  it('infers official extension declarations from nested Canonical blocks', async () => {
    const project = structuredClone(emptyVisuals) as CanonicalProject
    project.extensions = []
    project.stage.scripts = [
      {
        blocks: [
          { opcode: 'event_whenflagclicked' },
          {
            opcode: 'control_forever',
            inputs: {
              SUBSTACK: {
                type: 'stack',
                blocks: [
                  { opcode: 'pen_clear' },
                  { opcode: 'music_setTempo', inputs: { TEMPO: { type: 'literal', value: 120 } } },
                ],
              },
            },
          },
        ],
      },
    ]

    const compiled = await buildScratchProjectJson(project)
    expect(compiled.extensions).toEqual(['music', 'pen'])
  })
})
