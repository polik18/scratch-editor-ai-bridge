# 平台遊戲開發計畫

**版本**: 1.0  
**日期**: 2026-10-27  
**類型**: 跑跳收集（多關卡，含敵人 AI、音效、生命值系統）

## 遊戲概念

**名稱**: "Star Collector"  
**核心玩法**: 控制角色跳躍收集星星，躲避敵人，完成各關卡

## 技術架構

### 角色設計

| 角色名稱 | 功能 | 移動控制 | 特殊能力 |
|---------|------|---------|---------|
| **Hero** | 玩家角色 | WASD/方向鍵跳躍 | 雙重跳躍（Lv2+） |
| **Star** | 目標道具 | 靜止 | 旋轉動畫 |
| **Enemy** | 敵人 | 左右移動 | 自動巡邏 |
| **Platform** | 地面 | 靜止 | 可移動（Lv3+） |

### 音效資源

| 檔案 | 用途 |
|-----|------|
| `collect.wav` | 收集星星 |
| `jump.wav` | 跳躍 |
| `enemy_hit.wav` | 被敵人碰到 |
| `game_over.wav` | 遊戲結束 |
| `level_complete.wav` | 關卡完成 |

### 關卡設計

| 關卡 | 挑戰 | 收集目標 | 敵人數量 |
|-----|------|---------|---------|
| **Level 1** | 基础跳躍 | 5 顆星 | 0 隻 |
| **Level 2** | 雙重跳躍 | 8 顆星 | 2 隻 |
| **Level 3** | 移動平台 | 10 顆星 | 4 隻 |
| **Level 4** | 敵人巡邏 | 12 顆星 | 6 隻 |
| **Level 5** | 獵人模式 | 15 顆星 | 8 隻 |

## 積木結構

### Hero 控制

```
當 ▸ 被點擊時
  重複执行
    如果 <按下 鍵 ? > 那麼
      變更 x 坐標由 5
    如果 <按下 鍵 ? > 那麼
      變更 x 坐標由 -5
    如果 <按下 鍵 ? > 並且 <碰到 底部邊緣? > 那麼
      變更 y 速度由 15
      播放聲音 跳躍
  重複执行
    變更 y 速度由 -0.5
    如果 <碰到 邊緣? > 那麼
      變更 y 速度由 0
```

### 敵人 AI

```
當 ▸ 被點擊時
  隱藏
  重複执行
    移動 2 步
    如果 <碰到 邊緣? > 那麼
      面向 90 度
    如果 <碰到 Hero? > 那麼
      播放聲音 敵人_hit
      變更 生命值由 -1
      隱藏 Hero
      等待 2 秒
      顯示 Hero
```

### 收集系統

```
當 ▸ 被點擊時
  重複执行
    如果 <碰到 Hero? > 那麼
      播放聲音 收集
      變更 分數由 1
      隱藏
      等待 0.5 秒
      顯示
```

### 關卡切換

```
當 ▸ 被點擊時
  顯示
  重複执行直到 <分數 = 5>
    等待 0.1 秒
  下一個造型
  隱藏
```

## 實作步驟

### Step 1: 基礎結構

```
scratch-session new --name "Star Collector"
scratch-session addSprite "Hero" (costume: hero1.png)
scratch-session addSprite "Star" (costume: star.png)
scratch-session addSprite "Enemy" (costume: enemy.png)
```

### Step 2: 腳本生成（使用 NLP）

```
scratch-session nlpParse "控制角色移動跳躍收集星星"
```

### Step 3: 關卡設計

- Level 1: 基礎平台
- Level 2: 加入敵人
- Level 3: 移動平台
- Level 4: 密集敵人
- Level 5: 最終挑戰

### Step 4: 音效與特效

- 跳躍音效
- 收集音效
- 敵人碰到音效
- 粒子特效（星星旋轉）

### Step 5: 測試與優化

- 每關測試
- 生命值平衡
- 難度曲線

## 預期成果

| 指標 | 目標 |
|-----|------|
| 關卡數 | 5 關 |
| 收集目標 | 5-15 顆星 |
| 敵人數量 | 0-8 隻 |
| 音效數量 | 4 種 |
| 玩家操作 | 鍵盤 WASD |
| 遊戲時間 | 5-10 分鐘 |

## 檔案輸出

```
star-collector.sb3          # 主專案
level_*.sb3                 # 各關卡分離版本
assets/                     # 資源目錄
  - hero1.png
  - hero2.png
  - star.png
  - enemy.png
  - collect.wav
  - jump.wav
  - enemy_hit.wav
  - game_over.wav
  - level_complete.wav
```
