# Game-quality benchmark: 2026-11-10-local-qwen3-coder-next-80b-local-t2a-r3

Scored 10/10 cases; mean check pass rate 8%.

| check | passed |
| - | - |
| builds | 1/10 |
| runs | 1/1 |
| moves-on-its-own | 0/1 |
| key | 4/4 |
| state-changes-in-play | 0/1 |
| library-art | 1/1 |
| plays-sound | 1/1 |
| animated-sprite | 1/1 |

| case | score | failed checks |
| - | - | - |
| catch-apples | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/stage/scripts/0/blocks/3/inputs/BROADCAST_INPUT","message":"缺少 BROADCAST_INPUT input"},{"severity":"error",) |
| space-dodge | 0% | builds (schema: [{"instancePath":"/sprites/1/scripts/1/blocks/1/inputs/SUBSTACK","schemaPath":"#/oneOf/0/required","keyword":"required","message":"must have required property ') |
| space-shooter | 0% | builds (schema: [{"instancePath":"","schemaPath":"#/required","keyword":"required","message":"must have required property 'format'","params":{"missingProperty":"format"}},{"ins) |
| mouse-maze | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/stage/scripts/0/blocks/3/inputs/BROADCAST_INPUT","message":"缺少 BROADCAST_INPUT input"},{"severity":"error",) |
| jump-collect | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/sprites/0/scripts/3/blocks/1/inputs/CONDITION/block/inputs/KEY_OPTION","message":"缺少 KEY_OPTION input"},{"s) |
| pop-balloons | 0% | builds (schema: [{"instancePath":"","schemaPath":"#/additionalProperties","keyword":"additionalProperties","message":"must NOT have additional properties","params":{"additional) |
| two-player-pong | 82% | moves-on-its-own; state-changes-in-play (no variable changed) |
| deep-sea-rescue | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/stage/scripts/0/blocks/3/inputs/BROADCAST_INPUT","message":"缺少 BROADCAST_INPUT input"},{"severity":"error",) |
| car-racing | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/sprites/1/scripts/1/blocks/0/inputs/SUBSTACK/blocks/1/inputs/SUBSTACK/blocks/3/inputs/BROADCAST_INPUT","mes) |
| whack-a-mole | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/stage/scripts/0/blocks/3/inputs/BROADCAST_INPUT","message":"缺少 BROADCAST_INPUT input"},{"severity":"error",) |

Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses
real art and sound. They do not measure fun or whether every requested rule is implemented.
