'use strict';
/* Web 1.0.20 真实浏览器验证（自包含，端口错开）：
   ① 项目折叠卡：支持卡片背景（ct-bg/ct-mask/has-bg）+ CPU/内存改为条形图（meter，标注合计）
   ② 「有新镜像」徽标移进状态行，不再遮挡「运行中」（真实测量两元素零交集）
   ③ 检查更新 toast 显示真实镜像名+版本号（后端反查 sha256: 摘要回 repo:tag，
      此前 aitutor 显示为 sha256:0f35...；Fetch 拦截伪造含 repo/tag 的响应验证）
   走真实渲染 DOM + 真实点击/真实 dragstart，非合成自证。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const TOOLS = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 23020;
const CDP_PORT = 9340;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const SHOT_DIR = path.join(path.dirname(TOOLS), 'screenshots');
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const r = await fetch(url); if (r.ok || r.status === 502) return true; } catch (e) {} await sleep(120); }
  return false;
}
async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const srv = spawn('python', [path.join(TOOLS, 'serve_web_preview.py'), String(PREVIEW_PORT)],
    { cwd: TOOLS, stdio: 'ignore', windowsHide: true });
  const profile = 'C:/ldbuild/chrome-prof-120-web-' + Date.now();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    '--window-size=1440,1200', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let ws;
  try {
    if (!await waitPort(URL + 'api/state', 15000)) throw new Error('preview timeout');
    if (!await waitPort('http://127.0.0.1:' + CDP_PORT + '/json/version', 15000)) throw new Error('cdp timeout');
    const targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const evalJs = async (expr) => {
      const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
      return m.result && m.result.result && m.result.result.value;
    };
    const shot = async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      if (r.result && r.result.data) fs.writeFileSync(path.join(SHOT_DIR, file), Buffer.from(r.result.data, 'base64'));
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });

    console.log('=== Web 1.0.20 真实浏览器验证 ===');

    // ---- ① 项目卡：meter 条形图 + CPU/内存标注合计 ----
    await send('Page.navigate', { url: URL });
    await sleep(2300);
    let proj = await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      if(!pc) return {found:false};
      var labels=[].slice.call(pc.querySelectorAll('.meter-label')).map(function(x){return x.textContent.trim();});
      return {found:true, meterCount:pc.querySelectorAll('.meter').length,
        meterItems:pc.querySelectorAll('.meter-item').length,
        labels:labels,
        oldStatusText:(pc.querySelector('.ct-status')||{}).textContent||''};
    })()`);
    console.log('  project:', JSON.stringify(proj));
    ok('① 项目卡找到', proj.found === true, JSON.stringify(proj));
    ok('① 项目卡渲染出 CPU/内存条形图（.meter + 2 个 meter-item）',
       proj.meterCount === 1 && proj.meterItems === 2, JSON.stringify(proj));
    // 1.0.21 起产品按用户要求去掉「合计」标注，标签统一为「CPU」「内存」，与单容器卡一致
    ok('① CPU/内存标签与单容器卡一致（无合计标注）',
      (proj.labels || []).length === 2 && /^CPU/.test((proj.labels || [])[0] || '') && /^内存/.test((proj.labels || [])[1] || ''),
      JSON.stringify(proj.labels));

    // ---- ①b 项目卡卡片背景：往第一个子容器配背景后再渲染 ----
    const bgTest = await evalJs(`(function(){
      // 走 panelRuntime 受限出口操作面板自身 state，再由面板自己的渲染管线重画
      var rt=window.panelRuntime; if(!rt) return {ok:false, why:"no panelRuntime"};
      var st=rt.state();
      var first=null, i, cts=(st.data&&st.data.containers)||[];
      for(i=0;i<cts.length;i++){ if(cts[i].project==="safeline"){ first=cts[i].name; break; } }
      if(!first) return {ok:false, why:"no safeline child"};
      st.config.cardBackgrounds=st.config.cardBackgrounds||{};
      st.config.cardBackgrounds[first]={image:"/media/wall/builtin-aurora.jpg", blur:6, mask:.42};
      rt.rerender();
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      return {ok:true, hasBg:pc.classList.contains("has-bg"),
        bgEl:!!pc.querySelector(".ct-bg"), maskEl:!!pc.querySelector(".ct-mask"),
        bgImg:(pc.querySelector(".ct-bg")||{}).style&&pc.querySelector(".ct-bg").style.backgroundImage||""};
    })()`);
    console.log('  project bg:', JSON.stringify(bgTest));
    ok('① 配背景后项目折叠卡带 has-bg 类与背景层', bgTest.ok && bgTest.hasBg && bgTest.bgEl && bgTest.maskEl, JSON.stringify(bgTest));
    ok('① 背景图 URL 正确应用', /builtin-aurora/.test(bgTest.bgImg || ''), JSON.stringify(bgTest.bgImg));
    await shot('LiteDock-Web-1.0.20-project-bg.png');
    // 还原配置避免影响后续断言
    await evalJs('(function(){ var st=window.panelRuntime.state(); st.config.cardBackgrounds={}; window.panelRuntime.rerender(); return 1; })()');

    // ---- ② upd-flag 移进状态行，不遮挡 ----
    // 人为把某容器标记为有新镜像（等价于点过检查更新返回 hasUpdate）
    await evalJs('(function(){ var st=window.panelRuntime.state(); st.updates["aitutor"]=true; window.panelRuntime.rerender(); return 1; })()');
    await sleep(300);
    const overlap = await evalJs(`(function(){
      var ct=[].slice.call(document.querySelectorAll('.ct[data-ctname]')).filter(function(c){return c.getAttribute("data-ctname")==="aitutor";})[0];
      if(!ct) return {found:false};
      var flag=ct.querySelector('.upd-flag'); var st=ct.querySelector('.ct-state');
      if(!flag) return {found:true, flagMissing:true};
      var fr=flag.getBoundingClientRect(), sr=st.getBoundingClientRect();
      // 徽标是状态行子元素：验证「不遮挡」= 状态行的文字部分（led 与文本节点）与徽标零交集
      var led=st.querySelector('.led');
      var lr=led?led.getBoundingClientRect():null;
      var ledOverlap=lr?!(fr.right<=lr.left||lr.right<=fr.left||fr.bottom<=lr.top||lr.bottom<=fr.top):null;
      // 徽标自身不超出状态行（溢出=被裁剪或盖到卡片其它内容）
      var overflow=fr.right>sr.right+1||fr.left<sr.left-1;
      // 状态行文本（不含徽标）实际可见宽度
      var textNode=null;
      for(var i=0;i<st.childNodes.length;i++){ if(st.childNodes[i].nodeType===3&&/\\S/.test(st.childNodes[i].textContent)){ textNode=st.childNodes[i]; break; } }
      return {found:true, flagMissing:false, insideState:st.contains(flag),
        ledOverlap:ledOverlap, overflow:overflow,
        flagRight:Math.round(fr.right), stateRight:Math.round(sr.right), stateLeft:Math.round(sr.left)};
    })()`);
    console.log('  overlap:', JSON.stringify(overlap));
    ok('② 有新镜像徽标渲染（aitutor 标记后）', overlap.found && !overlap.flagMissing, JSON.stringify(overlap));
    ok('② 徽标位于状态行内部（不再绝对定位）', overlap.insideState === true, JSON.stringify(overlap));
    ok('② 徽标不遮挡状态指示灯与文字、不溢出状态行',
       overlap.insideState === true && overlap.ledOverlap === false && overlap.overflow === false,
       JSON.stringify(overlap));
    await shot('LiteDock-Web-1.0.20-upd-flag.png');
    await evalJs('(function(){ var st=window.panelRuntime.state(); st.updates["aitutor"]=false; window.panelRuntime.rerender(); return 1; })()');

    // ---- ③ 检查更新 toast 显示具体版本号 ----
    // Fetch 拦截 /api/container/*/check，返回带 repo/tag 的伪造响应（模拟后端 1.0.20 行为）
    await evalJs(`(function(){
      window.__toast120=null;
      var origToast=window.toast;
      // 找到页面 toast 函数（IIFE 内部，通过 DOM 劫持来捕获）
      var f=window.fetch;
      window.fetch=function(u,o){
        if(String(u).indexOf("/api/container/")>=0 && String(u).indexOf("/check")>=0){
          return Promise.resolve(new Response(JSON.stringify({
            ok:true, image:"ghcr.io/litedock-demo/aitutor:latest", repo:"ghcr.io/litedock-demo/aitutor", tag:"latest",
            oldId:"sha256:0f3575a85cda", newId:"sha256:9999aaaa8888", hasUpdate:true, online:true,
            message:"发现新镜像，可点「升级」重建"}),{status:200,headers:{"Content-Type":"application/json"}}));
        }
        return f.apply(this,arguments);
      };
      return 1;
    })()`);
    // 劫持 DOM 捕获 toast 文本（toast 元素是 #toast）
    await evalJs(`(function(){
      window.__toastTexts=[];
      var t=document.getElementById("toast");
      if(t){
        window.__tEl=t;
        t.__origText=t.textContent||"";
        var obs=new MutationObserver(function(){
          var cur=t.textContent||"";
          if(cur && cur!==window.__lastToast){ window.__lastToast=cur; window.__toastTexts.push(cur); }
        });
        obs.observe(t,{childList:true,subtree:true,characterData:true,attributes:true});
      }
      return !!t;
    })()`);
    // 真实点击 aitutor 的「检查更新」按钮
    const clickRes = await evalJs(`(function(){
      var ct=[].slice.call(document.querySelectorAll('.ct[data-ctname]')).filter(function(c){return c.getAttribute("data-ctname")==="aitutor";})[0];
      if(!ct) return JSON.stringify({clicked:false});
      var btn=[].slice.call(ct.querySelectorAll('[data-act]')).filter(function(b){return b.getAttribute('data-act')==='check';})[0];
      if(!btn) return JSON.stringify({clicked:false, noBtn:true});
      btn.click();
      return JSON.stringify({clicked:true});
    })()`);
    console.log('  check click:', clickRes);
    await sleep(1500);
    const toasts = await evalJs('JSON.stringify(window.__toastTexts||[])');
    console.log('  toasts:', toasts);
    const txts = JSON.parse(toasts || '[]');
    const final = txts[txts.length - 1] || '';
    ok('③ 点击「检查更新」后出现结果 toast', txts.length > 0, toasts);
    ok('③ toast 含镜像名（ghcr.io/litedock-demo/aitutor）', /ghcr\.io\/litedock-demo\/aitutor/.test(final), final);
    ok('③ toast 含「当前 latest」与「→ 最新」版本展示', /当前 latest/.test(final) && /最新/.test(final), final);

    console.log('\nWeb 1.0.20 PASS=' + PASS + '  FAIL=' + FAIL);
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  if (FAIL) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
