# Phase 3 — Scratch VM write path decision

## 結論

正式 compiler path 選擇：

```text
Canonical IR
→ build Scratch 3 project JSON + content-addressed assets in memory
→ package a temporary SB3 archive
→ Scratch VM loadProject(archive)
→ Scratch VM deserialize/installTargets
→ Scratch VM saveProjectSb3()
```

此路徑優先於 `blockListener()`、直接 `BlockContainer.createBlock()` 與手寫 SB3 ZIP serializer。

## 為什麼

目前 monorepo 的 `packages/scratch-vm/src/virtual-machine.js` 明確允許 `loadProject(input)` 接收 SB3 bytes。Bridge 先把 project JSON 與 MD5 命名的資產包成暫存 archive，再交由 Scratch VM 的 SB3 deserialize/installTargets 流程。

這個中間 archive 是為了讓 costume/sound 資產由官方 loader 正常安裝；compiler 不直接修改 runtime private graph，最終 `.sb3` 仍一律交由 `saveProjectSb3()`。

## 比較

| 方法                                        | 可用                       | GUI 依賴 |          Procedures |              Shadow |                     穩定性 |
| ------------------------------------------- | -------------------------- | -------: | ------------------: | ------------------: | -------------------------: |
| `loadProject(archive)` + `saveProjectSb3()` | 是                         |       無 | project JSON 可表達 | project JSON 可表達 |                   **首選** |
| `vm.blockListener()`                        | 可，但偏 GUI event adapter |       高 |                  可 |                  可 |                       次選 |
| `BlockContainer.createBlock()`              | 可                         |       低 |                  可 |                  可 |  依賴 private runtime 結構 |
| 直接建立 VM block graph                     | 可                         |       低 |                  可 |                  可 |         private API 風險高 |
| 手寫完整 SB3 serializer                     | 可                         |       無 |                  可 |                  可 | 不採用為正式 compiler path |

## Adapter boundary

正式程式只透過 `src/scratch/vm.ts` 使用 Scratch VM；compiler/decompiler 不直接讀寫 VM private fields。
