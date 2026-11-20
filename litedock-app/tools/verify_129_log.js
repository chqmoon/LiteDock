'use strict';
/* Web 日志自动刷新专项验证（自包含 CDP，真实浏览器 + 真实定时器）：
   ① 打开日志弹窗：自动刷新按钮默认亮起，首帧日志正常渲染
   ② 5 秒后确实自动再拉一次，且内容更新
   ③ 点开关暂停后不再请求，再点恢复后继续请求
   ④ 关闭弹窗（按钮 / Escape）后定时器彻底停止
   ⑤ 静态断言：HTML 按钮、JS 定时器与清理逻辑齐备
   运行：node tools/verify_129_log.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const WORKSPACE = path.dirname(ROOT);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8897;
const CDP_PORT = 9352;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const r = await fetch(url); if (r.ok || r.status === 502) return true; } catch (e) {} await sleep(120); }
  return false;
}
async function main() {
  const srv = spawn('python', [path.join(__dirname, 'serve_web_preview.py'), String(PREVIEW_PORT)],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-129-log-' + Date.now(),
    '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let ws;
  try {
    if (!await waitPort(URL + 'index.html', 15000)) throw new Error('preview timeout');
    if (!await waitPort('http://127.0.0.1:' + CDP_PORT + '/json/version', 15000)) throw new Error('cdp timeout');
    const targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    await new Promise(r => ws.onopen = r);
    const send = (method, params) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const evalJs = async (expr) => {
      const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300));
      const r = m.result && m.result.result;
      return r ? r.value : undefined;
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: URL });
    await sleep(2600);

    console.log('=== Web 日志弹窗自动刷新专项 ===\n');

    /* ---------- ⑤ 静态断言 ---------- */
    const html = fs.readFileSync(path.join(WORKSPACE, 'litedock', 'app', 'web', 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(WORKSPACE, 'litedock', 'app', 'web', 'assets', 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(WORKSPACE, 'litedock', 'app', 'web', 'assets', 'app.css'), 'utf8');
    ok('⑤ HTML 含自动刷新按钮', /id="btnLogAuto"/.test(html) && /id="btnCloseModal"/.test(html));
    ok('⑤ JS 含 5 秒轮询 + clearInterval 清理', /setInterval\(function \(\)/.test(js) && /5000\)/.test(js) && /clearInterval\(logTimer\)/.test(js));
    ok('⑤ 关闭弹窗统一走 closeLogModal', /\$\("#btnCloseModal"\)\.addEventListener\("click", closeLogModal\)/.test(js));
    ok('⑤ CSS 有亮/灭两态', /\.icon-btn\.log-auto\.on\{/.test(css) && /\.icon-btn\.log-auto\{/.test(css));

    /* ---------- 注入 fetch 计数（只在测试页生效） ---------- */
    await evalJs(`(function(){
      window.__logReqs = 0;
      var _f = window.fetch;
      window.fetch = function(u, o) {
        if (typeof u === 'string' && u.indexOf('/logs') >= 0) {
          var n = ++window.__logReqs;
          return Promise.resolve(new Response(JSON.stringify({ok:true, text:'LOG LINE ' + n}),
            {status:200, headers:{'Content-Type':'application/json'}}));
        }
        return _f.apply(this, arguments);
      };
      return true;
    })()`);

    /* ---------- ① 打开弹窗 ---------- */
    await evalJs(`(function(){ var b=document.querySelector('.op[data-act="logs"]'); if(!b) return false; b.click(); return true; })()`);
    await sleep(500);
    const s1 = JSON.parse(await evalJs(`JSON.stringify({shown:document.getElementById('modalMask').classList.contains('show'),
      on:document.getElementById('btnLogAuto').classList.contains('on'),
      txt:document.getElementById('modalLog').textContent, n:window.__logReqs})`));
    ok('① 点击日志按钮弹出弹窗', s1.shown === true, JSON.stringify(s1));
    ok('① 自动刷新按钮默认亮起', s1.on === true, JSON.stringify(s1));
    ok('① 首帧日志已渲染且计数=1', s1.n === 1 && /LOG LINE 1/.test(s1.txt), JSON.stringify(s1));

    /* ---------- ② 自动刷新确实发生 ---------- */
    await sleep(5500);
    const s2 = JSON.parse(await evalJs(`JSON.stringify({txt:document.getElementById('modalLog').textContent, n:window.__logReqs})`));
    ok('② 5 秒后自动再拉一次', s2.n >= 2, JSON.stringify(s2));
    ok('② 弹窗内容随之更新', /LOG LINE 2/.test(s2.txt), JSON.stringify(s2));

    /* ---------- ③ 暂停 / 恢复 ---------- */
    await evalJs(`document.getElementById('btnLogAuto').click()`);
    await sleep(150);
    const p1 = JSON.parse(await evalJs(`JSON.stringify({on:document.getElementById('btnLogAuto').classList.contains('on'), n:window.__logReqs})`));
    ok('③ 暂停后按钮灭', p1.on === false, JSON.stringify(p1));
    await sleep(5500);
    const p2 = JSON.parse(await evalJs(`JSON.stringify({n:window.__logReqs})`));
    ok('③ 暂停期间无新请求', p2.n === p1.n, JSON.stringify({p1, p2}));
    await evalJs(`document.getElementById('btnLogAuto').click()`);
    await sleep(5500);
    const p3 = JSON.parse(await evalJs(`JSON.stringify({on:document.getElementById('btnLogAuto').classList.contains('on'), n:window.__logReqs})`));
    ok('③ 恢复后按钮亮且继续请求', p3.on === true && p3.n > p2.n, JSON.stringify({p2, p3}));

    /* ---------- ④ 关闭后彻底停止 ---------- */
    await evalJs(`document.getElementById('btnCloseModal').click()`);
    await sleep(150);
    const c1 = JSON.parse(await evalJs(`JSON.stringify({shown:document.getElementById('modalMask').classList.contains('show'), n:window.__logReqs})`));
    ok('④ 关闭按钮收起弹窗', c1.shown === false, JSON.stringify(c1));
    await sleep(5500);
    const c2 = JSON.parse(await evalJs(`JSON.stringify({n:window.__logReqs})`));
    ok('④ 关闭后定时器已停', c2.n === c1.n, JSON.stringify({c1, c2}));

    await evalJs(`(function(){ var b=document.querySelector('.op[data-act="logs"]'); if(b) b.click(); })()`);
    await sleep(300);
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(150);
    const e1 = JSON.parse(await evalJs(`JSON.stringify({shown:document.getElementById('modalMask').classList.contains('show'), n:window.__logReqs})`));
    ok('④ Escape 也能关闭弹窗', e1.shown === false, JSON.stringify(e1));
    await sleep(5500);
    const e2 = JSON.parse(await evalJs(`JSON.stringify({n:window.__logReqs})`));
    ok('④ Escape 关闭后同样不再请求', e2.n === e1.n, JSON.stringify({e1, e2}));
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    srv.kill(); chrome.kill();
  }
  console.log('\n=== Web 日志自动刷新 PASS=' + PASS + ' FAIL=' + FAIL + ' ===');
  return FAIL ? 1 : 0;
}
main().catch(e => { console.error(e); process.exit(1); });
