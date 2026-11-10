# Game-quality benchmark: 2026-11-10-omlx-cyber-tiel-35b-a3b-nothink-spec-r3

Scored 10/10 cases; mean check pass rate 88%.

| check                 | passed |
| --------------------- | ------ |
| builds                | 9/10   |
| runs                  | 9/9    |
| moves-on-its-own      | 7/7    |
| key                   | 18/20  |
| state-changes-in-play | 8/8    |
| library-art           | -      |
| plays-sound           | -      |
| animated-sprite       | -      |
| scenario              | 35/35  |

| case            | score | failed checks                                                                                                        |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| catch-apples    | 100%  | -                                                                                                                    |
| space-dodge     | 100%  | -                                                                                                                    |
| space-shooter   | 91%   | key space y+ (_Walls Δ0)                                                                                             |
| mouse-maze      | 92%   | key ArrowLeft x- (_Walls Δ0)                                                                                         |
| jump-collect    | 100%  | -                                                                                                                    |
| pop-balloons    | 100%  | -                                                                                                                    |
| two-player-pong | 0%    | builds ([錯誤] 角色：有 2 個玩家角色（左拍、右拍），目前只支援一個。 → 只保留一個角色有「平台移動」或「俯視移動」。) |
| deep-sea-rescue | 100%  | -                                                                                                                    |
| car-racing      | 100%  | -                                                                                                                    |
| whack-a-mole    | 100%  | -                                                                                                                    |

Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses
real art and sound. They do not measure fun or whether every requested rule is implemented.
