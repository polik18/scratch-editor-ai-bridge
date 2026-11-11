# Game-quality benchmark: 2026-11-10-local-qwen3-coder-next-80b-local

Attempted 10/10 cases; 0/10 compiled; mean check pass rate 0%.

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
| catch-apples | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 不存在：/sprites/0/scripts/0/blocks/3) |
| space-dodge | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 不存在：/sprites/0/scripts/0/blocks/4) |
| space-shooter | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 不存在：/sprites/0/scripts/1/blocks/2/inputs/SUBSTACK/blocks/0/inputs/SUBSTACK/blocks/0) |
| mouse-maze | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 必須指向 block：/sprites/0/name) |
| jump-collect | 0% | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected double-quoted property name in JSON at position 8123 (line 215 column 25)) |
| pop-balloons | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 不存在：/sprites/0/scripts/1/blocks/2) |
| two-player-pong | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 不存在：/sprites/0/scripts/1/blocks/1/inputs/1/0) |
| deep-sea-rescue | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 不存在：/sprites/0/scripts/0/blocks/2/inputs/SUBSTACK/blocks/5) |
| car-racing | 0% | builds (normalize: requirementCoverage[0] 的 evidence pointer 必須指向 block：/sprites/0/y) |
| whack-a-mole | 0% | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected ',' or '}' after property value in JSON at position 12753 (line 412 column 25)) |

Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses
real art and sound. They do not measure fun or whether every requested rule is implemented.
