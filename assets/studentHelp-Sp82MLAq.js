import"./modulepreload-polyfill-CXK8biUa.js";import{N as e}from"./vm-EuflpmX-.js";import"./events-Bgd3mdsT.js";import"./jszip.min-769Lad5H.js";import"./__vite-browser-external-WlZv0icA.js";import"./scratch-svg-renderer-B3iCJaOJ.js";import{c as t,n,r,s as i}from"./style-CPYvNNPX.js";import"./scratch-storage-D3fL8Ppm.js";var a=e();globalThis.Buffer=a.Buffer,`serviceWorker`in navigator&&window.addEventListener(`load`,()=>{let e=new URL(`../`,``+import.meta.url);navigator.serviceWorker.register(new URL(`../service-worker.js`,``+import.meta.url),{scope:e.pathname}).catch(e=>console.warn(`Offline app cache could not be installed`,e))},{once:!0});var o=document.querySelector(`#student-help-app`);if(!o)throw Error(`Scratch student help app root was not found`);o.innerHTML=`
  <a class="skip-link" href="#student-help-main">跳到提問區</a>
  <div class="student-help-shell">
    <header class="student-help-heading">
      <div class="student-help-mark" aria-hidden="true">Scratch</div>
      <p class="student-help-eyebrow">作品解惑小幫手</p>
      <h1>Scratch 學習小幫手</h1>
      <p>上傳你的作品，帶著程式線索去問 AI，一起找出答案。</p>
    </header>

    <section class="student-help-card" aria-labelledby="upload-title">
      <div class="student-help-step">1</div>
      <div class="student-help-content">
        <h2 id="upload-title">選擇你的 Scratch 作品</h2>
        <p>請選擇從 Scratch 下載的 <strong>.sb3</strong> 專案檔。</p>
        <label class="student-help-upload" for="student-sb3-file">
          <span class="student-help-upload-icon" aria-hidden="true">↑</span>
          <strong>選擇或拖曳 .sb3 檔案到這裡</strong>
          <span>作品會留在這台裝置裡分析，不會上傳到這個網站。</span>
          <input id="student-sb3-file" class="visually-hidden" type="file" accept=".sb3,application/zip" />
        </label>
        <p id="student-file-status" class="student-help-status" role="status" aria-live="polite"></p>
      </div>
    </section>

    <section id="student-project-result" class="student-help-card" aria-labelledby="project-title" hidden>
      <div class="student-help-step">2</div>
      <div class="student-help-content">
        <h2 id="project-title">作品分析完成</h2>
        <p id="student-project-summary" class="student-help-summary"></p>
        <div class="student-help-map">
          <h3>程式線索：可以從這裡開始找</h3>
          <p>角色名稱已改成代號。打開 Scratch 裡同一個角色，再找相同段落和積木。</p>
          <ul id="student-project-map" class="student-help-map-list"></ul>
          <button id="student-map-more" class="student-help-map-more" type="button" hidden></button>
        </div>
        <p class="student-help-note">這是程式積木的整理，沒有替作品打分，也沒有實際執行遊戲。</p>
      </div>
    </section>

    <section id="student-question-card" class="student-help-card" aria-labelledby="question-title" hidden>
      <div class="student-help-step">3</div>
      <div class="student-help-content">
        <h2 id="question-title">你想問什麼？</h2>
        <label for="student-question">用自己的話寫下問題</label>
        <textarea id="student-question" rows="3" maxlength="500" placeholder="例如：為什麼主角一開始就在右邊？"></textarea>
        <details class="student-help-context">
          <summary>補充作品原本和實際的樣子（可不填）</summary>
          <label for="student-expected">我原本想看到什麼？</label>
          <textarea id="student-expected" rows="2" maxlength="200" placeholder="例如：主角應該從舞台左邊開始"></textarea>
          <label for="student-actual">我實際看到什麼？</label>
          <textarea id="student-actual" rows="2" maxlength="200" placeholder="例如：按綠旗後，主角出現在右邊"></textarea>
        </details>
        <div id="student-first-hint" class="student-help-first-hint" aria-live="polite" hidden></div>
        <p class="student-help-privacy">不要寫姓名、班級或其他個人資料。按複製後，問題和你填寫的補充資料會放進提示；只有你把提示貼到 AI 並送出時，AI 才會收到。</p>
        <div class="student-help-actions">
          <button id="student-copy-prompt" class="button primary" type="button" disabled>複製問題和作品線索</button>
        </div>
        <p id="student-copy-status" class="student-help-status" role="status" aria-live="polite"></p>
        <div class="student-help-howto">
          <strong>接下來這樣做</strong>
          <ol>
            <li>按上面的按鈕複製提示。</li>
            <li>打開老師允許使用的 AI，貼上提示並送出。</li>
            <li>請 AI 用提示帶你找答案；不懂的地方可以再問老師。</li>
          </ol>
        </div>
        <div id="student-copy-fallback" class="student-help-fallback" hidden>
          <label for="student-prompt-text">無法自動複製時，點一下文字框後全選並複製：</label>
          <textarea id="student-prompt-text" rows="8" readonly></textarea>
        </div>
      </div>
    </section>

    <footer class="student-help-footer">有問題時，請找老師一起看你的作品。</footer>
  </div>
`;var s=e=>{let t=document.querySelector(e);if(!t)throw Error(`Scratch student help element is missing: ${e}`);return t},c=s(`#student-sb3-file`),l=s(`.student-help-upload`),u=s(`#student-file-status`),d=s(`#student-project-result`),f=s(`#student-project-summary`),p=s(`#student-project-map`),m=s(`#student-map-more`),h=s(`#student-question-card`),g=s(`#student-question`),_=s(`#student-expected`),v=s(`#student-actual`),y=s(`#student-first-hint`),b=s(`#student-copy-prompt`),x=s(`#student-copy-status`),S=s(`#student-copy-fallback`),C=s(`#student-prompt-text`),w=null,T=null,E=null,D=!1,O=40,k=e=>{if(e===0)return`舞台`;let t=e-1,n=``,r=t;do n=String.fromCharCode(65+r%26)+n,r=Math.floor(r/26)-1;while(r>=0);return`角色 ${n}（Scratch 角色清單第 ${e} 個）`},A=e=>{let t=e.evidence.slice(0,O),n=new Map;for(let e of t){let t=`${e.targetIndex}:${e.scriptIndex??`other`}`,r=n.get(t)??{target:k(e.targetIndex),script:e.scriptIndex,labels:[]};r.labels.includes(e.studentLabel)||r.labels.push(e.studentLabel),n.set(t,r)}p.replaceChildren();for(let e of n.values()){let t=document.createElement(`li`),n=document.createElement(`strong`);n.textContent=e.script===null?e.target:`${e.target}・第 ${e.script+1} 段程式`;let r=document.createElement(`span`);r.textContent=e.labels.join(`、`),t.append(n,r),p.append(t)}let r=Math.max(0,e.evidence.length-t.length);m.hidden=r===0,m.textContent=r>0?`查看更多 ${r} 個線索`:``},j=e=>{if(y.replaceChildren(),!e.trim()||!E){y.hidden=!0;return}let t=e.toLocaleLowerCase(),n=[{keywords:[`位置`,`右邊`,`左邊`,`座標`,`一開始`,`出現在哪`,`跑到哪`],opcodes:[`motion_gotoxy`,`motion_setx`,`motion_changexby`],nextStep:e=>`先在 Scratch 找到「${e}」，看看 x 旁的數字；再看積木寫的是「定位」還是「改變」，想一想它會設定位置還是移動多少。`},{keywords:[`按鍵`,`方向鍵`,`按下`,`不能動`,`移動不了`,`控制`],opcodes:[`event_whenkeypressed`,`sensing_keypressed`],nextStep:e=>`先在 Scratch 找到「${e}」，確認它等的是哪個按鍵，再試著按一次那個鍵。`},{keywords:[`碰到`,`撞到`,`碰撞`,`接觸`],opcodes:[`sensing_touchingobject`,`event_whentouchingobject`],nextStep:e=>`先在 Scratch 找到「${e}」，看看它正在檢查哪個角色；再觀察遊戲中兩個角色有沒有真的碰在一起。`},{keywords:[`分數`,`加分`,`得分`,`分數沒有`],opcodes:[`data_changevariableby`,`data_setvariableto`],nextStep:e=>`先在 Scratch 找到「${e}」，看看它在什麼程式段裡；再找同一段前面的條件，想想什麼時候才會加分。`},{keywords:[`聲音`,`音樂`,`沒有聲音`],opcodes:[`sound_play`,`sound_playuntildone`,`music_playDrumForBeats`,`text2speech_speakAndWait`],nextStep:e=>`先在 Scratch 找到「${e}」，看看它前面接著什麼開始積木或條件。若使用擴充積木，請也確認 Scratch 有啟用對應擴充功能。`}].find(({keywords:e})=>e.some(e=>t.includes(e))),r=n?E.evidence.find(({opcode:e})=>n.opcodes.includes(e)):void 0,i=document.createElement(`strong`),a=document.createElement(`p`),o=r?`${k(r.targetIndex)}${r.scriptIndex===null?``:`・第 ${r.scriptIndex+1} 段程式`}`:``;n&&r?(i.textContent=`先試一個小提示`,a.textContent=`${o}：${n.nextStep(r.studentLabel)}`):(i.textContent=`先從作品線索開始`,a.textContent=`我目前找不到能直接回答這個問題的積木線索，所以先不猜原因。可以在上面的程式線索中找最像的積木，或請老師陪你一起看。`),y.append(i,a),y.hidden=!1},M=(e,t,n=`neutral`)=>{e.textContent=t,e.dataset.kind=n},N=async e=>{if(w=null,T=null,E=null,O=40,_.value=``,v.value=``,d.hidden=!0,h.hidden=!0,b.disabled=!0,S.hidden=!0,x.textContent=``,!e.name.toLocaleLowerCase().endsWith(`.sb3`)){M(u,`請選擇 Scratch 3 的 .sb3 專案檔。`,`error`);return}D=!0,l.setAttribute(`aria-busy`,`true`),M(u,`正在讀取作品，請稍等一下……`);try{let n=await r(e,e.name.replace(/\.sb3$/i,``)||`Scratch 專案`);w=n.canonical,T=t(n.canonical,n.rawBlockGraphs),E=i(n.canonical,T,n.rawBlockGraphs,n.canonicalBlockMappings,n.rawArchive.projectJson),A(E),j(g.value),f.textContent=`找到 ${n.canonical.sprites.length} 個角色、${T.summary.scripts} 段程式和 ${T.summary.blocks} 個積木。現在可以寫下想問的問題。`,d.hidden=!1,h.hidden=!1,b.disabled=g.value.trim().length===0,M(u,`作品讀取完成。`,`success`),g.focus()}catch{M(u,`讀不到這個作品。請確認檔案是 Scratch 3 的 .sb3 專案，再試一次。`,`error`)}finally{D=!1,l.removeAttribute(`aria-busy`)}};c.addEventListener(`change`,()=>{let e=c.files?.[0];c.value=``,e&&!D&&N(e)}),m.addEventListener(`click`,()=>{E&&(O+=40,A(E))});for(let e of[`dragenter`,`dragover`])l.addEventListener(e,e=>{e.preventDefault(),l.classList.add(`is-dragging`)});for(let e of[`dragleave`,`drop`])l.addEventListener(e,e=>{e.preventDefault(),l.classList.remove(`is-dragging`)});l.addEventListener(`drop`,e=>{let t=e.dataTransfer?.files[0];t&&!D&&N(t)}),g.addEventListener(`input`,()=>{b.disabled=!w||!T||!E||g.value.trim().length===0,j(g.value)});var P=async()=>{if(!w||!T||!E)return;let e=[`學生問題：${g.value.trim()}`,..._.value.trim()?[`原本想看到：${_.value.trim()}`]:[],...v.value.trim()?[`實際看到：${v.value.trim()}`]:[]].join(`
`),t=n({analysis:T,canonical:w,projectMap:E,question:e,mode:`student`,hintLevel:2});try{await navigator.clipboard.writeText(t),S.hidden=!0,M(x,`已複製！請打開老師允許使用的 AI，貼上提示開始提問。`,`success`)}catch{C.value=t,S.hidden=!1,C.focus(),C.select(),M(x,`瀏覽器不允許自動複製，請從下方文字框全選並複製。`)}};b.addEventListener(`click`,()=>{P()});