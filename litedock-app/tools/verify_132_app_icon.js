'use strict';
/* APP 1.0.25 自定义图标铺满专项验证（自包含 CDP，真实 DOM + getComputedStyle）：
   ① 静态：bundle 含 iconIsCustom；templates 三处 img 条件加 icon-custom；shell.css cover 规则
   ② 注入 fixture 给 aitutor 绑定自定义图标 → 卡片渲染 img.ct-icon-img.icon-custom，object-fit=cover
   ③ 未绑定自定义的内置图标仍 contain，无 icon-custom class
   ④ APP 版本 = 1.0.25
   ⑤ APK 解包回放可用：LD_WWW 指向解包目录时同样通过
   运行：node tools/verify_132_app_icon.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8899;
const CDP_PORT = 9354;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const FIXTURE = path.join(__dirname, 'fixtures', '_tmp_app_icon_fixture.json');
const ICON = 'assets/logo.png';
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const r = await fetch(url); if (r.ok || r.status === 502) return true; } catch (e) {} await sleep(120); }
  return false;
}
function makeFixture() {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'state.json'), 'utf8'));
  const name = base.containers[0].name;
  base.config = base.config || {};
  base.config.icons = {}; base.config.icons[name] = ICON;
  fs.writeFileSync(FIXTURE, JSON.stringify(base));
  return name;
}
async function main() {
  const boundName = makeFixture();
  const env = Object.assign({}, process.env, { LD_PORT: String(PREVIEW_PORT), LD_FIXTURE: FIXTURE });
  if (process.env.LD_WWW && process.env.LD_WWW !== '1') env.LD_WWW = process.env.LD_WWW;
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-132-app-icon-' + Date.now(),
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

    console.log('=== APP 1.0.25 自定义图标铺满专项 ===\n');

    /* ---------- ① 静态断言 ---------- */
    const bundle = fs.readFileSync(path.join(ROOT, 'www', 'js', 'bundle.js'), 'utf8');
    const tpl = fs.readFileSync(path.join(ROOT, 'www', 'js', 'templates.js'), 'utf8');
    const shell = fs.readFileSync(path.join(ROOT, 'www', 'css', 'shell.css'), 'utf8');
    const shim = fs.readFileSync(path.join(ROOT, 'www', 'js', 'wx-shim.js'), 'utf8');
    ok('① bundle 含 iconIsCustom 标志', /iconIsCustom/.test(bundle));
    ok('① templates 三处 img 条件加 icon-custom', (tpl.match(/iconIsCustom \? ' icon-custom'/g) || []).length >= 3);
    ok('① shell.css 自定义图标 cover', /\.ct-icon-img\.icon-custom \{ object-fit: cover; \}/.test(shell));
    ok('④ APP 版本 = 1.0.25', /LD\.APP_VERSION = '1\.0\.25'/.test(shim));

    /* ---------- ② 自定义图标计算样式 ---------- */
    const custom = JSON.parse(await evalJs(`(function(){
      var img = document.querySelector('.ct-icon-img.icon-custom');
      if (!img) return JSON.stringify({found:false});
      var s = getComputedStyle(img);
      return JSON.stringify({found:true, src:img.getAttribute('src'), fit:s.objectFit});
    })()`));
    ok('② 渲染出自定义图标 img.icon-custom', custom.found, JSON.stringify(custom));
    ok('② 自定义图标 object-fit=cover', custom.fit === 'cover', String(custom.fit));

    /* ---------- ③ 内置图标不受影响 ---------- */
    const builtin = JSON.parse(await evalJs(`(function(){
      var imgs = [].slice.call(document.querySelectorAll('.ct-icon-img')).filter(function(x){return !x.classList.contains('icon-custom');});
      if (!imgs.length) return JSON.stringify({found:false});
      var s = getComputedStyle(imgs[0]);
      return JSON.stringify({found:true, count:imgs.length, fit:s.objectFit});
    })()`));
    ok('③ 内置图标存在且保持 contain', builtin.found && builtin.fit === 'contain', JSON.stringify(builtin));

    console.log('\n结果: PASS=' + PASS + '  FAIL=' + FAIL);
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { if (fs.existsSync(FIXTURE)) fs.unlinkSync(FIXTURE); } catch (e) {}
  }
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
