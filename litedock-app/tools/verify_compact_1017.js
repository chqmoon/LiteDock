'use strict';
/* Web 1.0.17 真实浏览器验证：雷池项目卡片在紧凑模式下的布局。
   自包含：自己拉起本地预览服务（真实 NAS fixture）+ headless Chrome，跑完自动关闭。
   通过「外观 → 紧凑模式」真实 UI 开关切换，并做 1.0.16 旧行为 vs 1.0.17 新行为对比截图。 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOOLS = __dirname;
const ROOT = path.join(TOOLS, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 23017;
const CDP_PORT = 9228;
/* 设 LD_NAS_URL=http://192.168.1.10:23000/ 可对生产 NAS 直接做只读取证（不启本地服务、不写配置） */
const NAS = !!process.env.LD_NAS_URL;
const URL = process.env.LD_NAS_URL || ('http://127.0.0.1:' + PREVIEW_PORT + '/');
const SHOT_DIR = path.join(ROOT, 'screenshots');
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const py = process.env.LD_PY || 'python';
  const server = NAS ? null : spawn(py, [path.join(TOOLS, 'serve_web_preview.py'), String(PREVIEW_PORT)],
    { stdio: 'ignore', windowsHide: true, cwd: TOOLS });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-web-1017', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version'); break; } catch (e) { await sleep(200); } }
    for (let i = 0; i < 40; i++) { try { await fetch(URL + 'api/state'); break; } catch (e) { await sleep(200); } }
    const targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    await new Promise(r => ws.onopen = r);
    const send = (method, params) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const evalJs = async (expr) => {
      const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception || m.result.exceptionDetails).slice(0, 500));
      const r = m.result && m.result.result;
      return r ? r.value : undefined;
    };
    const shot = async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (r.result && r.result.data) fs.writeFileSync(path.join(SHOT_DIR, file), Buffer.from(r.result.data, 'base64'));
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2300);

    console.log('=== 真实浏览器：雷池项目卡片 + 紧凑模式 ===');
    const base = JSON.parse(await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      var single=document.querySelector('.ct:not(.project-card)');
      return JSON.stringify({found:!!pc, singleFound:!!single,
        pcPorts:pc?[].slice.call(pc.querySelectorAll('.port')).map(function(x){return x.textContent.trim();}):[],
        pcLabel:pc?((pc.querySelector('.ports-label')||{}).textContent||'').trim():''});
    })()`) || '{}');
    ok('雷池折叠项目卡片真实渲染', base.found === true, JSON.stringify(base));
    ok('普通模式：项目卡片有「快捷访问」标题', /快捷访问/.test(base.pcLabel || ''), JSON.stringify(base));
    ok('普通模式：端口显示宿主→容器（9443→1443）', (base.pcPorts || []).some(t => /9443\s*→\s*1443/.test(t)), JSON.stringify(base.pcPorts));

    /* 本地预览：走真实 UI 路径点击「外观 → 紧凑模式」开关。
       生产 NAS：只读取证，直接切 body class，绝不触碰 config（避免写入用户配置）。 */
    await evalJs(`(function(){
      document.getElementById('btnSettings').click();
      var t=document.querySelector('.tab[data-tab="look"]'); if(t) t.click();
      return 1;
    })()`);
    await sleep(450);
    const toggled = JSON.parse(await evalJs(`(function(){
      var box=document.querySelector('input[data-cfg-ck="compact"]');
      if(!box) return JSON.stringify({found:false});
      ` + (NAS ? `document.body.classList.add('compact');` : `box.click();`) + `
      return JSON.stringify({found:true, checked:box.checked, bodyCompact:document.body.classList.contains('compact')});
    })()`) || '{}');
    ok('设置面板存在「紧凑模式」开关', toggled.found === true, JSON.stringify(toggled));
    ok(NAS ? '切换 .compact 后紧凑模式生效（只读取证）' : '点击开关后 body 真的加上 .compact（真实 UI 路径）',
      toggled.bodyCompact === true, JSON.stringify(toggled));
    await evalJs(`(function(){ var b=document.getElementById('btnCloseDrawer'); if(b) b.click(); return 1; })()`);
    await sleep(350);

    /* 1.0.17 修复后：项目卡片快捷访问区应隐藏，卡片高度与普通卡片齐平 */
    const fixed = JSON.parse(await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      var single=document.querySelector('.ct:not(.project-card)');
      if(!pc) return JSON.stringify({found:false});
      var lbl=pc.querySelector('.ports-label'), meta=pc.querySelector('.ct-project-meta'), ops=pc.querySelector('.ct-ops');
      return JSON.stringify({found:true,
        labelDisplay:getComputedStyle(lbl).display, metaDisplay:getComputedStyle(meta).display,
        opsMarginTop:getComputedStyle(ops).marginTop,
        pcHeight:Math.round(pc.getBoundingClientRect().height),
        singleHeight:single?Math.round(single.getBoundingClientRect().height):-1,
        pcName:pc.querySelector('.ct-name').textContent.trim()});
    })()`) || '{}');
    ok('1.0.17 紧凑模式：「快捷访问」标题隐藏', fixed.labelDisplay === 'none', JSON.stringify(fixed));
    ok('1.0.17 紧凑模式：项目卡片端口区隐藏', fixed.metaDisplay === 'none', JSON.stringify(fixed));
    ok('1.0.17 操作按钮仍有 8px 上边距（原有打磨不回退）', fixed.opsMarginTop === '8px', JSON.stringify(fixed));
    ok('1.0.17 项目卡片与普通卡片高度齐平（差 ≤ 12px）',
      fixed.singleHeight > 0 && Math.abs(fixed.pcHeight - fixed.singleHeight) <= 12, JSON.stringify(fixed));
    await shot('LiteDock-Web-1.0.17-compact-fixed.png');

    /* 模拟 1.0.16 旧行为：用 !important 把项目卡片快捷访问区放回来，复现用户看到的问题 */
    await evalJs(`(function(){
      var s=document.createElement('style'); s.id='simulate-1016';
      s.textContent='.compact .project-card .ports-label{display:flex!important}'+
                    '.compact .project-card .ct-project-meta{display:flex!important}';
      document.head.appendChild(s); return 1;
    })()`);
    await sleep(250);
    const old = JSON.parse(await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      var single=document.querySelector('.ct:not(.project-card)');
      var lbl=pc.querySelector('.ports-label'), meta=pc.querySelector('.ct-project-meta');
      return JSON.stringify({labelDisplay:getComputedStyle(lbl).display, metaDisplay:getComputedStyle(meta).display,
        pcHeight:Math.round(pc.getBoundingClientRect().height),
        singleHeight:single?Math.round(single.getBoundingClientRect().height):-1});
    })()`) || '{}');
    ok('复现 1.0.16：项目卡片快捷访问区仍占位（问题确实存在）',
      old.labelDisplay !== 'none' && old.metaDisplay !== 'none', JSON.stringify(old));
    ok('复现 1.0.16：项目卡片明显高于普通卡片（布局不齐）',
      old.pcHeight - old.singleHeight > 20, JSON.stringify(old));
    await shot('LiteDock-Web-1.0.17-compact-before-simulated.png');
    await evalJs(`(function(){ var s=document.getElementById('simulate-1016'); if(s) s.remove(); return 1; })()`);
    await sleep(200);

    /* 关掉紧凑模式：普通模式下快捷访问必须回来，确认没有误伤 */
    await evalJs(`(function(){
      document.body.classList.remove('compact'); return 1;
    })()`);
    await sleep(250);
    const normal = JSON.parse(await evalJs(`(function(){
      var pc=document.querySelector('.project-card[data-projname="safeline"]');
      var lbl=pc.querySelector('.ports-label'), meta=pc.querySelector('.ct-project-meta'), ops=pc.querySelector('.ct-ops');
      return JSON.stringify({labelDisplay:getComputedStyle(lbl).display, metaDisplay:getComputedStyle(meta).display,
        opsMarginTop:getComputedStyle(ops).marginTop,
        ports:[].slice.call(pc.querySelectorAll('.port')).map(function(x){return x.textContent.trim();})});
    })()`) || '{}');
    ok('普通模式：项目卡片快捷访问完整保留（未被误伤）',
      normal.labelDisplay !== 'none' && normal.metaDisplay !== 'none' && (normal.ports || []).length > 0, JSON.stringify(normal));
    ok('普通模式：ct-ops 不再有 8px 上边距', normal.opsMarginTop === '0px', JSON.stringify(normal));
    await shot('LiteDock-Web-1.0.17-board-normal.png');

    ws.close();
    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('截图目录: ' + SHOT_DIR);
    console.log('========================================');
    if (FAIL) process.exitCode = 1;
  } finally {
    try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { }
    if (server) { try { execSync('taskkill /PID ' + server.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { } }
  }
}
main().catch(e => { console.error('VERIFY_COMPACT_1017_ERROR', e); process.exit(1); });
