'use strict';
/* 真实浏览器验证 Web 1.0.15：设置卡片排版 + host 端口显示 + HTTPS 输入移除。 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.LD_WEB_URL || process.argv[2] || 'http://127.0.0.1:23000/';
const PORT = 9223;
const SHOT = path.join(ROOT, 'litedock-app', 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

async function main() {
  fs.mkdirSync(SHOT, { recursive: true });
    const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    /* ★ 每次全新 profile：固定旧 profile 会缓存旧版 JS，1.0.18 复验时曾误报大面积失败 */
    '--user-data-dir=C:/ldbuild/chrome-prof-web-' + Date.now(), 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { await sleep(200); }
    }
    const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json();
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
    const shot = async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (r.result && r.result.data) fs.writeFileSync(path.join(SHOT, file), Buffer.from(r.result.data, 'base64'));
    };

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2200);

    console.log('=== 主面板 host 网络显示 ===');
    const board = JSON.parse(await evalJs(`(function(){
      var hosts=[].slice.call(document.querySelectorAll('.port-host')).map(function(x){return x.textContent.trim();});
      var chips=[].slice.call(document.querySelectorAll('.port')).map(function(x){return x.textContent.trim();});
      return JSON.stringify({hosts:hosts, chips:chips, total:chips.length});
    })()`) || '{}');
    ok('proxy-switch 显示 host · 8088（Web 端补齐）',
      board.hosts.some(t => /host\s*·\s*8088/.test(t)) || board.chips.some(t => /host\s*·\s*8088/.test(t)),
      JSON.stringify(board.hosts));
    ok('普通端口映射仍正常显示（宿主→容器格式）',
      board.chips.some(t => /→/.test(t)), JSON.stringify(board.chips.slice(0, 8)));
    /* 1.0.16：雷池项目卡片端口从裸 9443 改为 9443→1443，并补「快捷访问」标题 */
    const proj = JSON.parse(await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      if(!pc) return JSON.stringify({found:false});
      var lbl=pc.querySelector('.ports-label');
      var meta=pc.querySelector('.ct-project-meta');
      var ports=[].slice.call((meta?meta.querySelectorAll('.port'):[])).map(function(x){return x.textContent.trim();});
      return JSON.stringify({found:true, label:lbl?lbl.textContent.trim():'', ports:ports,
        title:(meta&&meta.querySelector('.port[title]')||{}).title||''});
    })()`) || '{}');
    ok('雷池折叠项目卡片能找到', proj.found === true, JSON.stringify(proj));
    ok('项目卡片端口区有「快捷访问」标题', /快捷访问/.test(proj.label || ''), JSON.stringify(proj));
    ok('9443 显示为「9443→1443」，不再裸数字', (proj.ports || []).some(t => /9443\s*→\s*1443/.test(t)), JSON.stringify(proj.ports));
    ok('端口 chip 的 title 解释宿主→容器含义', /宿主端口/.test(proj.title || ''), JSON.stringify(proj.title));
    await shot('LiteDock-Web-1.0.16-board.png');

    console.log('=== 设置 → 卡片 → 快捷访问排版 ===');
    await evalJs(`(function(){
      document.getElementById('btnSettings').click();
      var t=document.querySelector('.tab[data-tab="card"]'); if(t) t.click();
      return 1;
    })()`);
    await sleep(600);
    const set = JSON.parse(await evalJs(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.link-card'));
      var sample=cards[0]?{
        head:(cards[0].querySelector('.lc-head b')||{}).textContent,
        labels:[].slice.call(cards[0].querySelectorAll('.field label')).map(function(x){return x.textContent.trim();}),
        lan:!!cards[0].querySelector('input[data-link]'),
        wan:!!cards[0].querySelector('input[data-linkwan]'),
        html:cards[0].outerHTML.slice(0,360)
      }:null;
      return JSON.stringify({
        count:cards.length, sample:sample,
        httpsInputs:document.querySelectorAll('input[data-https]').length,
        httpsSection:[].slice.call(document.querySelectorAll('.sec h3')).some(function(x){return /HTTPS 端口/.test(x.textContent);}),
        personal:/private-host|nas\\.example\\.com|16666/.test((document.getElementById('drawerBody')||{}).textContent||'')
      });
    })()`) || '{}');
    ok('快捷访问渲染成卡片列表', set.count > 0, JSON.stringify(set.count));
    ok('容器名独占一行（.lc-head b）', !!(set.sample && set.sample.head), JSON.stringify(set.sample));
    ok('下面只有「内网 / 外网」两个短标签输入框',
      !!(set.sample && set.sample.labels.length === 2 && set.sample.labels[0] === '内网' && set.sample.labels[1] === '外网'),
      JSON.stringify(set.sample && set.sample.labels));
    ok('两个输入框都能正确绑定 data-link / data-linkwan',
      !!(set.sample && set.sample.lan && set.sample.wan), JSON.stringify(set.sample && set.sample.html));
    ok('HTTPS 端口设置节与输入框已移除', set.httpsInputs === 0 && set.httpsSection === false, JSON.stringify(set));
    ok('设置面板文案无个人环境字样', set.personal === false, JSON.stringify(set.personal));

    /* 1.0.16：紧凑模式下操作按钮整体下移一点点（ct-ops margin-top:8px） */
    const compact = JSON.parse(await evalJs(`(function(){
      document.body.classList.add('compact');
      var op=document.querySelector('.ct .ct-ops');
      var mt=op?getComputedStyle(op).marginTop:'';
      var hide=getComputedStyle(document.querySelector('.ct .ct-status')||document.body).display;
      /* 1.0.17：项目卡片（雷池等 Compose 折叠卡）的快捷访问区在紧凑模式下也必须隐藏 */
      var pc=document.querySelector('.project-card');
      var pclbl=pc?getComputedStyle(pc.querySelector('.ports-label')||document.body).display:'';
      var pcmeta=pc?getComputedStyle(pc.querySelector('.ct-project-meta')||document.body).display:'';
      document.body.classList.remove('compact');
      return JSON.stringify({marginTop:mt, statusDisplay:hide, pcLabel:pclbl, pcMeta:pcmeta, pcFound:!!pc});
    })()`) || '{}');
    ok('紧凑模式：状态行隐藏', compact.statusDisplay === 'none', JSON.stringify(compact));
    ok('紧凑模式：操作按钮有 8px 上边距（整体下移）', compact.marginTop === '8px', JSON.stringify(compact));
    ok('紧凑模式：项目卡片快捷访问区隐藏（雷池折叠卡）', compact.pcLabel === 'none' && compact.pcMeta === 'none', JSON.stringify(compact));
    await evalJs(`(function(){
      var first=document.querySelector('.link-card');
      if(first) first.scrollIntoView({block:'start'});
      return 1;
    })()`);
    await sleep(350);
    await shot('LiteDock-Web-1.0.15-settings-card.png');

    ws.close();
    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('========================================');
    if (FAIL) process.exitCode = 1;
  } finally {
    try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) {}
  }
}
main().catch(e => { console.error('VERIFY_WEB_DOM_ERROR', e); process.exit(1); });
