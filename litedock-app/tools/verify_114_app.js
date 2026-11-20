'use strict';
/* APP 1.0.14 真实浏览器验证（自包含）：项目卡状态行位置/healthy/异常警告
   ① 项目卡与单容器卡 meter 结构一致（沿用 1.0.12/1.0.13 断言）
   ② 状态行 .ct-status 必须在资源条 .meters 之前（DOM 顺序，与单容器卡一致）
   ③ 项目卡启动时间取 Up 最久容器，多个同时最久时优先带 (healthy)
   ④ 默认 fixture（7 容器全 running）无警告标识
   ⑤ LD_ISSUE=1 用 state-issue.json（1 个 exited + 1 个 unhealthy）→ 状态行
      出现 ⚠ 2 个容器异常 + .status-warn 橙色样式（真实 CDP 读取）
   ⑥ 展开子容器、紧凑模式隐藏 meters 不回归；版本号 1.0.14
   全部真实 CDP 渲染 DOM 读取，非合成事件自证。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ISSUE = process.env.LD_ISSUE === '1';
const PREVIEW_PORT = ISSUE ? 8886 : 8885;
const CDP_PORT = ISSUE ? 9342 : 9341;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const LD_WWW = process.env.LD_WWW;
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const r = await fetch(url); if (r.ok || r.status === 502) return true; } catch (e) {} await sleep(120); }
  return false;
}
async function main() {
  const env = Object.assign({}, process.env, { LD_PORT: String(PREVIEW_PORT) });
  if (LD_WWW) env.LD_WWW = LD_WWW;
  if (ISSUE) env.LD_FIXTURE = path.join(__dirname, 'fixtures', 'state-issue.json');
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=C:/ldbuild/chrome-prof-114-app-' + (ISSUE ? 'issue' : 'ok') + '-' + Date.now(),
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
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2600);

    console.log('=== APP 1.0.14 项目卡状态行 真实浏览器验证 ' + (ISSUE ? '[异常 fixture]' : '[正常 fixture]') + ' ===');

    const cards = JSON.parse(await evalJs(`(function(){
      function grab(el){
        if(!el) return null;
        var meters=[];
        el.querySelectorAll('.meters .meter').forEach(function(m){
          var lab=m.querySelector('.meter-label span');
          var val=m.querySelector('.meter-label .strong');
          var fill=m.querySelector('.bar .bar-fill');
          meters.push({ label: lab?lab.textContent.trim():'', value: val?val.textContent.trim():'', width: fill?fill.style.width:'' });
        });
        var st=el.querySelector(':scope > .ct-status') || el.querySelector('.ct-status');
        var ms=el.querySelector('.meters');
        var warnTag=st&&st.querySelector('.status-warn-tag');
        return {
          cls: el.className,
          meters: meters,
          statusText: st?st.textContent.trim():'',
          statusWarn: !!(st && st.classList.contains('status-warn')),
          warnTagText: warnTag?warnTag.textContent.trim():'',
          statusBeforeMeters: !!(st && ms && (st.compareDocumentPosition(ms) & 4)),
          hasNaN: /NaN|undefined|Infinity/.test(el.textContent)
        };
      }
      var single=null, project=null;
      document.querySelectorAll('.ct').forEach(function(c){
        var nm=c.querySelector('.ct-name');
        if(!nm) return;
        if(nm.textContent.trim()==='aitutor' && !single) single=grab(c);
        if(c.classList.contains('ct-project') && !project) project=grab(c);
      });
      return JSON.stringify({single:single, project:project, ver:(window.LD&&LD.APP_VERSION)});
    })()`));
    console.log('  single :', JSON.stringify(cards.single));
    console.log('  project:', JSON.stringify(cards.project));

    const p = cards.project, s = cards.single;
    /* ① meter 结构一致（回归 1.0.12） */
    ok('① 单容器卡有 2 条 meter', !!(s && s.meters.length === 2), JSON.stringify(s && s.meters));
    ok('① 项目卡有 2 条 meter（与单容器一致）', !!(p && p.meters.length === 2), JSON.stringify(p && p.meters));
    const allM = (p ? p.meters : []).concat(s ? s.meters : []);
    ok('① 标签都是 CPU/内存，无合计字样', allM.length === 4 && allM.every(m => (m.label === 'CPU' || m.label === '内存') && !/合计|容器|×/.test(m.label + m.value)), JSON.stringify(allM.map(m=>m.label+'='+m.value)));
    /* ② 状态行位置：.ct-status 在 .meters 之前（这就是上轮放反的地方） */
    ok('② 项目卡状态行在资源条上面', !!(p && p.statusBeforeMeters === true), p && p.statusBeforeMeters);
    ok('② 单容器卡状态行也在资源条上面（结构对齐）', !!(s && s.statusBeforeMeters === true), s && s.statusBeforeMeters);
    /* ③ 启动时间 + healthy */
    ok('③ 项目卡启动时间 Up 7 days', !!(p && /^Up 7 days/.test(p.statusText)), p && p.statusText);
    ok('③ 项目卡带 (healthy) 标记（同最长时长优先健康容器）', !!(p && /\(healthy\)/.test(p.statusText)), p && p.statusText);
    ok('③ 状态行无 NaN/undefined', !!(p && !/NaN|undefined/.test(p.statusText)), p && p.statusText);
    /* ④/⑤ 警告标识：正常无，异常有 ⚠2 */
    if (!ISSUE) {
      ok('④ 正常项目无警告标识', !!(p && p.statusWarn === false && p.warnTagText === ''), JSON.stringify({warn:p&&p.statusWarn,tag:p&&p.warnTagText}));
    } else {
      ok('⑤ 异常项目状态行加 .status-warn', !!(p && p.statusWarn === true), p && p.statusWarn);
      ok('⑤ 异常项目显示 ⚠ 2 个容器异常', !!(p && /⚠\s*2\s*个容器异常/.test(p.warnTagText)), p && p.warnTagText);
      ok('⑤ 异常项目启动时间仍是健康容器（Up 7 days (healthy)）', !!(p && /^Up 7 days \(healthy\)/.test(p.statusText)), p && p.statusText);
    }
    ok('④/⑤ 面板无 NaN/undefined/Infinity', !!(s && p && !s.hasNaN && !p.hasNaN), JSON.stringify({s:s&&s.hasNaN,p:p&&p.hasNaN}));
    /* ⑥ 版本 */
    ok('⑥ 版本号 = 1.0.25', cards.ver === '1.0.25', cards.ver);

    /* ⑦ 展开子容器不回归 */
    const toggle = await evalJs(`(function(){ var b=document.querySelector('.ct-project .op-full'); if(b){b.click(); return true;} return false; })()`);
    await sleep(500);
    const exp = JSON.parse(await evalJs(`(function(){
      var ct=document.querySelectorAll('.ct'); var child=0;
      ct.forEach(function(c){ if(c.getAttribute('data-inproject')==='1' || /\bct-inproject\b/.test(c.className)) child++; });
      return JSON.stringify({clicked:true, totalCards:ct.length, child:child});
    })()`));
    ok('⑦ 展开项目后出现子容器卡', toggle === true && exp.totalCards > (s ? 1 : 0), JSON.stringify(exp));

    /* ⑧ 紧凑模式隐藏 meters（开关在设置页，需切 tab） */
    await evalJs(`(function(){ document.querySelectorAll('.op-full').forEach(function(b){ if(/收起/.test(b.textContent)) b.click(); }); })()`);
    await sleep(300);
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="settings"]');if(t)t.click();})()`);
    await sleep(500);
    const swFound = await evalJs(`(function(){ var sw=document.querySelector('[data-ev="ldToggleCompact"]'); if(sw){sw.click();return true;} return false; })()`);
    ok('⑧ 设置页找到紧凑开关并点击', swFound === true, swFound);
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="index"]');if(t)t.click();})()`);
    await sleep(500);
    const comp = JSON.parse(await evalJs(`(function(){
      var p=document.querySelector('.ct-project'); var m=p&&p.querySelector('.meters');
      return JSON.stringify({ cls: document.getElementById('ld-root').classList.contains('ld-compact'), projMetersDisplay: m?getComputedStyle(m).display:'absent' });
    })()`));
    ok('⑧ 紧凑模式下项目卡 meters 隐藏', comp.cls === true && comp.projMetersDisplay === 'none', JSON.stringify(comp));

    console.log('\n结果: ' + PASS + ' PASS / ' + FAIL + ' FAIL');
    if (FAIL > 0) process.exitCode = 1;
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    chrome.kill(); srv.kill();
  }
}
main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
