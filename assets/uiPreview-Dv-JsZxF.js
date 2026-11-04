const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./session-fuTS-WTG.js","./session-CuAhj7HY.js","./preload-helper-CjWs-_sd.js","./chunk-Tjgt1bVo.js","./vm-0SkdI-3I.js","./vm-DxppWxRy.js","./legacy-DSPdZdeX.js","./events-Bgd3mdsT.js","./jszip.min-769Lad5H.js","./scratch-svg-renderer-DnggnMJw.js","./__vite-browser-external-WlZv0icA.js"])))=>i.map(i=>d[i]);
import"./modulepreload-polyfill-CXK8biUa.js";import{t as e}from"./preload-helper-CjWs-_sd.js";import"./session-CuAhj7HY.js";async function t(t){let{ScratchSession:n}=await e(async()=>{let{ScratchSession:e}=await import(`./session-fuTS-WTG.js`);return{ScratchSession:e}},__vite__mapDeps([0,1,2,3]),import.meta.url),r=new n;return t?await r.loadSb3(t):r.newProject(`Untitled`),r}var n={move:[`motion_movesteps`,`motion_turnright`,`motion_turnleft`,`motion_gotoxy`],"move forward":[`motion_movesteps`],"turn right":[`motion_turnright`],"turn left":[`motion_turnleft`],say:[`looks_say`,`looks_sayforsecs`],show:[`looks_show`],hide:[`looks_hide`],"when clicked":[`event_whenthisspriteclicked`],"when flag clicked":[`event_whenflagclicked`],"when space pressed":[`event_whenkeypressed`],repeat:[`control_repeat`,`control_wait`],wait:[`control_wait`],play:[`sound_play`,`sound_playuntildone`],variable:[`data_setvariableto`,`data_changevariableby`],touch:[`sensing_touchingobject`]},r={motion_movesteps:{STEPS:10},motion_turnright:{DEGREES:15},motion_turnleft:{DEGREES:15},looks_say:{MESSAGE:`Hello!`},looks_sayforsecs:{MESSAGE:`Hello!`,SECS:2},control_wait:{DURATION:1},sound_play:{SOUND_MENU:`Meow`},data_setvariableto:{VALUE:0},data_changevariableby:{VALUE:1}};async function i(e,t,n){let r=a(e.toLowerCase().trim());if(r.length===0&&t)try{return await o(e,t,n)}catch{}return{commands:r,confidence:r.length>0?.9:.5,summary:r.length>0?`Parsed ${r.length} command(s) from "${e}"`:`No commands found in "${e}"`}}function a(e){let t=[];for(let[i,a]of Object.entries(n))if(e.includes(i))for(let n of a){let a={...r[n]};if(n===`motion_movesteps`&&e.match(/(\d+)/)&&(a.STEPS=parseInt(e.match(/(\d+)/)[1],10)),n===`looks_say`&&e.includes(`say`)){let t=e.match(/say["']?([^"']+)/);t&&t[1]&&(a.MESSAGE=t[1].trim())}n===`control_wait`&&e.match(/(\d+\.?\d*)\s*(second|sec|s)/)&&(a.DURATION=parseFloat(e.match(/(\d+\.?\d*)\s*(second|sec|s)/)[1])),t.push({type:i,opcode:n,inputs:a,fields:{},description:i})}if(e.includes(`move`)&&e.includes(`step`)){let n=e.match(/(\d+)\s*step/);n?t.push({type:`move`,opcode:`motion_movesteps`,inputs:{STEPS:parseInt(n[1],10)},fields:{},description:`Move 10 steps`}):t.push({type:`move`,opcode:`motion_movesteps`,inputs:{STEPS:10},fields:{},description:`Move 10 steps`})}return t}async function o(e,t,n){try{let r=await fetch(t,{method:`POST`,headers:{"Content-Type":`application/json`,...n?{Authorization:`Bearer ${n}`}:{}},body:JSON.stringify({model:`qwen3-coder-next-80b-local`,messages:[{role:`system`,content:`You are a Scratch programming assistant. Convert natural language instructions to a JSON array of Scratch block commands.

Each command should have:
- type: category of the action (move, say, wait, etc.)
- opcode: Scratch block opcode (e.g., 'motion_movesteps', 'looks_say')
- inputs: object with block inputs (e.g., { STEPS: 10 }, { MESSAGE: 'Hello!' })
- fields: object with block fields (e.g., { VARIABLE: 'score' })
- targetName: optional sprite name (default: 'Sprite1')

Available opcodes:
- motion_movesteps, motion_turnright, motion_turnleft, motion_gotoxy
- looks_say, looks_sayforsecs, looks_show, looks_hide
- event_whenthisspriteclicked, event_whenflagclicked, event_whenkeypressed
- control_repeat, control_wait
- sound_play, sound_playuntildone
- data_setvariableto, data_changevariableby

Example:
Input: "Make the sprite move 10 steps and say hello"
Output: [
  { "type": "move", "opcode": "motion_movesteps", "inputs": { "STEPS": 10 } },
  { "type": "say", "opcode": "looks_say", "inputs": { "MESSAGE": "Hello!" } }
]

Return only valid JSON. Use English for type and description.`},{role:`user`,content:`Convert to Scratch blocks: "${e}"`}],max_tokens:512,temperature:.3})});if(!r.ok)throw Error(`LLM API error: ${r.status}`);let i=((await r.json()).choices?.[0]?.message?.content||``).match(/\[[\s\S]*\]/);if(i){let e=JSON.parse(i[0]);return{commands:e,confidence:.95,summary:`Parsed ${e.length} command(s) using LLM`}}throw Error(`No JSON array found in response`)}catch(e){throw console.error(`LLM parsing failed:`,e),e}}function s(){let e=document.createElement(`header`);return e.className=`ai-bridge-header`,e.innerHTML=`
    <h1>AI × Scratch 編輯器</h1>
    <p>將自然語言指令轉為 Scratch 專案</p>
  `,e}function c(){let e=document.createElement(`div`);return e.className=`ai-bridge-editor`,e.innerHTML=`
    <textarea 
      class="prompt-input" 
      placeholder="輸入自然語言指令，例如：
讓角色前進 10 步並說「你好」
重複 5 次移動 20 步"
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
  `,e}function l(){let e=document.createElement(`footer`);return e.className=`ai-bridge-footer`,e.innerHTML=`
    <p>Powered by Scratch AI Bridge • Step 5: Web UI</p>
  `,e}function u(){let e=document.createElement(`div`);return e.className=`ai-bridge-app`,e.appendChild(s()),e.appendChild(c()),e.appendChild(l()),e}function d(n){let r=n.querySelector(`.prompt-input`),a=n.querySelector(`.btn-generate`),o=n.querySelector(`.btn-preview`),s=n.querySelector(`.btn-download`),c=n.querySelector(`.output-log`),l=n.querySelector(`.status-text`),u=null;async function d(e){c.value+=`[${new Date().toLocaleTimeString()}] ${e}\n`,c.scrollTop=c.scrollHeight}async function f(e,t=`●`){l.textContent=e,l.previousElementSibling.textContent=t}a.addEventListener(`click`,async()=>{let e=r.value.trim();if(!e){await d(`錯誤：請輸入指令`);return}f(`分析指令中...`,`⏳`);try{let n=await i(e);await d(`解析成功：${n.commands.length} 個指令 (可信度 ${n.confidence*100}%)`),u=await t(),await u.newProject(`AI 生成專案`);let r=`Sprite1`;await u.addSprite(r);let a=null;for(let e of n.commands)a=await u.addBlock(r,e.opcode,{inputs:e.inputs,fields:e.fields}),await d(`新增積木：${e.opcode}`);if(!a){await d(`警告：未新增任何積木`);return}await f(`專案已生成`,`✓`),await d(`專案生成完成！`)}catch(e){await d(`錯誤：${String(e)}`),f(`生成失敗`,`✗`)}}),o.addEventListener(`click`,async()=>{if(!u){await d(`錯誤：請先生成專案`);return}f(`預覽中...`,`⏳`);try{let{createVM:t,renderSb3Preview:n}=await e(async()=>{let{createVM:e,renderSb3Preview:t}=await import(`./vm-0SkdI-3I.js`);return{createVM:e,renderSb3Preview:t}},__vite__mapDeps([4,5,2,6,3,7,8,9,10]),import.meta.url),r=await t(),i=document.createElement(`canvas`);i.width=480,i.height=360;try{await n(await u.compile(),r,i);let e=await new Promise((e,t)=>{i.toBlob(n=>n?e(n):t(Error(`Could not create preview image`)),`image/png`)}),t=URL.createObjectURL(e),a=document.createElement(`a`);a.href=t,a.download=`ai-project-preview.png`,a.click(),window.setTimeout(()=>URL.revokeObjectURL(t),0),await d(`預覽截圖已下載：ai-project-preview.png`)}finally{r.quit(),i.remove()}await f(`預覽完成`,`✓`)}catch(e){await d(`預覽錯誤：${String(e)}`),f(`預覽失敗`,`✗`)}}),s.addEventListener(`click`,async()=>{if(!u){await d(`錯誤：請先生成專案`);return}f(`匯出中...`,`⏳`);try{let e=await u.compile(),t=new Blob([e],{type:`application/zip`}),n=URL.createObjectURL(t),r=document.createElement(`a`);r.href=n,r.download=`ai-project.sb3`,document.body.appendChild(r),r.click(),document.body.removeChild(r),URL.revokeObjectURL(n),await d(`專案已下載：ai-project.sb3`),await f(`下載完成`,`✓`)}catch(e){await d(`下載錯誤：${String(e)}`),f(`下載失敗`,`✗`)}})}function f(){let e=u();document.getElementById(`app`).appendChild(e),d(e),console.log(`AI Bridge UI initialized`)}f();