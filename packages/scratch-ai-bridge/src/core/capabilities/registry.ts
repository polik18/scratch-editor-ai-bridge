import { BUILT_IN_BACKDROP_VISUALS, BUILT_IN_SPRITE_VISUALS } from '../visuals/presets'

export type CanonicalBlockCategory =
  'motion' | 'looks' | 'events' | 'control' | 'sensing' | 'operators' | 'data' | 'sound' | 'extensions'
export type CanonicalBlockShape = 'hat' | 'command' | 'reporter' | 'boolean'
export type CanonicalInputKind = 'any' | 'number' | 'string' | 'boolean' | 'stack' | 'broadcast' | 'menu' | 'color'
export type CanonicalTargetKind = 'stage' | 'sprite'

export interface CanonicalMenuShadow {
  readonly opcode: string
  readonly field: string
}

export interface CanonicalInputCapability {
  readonly kind: CanonicalInputKind
  readonly required: boolean
  readonly shadow?: CanonicalMenuShadow
}

export interface CanonicalFieldCapability {
  readonly required: boolean
  readonly values?: readonly string[]
}

export interface CanonicalBlockCapability {
  readonly category: CanonicalBlockCategory
  readonly shape: CanonicalBlockShape
  readonly targets: readonly CanonicalTargetKind[]
  readonly inputs?: Readonly<Record<string, CanonicalInputCapability>>
  readonly fields?: Readonly<Record<string, CanonicalFieldCapability>>
  /** Official Scratch extension module required by this block, if any. */
  readonly extensionId?: string
}

const bothTargets = ['stage', 'sprite'] as const
const spriteTarget = ['sprite'] as const
const keyOptions = [
  'space',
  'up arrow',
  'down arrow',
  'right arrow',
  'left arrow',
  'any',
  ...'abcdefghijklmnopqrstuvwxyz0123456789',
] as const

