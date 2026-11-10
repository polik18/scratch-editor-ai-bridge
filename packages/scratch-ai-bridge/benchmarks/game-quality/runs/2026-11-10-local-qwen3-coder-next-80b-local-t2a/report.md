# Game-quality benchmark: 2026-11-10-local-qwen3-coder-next-80b-local-t2a

Scored 10/10 cases; mean check pass rate 0%.

| check | passed |
| - | - |
| builds | 0/10 |
| runs | - |
| moves-on-its-own | - |
| key | - |
| state-changes-in-play | - |
| library-art | - |
| plays-sound | - |
| animated-sprite | - |

| case | score | failed checks |
| - | - | - |
| catch-apples | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/sprites/0/scripts/0/blocks/2/inputs/COSTUME","message":"缺少 COSTUME input"},{"severity":"error","code":"unkn) |
| space-dodge | 0% | builds (semantic: [{"severity":"error","code":"hat-not-top-level","path":"/sprites/1/scripts/0/blocks/1/inputs/SUBSTACK/blocks/1/inputs/SUBSTACK/blocks/3","message":"事件積木 event_w) |
| space-shooter | 0% | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected ',' or '}' after property value in JSON at position 11071 (line 354 column 37)) |
| mouse-maze | 0% | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected ',' or ']' after array element in JSON at position 4090 (line 1 column 4091)) |
| jump-collect | 0% | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected double-quoted property name in JSON at position 11926 (line 401 column 9)) |
| pop-balloons | 0% | builds (semantic: [{"severity":"error","code":"missing-input","path":"/stage/scripts/0/blocks/10/inputs/MESSAGE/block/inputs/NUM1","message":"缺少 NUM1 input"},{"severity":"error",) |
| two-player-pong | 0% | builds (schema: [{"instancePath":"","schemaPath":"#/required","keyword":"required","message":"must have required property 'format'","params":{"missingProperty":"format"}},{"ins) |
| deep-sea-rescue | 0% | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected double-quoted property name in JSON at position 24825 (line 778 column 3)) |
| car-racing | 0% | builds (semantic: [{"severity":"error","code":"unknown-opcode","path":"/sprites/1/scripts/2/blocks/1/inputs/SUBSTACK/blocks/0/inputs/DY/block/opcode","message":"不支援 opcode variab) |
| whack-a-mole | 0% | builds (semantic: [{"severity":"error","code":"target-not-supported","path":"/stage/scripts/0/blocks/4","message":"looks_switchcostumeto 不可用於 stage"},{"severity":"error","code":") |

Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses
real art and sound. They do not measure fun or whether every requested rule is implemented.
