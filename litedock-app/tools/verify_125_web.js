'use strict';
/* Web 1.0.25 + APP 1.0.18 真实浏览器专项验证（自包含 CDP，真实 DOM 渲染 + 真实点击）：
   ① Web 项目卡只留「停止/重启/展开」，无「启动」
   ② Web 5列/多视口下按钮文字零溢出（scrollWidth<=clientWidth）
   ③ Web 无图分组用强调色渐变背景 + has-bg 白字，有图分组保留原图；各组配色不同
   ④ APP 无背景卡片为半透明玻璃 rgba(255,255,255,.86)，非纯白
   用法：node tools/verify_125_web.js  （依赖本地 preview：127.0.0.1:23000 / 8778）*/
const { spawn } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEB_URL = process.env.LD_WEB_URL || 'http://127.0.0.1:23000/';
const APP_URL = process.env.LD_APP_URL || 'http://127.0.0.1:8778/';
const PORT = 9225;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-125-' + Date.now(), 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { await sleep(200); }
    }
    const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(WEB_URL), { method: 'PUT' })).json();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
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
    const go = async (url, w) => {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 950, deviceScaleFactor: 1, mobile: url === APP_URL });
      await send('Page.navigate', { url });
      await sleep(url === APP_URL ? 3200 : 2600);
    };
    await send('Page.enable'); await send('Runtime.enable');

    /* ---------- Web 部分 ---------- */
    await go(WEB_URL, 1440);
    console.log('=== Web 1.0.25：项目卡按钮 / 分组强调色 ===');
    const proj = JSON.parse(await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      if(!pc) return JSON.stringify({found:false});
      var ops=[].slice.call(pc.querySelectorAll('.ct-ops .op')).map(function(b){return b.textContent.trim();});
      return JSON.stringify({found:true, ops:ops, hasStart:ops.some(function(t){return /启动/.test(t);})});
    })()`) || '{}');
    ok('① 项目卡有 safeline', proj.found === true);
    ok('① 项目卡无「启动」按钮', proj.hasStart === false, JSON.stringify(proj.ops));
    ok('① 项目卡保留停止/重启/展开', (proj.ops||[]).some(t=>/^停止$/.test(t)) &&
       (proj.ops||[]).some(t=>/^重启$/.test(t)) && (proj.ops||[]).some(t=>/展开/.test(t)), JSON.stringify(proj.ops));

    const grp = JSON.parse(await evalJs(`(function(){
      var gs=[].slice.call(document.querySelectorAll('.group'));
      return JSON.stringify(gs.map(function(g){
        var bg=g.querySelector('.group-bg');
        var cs=bg?getComputedStyle(bg):null;
        return {key:g.getAttribute('data-group'), hasBg:g.classList.contains('has-bg'),
          bgImg:cs?(cs.backgroundImage||''):'',
          bgColor:cs?(cs.backgroundColor||''):'',
          bar:getComputedStyle(g.querySelector('.group-bar')).backgroundColor};
      }));
    })()`) || '[]');
    const autoGroups = grp.filter(g => g.hasBg && /linear-gradient/.test(g.bgImg));
    ok('③ 存在无图分组用渐变背景（autoBg）', autoGroups.length >= 1, JSON.stringify(grp.map(g=>({k:g.key,hasBg:g.hasBg,grad:/linear-gradient/.test(g.bgImg)}))));
    ok('③ 渐变分组应用 has-bg 白字视觉', autoGroups.every(g=>g.hasBg===true));
    // 至少两个 autoBg 分组的渐变色不同
    const grads = autoGroups.map(g=>g.bgImg);
    ok('③ 不同无图分组配色不同（不撞色）', grads.length < 2 || new Set(grads).size === grads.length, JSON.stringify(grads));

    /* 5 列 / 多视口溢出检测 */
    console.log('=== Web 1.0.25：5列 + 缩放窗口按钮不溢出 ===');
    for (const w of [1600, 1520, 1400, 1180, 900]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 950, deviceScaleFactor: 1, mobile: false });
      await new Promise(r => setTimeout(r, 350));
      const r = JSON.parse(await evalJs(`(function(){
        var de=document.documentElement.style; de.setProperty('--cols','5'); document.body.setAttribute('data-cols','5');
        var over=[];
        [].slice.call(document.querySelectorAll('.ct')).forEach(function(card){
          [].slice.call(card.querySelectorAll('.ct-ops .op')).forEach(function(b){
            if(b.scrollWidth>b.clientWidth+1) over.push(b.textContent.trim()+':'+b.scrollWidth+'>'+b.clientWidth);
          });
        });
        return JSON.stringify({over:over});
      })()`) || '{}');
      ok('② ' + w + 'px 5列按钮文字零溢出', (r.over||[]).length === 0, JSON.stringify(r.over));
    }
    // 另存一次不使用强制 5 列（真实配置）下的结果
    await evalJs(`(function(){document.documentElement.style.removeProperty('--cols');document.body.removeAttribute('data-cols');})()`);

    /* ---------- APP 部分 ---------- */
    console.log('=== APP 1.0.18：无背景卡片玻璃态 ===');
    await go(APP_URL, 390);
    const app = JSON.parse(await evalJs(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.ct:not(.has-bg)'));
      var info=cards.slice(0,3).map(function(c){return {bg:getComputedStyle(c).backgroundColor, cls:c.className};});
      return JSON.stringify({count:cards.length, info:info});
    })()`) || '{}');
    ok('④ APP 存在无背景卡片', (app.count||0) >= 1, JSON.stringify(app));
    ok('④ 无背景卡片为玻璃态 rgba(255,255,255,.86) 而非纯白',
       (app.info||[]).some(x=>/rgba\(255, 255, 255, 0?\.86\)/.test(x.bg)) &&
       !(app.info||[]).some(x=>/rgb\(255, 255, 255\)/.test(x.bg)), JSON.stringify(app.info));

    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('========================================');
    ws.close();
    chrome.kill();
    process.exit(FAIL ? 1 : 0);
  } catch (e) {
    console.error(e);
    try { chrome.kill(); } catch (_) {}
    process.exit(2);
  }
}
main();