export const CANONICAL_BLOCK_CAPABILITIES = {
  event_whenflagclicked: { category: 'events', shape: 'hat', targets: bothTargets },
  event_whenkeypressed: {
    category: 'events',
    shape: 'hat',
    targets: bothTargets,
    fields: { KEY_OPTION: { required: true, values: keyOptions } },
  },
  event_whenbroadcastreceived: {
    category: 'events',
    shape: 'hat',
    targets: bothTargets,
    fields: { BROADCAST_OPTION: { required: true } },
  },
  event_broadcast: {
    category: 'events',
    shape: 'command',
    targets: bothTargets,
    inputs: { BROADCAST_INPUT: { kind: 'broadcast', required: true } },
  },
  event_broadcastandwait: {
    category: 'events',
    shape: 'command',
    targets: bothTargets,
    inputs: { BROADCAST_INPUT: { kind: 'broadcast', required: true } },
  },
  event_whenstageclicked: { category: 'events', shape: 'hat', targets: ['stage'] },
  event_whenthisspriteclicked: { category: 'events', shape: 'hat', targets: spriteTarget },
  event_whenbackdropswitchesto: {
    category: 'events',
    shape: 'hat',
    targets: bothTargets,
    fields: { BACKDROP: { required: true } },
  },
  event_whentouchingobject: {
    category: 'events',
    shape: 'hat',
    targets: spriteTarget,
    fields: { TOUCHINGOBJECTMENU: { required: true } },
  },
  event_whengreaterthan: {
    category: 'events',
    shape: 'hat',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'number', required: true } },
    fields: { WHENGREATERTHANMENU: { required: true, values: ['LOUDNESS', 'TIMER'] } },
  },
  motion_movesteps: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { STEPS: { kind: 'number', required: true } },
  },
  motion_turnright: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { DEGREES: { kind: 'number', required: true } },
  },
  motion_turnleft: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { DEGREES: { kind: 'number', required: true } },
  },
  motion_pointindirection: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { DIRECTION: { kind: 'number', required: true } },
  },
  motion_pointtowards: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: {
      TOWARDS: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'motion_pointtowards_menu', field: 'TOWARDS' },
      },
    },
  },
  motion_goto: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: {
      TO: { kind: 'menu', required: true, shadow: { opcode: 'motion_goto_menu', field: 'TO' } },
    },
  },
  motion_glidesecstoxy: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: {
      SECS: { kind: 'number', required: true },
      X: { kind: 'number', required: true },
      Y: { kind: 'number', required: true },
    },
  },
  motion_glideto: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: {
      SECS: { kind: 'number', required: true },
      TO: { kind: 'menu', required: true, shadow: { opcode: 'motion_glideto_menu', field: 'TO' } },
    },
  },
  motion_ifonedgebounce: { category: 'motion', shape: 'command', targets: spriteTarget },
  motion_setrotationstyle: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    fields: { STYLE: { required: true, values: ['all around', 'left-right', "don't rotate"] } },
  },
  motion_xposition: { category: 'motion', shape: 'reporter', targets: spriteTarget },
  motion_yposition: { category: 'motion', shape: 'reporter', targets: spriteTarget },
  motion_direction: { category: 'motion', shape: 'reporter', targets: spriteTarget },
  motion_gotoxy: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { X: { kind: 'number', required: true }, Y: { kind: 'number', required: true } },
  },
  motion_changexby: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { DX: { kind: 'number', required: true } },
  },
  motion_setx: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { X: { kind: 'number', required: true } },
  },
  motion_changeyby: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { DY: { kind: 'number', required: true } },
  },
  motion_sety: {
    category: 'motion',
    shape: 'command',
    targets: spriteTarget,
    inputs: { Y: { kind: 'number', required: true } },
  },
  looks_say: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: { MESSAGE: { kind: 'string', required: true } },
  },
  looks_sayforsecs: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      MESSAGE: { kind: 'string', required: true },
      SECS: { kind: 'number', required: true },
    },
  },
  looks_think: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: { MESSAGE: { kind: 'string', required: true } },
  },
  looks_thinkforsecs: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      MESSAGE: { kind: 'string', required: true },
      SECS: { kind: 'number', required: true },
    },
  },
  looks_switchcostumeto: {
    category: 'looks',
    shape: 'command',
    targets: spriteTarget,
    inputs: {
      COSTUME: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'looks_costume', field: 'COSTUME' },
      },
    },
  },
  looks_show: { category: 'looks', shape: 'command', targets: spriteTarget },
  looks_hide: { category: 'looks', shape: 'command', targets: spriteTarget },
  looks_nextcostume: { category: 'looks', shape: 'command', targets: spriteTarget },
  looks_changesizeby: {
    category: 'looks',
    shape: 'command',
    targets: spriteTarget,
    inputs: { CHANGE: { kind: 'number', required: true } },
  },
  looks_setsizeto: {
    category: 'looks',
    shape: 'command',
    targets: spriteTarget,
    inputs: { SIZE: { kind: 'number', required: true } },
  },
  looks_switchbackdropto: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      BACKDROP: { kind: 'menu', required: true, shadow: { opcode: 'looks_backdrops', field: 'BACKDROP' } },
    },
  },
  looks_switchbackdroptoandwait: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      BACKDROP: { kind: 'menu', required: true, shadow: { opcode: 'looks_backdrops', field: 'BACKDROP' } },
    },
  },
  looks_nextbackdrop: { category: 'looks', shape: 'command', targets: bothTargets },
  looks_changeeffectby: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: { CHANGE: { kind: 'number', required: true } },
    fields: {
      EFFECT: { required: true, values: ['color', 'fisheye', 'whirl', 'pixelate', 'mosaic', 'brightness', 'ghost'] },
    },
  },
  looks_seteffectto: {
    category: 'looks',
    shape: 'command',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'number', required: true } },
    fields: {
      EFFECT: { required: true, values: ['color', 'fisheye', 'whirl', 'pixelate', 'mosaic', 'brightness', 'ghost'] },
    },
  },
  looks_cleargraphiceffects: { category: 'looks', shape: 'command', targets: bothTargets },
  looks_size: { category: 'looks', shape: 'reporter', targets: spriteTarget },
  looks_costumenumbername: {
    category: 'looks',
    shape: 'reporter',
    targets: spriteTarget,
    fields: { NUMBER_NAME: { required: true, values: ['number', 'name'] } },
  },
  looks_backdropnumbername: {
    category: 'looks',
    shape: 'reporter',
    targets: bothTargets,
    fields: { NUMBER_NAME: { required: true, values: ['number', 'name'] } },
  },
  looks_gotofrontback: {
    category: 'looks',
    shape: 'command',
    targets: spriteTarget,
    fields: { FRONT_BACK: { required: true, values: ['front', 'back'] } },
  },
  looks_goforwardbackwardlayers: {
    category: 'looks',
    shape: 'command',
    targets: spriteTarget,
    inputs: { NUM: { kind: 'number', required: true } },
    fields: { FORWARD_BACKWARD: { required: true, values: ['forward', 'backward'] } },
  },
  control_wait: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { DURATION: { kind: 'number', required: true } },
  },
  control_repeat: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { TIMES: { kind: 'number', required: true }, SUBSTACK: { kind: 'stack', required: true } },
  },
  control_forever: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { SUBSTACK: { kind: 'stack', required: true } },
  },
  control_if: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      CONDITION: { kind: 'boolean', required: true },
      SUBSTACK: { kind: 'stack', required: true },
    },
  },
  control_if_else: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      CONDITION: { kind: 'boolean', required: true },
      SUBSTACK: { kind: 'stack', required: true },
      SUBSTACK2: { kind: 'stack', required: true },
    },
  },
  control_repeat_until: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      CONDITION: { kind: 'boolean', required: true },
      SUBSTACK: { kind: 'stack', required: true },
    },
  },
  control_wait_until: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { CONDITION: { kind: 'boolean', required: true } },
  },
  control_stop: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    fields: { STOP_OPTION: { required: true, values: ['all', 'this script', 'other scripts in sprite'] } },
  },
  control_start_as_clone: { category: 'control', shape: 'hat', targets: spriteTarget },
  control_create_clone_of: {
    category: 'control',
    shape: 'command',
    targets: spriteTarget,
    inputs: {
      CLONE_OPTION: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'control_create_clone_of_menu', field: 'CLONE_OPTION' },
      },
    },
  },
  control_delete_this_clone: { category: 'control', shape: 'command', targets: spriteTarget },
  control_while: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      CONDITION: { kind: 'boolean', required: true },
      SUBSTACK: { kind: 'stack', required: true },
    },
  },
  control_for_each: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      VALUE: { kind: 'any', required: true },
      SUBSTACK: { kind: 'stack', required: true },
    },
    fields: { VARIABLE: { required: true } },
  },
  control_all_at_once: {
    category: 'control',
    shape: 'command',
    targets: bothTargets,
    inputs: { SUBSTACK: { kind: 'stack', required: true } },
  },
  control_get_counter: { category: 'control', shape: 'reporter', targets: bothTargets },
  control_incr_counter: { category: 'control', shape: 'command', targets: bothTargets },
  control_clear_counter: { category: 'control', shape: 'command', targets: bothTargets },
  sensing_touchingobject: {
    category: 'sensing',
    shape: 'boolean',
    targets: spriteTarget,
    inputs: {
      TOUCHINGOBJECTMENU: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'sensing_touchingobjectmenu', field: 'TOUCHINGOBJECTMENU' },
      },
    },
  },
  sensing_timer: { category: 'sensing', shape: 'reporter', targets: bothTargets },
  sensing_resettimer: { category: 'sensing', shape: 'command', targets: bothTargets },
  sensing_mousex: { category: 'sensing', shape: 'reporter', targets: bothTargets },
  sensing_mousey: { category: 'sensing', shape: 'reporter', targets: bothTargets },
  sensing_mousedown: { category: 'sensing', shape: 'boolean', targets: bothTargets },
  sensing_keypressed: {
    category: 'sensing',
    shape: 'boolean',
    targets: bothTargets,
    inputs: {
      KEY_OPTION: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'sensing_keyoptions', field: 'KEY_OPTION' },
      },
    },
  },
  sensing_distanceto: {
    category: 'sensing',
    shape: 'reporter',
    targets: spriteTarget,
    inputs: {
      DISTANCETOMENU: {
        kind: 'menu',
        required: true,
        shadow: { opcode: 'sensing_distancetomenu', field: 'DISTANCETOMENU' },
      },
    },
  },
  sensing_touchingcolor: {
    category: 'sensing',
    shape: 'boolean',
    targets: spriteTarget,
    inputs: { COLOR: { kind: 'string', required: true } },
  },
  sensing_coloristouchingcolor: {
    category: 'sensing',
    shape: 'boolean',
    targets: spriteTarget,
    inputs: {
      COLOR: { kind: 'string', required: true },
      COLOR2: { kind: 'string', required: true },
    },
  },
  sensing_askandwait: {
    category: 'sensing',
    shape: 'command',
    targets: bothTargets,
    inputs: { QUESTION: { kind: 'string', required: true } },
  },
  sensing_answer: { category: 'sensing', shape: 'reporter', targets: bothTargets },
  sensing_loudness: { category: 'sensing', shape: 'reporter', targets: bothTargets },
  sensing_loud: { category: 'sensing', shape: 'boolean', targets: bothTargets },
  sensing_current: {
    category: 'sensing',
    shape: 'reporter',
    targets: bothTargets,
    fields: {
      CURRENTMENU: { required: true, values: ['year', 'month', 'date', 'dayofweek', 'hour', 'minute', 'second'] },
    },
  },
  sensing_dayssince2000: { category: 'sensing', shape: 'reporter', targets: bothTargets },
  sensing_online: { category: 'sensing', shape: 'boolean', targets: bothTargets },
  sensing_username: { category: 'sensing', shape: 'reporter', targets: bothTargets },
  sensing_of: {
    category: 'sensing',
    shape: 'reporter',
    targets: bothTargets,
    inputs: {
      OBJECT: { kind: 'menu', required: true, shadow: { opcode: 'sensing_of_object_menu', field: 'OBJECT' } },
    },
    fields: { PROPERTY: { required: true } },
  },
  sensing_setdragmode: {
    category: 'sensing',
    shape: 'command',
    targets: spriteTarget,
    fields: { DRAG_MODE: { required: true, values: ['draggable', 'not draggable'] } },
  },
  operator_lt: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND1: { kind: 'any', required: true }, OPERAND2: { kind: 'any', required: true } },
  },
  operator_equals: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND1: { kind: 'any', required: true }, OPERAND2: { kind: 'any', required: true } },
  },
  operator_gt: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND1: { kind: 'any', required: true }, OPERAND2: { kind: 'any', required: true } },
  },
  operator_subtract: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { NUM1: { kind: 'number', required: true }, NUM2: { kind: 'number', required: true } },
  },
  operator_add: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { NUM1: { kind: 'number', required: true }, NUM2: { kind: 'number', required: true } },
  },
  operator_multiply: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { NUM1: { kind: 'number', required: true }, NUM2: { kind: 'number', required: true } },
  },
  operator_divide: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { NUM1: { kind: 'number', required: true }, NUM2: { kind: 'number', required: true } },
  },
  operator_mod: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { NUM1: { kind: 'number', required: true }, NUM2: { kind: 'number', required: true } },
  },
  operator_random: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { FROM: { kind: 'number', required: true }, TO: { kind: 'number', required: true } },
  },
  operator_join: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { STRING1: { kind: 'string', required: true }, STRING2: { kind: 'string', required: true } },
  },
  operator_round: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { NUM: { kind: 'number', required: true } },
  },
  operator_mathop: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { NUM: { kind: 'number', required: true } },
    fields: {
      OPERATOR: {
        required: true,
        values: [
          'abs',
          'floor',
          'ceiling',
          'sqrt',
          'sin',
          'cos',
          'tan',
          'asin',
          'acos',
          'atan',
          'ln',
          'log',
          'e ^',
          '10 ^',
        ],
      },
    },
  },
  operator_length: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { STRING: { kind: 'string', required: true } },
  },
  operator_letter_of: {
    category: 'operators',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { LETTER: { kind: 'number', required: true }, STRING: { kind: 'string', required: true } },
  },
  operator_contains: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { STRING1: { kind: 'string', required: true }, STRING2: { kind: 'string', required: true } },
  },
  operator_and: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: {
      OPERAND1: { kind: 'boolean', required: true },
      OPERAND2: { kind: 'boolean', required: true },
    },
  },
  operator_or: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: {
      OPERAND1: { kind: 'boolean', required: true },
      OPERAND2: { kind: 'boolean', required: true },
    },
  },
  operator_not: {
    category: 'operators',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { OPERAND: { kind: 'boolean', required: true } },
  },
  data_setvariableto: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'any', required: true } },
    fields: { VARIABLE: { required: true } },
  },
  data_changevariableby: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'number', required: true } },
    fields: { VARIABLE: { required: true } },
  },
  data_showvariable: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    fields: { VARIABLE: { required: true } },
  },
  data_hidevariable: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    fields: { VARIABLE: { required: true } },
  },
  data_showlist: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    fields: { LIST: { required: true } },
  },
  data_hidelist: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    fields: { LIST: { required: true } },
  },
  data_addtolist: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: { ITEM: { kind: 'any', required: true } },
    fields: { LIST: { required: true } },
  },
  data_deleteoflist: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: { INDEX: { kind: 'any', required: true } },
    fields: { LIST: { required: true } },
  },
  data_deletealloflist: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    fields: { LIST: { required: true } },
  },
  data_insertatlist: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      ITEM: { kind: 'any', required: true },
      INDEX: { kind: 'any', required: true },
    },
    fields: { LIST: { required: true } },
  },
  data_replaceitemoflist: {
    category: 'data',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      ITEM: { kind: 'any', required: true },
      INDEX: { kind: 'any', required: true },
    },
    fields: { LIST: { required: true } },
  },
  data_itemoflist: {
    category: 'data',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { INDEX: { kind: 'any', required: true } },
    fields: { LIST: { required: true } },
  },
  data_itemnumoflist: {
    category: 'data',
    shape: 'reporter',
    targets: bothTargets,
    inputs: { ITEM: { kind: 'any', required: true } },
    fields: { LIST: { required: true } },
  },
  data_lengthoflist: {
    category: 'data',
    shape: 'reporter',
    targets: bothTargets,
    fields: { LIST: { required: true } },
  },
  data_listcontainsitem: {
    category: 'data',
    shape: 'boolean',
    targets: bothTargets,
    inputs: { ITEM: { kind: 'any', required: true } },
    fields: { LIST: { required: true } },
  },
  data_listcontents: {
    category: 'data',
    shape: 'reporter',
    targets: bothTargets,
    fields: { LIST: { required: true } },
  },
  data_variable: {
    category: 'data',
    shape: 'reporter',
    targets: bothTargets,
    fields: { VARIABLE: { required: true } },
  },
  sound_play: {
    category: 'sound',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      SOUND_MENU: { kind: 'menu', required: true, shadow: { opcode: 'sound_sounds_menu', field: 'SOUND_MENU' } },
    },
  },
  sound_playuntildone: {
    category: 'sound',
    shape: 'command',
    targets: bothTargets,
    inputs: {
      SOUND_MENU: { kind: 'menu', required: true, shadow: { opcode: 'sound_sounds_menu', field: 'SOUND_MENU' } },
    },
  },
  sound_stopallsounds: { category: 'sound', shape: 'command', targets: bothTargets },
  sound_changeeffectby: {
    category: 'sound',
    shape: 'command',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'number', required: true } },
    fields: { EFFECT: { required: true, values: ['pitch', 'pan'] } },
  },
  sound_seteffectto: {
    category: 'sound',
    shape: 'command',
    targets: bothTargets,
    inputs: { VALUE: { kind: 'number', required: true } },
    fields: { EFFECT: { required: true, values: ['pitch', 'pan'] } },
  },
  sound_cleareffects: { category: 'sound', shape: 'command', targets: bothTargets },
  sound_changevolumeby: {
    category: 'sound',
    shape: 'command',
    targets: bothTargets,
    inputs: { VOLUME: { kind: 'number', required: true } },
  },
  sound_setvolumeto: {
    category: 'sound',
    shape: 'command',
    targets: bothTargets,
    inputs: { VOLUME: { kind: 'number', required: true } },
  },
  sound_volume: { category: 'sound', shape: 'reporter', targets: bothTargets },

  // Verified, commonly used Scratch extensions. Keep these explicit so the AI
  // authoring vocabulary can grow without pretending every extension/device
  // has identical runtime availability.
  pen_clear: { category: 'extensions', shape: 'command', targets: bothTargets, extensionId: 'pen' },
  pen_stamp: { category: 'extensions', shape: 'command', targets: spriteTarget, extensionId: 'pen' },
  pen_penDown: { category: 'extensions', shape: 'command', targets: spriteTarget, extensionId: 'pen' },
  pen_penUp: { category: 'extensions', shape: 'command', targets: spriteTarget, extensionId: 'pen' },
  pen_setPenColorToColor: {
    category: 'extensions',
    shape: 'command',
    targets: spriteTarget,
    extensionId: 'pen',
    inputs: { COLOR: { kind: 'color', required: true } },
  },
  pen_changePenColorParamBy: {
    category: 'extensions',
    shape: 'command',
    targets: spriteTarget,
    extensionId: 'pen',
    inputs: {
      COLOR_PARAM: { kind: 'menu', required: true },
      VALUE: { kind: 'number', required: true },
    },
  },
  pen_setPenColorParamTo: {
    category: 'extensions',
    shape: 'command',
    targets: spriteTarget,
    extensionId: 'pen',
    inputs: {
      COLOR_PARAM: { kind: 'menu', required: true },
      VALUE: { kind: 'number', required: true },
    },
  },
  pen_changePenSizeBy: {
    category: 'extensions',
    shape: 'command',
    targets: spriteTarget,
    extensionId: 'pen',
    inputs: { SIZE: { kind: 'number', required: true } },
  },
  pen_setPenSizeTo: {
    category: 'extensions',
    shape: 'command',
    targets: spriteTarget,
    extensionId: 'pen',
    inputs: { SIZE: { kind: 'number', required: true } },
  },
  music_playDrumForBeats: {
    category: 'extensions',
    shape: 'command',
    targets: bothTargets,
    extensionId: 'music',
    inputs: {
      DRUM: { kind: 'menu', required: true },
      BEATS: { kind: 'number', required: true },
    },
  },
  music_restForBeats: {
    category: 'extensions',
    shape: 'command',
    targets: bothTargets,
    extensionId: 'music',
    inputs: { BEATS: { kind: 'number', required: true } },
  },
  music_playNoteForBeats: {
    category: 'extensions',
    shape: 'command',
    targets: bothTargets,
    extensionId: 'music',
    inputs: {
      NOTE: { kind: 'number', required: true },
      BEATS: { kind: 'number', required: true },
    },
  },
  music_setInstrument: {
    category: 'extensions',
    shape: 'command',
    targets: bothTargets,
    extensionId: 'music',
    inputs: { INSTRUMENT: { kind: 'menu', required: true } },
  },
  music_setTempo: {
    category: 'extensions',
    shape: 'command',
    targets: bothTargets,
    extensionId: 'music',
    inputs: { TEMPO: { kind: 'number', required: true } },
  },
  music_changeTempo: {
    category: 'extensions',
    shape: 'command',
    targets: bothTargets,
    extensionId: 'music',
    inputs: { TEMPO: { kind: 'number', required: true } },
  },
  music_getTempo: { category: 'extensions', shape: 'reporter', targets: bothTargets, extensionId: 'music' },
} as const satisfies Readonly<Record<string, CanonicalBlockCapability>>

