'use strict';
/* 大列表性能回放：用指定 /api/state 快照，在真实 Chrome 里测「展开 / 收起」耗时。
   用法：node tools/profile_perf.js [state.json 路径] [--port 9223]
   输出：JSON（同步 JS 耗时、含首帧总耗时、setData 次数、节点数）。
   自包含：自动拉起预览服务器与无头 Chrome，结束自动清理。 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.dirname(__dirname);
const PROJECT = path.dirname(ROOT);
const FIXTURE = process.argv[2] || path.join(ROOT, 'tools', 'fixtures', 'state.json');
const CDP = Number((process.argv.find(a => a.startsWith('--port=')) || '--port=9223').split('=')[1]);
const TABS = process.argv.includes('--tabs');          // 测「切回面板」而非展开/收起
const WWW = (process.argv.find(a => a.startsWith('--www=')) || '').slice(6);
const SRV = CDP + 500;
const URL = `http://127.0.0.1:${SRV}/`;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok) return true; } catch (e) {}
    await sleep(120);
  }
  return false;
}

async function main() {
  const env = Object.assign({}, process.env,
    Object.assign({ LD_FIXTURE: FIXTURE, LD_PORT: String(SRV) }, WWW ? { LD_WWW: WWW } : {}));
  const srv = spawn('python', [path.join(ROOT, 'tools', 'serve_preview.py')],
    { cwd: PROJECT, env, stdio: 'ignore', windowsHide: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=C:/ldbuild/chrome-perf-${CDP}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  let ws;
  try {
    if (!await waitPort(`http://127.0.0.1:${SRV}/index.html`, 15000)) throw new Error('server timeout');
    if (!await waitPort(`http://127.0.0.1:${CDP}/json/version`, 15000)) throw new Error('chrome timeout');
    const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + encodeURIComponent(URL), { method: 'PUT' })).json();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    await new Promise(r => ws.onopen = r);
    const send = (method, params) => new Promise(resolve => {
      const n = ++id; pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    });
    const evalJs = async (expr, awaitPromise) => {
      const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
      if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
      const r = m.result && m.result.result;
      return r ? r.value : undefined;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
      screenWidth: 390, screenHeight: 844
    });
    await send('Page.navigate', { url: URL });
    // 等启动页退场 + 数据渲染完成
    for (let i = 0; i < 60; i++) {
      const ready = await evalJs("!!document.querySelector('.ct, .group') && !document.getElementById('ld-splash')");
      if (ready) break;
      await sleep(100);
    }
    await sleep(200);

    const expr = `(async function () {
      var host = document.getElementById('ld-page');
      var inst = host.__ldInst;
      var btn = document.querySelector('[data-ev="toggleProject"]');
      var key = btn ? btn.getAttribute('data-key') || btn.getAttribute('data-project') : null;
      var domNodes = host.querySelectorAll('*').length;
      var htmlLen = host.innerHTML.length;
      var out = { key: key, domNodes: domNodes, htmlLen: htmlLen,
                  groups: document.querySelectorAll('.group').length,
                  cards0: document.querySelectorAll('.ct').length,
                  perf: window.LD && LD._perf ? JSON.parse(JSON.stringify(LD._perf)) : null };
      if (!key || !inst) { out.error = 'no project button or instance'; return out; }

      // 统计一次交互触发的 setData 次数
      var count = 0, orig = inst.setData;
      inst.setData = function (p) { count++; return orig.call(inst, p); };

      function tap() {
        // 必须走真实事件委托，才能覆盖到「一次点击合并渲染」的批处理路径
        var b = document.querySelector('[data-ev="toggleProject"]');
        if (b) b.click();
        else inst.toggleProject({ currentTarget: { dataset: { key: key } }, detail: {}, type: 'tap' });
      }
      function frame() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }

      var t0 = performance.now();
      tap();
      var t1 = performance.now();
      await frame();
      var t2 = performance.now();
      out.expandSyncMs = +(t1 - t0).toFixed(2);
      out.expandFrameMs = +(t2 - t0).toFixed(2);
      out.setDataPerExpand = count;
      out.cards1 = document.querySelectorAll('.ct').length;

      count = 0;
      var t3 = performance.now();
      tap();
      var t4 = performance.now();
      await frame();
      var t5 = performance.now();
      out.collapseSyncMs = +(t4 - t3).toFixed(2);
      out.collapseFrameMs = +(t5 - t3).toFixed(2);
      out.setDataPerCollapse = count;
      out.cards2 = document.querySelectorAll('.ct').length;

      inst.setData = orig;
      out.perfAfter = window.LD && LD._perf ? JSON.parse(JSON.stringify(LD._perf)) : null;
      out.bodyScrollW = document.body.scrollWidth;
      return out;
    })()`;
    /* --tabs：测「设置 → 面板」的切页耗时。1.0.2 每次整页 innerHTML 重建全部分组卡片，
       1.0.3 复用缓存 DOM；在多容器快照下差距最明显。 */
    const tabExpr = `(async function () {
      function frame(){ return new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); }); }
      function avg(a){ return +(a.reduce(function(x,y){return x+y;},0)/a.length).toFixed(2); }
      var host = document.getElementById('ld-page');
      var imgs = Array.prototype.slice.call(host.querySelectorAll('img'));
      imgs.forEach(function(im,i){ im.__tabImg = i+1; });
      var syncs=[], renderMs=[], imgsKept=0;
      for (var k=0;k<3;k++){
        wx.switchTab({url:'/pages/settings/settings'});
        await frame();
        var t0 = performance.now();
        wx.switchTab({url:'/pages/index/index'});
        syncs.push(+(performance.now()-t0).toFixed(2));
        renderMs.push((window.LD && LD._perf) ? LD._perf.lastMs : 0);
        var back = host.querySelectorAll('img'), kept=0;
        for (var i=0;i<back.length;i++) if (back[i].__tabImg) kept++;
        imgsKept = kept;
        await frame();
      }
      return { mode:'tabs', syncMs:avg(syncs), syncSamples:syncs,
        renderMs:avg(renderMs), renderSamples:renderMs,
        imgsTotal:imgs.length, imgsKept:imgsKept,
        nodes:host.querySelectorAll('*').length,
        groups:document.querySelectorAll('.group').length,
        cards:document.querySelectorAll('.ct').length,
        htmlLen:host.innerHTML.length,
        tabReuse:(window.LD&&LD._perf&&LD._perf.tabReuse)||0,
        renders:(window.LD&&LD._perf&&LD._perf.renders)||0,
        bodyScrollW:document.body.scrollWidth };
    })()`;
    const res = await evalJs(TABS ? tabExpr : expr, true);
    console.log(JSON.stringify(res, null, 2));
    fs.writeFileSync(path.join(ROOT, 'tools', TABS ? 'perf-tabs.json' : 'perf-result.json'),
                     JSON.stringify(res, null, 2));
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
}

main().catch(e => { console.error('PROFILE_ERROR', e.message); process.exit(1); });
