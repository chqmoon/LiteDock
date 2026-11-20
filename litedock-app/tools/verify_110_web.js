'use strict';
/* Web 1.0.18 真实浏览器验证（自包含，端口错开）：
   ② 检查更新结果 toast 显示「当前版本 → 最新版本」+ 镜像 ID 短码
   ④ Compose 项目卡展开后，子容器不可单独拖拽；项目卡本身仍可整体拖
   走真实 UI 链路：CDP Fetch 拦截 check 请求伪造响应，真实点击按钮观察 toast；
   真实派发 dragstart 验证拖拽裁决。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const TOOLS = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 23018;
const CDP_PORT = 9338;
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
  const profile = 'C:/ldbuild/chrome-prof-110-web-' + Date.now();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    '--window-size=1440,1000', 'about:blank'
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
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2300);

    console.log('=== Web 1.0.18 真实浏览器验证 ===');

    // ---- ④ 项目卡展开后子容器不可拖 ----
    // 先确认项目卡存在且折叠
    const pcBefore = JSON.parse(await evalJs(`JSON.stringify({
      has: !!document.querySelector('.project-card[data-projname="safeline"]'),
      expanded: document.querySelector('.project-card[data-projname="safeline"]')?.classList.contains('is-expanded')||false
    })`));
    console.log('  project card:', JSON.stringify(pcBefore));
    ok('④ 找到 safeline 项目卡且默认折叠', pcBefore.has && !pcBefore.expanded, JSON.stringify(pcBefore));

    // 真实点击「展开 N 个容器」
    await evalJs(`(function(){var b=document.querySelector('.project-card[data-projname="safeline"] [data-toggleproject]');if(b){b.scrollIntoView({block:'center'});b.click();}})()`);
    await sleep(700);
    const afterExpand = JSON.parse(await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      var subs=document.querySelectorAll('.ct.in-project');
      return JSON.stringify({
        expanded: pc?pc.classList.contains('is-expanded'):false,
        subCount: subs.length,
        allDataInproject: [].slice.call(subs).every(function(x){return x.getAttribute('data-inproject')==='1';}),
        allNoCtname: [].slice.call(subs).every(function(x){return !x.hasAttribute('data-ctname');}),
        allDraggableFalse: [].slice.call(subs).every(function(x){return x.getAttribute('draggable')==='false';}),
        projectDraggable: pc?pc.getAttribute('draggable'):null,
        projectHasName: pc?!(!pc.getAttribute('data-projname')):false
      });
    })()`));
    console.log('  after expand:', JSON.stringify(afterExpand));
    ok('④ 展开后显示项目内子容器卡', afterExpand.expanded && afterExpand.subCount >= 2, JSON.stringify(afterExpand));
    ok('④ 子容器标记 data-inproject=1、无 data-ctname、draggable=false',
       afterExpand.allDataInproject && afterExpand.allNoCtname && afterExpand.allDraggableFalse, JSON.stringify(afterExpand));
    ok('④ 项目卡本身仍可整体拖（draggable + data-projname 保留）',
       afterExpand.projectDraggable === 'true' && afterExpand.projectHasName, JSON.stringify(afterExpand));

    // 真实派发 dragstart 到子容器，验证被 preventDefault（无拖拽载荷）
    const childDrag = await evalJs(`(function(){
      var sub=document.querySelector('.ct.in-project');
      if(!sub) return JSON.stringify({ok:false});
      var dt={ data:{}, setData:function(k,v){this.data[k]=v;}, getData:function(k){return this.data[k]||'';}, effectAllowed:'' };
      var ev=new Event('dragstart',{bubbles:true,cancelable:true});
      Object.defineProperty(ev,'dataTransfer',{value:dt});
      sub.dispatchEvent(ev);
      return JSON.stringify({defaultPrevented:ev.defaultPrevented, payload:dt.getData('text/plain')||''});
    })()`);
    console.log('  child dragstart:', childDrag);
    ok('④ 子容器真实 dragstart 被拦截（defaultPrevented、无载荷）',
       JSON.parse(childDrag).defaultPrevented === true && JSON.parse(childDrag).payload === '', childDrag);

    // 真实派发 dragstart 到项目卡，验证可拖（有载荷）
    const projDrag = await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      if(!pc) return JSON.stringify({ok:false});
      var dt={ data:{}, setData:function(k,v){this.data[k]=v;}, getData:function(k){return this.data[k]||'';}, effectAllowed:'' };
      var ev=new Event('dragstart',{bubbles:true,cancelable:true});
      Object.defineProperty(ev,'dataTransfer',{value:dt});
      pc.dispatchEvent(ev);
      return JSON.stringify({defaultPrevented:ev.defaultPrevented, payload:dt.getData('text/plain')||''});
    })()`);
    console.log('  project dragstart:', projDrag);
    ok('④ 项目卡真实 dragstart 允许拖拽（载荷含多个容器名）',
       JSON.parse(projDrag).defaultPrevented === false && (JSON.parse(projDrag).payload||'').split('\n').filter(Boolean).length >= 2, projDrag);

    // ---- ② 检查更新 toast 显示当前版本/最新版本 ----
    // 用 CDP Fetch 拦截 POST .../check，返回伪造的「发现新镜像」响应
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/container/*/check', requestStage: 'Request' }] });
    const checkBody = JSON.stringify({
      ok: true, image: 'ghcr.io/example/litedock:1.0.17',
      oldId: 'sha256:abcdef1234567890', newId: 'sha256:9999888877776666',
      hasUpdate: true, online: true, pullError: '', message: '发现新镜像，可点「升级」重建'
    });
    // 监听 Fetch.requestPaused 并回应
    let fetchHandler = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Fetch.requestPaused') {
        send('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(checkBody).toString('base64')
        }).catch(() => {});
      }
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      fetchHandler(ev);
    };
    // 真实点击某容器的「检查更新」按钮
    const clicked = await evalJs(`(function(){
      var btn=document.querySelector('[data-act="check"]');
      if(!btn) return JSON.stringify({clicked:false});
      btn.scrollIntoView({block:'center'});
      btn.click();
      return JSON.stringify({clicked:true});
    })()`);
    console.log('  check click:', clicked);
    ok('② 找到并点击「检查更新」按钮', JSON.parse(clicked).clicked === true, clicked);
    await sleep(1200);
    const toastText = await evalJs(`(function(){var t=document.getElementById('toast');return t?t.textContent:'';})()`);
    console.log('  toast:', toastText);
    ok('② 检查更新结果 toast 含「当前」与「最新」版本号',
       /当前/.test(toastText||'') && /最新/.test(toastText||'') && /1\.0\.17/.test(toastText||''), toastText);
    ok('② toast 含镜像 ID 短码佐证（abcdef1234 / 9999888877）',
       /abcdef1234/.test(toastText||'') && /9999888877/.test(toastText||''), toastText);
    await send('Fetch.disable');
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) fs.writeFileSync(path.join(SHOT_DIR, 'LiteDock-Web-1.0.18-verify.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('\nWeb 1.0.18 PASS=' + PASS + '  FAIL=' + FAIL);
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  if (FAIL) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