export type KnownOpcode = keyof typeof CANONICAL_BLOCK_CAPABILITIES
/** Any Scratch opcode string; capability checks narrow this to `KnownOpcode`. */
export type CanonicalOpcode = string

export const CANONICAL_OPCODES: readonly KnownOpcode[] = Object.freeze(
  Object.keys(CANONICAL_BLOCK_CAPABILITIES) as KnownOpcode[],
)

/** Legacy VM no-ops stay available to raw preservation workflows, not strict authoring. */
export const CORE_PRESERVED_LEGACY_OPCODES = [
  'looks_changestretchby',
  'looks_hideallsprites',
  'looks_setstretchto',
  'motion_align_scene',
  'motion_scroll_right',
  'motion_scroll_up',
  'motion_xscroll',
  'motion_yscroll',
  // Scratch VM's current implementation is an empty function; preserve old projects without advertising behavior.
  // Scratch VM's current implementation is an empty function; preserve old projects without advertising behavior.
  'sensing_userid',
] as const

/** Sound menu blocks are created as shadows by their parent capabilities. */
export const CORE_INTERNAL_MENU_OPCODES = ['sound_beats_menu', 'sound_effects_menu', 'sound_sounds_menu'] as const

/** Procedure graph blocks are modeled by CanonicalProcedure and its graph codec. */
export const CORE_PROCEDURE_GRAPH_OPCODES = [
  'argument_reporter_boolean',
  'argument_reporter_string_number',
  'procedures_call',
  'procedures_definition',
  'procedures_prototype',
] as const

