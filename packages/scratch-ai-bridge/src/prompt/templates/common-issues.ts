// Common issue prompt templates for AI agent
// Each template: { title, description, prompt, examples }
// Usage: import { getPromptTemplate } from '@scratch/scratch-ai-bridge/prompt/templates';

export type TemplateCategory = 'structure' | 'behavior' | 'debug' | 'learning' | 'general';

export interface PromptTemplate {
  readonly category: TemplateCategory;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly examples: readonly string[];
  readonly applicableScenarios: readonly string[];
}

// ── Structure Templates ──────────────────────────────────────────────────────

const MISSING_START_BLOCK: PromptTemplate = {
  category: 'structure',
  title: '缺少開始積木',
  description: '積木群組沒有事件觸發（如當綠旗被點擊）',
  prompt: `這段程式一開始是「{studentLabel}」，前面沒有綠旗或按鍵等開始積木，所以按綠旗時可能不會自行啟動。

提示：如果你希望它按綠旗就開始，先接上「當綠旗被點擊」，再按綠旗測試；若這是自製積木或刻意保留的積木，先不要更動。`,
  examples: [
    '如果這個積木群組希望自動執行，需要先接上「當綠旗被點擊」。',
    '這段積木是「{studentLabel}」，沒有事件觸發，需要加上開始積木。',
  ],
  applicableScenarios: [
    '學生忘記加事件觸發',
    '自製積木缺少事件包裝',
    '積木被誤放在錯誤位置',
  ],
};

const DETACHED_SCRIPT: PromptTemplate = {
  category: 'structure',
  title: '斷裂的積木群組',
  description: '積木沒有正確連接，或缺少輸入值',
  prompt: `這段積木缺少必要的輸入值或連接，導致無法執行。

提示：檢查積木的輸入插槽，確保所有值都已設定；如果是自製積木，確認參數傳遞正確。`,
  examples: [
    '積木的輸入插槽是空的，需要填入數值或變數。',
    '這段積木沒有連接到其他積木，需要接上事件觸發。',
  ],
  applicableScenarios: [
    '學生忘記設定數值',
    '積木連接斷裂',
    '自製積木參數未傳遞',
  ],
};

// ── Behavior Templates ──────────────────────────────────────────────────────

const LOOP_FOREVER: PromptTemplate = {
  category: 'behavior',
  title: '無限迴圈',
  description: '積木在無限迴圈中，可能導致卡住',
  prompt: `這段程式在無限迴圈中，每一輪都會重複執行。

提示：如果這個值每一輪都要更新，保留目前寫法；若只想在開始時設定一次，再考慮移到迴圈前。`,
  examples: [
    '這個設定在每一輪迴圈中都會重複執行，確認是否為預期行為。',
    '如果只需要設定一次，可以把這段積木移到迴圈外面。',
  ],
  applicableScenarios: [
    '變數設定在迴圈內',
    '位置重置在迴圈內',
    '音效播放在迴圈內',
  ],
};

const WAIT_INSIDE_LOOP: PromptTemplate = {
  category: 'behavior',
  title: '迴圈內等待',
  description: '等待積木在迴圈中，影響執行效率',
  prompt: `這段程式在迴圈中使用等待積木，每一輪都會暫停指定時間。

提示：如果等待時間太長，可以考慮減少迴圈次數或優化等待邏輯。`,
  examples: [
    '迴圈內的等待會讓整個程式暫停，確認是否為預期行為。',
    '如果只是想讓動畫變慢，可以考慮調整等待時間。',
  ],
  applicableScenarios: [
    '動畫播放過快',
    '迴圈執行太頻繁',
    '需要控制節奏',
  ],
};

// ── Debug Templates ──────────────────────────────────────────────────────

const SPRITE_NOT_VISIBLE: PromptTemplate = {
  category: 'debug',
  title: '角色不可見',
  description: '角色被隱藏或位置在畫面外',
  prompt: `這個角色目前是隱藏狀態，或位置在畫面外，所以你看不到。

提示：檢查「顯示」和「隱藏」積木，確認角色在需要時顯示；檢查位置積木，確認角色在畫面內。`,
  examples: [
    '這段積木執行「隱藏」，所以角色不會顯示。',
    '角色位置在畫面外，可以加「移到 x:0 y:0」測試。',
  ],
  applicableScenarios: [
    '角色突然不見',
    '動畫看不到',
    '碰撞檢測失敗',
  ],
};

