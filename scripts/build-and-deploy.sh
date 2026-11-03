#!/bin/bash
set -e

echo "=== 開始部署 GitHub Pages ==="

# 檢查是否在正確的目錄
if [ ! -f "package.json" ]; then
    echo "錯誤：請在專案根目錄執行此腳本"
    exit 1
fi

# 檢查是否有未提交的變更
if [ -n "$(git status --porcelain)" ]; then
    echo "警告：有未提交的變更，請先提交或暫存"
    git status
    exit 1
fi

# 確保在 main 分支
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
    echo "警告：當前分支是 $current_branch，請切換到 main 分支"
    exit 1
fi

echo "=== Step 1: Build 專案 ==="
npm run build --workspace=@scratch/scratch-ai-bridge

echo "=== Step 2: 切換到 gh-pages 分支 ==="
# 確保 gh-pages 分支存在
git fetch origin gh-pages 2>/dev/null || git checkout -b gh-pages

# 切換到 gh-pages 分支
git checkout gh-pages

echo "=== Step 3: 用 main 分支內容覆蓋 gh-pages 分支（避免 merge conflict） ==="
git reset --hard main

echo "=== Step 4: 強制推送到 GitHub ==="
git push origin gh-pages --force

echo "=== 部署完成！==="
echo "GitHub Pages 將在幾分鐘後更新"
echo "請訪問 https://polik18.github.io/scratch-editor-ai-bridge/ 查看"