export const isKnownOpcode = (opcode: string): opcode is KnownOpcode =>
  Object.hasOwn(CANONICAL_BLOCK_CAPABILITIES, opcode)

export const getBlockCapability = (opcode: string): CanonicalBlockCapability | undefined =>
  isKnownOpcode(opcode) ? CANONICAL_BLOCK_CAPABILITIES[opcode] : undefined

export const getInputCapability = (opcode: string, inputName: string): CanonicalInputCapability | undefined =>
  getBlockCapability(opcode)?.inputs?.[inputName]

const describeBlock = (opcode: KnownOpcode): string => {
  const capability: CanonicalBlockCapability = CANONICAL_BLOCK_CAPABILITIES[opcode]
  const inputs = Object.entries(capability.inputs ?? {}).map(
    ([name, input]) => `${name}:${input.kind}${input.required ? '' : '?'}`,
  )
  const fields = Object.entries(capability.fields ?? {}).map(
    ([name, field]) => `${name}:field${field.required ? '' : '?'}`,
  )
  const argumentsText = [...fields, ...inputs].join(', ')
  return `- ${opcode} [${capability.shape}; ${capability.targets.join('|')}]${argumentsText ? ` (${argumentsText})` : ''}`
}

export const createAuthoringInstruction = (withRequirementCoverage = false): string => `${
  withRequirementCoverage
    ? '最外層只輸出一個 scratch-ai-bridge/ai-response v1 JSON 物件；Canonical IR 放在 project 欄位。'
    : '你要輸出 Scratch AI Bridge Canonical IR JSON。'
}
不要執行 Python、不要使用程式碼工具、不要顯示思考或驗證過程。
只輸出一個最終 JSON 根物件；不要 Markdown code fence、說明文字或多個候選版本。
${withRequirementCoverage ? 'project 物件' : '根物件'}必須包含 format="scratch-ai-bridge/canonical-ir"、version=1、name、stage、sprites、broadcasts。
stage 必須包含 kind="stage"、name、variables、lists、costumes、sounds、scripts、procedures。
每個 sprite 必須包含 kind="sprite"、name、variables、lists、costumes、sounds、scripts、procedures、x、y、direction、size、visible、draggable、rotationStyle。
每個 script 必須是 {"blocks":[...]}，不能直接使用積木陣列。Stage 和 sprite 都可以有 scripts；Stage script 的 target 名稱必須等於 stage.name。
每個 input 都必須是下列物件之一：
- 常數：{"type":"literal","value":10}
- 變數：{"type":"variable","name":"score"}
- 清單：{"type":"list","name":"items"}
- 廣播：{"type":"broadcast","name":"start"}
- reporter：{"type":"block","block":{"opcode":"..."}}
- 子堆疊：{"type":"stack","blocks":[...]}
broadcasts 必須使用 [{"name":"start"}]，不能使用字串陣列。
fields 的值必須直接是 string、number 或 boolean，例如 {"KEY_OPTION":"right arrow"}、{"VARIABLE":"score"}；不可使用 {"value":"..."} 或 {"name":"..."} wrapper。
每個 costume 至少要有 name 與 dataFormat（svg/png/jpg/jpeg/bmp）。
舞台至少要有一個背景 costume；可用內建背景名稱：${BUILT_IN_BACKDROP_VISUALS.join('、')}。
每個 visible=true 的 sprite 至少要有一個 costume；可用內建造型名稱：${BUILT_IN_SPRITE_VISUALS.join('、')}。
使用上述內建名稱時不要輸出 data，Bridge 會安全加入圖像；若不確定造型，角色使用 generic-character，背景使用 platform-day。Paddle/球拍、Wall/牆/邊界、Brick/磚塊等角色名稱會優先決定造型；Left/Right wall 會使用直向牆，Top/Bottom wall 使用橫向牆，避免被泛用 costume 名稱覆蓋。
不要使用 Mario、Goomba 等受版權保護角色的原始圖像；應使用通用平台英雄與敵人造型。
Stage 至少要有一個背景 costume；Stage 與 sprite 的 scripts 都可用來放置初始化、關卡與全域事件邏輯。空的 lists、costumes、sounds、scripts、procedures 也必須輸出 []。
Pen（pen_*）與 Music（music_*）是已驗證的官方擴充積木；使用到時 compiler 會從 opcode 自動加入 project.extensions，不必手動猜 extension id。其他尚未列出的擴充、硬體或自製積木仍須先加入 capability registry 並驗證 runtime，不能假設會執行。
布林條件必須使用 capability registry 標示為 boolean 的 reporter，不可直接把數值變數當條件。registry 的 shape 僅供辨識積木類型；Canonical IR block 禁止輸出 shape 欄位，積木形狀由 opcode 決定。
可用積木與必要參數：
${CANONICAL_OPCODES.map(describeBlock).join('\n')}
鍵盤 KEY_OPTION 可用 space、方向鍵（up/down/right/left arrow）、any、a-z、0-9。
碰撞 TOUCHINGOBJECTMENU 可用角色名稱、_edge_ 或 _mouse_。
不要自行加入 Scratch block id、parent、next 或 shadow id；這些由 compiler 產生。
Scratch 的 control_forever 每輪都會讓出執行時間，不要只為消除分析器警告而額外插入 control_wait。若迴圈內設定變數是碰撞、計分或狀態更新，保留在迴圈內；只把只需執行一次的初始值設定放在迴圈前。
若需求超出上述 capability，不得靜默刪除玩法或假裝已完成；優先提出最接近且仍有趣的替代方案，並依需求覆蓋欄位標記近似、未支援或環境受限項目。重要玩法會因此改變時，先請使用者選擇或明確採用替代方案。不得杜撰 opcode.${
  withRequirementCoverage
    ? `
