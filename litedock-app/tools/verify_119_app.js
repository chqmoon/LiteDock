'use strict';
/* APP 1.0.26 自我保护专项验证（自包含 CDP，真实 DOM 渲染 + 真实点击）：
   fixture=state_self.json（litedock 容器 isSelf=true）
   ① APP 卡片：litedock 显示「◆ 本体」徽标 + "本体受保护"，无 停止/重启 按钮，保留 详情
   ② APP 卡片：其它容器（aitutor）仍有正常操作按钮，无本体徽标
   ③ APP 详情页：进入 litedock 详情，有受保护提示，无 停止/重启/暂停/升级重建，保留 检查更新/日志
   ④ APP 详情页：其它容器详情仍有完整操作
   ⑤ APP 版本 = 1.0.26
   运行：node tools/verify_119_app.js */
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8894;
const CDP_PORT = 9349;
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
  const env = Object.assign({}, process.env, {
    LD_PORT: String(PREVIEW_PORT),
    LD_FIXTURE: path.join(__dirname, 'fixtures', 'state_self.json')
  });
  if (process.env.LD_WWW && process.env.LD_WWW !== '1') env.LD_WWW = process.env.LD_WWW;
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-119-app-' + Date.now(),
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
    const closeModal = async () => { await evalJs(`(function(){var b=document.querySelector('.ld-modal-ok');if(b)b.click();return 1;})()`); await sleep(250); };
    const goBack = async () => { await evalJs(`(function(){var b=document.querySelector('ld-nav-back,#ld-nav-back,.ld-nav-back,[class*="nav-back"]');if(b)b.click();return 1;})()`); await sleep(650); };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2800);

    console.log('=== APP 1.0.26 自我保护：本体卡片 + 详情禁用 ===');

    const ver = await evalJs(`(function(){return (window.LD&&LD.APP_VERSION)||'';})()`);
    ok('⑤ APP 版本 = 1.0.26', ver === '1.0.26', String(ver));

    /* ---------- ① 卡片层 ---------- */
    const cards = JSON.parse(await evalJs(`(function(){
      var list=[].slice.call(document.querySelectorAll('.ct[data-ev="openDetail"]'));
      var self=list.find(function(c){var n=c.querySelector('.ct-name');return n&&n.textContent.trim()==='litedock';});
      var other=list.find(function(c){var n=c.querySelector('.ct-name');return n&&n.textContent.trim()==='aitutor';});
      function info(c){
        if(!c) return {found:false};
        return {found:true,
          selfFlag:!!c.querySelector('.self-flag'),
          selfTip:!!c.querySelector('.self-tip'),
          acts:[].slice.call(c.querySelectorAll('[data-ev="doAction"]')).map(function(b){return b.getAttribute('data-act');}),
          hasDetail:!!c.querySelector('[data-ev="openDetail"]')};
      }
      return JSON.stringify({self:info(self), other:info(other), total:list.length});
    })()`) || '{}');
    ok('① 找到 litedock 本体卡片', cards.self && cards.self.found === true, JSON.stringify(cards).slice(0, 240));
    ok('① 本体卡片显示「◆ 本体」徽标 + "本体受保护"',
       cards.self && cards.self.selfFlag === true && cards.self.selfTip === true, JSON.stringify(cards.self));
    ok('① 本体卡片无 doAction 危险操作（停止/重启）',
       cards.self && (cards.self.acts || []).length === 0, JSON.stringify(cards.self));
    ok('③ 其它容器卡片未被误伤（有 stop/restart doAction）',
       cards.other && cards.other.found === true && cards.other.acts.indexOf('stop') >= 0 && cards.other.acts.indexOf('restart') >= 0,
       JSON.stringify(cards.other));
    ok('③ 其它容器不显示本体徽标', cards.other && cards.other.selfFlag === false, JSON.stringify(cards.other));

    /* ---------- ② 详情页：litedock ---------- */
    const opened = await evalJs(`(function(){
      var list=[].slice.call(document.querySelectorAll('.ct[data-ev="openDetail"]'));
      var self=list.find(function(c){var n=c.querySelector('.ct-name');return n&&n.textContent.trim()==='litedock';});
      if(!self) return 'not-found';
      var detailBtn=self.querySelector('[data-ev="openDetail"]');
      if(detailBtn) detailBtn.click(); else self.click();
      return 'ok';
    })()`);
    ok('② 进入 litedock 详情页', opened === 'ok', String(opened));
    await sleep(900);

    const detail = JSON.parse(await evalJs(`(function(){
      var page=document.querySelector('.detail-page');
      if(!page) return JSON.stringify({found:false});
      var txt=page.textContent||'';
      var acts=[].slice.call(page.querySelectorAll('[data-ev="doAction"]')).map(function(b){return b.getAttribute('data-act');});
      return JSON.stringify({found:true,
        selfFlag:!!page.querySelector('.self-flag'),
        protected:/受保护|已禁用|管理界面中断/.test(txt),
        acts:acts,
        hasCheck:!!page.querySelector('[data-ev="checkUpdate"]'),
        hasUpgrade:!!page.querySelector('[data-ev="doUpgrade"]'),
        hasLog:!!page.querySelector('[data-ev="loadLogs"]')});
    })()`) || '{}');
    ok('② litedock 详情显示本体徽标 + 受保护提示',
       detail.found === true && detail.selfFlag === true && detail.protected === true, JSON.stringify(detail));
    ok('② litedock 详情无 stop/restart/pause/start 操作',
       (detail.acts || []).length === 0, JSON.stringify(detail.acts));
    ok('② litedock 详情保留 检查更新 + 日志（只读）',
       detail.hasCheck === true && detail.hasLog === true, JSON.stringify(detail));
    ok('② litedock 详情无 升级重建 按钮', detail.hasUpgrade === false, JSON.stringify(detail));

    /* ---------- ③ 详情页：其它容器不回归 ---------- */
    await goBack();
    const openedOther = await evalJs(`(function(){
      var list=[].slice.call(document.querySelectorAll('.ct[data-ev="openDetail"]'));
      var other=list.find(function(c){var n=c.querySelector('.ct-name');return n&&n.textContent.trim()==='aitutor';});
      if(!other) return 'not-found';
      var b=other.querySelector('[data-ev="openDetail"]'); if(b)b.click(); else other.click();
      return 'ok';
    })()`);
    ok('③ 进入 aitutor 详情页', openedOther === 'ok', String(openedOther));
    await sleep(900);
    const otherDetail = JSON.parse(await evalJs(`(function(){
      var page=document.querySelector('.detail-page');
      if(!page) return JSON.stringify({found:false});
      var acts=[].slice.call(page.querySelectorAll('[data-ev="doAction"]')).map(function(b){return b.getAttribute('data-act');});
      return JSON.stringify({found:true, acts:acts,
        hasUpgrade:!!page.querySelector('[data-ev="doUpgrade"]'), selfFlag:!!page.querySelector('.self-flag')});
    })()`) || '{}');
    ok('③ 其它容器详情仍有 stop/restart 与升级重建（无回归）',
       otherDetail.found === true && (otherDetail.acts || []).indexOf('stop') >= 0 &&
       otherDetail.hasUpgrade === true && otherDetail.selfFlag === false, JSON.stringify(otherDetail));

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
