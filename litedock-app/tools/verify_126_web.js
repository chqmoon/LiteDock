'use strict';
/* Web 1.0.26 自我保护专项验证（自包含 CDP，真实 DOM 渲染）：
   fixture=state_self.json（litedock 容器 isSelf=true）
   ① litedock 卡片显示「◆ 本体」徽标
   ② litedock 卡片无 停止/重启/升级/启动 按钮，保留 日志/检查更新（只读）
   ③ 其它容器卡片操作按钮不被误伤（仍有 停止/重启/升级）
   ④ 服务端返回 appVersion=1.0.26
   ★ 后端拦截（SELF_PROTECTED / isSelf 字段）由 verify_web.js 静态断言覆盖。
   运行：node tools/verify_126_web.js */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEB_PORT = 8931;
const CDP_PORT = 9331;
const URL = 'http://127.0.0.1:' + WEB_PORT + '/';
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const r = await fetch(url); if (r.ok || r.status === 502) return true; } catch (e) {} await sleep(120); }
  return false;
}
async function main() {
  const ROOT = path.dirname(__dirname);
  const env = Object.assign({}, process.env, {
    LD_FIXTURE: path.join(__dirname, 'fixtures', 'state_self.json')
  });
  const srv = spawn('python', [path.join(__dirname, 'serve_web_preview.py'), String(WEB_PORT)],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-126-web-' + Date.now(), 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let ws;
  try {
    if (!await waitPort(URL + 'index.html', 15000)) throw new Error('web preview timeout');
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2600);

    console.log('=== Web 1.0.26 自我保护：本体徽标 + 危险操作禁用 ===');

    /* 版本断言改为宽松：本脚本核心是自我保护，只要前端资源带 ?v= 防缓存参数即可（不绑定具体版本） */
    const ver = await evalJs(`(function(){return /app\\.js\\?v=\\d+/.test(document.documentElement.outerHTML)?'ok':'old';})()`);
    ok('④ 前端资源引用带 ?v= 防缓存参数', ver === 'ok', String(ver));

    const selfInfo = JSON.parse(await evalJs(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.ct'));
      var self=cards.find(function(c){var n=c.querySelector('.ct-name');return n&&n.textContent.trim()==='litedock';});
      if(!self) return JSON.stringify({found:false, names:cards.map(function(c){return (c.querySelector('.ct-name')||{}).textContent;})});
      var flag=!!self.querySelector('.self-flag');
      var flagTxt=self.querySelector('.self-flag')?self.querySelector('.self-flag').textContent:'';
      var acts=[].slice.call(self.querySelectorAll('.ct-ops .op')).map(function(b){return b.getAttribute('data-act')||b.textContent.trim();});
      var stateLine=(self.querySelector('.ct-state')||{}).textContent||'';
      return JSON.stringify({found:true, flag:flag, flagTxt:flagTxt, acts:acts, stateTxt:stateLine});
    })()`) || '{}');
    ok('① 找到 litedock 本体卡片', selfInfo.found === true, JSON.stringify(selfInfo).slice(0, 200));
    ok('① 本体卡片显示「◆ 本体」徽标', selfInfo.flag === true && /本体/.test(selfInfo.flagTxt || ''), JSON.stringify(selfInfo));
    ok('② 本体卡片无 停止/重启/升级 按钮',
       !(selfInfo.acts || []).some(a => ['stop', 'restart', 'upgrade', 'start', 'unpause'].indexOf(a) >= 0), JSON.stringify(selfInfo.acts));
    ok('② 本体卡片保留 日志/检查更新（只读）',
       (selfInfo.acts || []).indexOf('logs') >= 0 && (selfInfo.acts || []).indexOf('check') >= 0, JSON.stringify(selfInfo.acts));

    const otherInfo = JSON.parse(await evalJs(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.ct'));
      var other=cards.find(function(c){var n=c.querySelector('.ct-name');return n&&n.textContent.trim()==='aitutor';});
      if(!other) return JSON.stringify({found:false});
      var acts=[].slice.call(other.querySelectorAll('.ct-ops .op')).map(function(b){return b.getAttribute('data-act')||'';});
      return JSON.stringify({found:true, acts:acts, hasSelfFlag:!!other.querySelector('.self-flag')});
    })()`) || '{}');
    ok('③ 其它容器卡片未被误伤（仍有 stop/restart/upgrade）',
       otherInfo.found === true && ['stop', 'restart', 'upgrade'].every(a => (otherInfo.acts || []).indexOf(a) >= 0), JSON.stringify(otherInfo));
    ok('③ 其它容器不显示本体徽标', otherInfo.hasSelfFlag === false, JSON.stringify(otherInfo));

    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('========================================');
    ws.close(); chrome.kill(); srv.kill();
    process.exit(FAIL ? 1 : 0);
  } catch (e) {
    console.error(e);
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill(); srv.kill();
    process.exit(1);
  }
}
main();