requirementCoverage 必須逐項列出原作品需求中的角色、玩法與目標，使用 id、requirement、status、evidencePointers 欄位。status 只能是 implemented-structure、approximated、not-implemented、runtime-unavailable、not-verifiable-from-ir。implemented-structure 必須引用 project 內實際存在的 block JSON Pointer；路徑以 project 物件為根，不要加 /project 前綴（例如 /sprites/0/scripts/0/blocks/0）。只近似或未做的項目不得標成 implemented-structure。FPS、手感及未執行行為使用 not-verifiable-from-ir。Bridge 會檢查 pointer，但 AI 自述不等於 runtime 驗證。
rotationStyle 只能使用 "all around"、"left-right" 或 "don't rotate"，不要使用 "all-around"。
回覆格式：{"format":"scratch-ai-bridge/ai-response","version":1,"project":{...Canonical IR...},"requirementCoverage":[{"id":"R1","requirement":"...","status":"implemented-structure","evidencePointers":["/sprites/0/scripts/0/blocks/0"]}]}`
    : ''
}`

export type GameGenreProfile = 'auto' | 'platformer' | 'arcade' | 'puzzle-story' | 'rhythm' | 'drawing' | 'simulation'

export interface StudentProjectPreferences {
  readonly genre?: GameGenreProfile
  readonly confirmedBrief?: string
}

