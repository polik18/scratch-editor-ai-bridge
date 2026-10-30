import { createSession } from '../api/index.js';
import { parseNaturalLanguage } from '../nlp/parser.js';
import './style.css';

// ── UI Components ────────────────────────────────────────────────────────────

function createHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'ai-bridge-header';
  header.innerHTML = `
    <h1>AI × Scratch 編輯器</h1>
    <p>將自然語言指令轉為 Scratch 專案</p>
  `;
  return header;
}

function createEditor(): HTMLElement {
  const editor = document.createElement('div');
  editor.className = 'ai-bridge-editor';
  editor.innerHTML = `
    <textarea 
      class="prompt-input" 
      placeholder="輸入自然語言指令，例如：\n讓角色前進 10 步並說「你好」\n重複 5 次移動 20 步"
    ></textarea>
    <div class="button-group">
      <button class="btn-generate">生成專案</button>
      <button class="btn-preview">預覽截圖</button>
      <button class="btn-download">下載 .sb3</button>
    </div>
    <div class="status-bar">
      <span class="status-icon">●</span>
      <span class="status-text">就緒</span>
    </div>
    <textarea 
      class="output-log" 
      readonly 
      placeholder="輸出日誌..."
      style="height: 200px; font-family: monospace; margin-top: 10px;"
    ></textarea>
  `;
  return editor;
}

function createFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'ai-bridge-footer';
  footer.innerHTML = `
    <p>Powered by Scratch AI Bridge • Step 5: Web UI</p>
  `;
  return footer;
}

// ── Main App ────────────────────────────────────────────────────────────────

export default function createApp(): HTMLElement {
  const app = document.createElement('div');
  app.className = 'ai-bridge-app';
  
  app.appendChild(createHeader());
  app.appendChild(createEditor());
  app.appendChild(createFooter());
  
  return app;
}

// ── Event Handlers ──────────────────────────────────────────────────────────

export function bindEvents(app: HTMLElement): void {
  const promptInput = app.querySelector<HTMLTextAreaElement>('.prompt-input')!;
  const generateBtn = app.querySelector<HTMLButtonElement>('.btn-generate')!;
  const previewBtn = app.querySelector<HTMLButtonElement>('.btn-preview')!;
  const downloadBtn = app.querySelector<HTMLButtonElement>('.btn-download')!;
  const outputLog = app.querySelector<HTMLTextAreaElement>('.output-log')!;
  const statusText = app.querySelector<HTMLSpanElement>('.status-text')!;

  let currentSession: Awaited<ReturnType<typeof createSession>> | null = null;

  async function log(message: string): Promise<void> {
    outputLog.value += `[${new Date().toLocaleTimeString()}] ${message}\n`;
    outputLog.scrollTop = outputLog.scrollHeight;
  }

  async function setStatus(text: string, icon: '●' | '⏳' | '✓' | '✗' = '●'): Promise<void> {
    statusText.textContent = text;
    statusText.previousElementSibling!.textContent = icon;
  }

  // Generate Project
  generateBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      await log('錯誤：請輸入指令');
      return;
    }

    setStatus('分析指令中...', '⏳');
    
    try {
      // Parse natural language
      const result = await parseNaturalLanguage(prompt);
      await log(`解析成功：${result.commands.length} 個指令 (可信度 ${result.confidence * 100}%)`);

      // Create session and add blocks
      currentSession = await createSession();
      await currentSession.newProject('AI 生成專案');
      
      const spriteName = 'Sprite1';
      await currentSession.addSprite(spriteName);
      
      let lastBlockId: string | null = null;
      for (const cmd of result.commands) {
        lastBlockId = await currentSession.addBlock(spriteName, cmd.opcode, {
          inputs: cmd.inputs,
          fields: cmd.fields,
        });
        await log(`新增積木：${cmd.opcode}`);
      }

      // Add start event if missing
      if (!lastBlockId) {
        await log('警告：未新增任何積木');
        return;
      }

      await setStatus('專案已生成', '✓');
      await log('專案生成完成！');
    } catch (error) {
      await log(`錯誤：${String(error)}`);
      setStatus('生成失敗', '✗');
    }
  });

  // Preview Screenshot
  previewBtn.addEventListener('click', async () => {
    if (!currentSession) {
      await log('錯誤：請先生成專案');
      return;
    }

    setStatus('預覽中...', '⏳');

    try {
      const { createVM, renderSb3Preview } = await import('../scratch/vm.js');
      const vm = await createVM();
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 360;
      try {
        await renderSb3Preview(await currentSession.compile(), vm, canvas);
        const screenshot = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create preview image'))), 'image/png');
        });
        const url = URL.createObjectURL(screenshot);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ai-project-preview.png';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        await log('預覽截圖已下載：ai-project-preview.png');
      } finally {
        vm.quit();
        canvas.remove();
      }
      await setStatus('預覽完成', '✓');
    } catch (error) {
      await log(`預覽錯誤：${String(error)}`);
      setStatus('預覽失敗', '✗');
    }
  });

  // Download SB3
  downloadBtn.addEventListener('click', async () => {
    if (!currentSession) {
      await log('錯誤：請先生成專案');
      return;
    }

    setStatus('匯出中...', '⏳');

    try {
      const sb3 = await currentSession.compile();
      const blob = new Blob([sb3 as unknown as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai-project.sb3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      URL.revokeObjectURL(url);
      await log('專案已下載：ai-project.sb3');
      await setStatus('下載完成', '✓');
    } catch (error) {
      await log(`下載錯誤：${String(error)}`);
      setStatus('下載失敗', '✗');
    }
  });
}

// ── Initialize ───────────────────────────────────────────────────────────────

export function init(): void {
  const app = createApp();
  document.getElementById('app')!.appendChild(app);
  bindEvents(app);
  console.log('AI Bridge UI initialized');
}
