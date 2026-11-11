# Game-quality benchmark: canonical

Scored 10/10 cases; mean check pass rate 61%.

| check | passed |
| - | - |
| builds | 10/10 |
| runs | 10/10 |
| moves-on-its-own | 3/8 |
| key | 18/24 |
| state-changes-in-play | 3/9 |
| library-art | 4/10 |
| plays-sound | 7/10 |
| animated-sprite | 0/10 |

| case | score | failed checks |
| - | - | - |
| catch-apples | 89% | animated-sprite (0 animated) |
| space-dodge | 67% | moves-on-its-own; state-changes-in-play (no variable changed); animated-sprite (0 animated) |
| space-shooter | 50% | moves-on-its-own; key space y+ (Player Δ0); state-changes-in-play (no variable changed); library-art (2 library, 1 placeholder, 0 model SVG replaced); animated-sprite (0 animated) |
| mouse-maze | 67% | library-art (2 library, 2 placeholder, 0 model SVG replaced); plays-sound (0 sound blocks, 0 silent); animated-sprite (0 animated) |
| jump-collect | 56% | state-changes-in-play (no variable changed); library-art (3 library, 1 placeholder, 0 model SVG replaced); plays-sound (0 sound blocks, 0 silent); animated-sprite (0 animated) |
| pop-balloons | 71% | library-art (2 library, 1 placeholder, 0 model SVG replaced); animated-sprite (0 animated) |
| two-player-pong | 55% | key s y- (Left Paddle Δ0); key ArrowUp y+ (Player Δ1.7); key ArrowDown y- (Player Δ0); state-changes-in-play (no variable changed); animated-sprite (0 animated) |
| deep-sea-rescue | 64% | moves-on-its-own; state-changes-in-play (no variable changed); library-art (3 library, 1 placeholder, 0 model SVG replaced); animated-sprite (0 animated) |
| car-racing | 22% | moves-on-its-own; key ArrowLeft x- (Player Δ0); key ArrowRight x+ (Player Δ0); state-changes-in-play (no variable changed); library-art (2 library, 1 placeholder, 0 model SVG replaced); plays-sound (0 sound blocks, 0 silent); animated-sprite (0 animated) |
| whack-a-mole | 71% | moves-on-its-own; animated-sprite (0 animated) |

Checks are automatic proxies: they show whether the game builds, reacts to its controls, changes state and uses
real art and sound. They do not measure fun or whether every requested rule is implemented.