export interface ProjectFragmentPromptOptions {
  readonly projectName: string
  readonly fragmentId: string
  readonly targetKind: 'stage' | 'sprite'
  readonly targetName: string
  readonly designBrief: string
  readonly existingTargets?: readonly string[]
  readonly sharedNames?: readonly string[]
  /** Use only when the same AI conversation already contains the full authoring contract. */
  readonly reuseCapabilityContract?: boolean
}

/** Produces one independently generated, mergeable target so large projects fit across AI turns. */
export const createProjectFragmentInstruction = (options: ProjectFragmentPromptOptions): string => {
  const targetKind = options.targetKind
  const opcodes = CANONICAL_OPCODES.filter((opcode) =>
    (CANONICAL_BLOCK_CAPABILITIES[opcode].targets as readonly string[]).includes(targetKind),
  )
  const targetShape =
    targetKind === 'stage'
      ? `{"kind":"stage","name":${JSON.stringify(options.targetName)},"variables":[],"lists":[],"costumes":[{"name":"platform-day","dataFormat":"svg"}],"sounds":[],"scripts":[],"procedures":[]}`
      : `{"kind":"sprite","name":${JSON.stringify(options.targetName)},"variables":[],"lists":[],"costumes":[{"name":"generic-character","dataFormat":"svg"}],"sounds":[],"scripts":[],"procedures":[],"x":0,"y":0,"direction":90,"size":100,"visible":true,"draggable":false,"rotationStyle":"all around"}`
  const capabilityContract = options.reuseCapabilityContract
    ? '沿用本 AI 對話前文的 Scratch AI Bridge 完整 authoring contract 和 opcode 清單。這個模式只適用同一對話；不得猜測未列出的積木，也不得遺失前文規則。若你看不到先前能力規格，請先要求使用者重貼完整模式的指令。'
    : `此片段可用的 opcode 與必要參數：\n${opcodes.map(describeBlock).join('\n')}`
  return `你正在分段製作 Scratch 遊戲。只產生一個 target 片段，供 Scratch AI Bridge 合併；不要重輸出整個專案，也不要用 Markdown。

作品：${options.projectName}
本片段 ID：${options.fragmentId}
本片段 target：${targetKind}「${options.targetName}」
設計 brief：
${options.designBrief.trim()}

已存在的 targets：${options.existingTargets?.join('、') || '尚無；若本片段為 sprite，Stage 必須已先加入。'}
共享廣播/變數等名稱：${options.sharedNames?.join('、') || '尚未指定；請沿用 brief 的命名並避免自行另造同義名稱。'}

輸出根物件格式：{"format":"scratch-ai-bridge/project-fragment","version":1,"projectName":${JSON.stringify(options.projectName)},"fragmentId":${JSON.stringify(options.fragmentId)},"target":${targetShape},"broadcasts":[],"extensions":[]}
target 必須符合上述完整形狀；scripts 每項是 {"blocks":[...]}，空集合也要輸出 []。需要加入共享變數、廣播或擴充時，分別放在 target.variables、broadcasts、extensions；同名共享資料必須內容一致。已存在的同一 sprite 可用不同 fragmentId 再提供增量 scripts，但不要重複宣告不同值的同名變數/造型/自訂積木。
每個 input 必須使用 literal、variable、list、broadcast、block 或 stack 物件格式；fields 直接填純量。不要輸出 Scratch block id、parent、next 或 shadow id。布林條件使用布林 reporter。保留完整玩法邏輯，不要把複雜需求簡化成只有移動。

${capabilityContract}

素材與選單限制：Stage 背景可用 ${BUILT_IN_BACKDROP_VISUALS.join('、')}；Sprite 造型可用 ${BUILT_IN_SPRITE_VISUALS.join('、')}。可用內建造型名稱時不要輸出 data。KEY_OPTION 可用 space、方向鍵、any、a-z、0-9；TOUCHINGOBJECTMENU 可用已存在角色名稱、_edge_ 或 _mouse_。不要用 Mario 等受版權角色原始圖像，不要杜撰 opcode 或假裝未支援功能已實作。

只輸出一個 JSON 物件。`
}

