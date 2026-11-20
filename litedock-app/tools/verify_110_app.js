'use strict';
/* APP 1.0.10 真实浏览器验证（自包含，端口与现有脚本错开）：
   ① 点击端口 chip：静默打开浏览器，不再弹「正在打开浏览器」toast
   ② 详情页：不出现检查更新 / 升级重建按钮，日志区仍在
   ③ 首页卡片：显示「重启」按钮（data-act=restart），不再有「日志」按钮
   ⑤ 分组：全部带背景，无图分组有渐变，配色各异（含新增分组）
   全部走真实渲染 DOM（CDP），非合成事件自证。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8877;
const CDP_PORT = 9333;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const SHOT_DIR = path.join(ROOT, 'screenshots');
const LD_WWW = process.env.LD_WWW;   // 指定则验证另一份 www（如 APK 解包目录）
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
  const env = Object.assign({}, process.env, { LD_PORT: String(PREVIEW_PORT) });
  if (LD_WWW) env.LD_WWW = LD_WWW;
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const profile = 'C:/ldbuild/chrome-prof-110-app-' + Date.now();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    '--window-size=430,900', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let ws;
  try {
    if (!await waitPort(URL + 'index.html', 15000)) throw new Error('preview timeout');
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
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await send('Page.navigate', { url: URL + '?diag=1' });
    await sleep(2600);

    console.log('=== APP 1.0.10 真实浏览器验证 ===');

    // --- ③ 首页卡片：重启按钮、无日志按钮 ---
    const home = JSON.parse(await evalJs(`(function(){
      var out={restart:0,openLogs:0,groups:0,hasBg:0,gradBg:0,accents:[]};
      document.querySelectorAll('.ct-ops [data-act="restart"]').forEach(function(){out.restart++;});
      document.querySelectorAll('.ct-ops [data-ev="openLogs"]').forEach(function(){out.openLogs++;});
      document.querySelectorAll('.group').forEach(function(g){
        out.groups++;
        if(g.classList.contains('has-bg')) out.hasBg++;
        if(g.querySelector('.group-auto-bg')) out.gradBg++;
        var bar=g.querySelector('.group-bar');
        if(bar) out.accents.push(bar.style.background);
      });
      return JSON.stringify(out);
    })()`));
    console.log('  home:', JSON.stringify(home));
    ok('③ 首页有「重启」按钮（data-act=restart）', home.restart > 0, JSON.stringify(home));
    ok('③ 首页不再有「日志」按钮（openLogs）', home.openLogs === 0, JSON.stringify(home));
    // --- ⑤ 分组全部带背景、无图有渐变、配色各异 ---
    ok('⑤ 所有分组都带背景（has-bg）', home.groups > 0 && home.hasBg === home.groups, JSON.stringify(home));
    ok('⑤ 无自定义图的分组带渐变背景层', home.gradBg >= 3, JSON.stringify(home));
    ok('⑤ 分组强调色彼此不同（配色各异）',
       new Set(home.accents).size === home.accents.length, JSON.stringify(home.accents));

    // --- ① 点击端口 chip：静默打开浏览器，不弹 toast ---
    // 先记录 toast 元素变化 + 原生 openUrl 调用
    await evalJs(`(function(){
      window.__t110={toasts:[],opened:0};
      var el=document.getElementById('ld-toast');
      if(el){ window.__t110.obs=new MutationObserver(function(){
        if(el.classList.contains('show')) window.__t110.toasts.push(el.textContent||'');
      }); window.__t110.obs.observe(el,{attributes:true,childList:true,subtree:true,characterData:true}); }
      return 1;
    })()`);
    const chipInfo = await evalJs(`(function(){
      var all=[].slice.call(document.querySelectorAll('[data-ev="copyLink"]'));
      return JSON.stringify({total:all.length, detail:all.map(function(c){
        var r=c.getBoundingClientRect();
        return {url:c.getAttribute('data-url'),w:Math.round(r.width),h:Math.round(r.height),disp:getComputedStyle(c).display,par:c.parentElement&&c.parentElement.className};
      })});
    })()`);
    console.log('  chip:', chipInfo);
    ok('① 找到端口/访问链接 chip', JSON.parse(chipInfo).total > 0, chipInfo);
    // 真实鼠标点击 chip（CDP），然后观察 toast 与 openUrl
    const clickRes = await evalJs(`(function(){
      var chips=[].slice.call(document.querySelectorAll('[data-ev="copyLink"][data-url^="http"]'));
      var chip=chips.filter(function(c){var r=c.getBoundingClientRect();return r.width>4&&r.height>4;})[0];
      if(!chip) return JSON.stringify({clicked:false,total:chips.length});
      chip.scrollIntoView({block:'center'});
      var r=chip.getBoundingClientRect();
      window.__t110.center={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
      return JSON.stringify({clicked:true,url:chip.getAttribute('data-url'),center:{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)},rect:{x:r.left,y:r.top,w:r.width,h:r.height}});
    })()`);
    await sleep(300);
    console.log('  clickRes:', clickRes);
    const ctr = JSON.parse(clickRes).center;
    console.log('  click center:', JSON.stringify(ctr));
    if (ctr) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctr.x, y: ctr.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctr.x, y: ctr.y, button: 'left', clickCount: 1 });
    }
    await sleep(900);
    const clickOut = await evalJs(`(function(){
      return JSON.stringify({
        toasts:window.__t110.toasts,
        opened:(window.__openedNative||[]).length
      });
    })()`);
    console.log('  after click:', clickOut);
    const co = JSON.parse(clickOut);
    ok('① 点击 chip 调用了原生浏览器打开', co.opened >= 1, clickOut);
    ok('① 点击 chip 不再弹「正在打开浏览器 / 已打开浏览器」toast',
       !co.toasts.some(t => /打开浏览器/.test(t)), clickOut);

    // --- ② 详情页：删检查更新/升级重建，日志保留 ---
    await evalJs(`(function(){var c=document.querySelector('.ct[data-ev="openDetail"]');if(c)c.click();})()`);
    await sleep(700);
    const detail = JSON.parse(await evalJs(`(function(){
      var out={page:!!document.querySelector('.detail-page'),check:0,upgrade:0,logs:0,logText:0};
      document.querySelectorAll('[data-ev]').forEach(function(n){
        var ev=n.getAttribute('data-ev');
        if(ev==='checkUpdate')out.check++;
        if(ev==='doUpgrade')out.upgrade++;
        if(ev==='loadLogs')out.logs++;
      });
      var sec=document.querySelector('.section-title');
      var all=[].slice.call(document.querySelectorAll('.section-title')).map(function(x){return x.textContent;});
      out.hasLogSection=all.indexOf('运行日志')>=0;
      return JSON.stringify(out);
    })()`));
    console.log('  detail:', JSON.stringify(detail));
    ok('② 详情页已打开', detail.page === true, JSON.stringify(detail));
    ok('② 详情页无「检查更新」按钮', detail.check === 0, JSON.stringify(detail));
    ok('② 详情页无「升级重建」按钮', detail.upgrade === 0, JSON.stringify(detail));
    ok('② 详情页保留「运行日志」与刷新按钮', detail.hasLogSection && detail.logs >= 1, JSON.stringify(detail));

    await shot(LD_WWW ? 'LiteDock-App-1.0.10-detail-apk.png' : 'LiteDock-App-1.0.10-verify.png');
    console.log('\nAPP 1.0.10 PASS=' + PASS + '  FAIL=' + FAIL);
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  if (FAIL) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
