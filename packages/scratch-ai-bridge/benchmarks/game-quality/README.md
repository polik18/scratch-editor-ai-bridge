# Game-quality benchmark

Measures what a student gets from one idea sentence: ten requests in `cases.json` go through the real student
prompt, a model, the Bridge pipeline (parse → normalize → validate → library assets → compile) and a headless
playtest in the Scratch renderer preview.

```sh
npm run build --workspace=@scratch/scratch-ai-bridge   # the playtest uses dist/preview.html
RUN=benchmarks/game-quality/runs/2026-11-10-gemini

npm run benchmark:games -- prompts --run $RUN            # writes <id>.prompt.txt
# Either paste each prompt into a chat UI and save the full answer as <id>.response.txt, or:
BENCH_BASE_URL=http://127.0.0.1:8000/v1 BENCH_MODEL=<model> BENCH_API_KEY=<key> \
  npm run benchmark:games -- generate --run $RUN
npm run benchmark:games -- score --run $RUN              # writes report.md, report.json, <id>.sb3, <id>.png
```

`--cases id1,id2` limits a command to some cases; `generate --force` regenerates existing responses.

## Checks

| check                 | passes when                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| builds                | the response parses, validates and compiles to SB3                                      |
| runs                  | the renderer preview starts without page errors                                         |
| moves-on-its-own      | pixels or sprite/variable state change within 1.5 s without input (only where expected) |
| key …                 | holding the key moves some sprite at least 4 px along the expected axis                 |
| state-changes-in-play | some variable changes during 8 s of scripted key presses or sprite clicks               |
| library-art           | every costume and backdrop uses official Scratch library art (no placeholder)           |
| plays-sound           | the project has sound blocks and none of its sounds are silent                          |
| animated-sprite       | a sprite with two or more costumes switches costumes in its scripts                     |

These are automatic proxies. They do not measure fun or whether every requested rule exists; read the screenshots
and open a few SB3 files when comparing runs. Clones are not tracked individually, so control and click checks only
see original sprites.