/** A compact prompt for concept development; it intentionally contains no block catalog or JSON schema. */
export const createGameDesignDiscussionInstruction = (
  request: string,
  genre: GameGenreProfile = 'auto',
): string => `請用繁體中文陪學生把點子設計成真正有玩法的 Scratch 遊戲。現在只做遊戲設計討論，先不要輸出程式碼、JSON 或 Scratch 積木。

學生的原始想法：
${request.trim()}

學生偏好的類型：${
  {
    auto: '尚未決定，請根據點子提出不同方向。',
    platformer: '平台跳躍/動作冒險',
    arcade: '街機射擊/閃避',
    'puzzle-story': '解謎/冒險故事',
    rhythm: '節奏/音樂互動',
    drawing: '繪圖/互動藝術',
    simulation: '模擬/經營',
  }[genre]
}

請按這個流程：
1. 用一句友善的話重述想法，不嫌它太簡單。
2. 提出 2–3 個不同但都貼合主題的玩法方向，說清楚玩家會做什麼、樂趣來自哪裡；不要把所有方向硬塞進同一款遊戲。
3. 一次最多問 2 個簡單問題，讓學生選擇玩法類型、主要操作或想要的感覺。每題提供幾個短選項，也允許回答「你決定」或自由回答。不索取個人資料。
4. 等學生選擇後，整理一份精簡的「已確認遊戲設計 brief」，並把尚未決定的小細節用明確的合理預設補上；仍不輸出 JSON。

已確認 brief 請包含：遊戲名稱與一句話賣點、類型、玩家角色/目標、玩家反覆做的核心循環（操作→挑戰→回饋）、主要障礙與難度/進展、獎勵或驚喜、成功/失敗/重玩方式、操作方式、畫面/音效氣氛，以及第一分鐘玩家會經歷什麼。玩法應有立即回饋、逐步變化和清楚目標；保持 Scratch 可實作，但不要因為追求簡單就刪掉原始想法。

如果學生說「直接做」或「你決定」，替他做有創意但範圍合理的設計，列明你採用的預設，完成 brief 後再等待下一步。`

