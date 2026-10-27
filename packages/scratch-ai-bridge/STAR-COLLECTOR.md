# Star Collector - 平台遊戲

**版本**: 1.0  
**日期**: 2026-10-27  
**檔案**: star-collector.sb3

## 遊戲特色

- **5 個角色**：Hero、Star、Enemy、LevelManager、UI
- **3 個關卡**：基礎、敵人、移動平台
- **音效系統**：跳躍、收集、敵人碰到
- **生命值系統**：3 條生命
- **分數系統**：收集星星累計分數

## 角色說明

### Hero (玩家)
- 移動：左右移動
- 跳躍：重力系統
- 雙重跳躍：Lv2+ 解鎖

### Star (道具)
- 旋轉動畫
- 收集後分數 +1
- 出現新星星

### Enemy (敵人)
- 左右巡邏
- 碰到玩家 -1 生命
- 自動重生

### LevelManager
- 關卡管理
- 分數統計
- 生命值控制

### UI
- 顯示分數
- 顯示生命
- 關卡提示

## 遊戲玩法

1. **控制**：鍵盤 WASD 或方向鍵
2. **目標**：收集所有星星
3. **規則**：
   - 碰到敵人 -1 生命
   - 掉出畫面 -1 生命
   - 生命歸零 遊戲結束
   - 收集完所有星星 進入下一關

## 檔案結構

```
star-collector.sb3
└── project.json
    ├── targets[]
    │   ├── Hero (player)
    │   ├── Star (collectible)
    │   ├── Enemy (enemy)
    │   ├── LevelManager (controller)
    │   └── UI (interface)
    └── meta{}
```

## 使用指令

```bash
# 建立遊戲
npx tsx scripts/create-platform-game.mjs

# 預覽截圖
open /tmp/star-collector-preview.png

# 上傳到 GitHub
git add star-collector.sb3
git commit -m "feat: add Star Collector platform game"
git push origin codex/scratch-ai-bridge-hosted-gates-20261014
```

## 未來增強

- [ ] 更多關卡
- [ ] 更多道具
- [ ] 敵人 AI 增強
- [ ] 背景音樂
- [ ] 粒子特效
- [ ] 存檔系統