const WRONG_DIRECTIONS: PromptTemplate = {
  category: 'debug',
  title: '方向錯誤',
  description: '角色方向不正確，導致移動方向錯誤',
  prompt: `這個角色的方向是 {direction} 度，所以「前進」會往這個方向移動。

提示：如果希望角色面向畫面中央，可以加「面向 90 度」（向右）或「面向 0 度」（向上）。`,
  examples: [
    '角色面向 {direction} 度，前進會往這個方向移動，確認是否為預期方向。',
    '可以加「面向 90 度」讓角色向右移動。',
  ],
  applicableScenarios: [
    '角色移動方向錯誤',
    '碰撞檢測失敗',
    '動畫不符合預期',
  ],
};

// ── Learning Templates ──────────────────────────────────────────────────────

const VARIABLE_NOT_SET: PromptTemplate = {
  category: 'learning',
  title: '變數未設定',
  description: '變數值為 0 或空字串，可能未正確設定',
  prompt: `這個變數目前的值是 {value}，可能沒有正確設定或初始化。

提示：檢查變數設定積木，確認變數在使用前已設定值；如果變數是輸入值，確認使用者已提供輸入。`,
  examples: [
    '變數目前是 {value}，可能沒有正確設定，需要先設定值。',
    '這段積木使用變數 {name}，確認變數已正確設定。',
  ],
  applicableScenarios: [
    '變數值為 0',
    '變數值為空字串',
    '變數未初始化',
  ],
};

const SCORE_NOT_UPDATING: PromptTemplate = {
  category: 'learning',
  title: '分數未更新',
  description: '分數變數沒有正確遞增',
  prompt: `這段積木設定分數為 {value}，但沒有遞增積木。

提示：如果希望分數遞增，需要加「分數變為 (分數 + 1)」或類似積木。`,
  examples: [
    '這段積木設定分數為 {value}，但沒有遞增，分數不會改變。',
    '可以加「分數變為 (分數 + 1)」讓分數每次增加 1。',
  ],
  applicableScenarios: [
    '分數卡在 0',
    '分數不增加',
    '分數不減少',
  ],
};

// ── General Templates ──────────────────────────────────────────────────────

const UNKNOWN_BLOCK: PromptTemplate = {
  category: 'general',
  title: '未知的積木',
  description: '使用了不支援的積木或擴充功能',
  prompt: `這段積木使用了 {opcode}，可能是擴充功能或自製積木，目前無法完整解讀。

提示：可以在原 Scratch 專案中執行這段程式，確認這個積木帶來的效果。`,
  examples: [
    '這段積木使用了 {opcode}，目前無法完整解讀，建議在 Scratch 中執行確認。',
    '這是擴充功能或自製積木，靜態分析無法判斷行為。',
  ],
  applicableScenarios: [
    '擴充功能',
    '自製積木',
    '第三方積木',
  ],
};

const UNSUPPORTED_FEATURE: PromptTemplate = {
  category: 'general',
  title: '不支援的功能',
  description: '使用了靜態分析不支援的功能',
  prompt: `這段程式使用了 {feature}，目前無法完整解讀。

提示：可以在原 Scratch 專案中執行這段程式，確認這個功能帶來的效果。`,
  examples: [
    '這段程式使用了 {feature}，目前無法完整解讀，建議在 Scratch 中執行確認。',
    '靜態分析無法判斷這個功能的行為，建議手動測試。',
  ],
  applicableScenarios: [
    '音效',
    '視訊',
    '雲端變數',
    '擴充功能',
  ],
};

// ── Template Registry ──────────────────────────────────────────────────────

const TEMPLATES: readonly PromptTemplate[] = [
  MISSING_START_BLOCK,
  DETACHED_SCRIPT,
  LOOP_FOREVER,
  WAIT_INSIDE_LOOP,
  SPRITE_NOT_VISIBLE,
  WRONG_DIRECTIONS,
  VARIABLE_NOT_SET,
  SCORE_NOT_UPDATING,
  UNKNOWN_BLOCK,
  UNSUPPORTED_FEATURE,
];

/**
 * Get prompt template by category and title
 */
export function getPromptTemplate(category: TemplateCategory, title: string): PromptTemplate | undefined {
  return TEMPLATES.find((t) => t.category === category && t.title === title);
}

/**
 * Get all templates in a category
 */
export function getTemplatesByCategory(category: TemplateCategory): readonly PromptTemplate[] {
  return TEMPLATES.filter((t) => t.category === category);
}

/**
 * Get all templates
 */
export function getAllTemplates(): readonly PromptTemplate[] {
  return TEMPLATES;
}
