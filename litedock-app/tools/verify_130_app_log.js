'use strict';
/* APP 日志自动刷新专项验证（真实浏览器 + 真实定时器 + mock 插件计数）：
   ① 进详情页首帧即静默加载日志，自动按钮默认亮起
   ② 5 秒后确实自动再拉一次
   ③ 点开关暂停后不再请求，再点恢复后继续
   ④ 手动「刷新」按钮仍在且可用
   ⑤ 切回首页后旧定时器不再打接口（实例切换 + DOM 判据）
   ⑥ 静态：源 / 生成物 / 版本 1.0.26
   运行：node tools/verify_130_app_log.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8898;
const CDP_PORT = 9353;
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
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env: Object.assign({}, process.env, { LD_PORT: String(PREVIEW_PORT) }) });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-130-app-log-' + Date.now(),
    '--window-size=430,900', 'about:blank'
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
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2800);

    console.log('=== APP 日志弹窗自动刷新专项 ===\n');

    /* ---------- ⑥ 静态断言 ---------- */
    const srcJs = fs.readFileSync(path.join(ROOT, '..', 'litedock-miniprogram', 'pages', 'detail', 'detail.js'), 'utf8');
    const srcXml = fs.readFileSync(path.join(ROOT, '..', 'litedock-miniprogram', 'pages', 'detail', 'detail.wxml'), 'utf8');
    const bundle = fs.readFileSync(path.join(ROOT, 'www', 'js', 'bundle.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'www', 'css', 'litedock.css'), 'utf8');
    const tpl = fs.readFileSync(path.join(ROOT, 'www', 'js', 'templates.js'), 'utf8');
    const shim = fs.readFileSync(path.join(ROOT, 'www', 'js', 'wx-shim.js'), 'utf8');
    ok('⑥ 源 detail.js 含定时器 + 双判据 + 静默刷新',
       /_tickLogAuto/.test(srcJs) && /refreshLogsQuiet/.test(srcJs) && /document\.querySelector\('\.detail-page'\)/.test(srcJs) && /LD\.pageInstance/.test(srcJs));
    ok('⑥ 源 wxml 含自动/手动按钮', /toggleLogAuto/.test(srcXml) && /log-ops/.test(srcXml));
    ok('⑥ 生成物 bundle 含完整逻辑', /_tickLogAuto/.test(bundle) && /logAuto: true/.test(bundle) && /refreshLogsQuiet/.test(bundle));
    ok('⑥ 生成物 CSS 含 log-ops 且 rpx 已转', /\.log-ops/.test(css) && !/\d+rpx/.test(css));
    ok('⑥ APP 模板含 toggleLogAuto 按钮', /data-ev="toggleLogAuto"/.test(tpl));
    ok('⑥ APP 版本 = 1.0.26', /LD\.APP_VERSION = '1\.0\.26'/.test(shim));

    /* ---------- mock 插件包一层计数 ---------- */
    await evalJs(`(function(){
      var H = window.Capacitor.Plugins.LiteDockHttp;
      var orig = H.request;
      window.__logReqs = 0;
      H.request = function(o) {
        var u = String(o.url || '');
        if (u.indexOf('/logs') >= 0) {
          var n = ++window.__logReqs;
          return Promise.resolve({status:200, data: JSON.stringify({ok:true, text:'APP LOG LINE ' + n})});
        }
        return orig(o);
      };
      return true;
    })()`);

    /* ---------- ① 进入详情页 ---------- */
    const entered = await evalJs(`(function(){
      var c = document.querySelector('.ct[data-ev="openDetail"]');
      if (!c) return false; c.click(); return true;
    })()`);
    ok('① 首页存在可点开的容器卡', entered === true);
    await sleep(600);
    const s1 = JSON.parse(await evalJs(`JSON.stringify({
      detail: !!document.querySelector('.detail-page'),
      on: !!(document.querySelector('.log-ops .btn.on')),
      btns: [].slice.call(document.querySelectorAll('.log-ops .btn')).map(function(b){return b.textContent.trim();}),
      txt: (document.querySelector('.log-text')||{}).textContent || '', n: window.__logReqs})`));
    ok('① 详情页已渲染', s1.detail === true, JSON.stringify(s1));
    ok('① 首帧日志已静默加载', s1.n >= 1 && /APP LOG LINE/.test(s1.txt), JSON.stringify(s1));
    ok('① 自动按钮默认亮起且两按钮齐全', s1.on === true && s1.btns.join(',') === '自动,刷新', JSON.stringify(s1.btns));

    /* ---------- ② 自动刷新 ---------- */
    await sleep(5500);
    const s2 = JSON.parse(await evalJs(`JSON.stringify({txt:(document.querySelector('.log-text')||{}).textContent||'', n:window.__logReqs})`));
    ok('② 5 秒后自动再拉一次且内容更新', s2.n >= 2 && /APP LOG LINE 2/.test(s2.txt), JSON.stringify(s2));

    /* ---------- ③ 暂停 / 恢复 ---------- */
    await evalJs(`document.querySelector('.log-ops [data-ev="toggleLogAuto"]').click()`);
    await sleep(250);
    const p1 = JSON.parse(await evalJs(`JSON.stringify({on:!!document.querySelector('.log-ops .btn.on'), label:(document.querySelector('.log-ops [data-ev="toggleLogAuto"]')||{}).textContent, n:window.__logReqs})`));
    ok('③ 暂停后按钮灭且文案变「手动」', p1.on === false && /手动/.test(p1.label || ''), JSON.stringify(p1));
    await sleep(5500);
    const p2 = JSON.parse(await evalJs(`JSON.stringify({n:window.__logReqs})`));
    ok('③ 暂停期间无新请求', p2.n === p1.n, JSON.stringify({p1, p2}));
    await evalJs(`document.querySelector('.log-ops [data-ev="toggleLogAuto"]').click()`);
    await sleep(5500);
    const p3 = JSON.parse(await evalJs(`JSON.stringify({on:!!document.querySelector('.log-ops .btn.on'), n:window.__logReqs})`));
    ok('③ 恢复后继续请求', p3.on === true && p3.n > p2.n, JSON.stringify({p2, p3}));

    /* ---------- ④ 手动刷新按钮仍在 ---------- */
    const beforeManual = await evalJs(`window.__logReqs`);
    await evalJs(`document.querySelector('.log-ops [data-ev="loadLogs"]').click()`);
    await sleep(300);
    const afterManual = await evalJs(`window.__logReqs`);
    ok('④ 手动「刷新」仍可用', afterManual === beforeManual + 1, beforeManual + ' -> ' + afterManual);

    /* ---------- ⑤ 切回首页后定时器停止 ---------- */
    await evalJs(`LD.switchTab('/pages/index/index')`);
    await sleep(300);
    const g1 = JSON.parse(await evalJs(`JSON.stringify({detail:!!document.querySelector('.detail-page'), n:window.__logReqs})`));
    ok('⑤ 已切回首页', g1.detail === false, JSON.stringify(g1));
    await sleep(5500);
    const g2 = JSON.parse(await evalJs(`JSON.stringify({n:window.__logReqs})`));
    ok('⑤ 离开详情页后不再打接口', g2.n === g1.n, JSON.stringify({g1, g2}));
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    srv.kill(); chrome.kill();
  }
  console.log('\n=== APP 日志自动刷新 PASS=' + PASS + ' FAIL=' + FAIL + ' ===');
  return FAIL ? 1 : 0;
}
main().catch(e => { console.error(e); process.exit(1); });
