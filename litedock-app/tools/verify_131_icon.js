'use strict';
/* Web 自定义图标铺满专项验证（自包含 CDP，真实浏览器 + getComputedStyle）：
   ① 静态：app.js 给自定义图标加 icon-custom class；CSS 规则 object-fit:cover;padding:0
   ② 动态：注入 fixture 给容器 a 绑定自定义图标 → 渲染出 img.icon-custom，object-fit=cover、padding=0
   ③ 未绑定的内置图标仍走 contain，不被裁切
   ④ 静态基线：内置图标 id 的 img 无 icon-custom class
   运行：node tools/verify_131_icon.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const WORKSPACE = path.dirname(ROOT);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8898;
const CDP_PORT = 9353;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const FIXTURE = path.join(__dirname, 'fixtures', '_tmp_icon_fixture.json');
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
  const iconUrl = '/assets/icons/litedock.png';
  base.config = base.config || {};
  base.config.icons = {}; base.config.icons[name] = iconUrl;
  fs.writeFileSync(FIXTURE, JSON.stringify(base));
  return { name, iconUrl };
}
async function main() {
  const { name, iconUrl } = makeFixture();
  const srv = spawn('python', [path.join(__dirname, 'serve_web_preview.py'), String(PREVIEW_PORT)],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env: Object.assign({}, process.env, { LD_FIXTURE: FIXTURE }) });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-131-icon-' + Date.now(),
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
    await sleep(2800);

    console.log('=== Web 自定义图标铺满专项 ===\n');

    /* ---------- ① 静态断言 ---------- */
    const js = fs.readFileSync(path.join(WORKSPACE, 'litedock', 'app', 'web', 'assets', 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(WORKSPACE, 'litedock', 'app', 'web', 'assets', 'app.css'), 'utf8');
    ok('① app.js 自定义图标带 icon-custom class',
       /class="icon-custom"/.test(js) && /if \(custom\) return/.test(js));
    ok('① CSS 自定义图标 cover + padding:0',
       /\.ct-icon img\.icon-custom\{object-fit:cover;padding:0\}/.test(css));
    ok('① CSS 内置图标仍 contain + padding:3px',
       /\.ct-icon img\{width:100%;height:100%;object-fit:contain;padding:3px\}/.test(css));

    /* ---------- ② 自定义图标计算样式 ---------- */
    const custom = JSON.parse(await evalJs(`(function(){
      var img = document.querySelector('.ct-icon img.icon-custom');
      if (!img) return JSON.stringify({found:false});
      var s = getComputedStyle(img);
      return JSON.stringify({found:true, src:img.getAttribute('src'), fit:s.objectFit, pad:s.padding, w:s.width, h:s.height});
    })()`));
    ok('② 渲染出自定义图标 img.icon-custom', custom.found, JSON.stringify(custom));
    ok('② 自定义图标 src 指向绑定图标', custom.src === iconUrl, String(custom.src));
    ok('② 自定义图标 object-fit=cover', custom.fit === 'cover', String(custom.fit));
    ok('② 自定义图标 padding=0', /^0px?(\s|$)/.test(custom.pad || ''), String(custom.pad));

    /* ---------- ③ 内置图标不受影响 ---------- */
    const builtin = JSON.parse(await evalJs(`(function(){
      var imgs = [].slice.call(document.querySelectorAll('.ct-icon img')).filter(function(x){return !x.classList.contains('icon-custom');});
      if (!imgs.length) return JSON.stringify({found:false});
      var s = getComputedStyle(imgs[0]);
      return JSON.stringify({found:true, count:imgs.length, fit:s.objectFit, pad:s.padding});
    })()`));
    ok('③ 内置图标仍存在且走 contain', builtin.found && builtin.fit === 'contain', JSON.stringify(builtin));
    ok('③ 内置图标保留 padding（不被裁切）', builtin.found && /3px/.test(builtin.pad || ''), JSON.stringify(builtin));

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
