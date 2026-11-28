'use strict';
/* APP 1.0.15 真实浏览器验证（自包含，CDP 真实渲染 + 真实点击）：
   ① 项目卡有启动/停止/重启三个 data-ev=projectAction 按钮
   ② 真实点击「启动」→ 弹出确认框 → 确认 → 调用项目批量 API（mock 记录请求）
   ③ 设置页有「升级备份」卡片；注入一个假备份后能渲染出「回退/删除」按钮
   ④ 真实点击「回退」→ 确认框 → 调用 backup rollback API（mock 记录）
   ⑤ 既有功能不回归：项目卡状态行/资源条、紧凑模式、版本号 1.0.15
   LD_WWW=1 时回放 APK 解包前端（若外部传入 LD_WWW 路径）。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8887;
const CDP_PORT = 9343;
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
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')], { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-115-app-' + Date.now(),
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

    console.log('=== APP 1.0.15 项目批量 + 备份管理 真实浏览器验证 ===');

    // ① 项目卡批量按钮
    const pc = JSON.parse(await evalJs(`(function(){
      var p=document.querySelector('.ct-project');
      if(!p) return JSON.stringify({found:false});
      var bs=[].slice.call(p.querySelectorAll('[data-ev="projectAction"]')).map(function(b){return {act:b.getAttribute('data-act'),proj:b.getAttribute('data-proj'),txt:b.textContent.trim()};});
      var st=p.querySelector('.ct-status'), meters=p.querySelector('.meters');
      return JSON.stringify({found:true, btns:bs, statusBeforeMeters:!!(st&&meters&&(st.compareDocumentPosition(meters)&4))});
    })()`) || '{}');
    ok('项目卡能找到', pc.found === true, JSON.stringify(pc));
    ok('① 项目卡有启动/停止/重启三个批量按钮',
       pc.btns && pc.btns.length === 3 && pc.btns.map(b => b.act).sort().join(',') === 'restart,start,stop' &&
       pc.btns.every(b => b.proj && b.proj.length > 0), JSON.stringify(pc.btns));
    ok('⑤ 项目卡状态行在资源条上方（不回归）', pc.statusBeforeMeters === true, JSON.stringify(pc));

    // ② 真实点击「启动」→ 确认框 → 确认 → 调 API
    await evalJs(`(function(){
      window.__apiCalls = [];
      /* APP 的 HTTP 走 Capacitor 原生插件，不是 window.fetch；拦截 LiteDockHttp.request */
      var plug = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LiteDockHttp;
      if (plug) { var orig = plug.request; plug.request = function(o){ window.__apiCalls.push({url:String(o&&o.url||''), method:o&&o.method}); return orig.apply(this, arguments); }; }
      var b=document.querySelector('.ct-project [data-ev="projectAction"][data-act="start"]');
      if(b) b.click(); return true;
    })()`);
    await sleep(400);
    const modal = await evalJs(`(function(){
      var box=document.getElementById('__wxmodal')||document.querySelector('.wx-modal-mask,.modal-mask');
      return box ? box.textContent.replace(/\\s+/g,' ').trim().slice(0,80) : (document.body.textContent.indexOf('确认启动项目')>=0?'确认启动项目':'');
    })()`);
    ok('② 点击启动弹出确认框', /确认启动项目/.test(modal || ''), modal);
    // 点确认
    const confirmed = await evalJs(`(function(){
      var ok=document.querySelector('.ld-modal-ok');
      if(ok){ok.click();return 'clicked:'+ok.textContent.trim();} return 'no-ok';
    })()`);
    await sleep(700);
    const calls = JSON.parse(await evalJs(`JSON.stringify(window.__apiCalls||[])`) || '[]');
    ok('② 确认后调用项目批量 API', calls.some(c => /\/api\/project\//.test(c.url) && /\/start/.test(c.url)), JSON.stringify(calls));

    // ③④ 设置页备份管理：注入假备份 → 进设置页 → 渲染 → 点击回退
    await evalJs(`(function(){ window.__ldBackups = [{id:'fake1',shortId:'abcd1234',base:'demo-app',kind:'backup',image:'demo:1.0',state:'exited',status:'Exited',project:'demo',created:1}]; return true; })()`);
    // 进设置页：点 tabBar 的「设置」
    await evalJs(`(function(){
      var tabs=[].slice.call(document.querySelectorAll('.ld-tab'));
      var s=tabs.find(function(t){return /设置/.test(t.textContent);});
      if(s){s.click();return 'clicked-set';} return 'no-set-tab';
    })()`);
    await sleep(900);
    const bk = JSON.parse(await evalJs(`(function(){
      var page=document.getElementById('ld-page')||document.body;
      var has=page.textContent.indexOf('升级备份')>=0;
      var rb=page.querySelector('[data-ev="backupRollback"]');
      var del=page.querySelector('[data-ev="backupDelete"]');
      var nameEl=page.querySelector('.bk-name');
      return JSON.stringify({has:has, hasRollback:!!rb, hasDelete:!!del, name:nameEl?nameEl.textContent.trim():'',
        base:(rb&&rb.getAttribute('data-base'))||''});
    })()`) || '{}');
    ok('③ 设置页有「升级备份」卡片', bk.has === true, JSON.stringify(bk));
    ok('③ 假备份渲染出回退/删除按钮', bk.hasRollback === true && bk.hasDelete === true, JSON.stringify(bk));
    ok('③ 显示备份原容器名 demo-app', /demo-app/.test(bk.name || '') && bk.base === 'demo-app', JSON.stringify(bk));

    // ④ 真实点击回退 → 确认 → 调 API
    await evalJs(`(function(){
      var b=document.querySelector('[data-ev="backupRollback"]'); if(b) b.click(); return true;
    })()`);
    await sleep(400);
    const rConfirmed = await evalJs(`(function(){
      var ok=document.querySelector('.ld-modal-ok');
      if(ok){ok.click();return 'clicked';} return 'no-ok';
    })()`);
    await sleep(700);
    const calls2 = JSON.parse(await evalJs(`JSON.stringify(window.__apiCalls||[])`) || '[]');
    ok('④ 确认后调用备份回退 API', calls2.some(c => /\/api\/backup\/fake1\/rollback/.test(c.url)), JSON.stringify(calls2));

    // ⑤ 版本号
    const ver = await evalJs(`(function(){return (window.LD&&LD.APP_VERSION)||'';})()`);
    ok('⑤ APP 版本 1.0.26', ver === '1.0.26', ver);

    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('========================================');
  } catch (e) {
    console.error('ERROR:', e.message);
    FAIL++;
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
  process.exit(FAIL ? 1 : 0);
}
main();
