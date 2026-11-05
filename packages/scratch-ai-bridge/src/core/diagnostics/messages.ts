/**
 * Student-facing diagnostic messages
 *
 * This module contains templates for student-friendly diagnostic messages.
 * Each diagnostic type has a template with: title, explanation, impact, fix, example.
 */
import type { StudentDiagnostic, DiagnosticCategory, DiagnosticSeverity } from './catalog'

/**
 * Structured content blueprint for localized diagnostic explanations.
 */
interface DiagnosticMessageTemplate {
  title: string
  explanation: string
  impact: string
  fix: string
  example?: string
}

/**
 * Student-facing diagnostic messages (Chinese)
 * Each diagnostic type has a template following: [觀察] → [影響] → [怎麼辦] structure
 */
export const DIAGNOSTIC_MESSAGES: Record<string, DiagnosticMessageTemplate | undefined> = {
  // Structure issues
  'missing-start-block': {
    title: '缺少「當綠旗被點擊」積木',
    explanation:
      '就像電腦需要「開機」才能運作，Scratch 作品也需要一個「開始」的訊號。當綠旗被點擊積木就像開機按鈕，告訴 Scratch 從哪裡開始執行。',
    impact: '沒有這塊積木，你的作品無法用綠旗啟動，需要手動點擊角色或使用其他方式觸發',
    fix: '從「事件」分類拖出「當綠旗被點擊」積木，放在你的主要程式碼上方',
    example: '[當綠旗被點擊] → [移動 10 步]',
  },
  'script-disconnected': {
    title: '積木連接斷開',
    explanation: 'Scratch 的積木像樂高，需要「嚴密咬合」才能工作。如果積木之間有縫隙，訊號就無法傳遞。',
    impact: '斷開的積木不會執行，導致你的程式碼無法完整運作',
    fix: '確保每塊積木的凹槽都完全插入上方積木的凸起，聽見「咔嗒」聲表示連接成功',
  },
  'missing-sprite': {
    title: '角色遺失或無法載入',
    explanation: '你的作品參考了一個角色，但這個角色的檔案不存在或格式錯誤。就像故事裡的角色突然消失一樣。',
    impact: '無法控制該角色，所有針對此角色的程式碼都會失效',
    fix: '從「選取角色」新增角色，或從電腦上傳正確的 costume 檔案',
  },
  // Variable issues
  'undefined-variable': {
    title: '變數「{name}」未宣告',
    explanation: '變數就像你的小倉庫，要先「造倉庫」才能放東西。你使用了「{name}」這個變數，但還沒有建立它。',
    impact: '當程式試圖使用或修改這個變數時，Scratch 不知道該改哪個值，結果可能是什麼都沒發生或出現錯誤',
    fix: '在舞台左下角點擊「建立變數」，輸入變數名稱「{name}」，選擇「所有角色」或「這個角色」',
  },
  'variable-scope-mismatch': {
    title: '變數作用域不匹配',
    explanation:
      '變數有「這個角色專用」和「所有角色共享」兩種。你建立的是「這個角色」的變數，但程式碼在「所有角色」的腳本中使用。',
    impact: '變數可能無法正確更新或讀取，導致程式邏輯混亂',
    fix: '檢查變數建立時的設定，確保「所有角色」或「這個角色」與你的程式碼需求一致',
  },
  'variable-shadowing': {
    title: '變數名稱重複',
    explanation:
      '就像班上有兩個同名的學生，Scratch 無法分辨你指的是哪一個。你同時建立了「這個角色」和「所有角色」的「{name}」變數。',
    impact: '修改變數時可能影響錯誤的目標，導致程式行為不可預測',
    fix: '重命名其中一個變數，例如將角色變數改名為「{name}_this」',
  },
  // Asset issues
  'missing-costume': {
    title: '角色「{name}」缺少 costume「{costumeName}」',
    explanation: '角色需要衣服才能表演，但這個 costume 的檔案遺失了。就像演員沒有戲服一樣。',
    impact: '角色可能顯示為空白或預設圖形，無法正確顯示',
    fix: '從角色清單點擊角色 → 點擊「 costumes」標籤 → 點擊「選取」→ 從電腦上傳正確的圖片檔案',
  },
  'missing-sound': {
    title: '聲音「{soundName}」遺失',
    explanation: '聲音檔案就像音樂CD，如果CD不見了，就無法播放音樂。你的作品引用了這個聲音，但檔案不存在。',
    impact: '播放聲音的積木不會發出聲音，影響作品的聽覺效果',
    fix: '點擊角色 → 「聲音」標籤 → 「選取」→ 從電腦上傳正確的音效檔案（支援 mp3/wav）',
  },
  'unsupported-file-format': {
    title: '不支援的檔案格式「{format}」',
    explanation:
      'Scratch 只能讀取特定格式的檔案，就像電腦需要特定程式才能開啟特定檔案類型。你嘗試上傳的格式不被支援。',
    impact: '檔案無法載入，相關功能無法使用',
    fix: '將檔案轉換為支援的格式：圖片用 PNG/JPG，聲音用 MP3/WAV',
  },
  // Block issues
  'unsupported-block': {
    title: '不支援的擴充功能積木',
    explanation: '你使用了「{opcode}」這個擴充功能的積木，但 Bridge 目前不支援這個擴充。就像工具箱沒有這把工具一樣。',
    impact: '這塊積木不會執行，相關功能會失效。原始 SB3 檔案會保留這塊積木，但在 Bridge 中無法使用',
    fix: '移除這塊積木，或改用 Scratch 原生積木實現相同功能',
  },
  'invalid-block-argument': {
    title: '積木參數無效',
    explanation:
      '這塊積木需要特定類型的輸入（數字、文字、選單），但你給了不正確的類型。就像「切水果」需要數字，而不是文字。',
    impact: '積木可能無法執行或產生錯誤結果',
    fix: '檢查積木需要的輸入類型，確保使用正確的數值或選項',
  },
  'unknown-opcode': {
    title: '未知的積木類型「{opcode}」',
    explanation: '這個積木的代碼 Bridge 不認識，可能是自訂擴充功能或新版本 Scratch 的積木。',
    impact: '這塊積木會被標記為 opaque（不透明），無法靜態分析',
    fix: '在 Scratch 3.0 中使用原生積木，或確認擴充功能是否正確載入',
  },
  // Logic issues
  'infinite-loop': {
    title: '可能的無限迴圈',
    explanation:
      '你的「重複執行」或「重複執行直到」積木沒有明確的停止條件，或者條件永遠為真，就像一部永遠無法關掉的機器。',
    impact: '作品可能凍結或變得無回應',
    fix: '檢查迴圈的條件，確保有機會讓條件變為假。可以加入「等待」積木給系統喘息的機會',
  },
  'condition-always-true': {
    title: '條件永遠為真',
    explanation: '你的「如果...那麼」條件使用的變數或比較永遠成立，這塊積木會一直執行，無法跳過。',
    impact: '條件判斷失去意義，程式無法根據不同情況做出不同反應',
    fix: '檢查條件中的變數是否會變化，或使用正確的比較運算子',
  },
  'condition-always-false': {
    title: '條件永遠為假',
    explanation: '你的「如果...那麼」條件永遠無法成立，這塊積木永遠不會執行。',
    impact: '程式碼中的這段邏輯永遠不會被觸發',
    fix: '檢查條件中的變數是否會變化，或使用正確的比較運算子',
  },
  // Sprite issues
  'sprite-invisible': {
    title: '角色「{name}」被隱藏',
    explanation:
      '角色的「顯示/隱藏」積木被設定為「隱藏」，或者角色的「可見」屬性被設為 false。角色還在，只是你看不見它。',
    impact: '玩家看不到角色，但角色的程式碼仍在執行，可能造成 confusion',
    fix: '將「隱藏」積木改為「顯示」，或檢查是否有誤觸的隱藏邏輯',
  },
  'sprite-off-screen': {
    title: '角色「{name}」在螢幕外',
    explanation:
      '角色的位置被設定在螢幕可視範圍之外（X 超過 -240 或 240，Y 超過 -180 或 180）。角色還在，只是在「畫面外」。',
    impact: '玩家看不到角色，但角色的程式碼仍在執行',
    fix: '使用「移到 x: y:」積木將角色移到螢幕內，例如「移到 x: 0 y: 0」',
  },
  // Stage issues
  'variable-conflict': {
    title: '舞台與角色變數名稱衝突',
    explanation:
      '你同時在「舞台」和「角色」建立了同名變數「{name}」。Scratch 會優先使用角色變數，導致你可能修改了錯誤的變數。',
    impact: '修改變數時可能影響錯誤的目標，程式邏輯混亂',
    fix: '重新命名其中一個變數，例如將角色變數改名為「{name}_角色」',
  },
  'monitor-position-error': {
    title: '監視器位置超出範圍',
    explanation: '監視器（變數或列表的顯示框）被拖曳到舞台可視範圍之外。',
    impact: '你無法看到監視器的數值',
    fix: '點擊監視器 → 拖曳到舞台可視範圍內',
  },
  // Extension issues
  'extension-not-loaded': {
    title: '擴充功能「{extensionName}」未載入',
    explanation: '你的作品使用了擴充功能的積木，但這個擴充功能沒有在 Scratch 中啟用。就像你有工具但沒有拿出來使用。',
    impact: '擴充功能的積木會顯示為 opaque，無法被分析',
    fix: '在 Scratch 中點擊角色下方的「+」→ 選擇擴充功能名稱 → 啟用',
  },
  'hardware-required': {
    title: '需要硬體設備',
    explanation: '這個擴充功能需要特定硬體（相機、語音辨識），但 Bridge 无法在分析時提供這些硬體。',
    impact: '這類積木會被標記為 unavailable，無法在 CLI 分析時執行',
    fix: '在 Scratch 中實際測試作品，確保硬體設備正常連接',
  },
  'external-service-required': {
    title: '需要外部服務',
    explanation: '這個擴充功能（如 Text to Speech）需要連接外部服務，但 Bridge 无法在分析時存取外部網路。',
    impact: '這類積木會被標記為 unavailable，無法在 CLI 分析時執行',
    fix: '在 Scratch 中實際測試作品，確保網路連線正常',
  },
  // Best practice
  'performance-concern': {
    title: '可能影響效能',
    explanation:
      '你的程式碼可能執行頻繁的操作（如每幀移動角色），或者使用了大量變數。就像引擎一直高轉速運轉，可能會過熱。',
    impact: '作品可能變慢或卡頓，特別是在舊電腦上',
    fix: '加入「等待」積木降低執行頻率，或考慮優化程式碼結構',
  },
  'maintainability-concern': {
    title: '可能影響可維護性',
    explanation: '你的程式碼重複使用相同的邏輯，或者變數命名不清楚。就像筆記寫得亂七八糟，日後很難看懂。',
    impact: '未來修改或除錯會更困難',
    fix: '考慮使用「自定積木」封裝重複邏輯，或重新命名變數為有意義的名稱',
  },
  'code-smell': {
    title: '程式碼可能有問題',
    explanation: '你的程式碼結構可能不是最佳實踐。這不是錯誤，但可能導致未來維護困難。',
    impact: '長期來看可能增加維護成本',
    fix: '參考 Scratch 官方指南或教師建議的最佳實踐',
  },
}

