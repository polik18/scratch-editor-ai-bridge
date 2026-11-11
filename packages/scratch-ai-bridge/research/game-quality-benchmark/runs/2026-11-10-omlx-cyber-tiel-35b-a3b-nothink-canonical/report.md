# Game-quality benchmark: 2026-11-10-omlx-cyber-tiel-35b-a3b-nothink-canonical

Scored 10/10 cases; mean check pass rate 0%.

| check                 | passed |
| --------------------- | ------ |
| builds                | 0/10   |
| runs                  | -      |
| moves-on-its-own      | -      |
| key                   | -      |
| state-changes-in-play | -      |
| library-art           | -      |
| plays-sound           | -      |
| animated-sprite       | -      |
| scenario              | -      |

| case                      | score | failed checks                                                                                                                                                                     |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| catch-apples              | 0%    | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected double-quoted property name in JSON at position 2719 (line 1 column 2720))                              |
| space-dodge               | 0%    | builds (schema: [{"instancePath":"","schemaPath":"#/required","keyword":"required","message":"must have required property 'broadcasts'","params":{"missingProperty":"broadcasts") |
| space-shooter             | 0%    | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected double-quoted property name in JSON at position 3658 (line 1 column 3659))                              |
| mouse-maze                | 0%    | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected ',' or '}' after property value in JSON at position 824 (line 1 column 825))                            |
| jump-collect              | 0%    | builds (schema: [{"instancePath":"","schemaPath":"#/required","keyword":"required","message":"must have required property 'broadcasts'","params":{"missingProperty":"broadcasts") |
| pop-balloons              | 0%    | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected ',' or '}' after property value in JSON at position 2732 (line 1 column 2733))                          |
| two-player-pong           | 0%    | builds (schema: [{"instancePath":"","schemaPath":"#/required","keyword":"required","message":"must have required property 'sprites'","params":{"missingProperty":"sprites"}},{"i) |
| deep-sea-rescue           | 0%    | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Unexpected token '`', "```json                                                                                   |
| {""... is not valid JSON) |
| car-racing                | 0%    | builds (schema: [{"instancePath":"/sprites/1/scripts/1","schemaPath":"#/additionalProperties","keyword":"additionalProperties","message":"must NOT have additional properties",") |
| whack-a-mole              | 0%    | builds (parse: 找不到完整的 Scratch AI Bridge Canonical IR JSON：Expected ',' or '}' after property value in JSON at position 733 (line 1 column 734))                            |

Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses
real art and sound. They do not measure fun or whether every requested rule is implemented.