export const createStudentProjectInstruction = (
  request: string,
  preferences: StudentProjectPreferences = {},
): string => {
  const genre = preferences.genre ?? 'auto'
  const genreNames: Record<GameGenreProfile, string> = {
    auto: '請依已確認 brief 選擇最合適的類型，不要套用固定遊戲模板。',
    platformer: '平台跳躍/動作冒險',
    arcade: '街機射擊/閃避',
    'puzzle-story': '解謎/冒險故事',
    rhythm: '節奏/音樂互動',
    drawing: '繪圖/互動藝術',
    simulation: '模擬/經營',
  }
  const brief = preferences.confirmedBrief?.trim()

  return `這是「依設計 brief 製作遊戲」階段。這份訊息可能在新的 AI 對話中使用；以下原始需求和已確認 brief 是完整設計依據，不需要讀取前一段聊天紀錄。

原始作品需求：
${request.trim()}

已確認遊戲設計 brief：
${brief || '尚未提供。請先自行完成一份精簡設計：確定玩家角色與目標、核心循環（操作→挑戰→回饋）、至少一種有趣障礙、逐步進展/獎勵、成功/失敗與快速重玩；採用合理預設並在 requirementCoverage 中標明近似或未實作項目，不要退化成只有移動和說話的空殼示範。'}

指定類型：${genreNames[genre]}

製作要求：
- 保留原始需求及 brief 中每一項核心玩法；開始前先在內部建立「需求→角色/狀態/事件/腳本」映射，並用有意義的變化、回饋和重玩動機完成核心循環。
- 至少規劃初始化/reset、玩家主要操作、挑戰/碰撞或選擇、進展/獎勵、成功/失敗回饋。依遊戲類型選擇所需架構，不要硬套平台遊戲模板。
- 若有必要需求超過工具能力，保留最接近的核心體驗，並在 requirementCoverage 明確標示 approximated、runtime-unavailable 或 not-implemented；不可靜默省略，也不可杜撰 opcode。
- 確保造型和背景對應角色用途；避免所有角色只用相同 generic 外觀。音效素材未提供時不可宣稱已加入實際音效。
- 產生前檢查腳本能否形成完整玩法，尤其是開始狀態、可觀察回饋、勝敗條件與重開流程；最後只輸出規定的完整 JSON。

${createAuthoringInstruction(true)}`
}

export const estimatePromptSize = (
  prompt: string,
): { readonly characters: number; readonly estimatedTokens: number } => {
  const cjkCharacters = (prompt.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const otherCharacters = [...prompt].length - cjkCharacters
  return {
    characters: [...prompt].length,
    // A rough mixed-language estimate for before/after comparisons only; provider tokenizers differ.
    estimatedTokens: Math.ceil(cjkCharacters + otherCharacters / 4),
  }
}
