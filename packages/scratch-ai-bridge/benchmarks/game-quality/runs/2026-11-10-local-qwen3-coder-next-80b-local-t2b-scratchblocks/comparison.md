# T2b scratchblocks prototype comparison: 2026-11-10-local-qwen3-coder-next-80b-local-t2b-scratchblocks

Baseline: benchmarks/game-quality/runs/2026-11-10-local-qwen3-coder-next-80b-local-t2a-r3/report.json
Model: qwen3-coder-next-80b-local

| metric | JSON T2a | scratchblocks prototype |
| - | -: | -: |
| mean check pass rate | 8% | 61% |
| builds | 1/10 | 10/10 |
| runs | 1/1 | 10/10 |
| key checks | 4/4 | 18/24 |
| library-art | 1/1 | 4/10 |
| plays-sound | 1/1 | 7/10 |
| animated-sprite | 1/1 | 0/10 |
| mean model response length | 17282 characters | 757 characters |

| case | JSON score | scratchblocks score | parser warnings |
| - | -: | -: | -: |
| catch-apples | 0% | 89% | 0 |
| space-dodge | 0% | 67% | 0 |
| space-shooter | 0% | 50% | 0 |
| mouse-maze | 0% | 67% | 0 |
| jump-collect | 0% | 56% | 0 |
| pop-balloons | 0% | 71% | 0 |
| two-player-pong | 82% | 55% | 0 |
| deep-sea-rescue | 0% | 64% | 0 |
| car-racing | 0% | 22% | 0 |
| whack-a-mole | 0% | 71% | 0 |

## Conclusion

This is an isolated scratchblocks-style subset prototype. It is not connected to the UI or authoring prompt.
Decision: 採用 scratchblocks-style 作為後續受控整合方向，但暫不直接接入 UI。理由是同一模型／同一 10 題由 JSON T2a 的 8% 提升至 61%，build 由 1/10 提升至 10/10，平均回覆由 17,282 字降至 757 字，且 parser warnings 為 0；仍需先補齊動畫、更多感測／分身語法與多角色模型，再進行產品整合。
