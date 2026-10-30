import {
  createGameDesignDiscussionInstruction,
  createStudentProjectInstruction,
  estimatePromptSize,
  type GameGenreProfile,
} from '../src/core/capabilities/registry'

const request = '幫我做一個好玩的遊戲，主角是住在深海的小魚。'
const brief =
  '玩家操控小魚收集氧氣泡泡、躲避水母並救出海龜。每救到一隻海龜就解鎖新海域；氧氣耗盡時顯示結果並可立即重玩。畫面明亮、節奏逐漸加快。'
const genres: readonly GameGenreProfile[] = [
  'auto',
  'platformer',
  'arcade',
  'puzzle-story',
  'rhythm',
  'drawing',
  'simulation',
]

const discussion = createGameDesignDiscussionInstruction(request)
const rows = genres.map((genre) => {
  const production = createStudentProjectInstruction(request, { genre, confirmedBrief: brief })
  return {
    genre,
    discussion: estimatePromptSize(discussion),
    production: estimatePromptSize(production),
  }
})

console.log(
  JSON.stringify(
    {
      format: 'scratch-ai-bridge/prompt-budget-baseline',
      version: 1,
      measurement: 'character count plus rough mixed-language token estimate; provider tokenizers vary',
      sampleRequest: request,
      sampleConfirmedBrief: brief,
      genres: rows,
    },
    null,
    2,
  ),
)