/**
 * Generate a student-friendly diagnostic from a template.
 * @param type Identifier of the diagnostic template.
 * @param params Parameters to fill in the template (e.g., { name: 'score' }).
 * @returns Built student diagnostic record, or undefined if template is not found.
 */
export function createStudentDiagnostic(
  type: string,
  params: Record<string, string> = {},
): StudentDiagnostic | undefined {
  const template = DIAGNOSTIC_MESSAGES[type]
  if (!template) return undefined

  // Fill in template with parameters
  const fillTemplate = (text: string): string => {
    let result = text
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), value)
    }
    return result
  }

  // Map diagnostic type to category and severity
  const getCategoryAndSeverity = (type: string): { category: DiagnosticCategory; severity: DiagnosticSeverity } => {
    const structureTypes: string[] = ['missing-start-block', 'script-disconnected', 'missing-sprite']
    const variableTypes: string[] = ['undefined-variable', 'variable-scope-mismatch', 'variable-shadowing']
    const assetTypes: string[] = ['missing-costume', 'missing-sound', 'unsupported-file-format']
    const blockTypes: string[] = ['unsupported-block', 'invalid-block-argument', 'unknown-opcode']
    const logicTypes: string[] = ['infinite-loop', 'condition-always-true', 'condition-always-false']
    const spriteTypes: string[] = ['sprite-invisible', 'sprite-off-screen']
    const stageTypes: string[] = ['variable-conflict', 'monitor-position-error']
    const extensionTypes: string[] = ['extension-not-loaded', 'hardware-required', 'external-service-required']
    const bestPracticeTypes: string[] = ['performance-concern', 'maintainability-concern', 'code-smell']

    if (structureTypes.includes(type)) return { category: 'structure', severity: 'high' }
    if (variableTypes.includes(type)) return { category: 'variable', severity: 'high' }
    if (assetTypes.includes(type)) return { category: 'asset', severity: 'high' }
    if (blockTypes.includes(type)) return { category: 'block', severity: 'medium' }
    if (logicTypes.includes(type)) return { category: 'logic', severity: 'high' }
    if (spriteTypes.includes(type)) return { category: 'sprite', severity: 'medium' }
    if (stageTypes.includes(type)) return { category: 'stage', severity: 'medium' }
    if (extensionTypes.includes(type)) return { category: 'extension', severity: 'medium' }
    if (bestPracticeTypes.includes(type)) return { category: 'best-practice', severity: 'low' }

    return { category: 'best-practice', severity: 'low' }
  }

  const { category, severity } = getCategoryAndSeverity(type)

  return {
    type: severity === 'high' ? 'error' : severity === 'medium' ? 'warning' : 'info',
    category,
    severity,
    title: fillTemplate(template.title),
    explanation: fillTemplate(template.explanation),
    impact: fillTemplate(template.impact),
    fix: fillTemplate(template.fix),
    example: template.example ? fillTemplate(template.example) : undefined,
    code: type,
    message: fillTemplate(template.title),
    suggestion: fillTemplate(template.fix),
    stage: 'unknown',
    location: undefined,
    metadata: params,
    categoryId: category,
  }
}

/**
 * Get all available diagnostic types.
 * @returns Array of registered diagnostic identifier keys.
 */
export function getDiagnosticTypes(): string[] {
  return Object.keys(DIAGNOSTIC_MESSAGES)
}
