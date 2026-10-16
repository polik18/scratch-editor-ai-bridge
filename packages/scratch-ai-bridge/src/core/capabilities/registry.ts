import { BUILT_IN_BACKDROP_VISUALS, BUILT_IN_SPRITE_VISUALS } from '../visuals/presets'

export type CanonicalBlockCategory =
  'motion' | 'looks' | 'events' | 'control' | 'sensing' | 'operators' | 'data' | 'sound'
export type CanonicalBlockShape = 'hat' | 'command' | 'reporter' | 'boolean'
export type CanonicalInputKind = 'any' | 'number' | 'string' | 'boolean' | 'stack' | 'broadcast' | 'menu'
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
每個 script 必須是 {"blocks":[...]}，不能直接使用積木陣列。
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
空的 lists、costumes、sounds、scripts、procedures 也必須輸出 []。
布林條件必須使用 capability registry 標示為 boolean 的 reporter，不可直接把數值變數當條件。registry 的 shape 僅供辨識積木類型；Canonical IR block 禁止輸出 shape 欄位，積木形狀由 opcode 決定。
可用積木與必要參數：
${CANONICAL_OPCODES.map(describeBlock).join('\n')}
鍵盤 KEY_OPTION 可用 space、方向鍵（up/down/right/left arrow）、any、a-z、0-9。
碰撞 TOUCHINGOBJECTMENU 可用角色名稱、_edge_ 或 _mouse_。
不要自行加入 Scratch block id、parent、next 或 shadow id；這些由 compiler 產生。
Scratch 的 control_forever 每輪都會讓出執行時間，不要只為消除分析器警告而額外插入 control_wait。若迴圈內設定變數是碰撞、計分或狀態更新，保留在迴圈內；只把只需執行一次的初始值設定放在迴圈前。
若需求超出上述 capability，只產生可執行的簡化示範，不得杜撰 opcode.${
  withRequirementCoverage
    ? `
requirementCoverage 必須逐項列出原作品需求中的角色、玩法與目標，使用 id、requirement、status、evidencePointers 欄位。status 只能是 implemented-structure、approximated、not-implemented、runtime-unavailable、not-verifiable-from-ir。implemented-structure 必須引用 project 內實際存在的 block JSON Pointer；路徑以 project 物件為根，不要加 /project 前綴（例如 /sprites/0/scripts/0/blocks/0）。只近似或未做的項目不得標成 implemented-structure。FPS、手感及未執行行為使用 not-verifiable-from-ir。Bridge 會檢查 pointer，但 AI 自述不等於 runtime 驗證。
rotationStyle 只能使用 "all around"、"left-right" 或 "don't rotate"，不要使用 "all-around"。
回覆格式：{"format":"scratch-ai-bridge/ai-response","version":1,"project":{...Canonical IR...},"requirementCoverage":[{"id":"R1","requirement":"...","status":"implemented-structure","evidencePointers":["/sprites/0/scripts/0/blocks/0"]}]}`
    : ''
}`

export const createStudentProjectInstruction = (
  request: string,
): string => `這是一個「先聊點子，再一起做作品」的兩階段任務。下面的 JSON 輸出規定只在最後製作作品時生效；開始時請先用繁體中文和學生簡短討論，不要立刻輸出 JSON、程式碼或完整作品答案。

第一階段：陪學生發想
- 先肯定並用一句話說出你聽懂的作品想法，不批評它太簡單。
- 想想這個點子還缺少哪些遊戲設計要素：玩家要完成什麼、可以做什麼、會遇到什麼挑戰、成功或失敗時會發生什麼。
- 提出 2 到 3 個貼合這個點子的簡短玩法靈感，例如一種障礙、一個有趣選擇或一個意外轉折；說明讓玩法變有趣的效果。不要把所有靈感都塞進作品，請讓學生挑選、修改或提出自己的想法。
- 一次最多問 2 個簡單問題，問題要短、適合國小生理解，並給幾個可選方向；也接受學生自由回答。不要要求姓名、班級或其他個人資料。
- 等學生回答後，優先採用學生自己的選擇，簡短整理成玩法，再開始製作。若有一個關鍵玩法仍不清楚，最多再追問 1 次；若學生說「直接做」或不想討論，就用最簡單可玩的方式理解原想法並開始製作。

第二階段：產生 Scratch 作品
- 保留學生原本的角色、玩法與目標，也納入學生在討論中選擇的點子。若目前能力無法完整做到，請產生可執行的簡化版本。
- 最後回覆時只輸出規定的完整 JSON；不要把討論文字、Markdown 或程式碼框放進最終回覆。

作品需求：
${request.trim()}

${createAuthoringInstruction(true)}`
