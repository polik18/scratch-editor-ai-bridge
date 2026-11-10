# Game-quality benchmark: 2026-11-10-omlx-cyber-tiel-35b-a3b-nothink-spec

Scored 10/10 cases; mean check pass rate 81%.

| check                 | passed |
| --------------------- | ------ |
| builds                | 9/10   |
| runs                  | 9/9    |
| moves-on-its-own      | 4/7    |
| key                   | 18/20  |
| state-changes-in-play | 4/8    |
| library-art           | -      |
| plays-sound           | -      |
| animated-sprite       | -      |
| scenario              | 37/37  |

| case            | score | failed checks                                                                                                            |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| catch-apples    | 80%   | moves-on-its-own; state-changes-in-play (no variable changed)                                                            |
| space-dodge     | 90%   | state-changes-in-play (no variable changed)                                                                              |
| space-shooter   | 73%   | moves-on-its-own; key space y+ (_Walls Δ0); state-changes-in-play (no variable changed)                                  |
| mouse-maze      | 91%   | key ArrowLeft x- (_Walls Δ0)                                                                                             |
| jump-collect    | 100%  | -                                                                                                                        |
| pop-balloons    | 100%  | -                                                                                                                        |
| two-player-pong | 0%    | builds ([錯誤] 角色：有 2 個玩家角色（左球拍、右球拍），目前只支援一個。 → 只保留一個角色有「平台移動」或「俯視移動」。) |
| deep-sea-rescue | 100%  | -                                                                                                                        |
| car-racing      | 80%   | moves-on-its-own; state-changes-in-play (no variable changed)                                                            |
| whack-a-mole    | 100%  | -                                                                                                                        |

Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses
real art and sound. They do not measure fun or whether every requested rule is implemented.
