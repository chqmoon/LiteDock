'use strict';
/* APP 1.0.11 真实浏览器验证（自包含）：
   ① 设置页：新增「显示」卡片，位置在「当前连接」与「链接与打开方式」之间，标题正确
   ② 开关默认关（ld_compact 不存在 / '0'），#ld-root 不带 .ld-compact
   ③ 真实点击开关 → #ld-root 挂上 .ld-compact，toast 反馈，localStorage 持久化
   ④ 紧凑下面板卡片：.ct-status/.meters/.ports 全部 display:none，.ct/.ct-icon 尺寸缩小
   ⑤ 项目卡（雷池折叠卡）：.ct-status/.ports 隐藏，op-full 按钮带 margin-top
   ⑥ 紧凑下操作按钮、点卡进详情、长按/点击 chip 等既有功能全部不受影响
   ⑦ 再点一次开关 → 恢复完整显示（.ct-status 等回来），localStorage 置 '0'
   ⑧ 刷新页面 → 偏好持久（重新打开 APP 场景）
   全部真实 CDP 点击 + 真实渲染 DOM，非合成事件自证。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8879;
const CDP_PORT = 9335;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const SHOT_DIR = path.join(ROOT, 'screenshots');
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
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const env = Object.assign({}, process.env, { LD_PORT: String(PREVIEW_PORT) });
  if (LD_WWW) env.LD_WWW = LD_WWW;
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const profile = 'C:/ldbuild/chrome-prof-111-app-' + Date.now();   // 全新 profile，杜绝旧缓存
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
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
    const shot = async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      if (r.result && r.result.data) fs.writeFileSync(path.join(SHOT_DIR, file), Buffer.from(r.result.data, 'base64'));
    };
    const realClick = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    await send('Page.enable'); await send('Runtime.enable');
    // 430x900, DPR1 模拟手机；vh 单位与 vw 换算都按此基准
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await send('Page.navigate', { url: URL + '?diag=1' });
    await sleep(2600);

    console.log('=== APP 1.0.11 紧凑模式·真实浏览器验证 ===');

    /* --- ② 默认关：#ld-root 无 .ld-compact --- */
    const def = JSON.parse(await evalJs(`(function(){
      return JSON.stringify({
        compactCls: document.getElementById('ld-root').classList.contains('ld-compact'),
        kv: localStorage.getItem('ld_compact'),
        ver: window.LD && LD.APP_VERSION
      });
    })()`));
    console.log('  default:', JSON.stringify(def));
    ok('② 默认无 .ld-compact class（紧凑默认关）', def.compactCls === false, JSON.stringify(def));
    ok('② 默认 localStorage 无 ld_compact 记录', def.kv === null, def.kv);
    ok('  版本号 = 1.0.25', def.ver === '1.0.26', def.ver);

    /* --- 完整显示基线：记录 .ct 常规 padding 与 .ct-icon 尺寸，供之后对比 --- */
    const base = JSON.parse(await evalJs(`(function(){
      var ct=document.querySelector('.scope-index .ct');
      var ic=document.querySelector('.scope-index .ct-icon');
      var st=document.querySelector('.scope-index .ct-status');
      var me=document.querySelector('.scope-index .meters');
      var po=document.querySelector('.scope-index .ports');
      if(!ct) return JSON.stringify({none:true});
      var cs=getComputedStyle(ct), cs2=ic?getComputedStyle(ic):null;
      return JSON.stringify({
        pad: cs.padding, iconW: ic?Math.round(ic.getBoundingClientRect().width):0,
        flexBasis: cs2?cs2.flexBasis:'',
        statusDisp: st?getComputedStyle(st).display:'absent',
        metersDisp: me?getComputedStyle(me).display:'absent',
        portsDisp: po?getComputedStyle(po).display:'absent',
        cardH: Math.round(ct.getBoundingClientRect().height)
      });
    })()`));
    console.log('  full-mode card:', JSON.stringify(base));
    ok('  完整模式基线：状态/资源/端口均可见', base.statusDisp === 'block' && base.metersDisp === 'flex' && base.portsDisp !== 'none', JSON.stringify(base));

    /* --- ① 设置页：显示卡位置 --- */
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="settings"]');if(t)t.click();})()`);
    await sleep(900);
    const setPage = JSON.parse(await evalJs(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.scope-settings .card'));
      var titles=cards.map(function(c){var t=c.querySelector('.section-title');return t?t.textContent:'';});
      var dispIdx=titles.indexOf('显示');
      var beforeIdx=titles.indexOf('当前连接');
      var afterIdx=titles.indexOf('链接与打开方式');
      var sw=document.querySelector('[data-ev="ldToggleCompact"]');
      return JSON.stringify({
        titles:titles, dispIdx:dispIdx, beforeIdx:beforeIdx, afterIdx:afterIdx,
        hasSwitch:!!sw, switchOn:!!(sw&&sw.querySelector('.ld-switch.on')),
        label:sw?sw.textContent.replace(/\\s+/g,' ').trim():''
      });
    })()`));
    console.log('  settings:', JSON.stringify(setPage));
    ok('① 设置页出现「显示」卡', setPage.dispIdx >= 0, JSON.stringify(setPage.titles));
    ok('① 位置正确：当前连接(前) < 显示 < 链接与打开方式(后)',
       setPage.beforeIdx >= 0 && setPage.dispIdx === setPage.beforeIdx + 1 && setPage.afterIdx === setPage.dispIdx + 1,
       JSON.stringify(setPage));
    ok('① 「显示」卡内含 ldToggleCompact 开关', setPage.hasSwitch, '');
    ok('① 开关默认关闭（无 .on）', setPage.switchOn === false, '');
    ok('① 开关文案清晰', /紧凑模式/.test(setPage.label), setPage.label);
    await shot('LiteDock-App-1.0.11-settings-display.png');

    /* --- ③ 真实点击开关 --- */
    const ctr = JSON.parse(await evalJs(`(function(){
      var sw=document.querySelector('[data-ev="ldToggleCompact"]');
      // 记录 toast
      window.__t111={toasts:[]};
      var el=document.getElementById('ld-toast');
      if(el){ window.__t111.obs=new MutationObserver(function(){
        if(el.classList.contains('show')) window.__t111.toasts.push(el.textContent||'');
      }); window.__t111.obs.observe(el,{attributes:true,childList:true,subtree:true,characterData:true}); }
      if(!sw) return JSON.stringify({found:false});
      sw.scrollIntoView({block:'center'});
      var r=sw.getBoundingClientRect();
      return JSON.stringify({found:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
    })()`));
    ok('③ 找到开关并可点击', ctr.found, JSON.stringify(ctr));
    if (ctr.found) { await realClick(ctr.x, ctr.y); }
    await sleep(1000);
    const afterOn = JSON.parse(await evalJs(`(function(){
      var sw=document.querySelector('[data-ev="ldToggleCompact"]');
      return JSON.stringify({
        cls: document.getElementById('ld-root').classList.contains('ld-compact'),
        kv: localStorage.getItem('ld_compact'),
        sw: !!(sw&&sw.querySelector('.ld-switch.on')),
        toasts: window.__t111.toasts
      });
    })()`));
    console.log('  after-on:', JSON.stringify(afterOn));
    ok('③ 开启后 #ld-root 带 .ld-compact', afterOn.cls === true, '');
    ok('③ localStorage 持久化 ld_compact=1', afterOn.kv === '1', afterOn.kv);
    ok('③ 开关随 UI 翻转为 on', afterOn.sw === true, '');
    ok('③ 开启有 toast 反馈', afterOn.toasts.length > 0, JSON.stringify(afterOn.toasts));

    /* --- ④ 切回面板：卡片紧凑渲染断言 --- */
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="index"]');if(t)t.click();})()`);
    await sleep(1200);
    const compactCard = JSON.parse(await evalJs(`(function(){
      var ct=document.querySelector('.scope-index .ct');
      var ic=document.querySelector('.scope-index .ct-icon');
      var me=document.querySelector('.scope-index .meters');
      if(!ct) return JSON.stringify({none:true});
      var cs=getComputedStyle(ct);
      var sts=[].slice.call(document.querySelectorAll('.scope-index .ct .ct-status')).map(function(s){return getComputedStyle(s).display;});
      var pos=[].slice.call(document.querySelectorAll('.scope-index .ct .ports')).map(function(s){return getComputedStyle(s).display;});
      var ops=[].slice.call(document.querySelectorAll('.scope-index .ct-ops')).map(function(o){return getComputedStyle(o).marginTop;});
      return JSON.stringify({
        pad: cs.padding,
        iconW: ic?Math.round(ic.getBoundingClientRect().width):0,
        statusHidden: sts.length>0 && sts.every(function(d){return d==='none';}),
        metersHidden: !!me && getComputedStyle(me).display==='none',
        portsHidden: pos.length>0 && pos.every(function(d){return d==='none';}),
        opsTop: ops[0]||'', cardH: Math.round(ct.getBoundingClientRect().height)
      });
    })()`));
    console.log('  compact card:', JSON.stringify(compactCard));
    ok('④ .ct 内边距缩小（紧凑 padding 生效）',
       parseFloat(compactCard.pad) < parseFloat(base.pad),
       compactCard.pad + ' vs ' + base.pad);
    ok('④ .ct-icon 缩小', compactCard.iconW < base.iconW, compactCard.iconW + ' < ' + base.iconW);
    ok('④ 所有卡 .ct-status display:none', compactCard.statusHidden === true, '');
    ok('④ 所有卡 .meters display:none', compactCard.metersHidden === true, '');
    ok('④ 所有卡 .ports display:none', compactCard.portsHidden === true, '');
    ok('④ 卡片高度明显变小', compactCard.cardH < base.cardH - 10, compactCard.cardH + ' < ' + base.cardH);
    await shot('LiteDock-App-1.0.11-compact-board.png');

    /* --- ⑤ 项目卡（Compose 折叠卡，fixture 含雷池项目）---
       折叠态项目卡本就不渲染 ports（portsVisible=false → absent 是正常的），
       展开后才有；两种情况下紧凑都不得让 ports 可见。这里先断言折叠态，
       再真实点开项目卡断言展开态。 */
    const proj = JSON.parse(await evalJs(`(function(){
      var p=document.querySelector('.scope-index .ct-project');
      if(!p) return JSON.stringify({none:true});
      var st=p.querySelector('.ct-status'), po=p.querySelector('.ports'), op=p.querySelector('.op-full');
      /* 1.0.12：项目卡 CPU/内存已从单行 .ct-status 改为和单容器卡一样的 .meters，
         紧凑模式应隐藏 .meters（资源区），故这里同时取 meters 的 display。 */
      var meters=p.querySelector('.meters');
      return JSON.stringify({
        found:true,
        st: st?getComputedStyle(st).display:'absent',
        meters: meters?getComputedStyle(meters).display:'absent',
        po: po?getComputedStyle(po).display:'absent',
        opMt: op?getComputedStyle(op).marginTop:'absent',
        ops: !!p.querySelector('.btn, .op')
      });
    })()`));
    console.log('  project card(folded):', JSON.stringify(proj));
    ok('⑤ 项目卡存在（fixture 有 Compose 项目）', proj.found === true, '');
    ok('⑤ 项目卡资源区隐藏（1.0.12 起项目卡用 .meters，旧 .ct-status 已移除）',
       proj.meters === 'none' || proj.st === 'none', JSON.stringify({meters:proj.meters, st:proj.st}));
    ok('⑤ 折叠态 ports 不渲染或隐藏（absent/none 均合规）', proj.po === 'absent' || proj.po === 'none', proj.po);
    ok('⑤ 项目卡 op-full 按钮带 margin-top 下移(≈2.6667vw)', proj.opMt !== 'absent' && parseFloat(proj.opMt) > 5, proj.opMt);

    /* --- ⑥ 紧凑下功能回归：操作按钮存在且可点、点卡进详情、chips 全被隐藏 --- */
    const func = JSON.parse(await evalJs(`(function(){
      var ops=[].slice.call(document.querySelectorAll('.scope-index .ct-ops [data-act="restart"]'));
      var card=document.querySelector('.scope-index .ct[data-ev="openDetail"]');
      var chips=[].slice.call(document.querySelectorAll('.scope-index .port-chip'));
      return JSON.stringify({
        restartBtns: ops.length,
        detailClick: !!card,
        chipCount: chips.length,
        chipHidden: chips.length===0 || chips.every(function(c){return getComputedStyle(c).display==='none'||!c.offsetParent;})
      });
    })()`));
    console.log('  compact funcs:', JSON.stringify(func));
    ok('⑥ 紧凑下重启/详情按钮仍在', func.restartBtns > 0 && func.detailClick === true, JSON.stringify(func));
    ok('⑥ 快捷访问 chips 随 .ports 隐藏（不可见）', func.chipHidden === true, '');
    // 真实点击详情（紧凑下卡片点击目标仍有效）
    const dctr = JSON.parse(await evalJs(`(function(){
      var card=document.querySelector('.scope-index .ct[data-ev="openDetail"]');
      if(!card) return JSON.stringify({found:false});
      card.scrollIntoView({block:'center'});
      var r=card.getBoundingClientRect();
      // 点击卡片的图标区域（避开按钮）
      return JSON.stringify({found:true,x:Math.round(r.left+30),y:Math.round(r.top+20)});
    })()`));
    if (dctr.found) { await realClick(dctr.x, dctr.y); await sleep(900); }
    const detailRes = JSON.parse(await evalJs(`(function(){
      return JSON.stringify({
        page: !!document.querySelector('.detail-page'),
        back: !!document.querySelector('#ld-nav-back')
      });
    })()`));
    ok('⑥ 紧凑下点卡可进详情页', detailRes.page === true, JSON.stringify(detailRes));
    // 详情不受紧凑影响：资源条仍在
    const detMeters = await evalJs(`(function(){
      var m=document.querySelector('.scope-detail .meter-detail');
      return m?getComputedStyle(m).display:''; })()`);
    ok('⑥ 详情页资源区不受紧凑影响', detMeters !== 'none', detMeters);
    await evalJs(`(function(){var b=document.getElementById('ld-nav-back');if(b)b.click();})()`);
    await sleep(700);

    /* --- ⑦ 再点一次开关：恢复完整显示 --- */
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="settings"]');if(t)t.click();})()`);
    await sleep(900);
    const ctr2 = JSON.parse(await evalJs(`(function(){
      var sw=document.querySelector('[data-ev="ldToggleCompact"]');
      if(!sw) return JSON.stringify({found:false});
      sw.scrollIntoView({block:'center'});
      var r=sw.getBoundingClientRect();
      return JSON.stringify({found:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
    })()`));
    if (ctr2.found) { await realClick(ctr2.x, ctr2.y); }
    await sleep(900);
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="index"]');if(t)t.click();})()`);
    await sleep(1200);
    const afterOff = JSON.parse(await evalJs(`(function(){
      var ct=document.querySelector('.scope-index .ct');
      var st=document.querySelector('.scope-index .ct-status');
      var me=document.querySelector('.scope-index .meters');
      var po=document.querySelector('.scope-index .ports');
      return JSON.stringify({
        cls: document.getElementById('ld-root').classList.contains('ld-compact'),
        kv: localStorage.getItem('ld_compact'),
        pad: ct?getComputedStyle(ct).padding:'',
        st: st?getComputedStyle(st).display:'absent',
        me: me?getComputedStyle(me).display:'absent',
        po: po?getComputedStyle(po).display:'absent'
      });
    })()`));
    console.log('  after-off:', JSON.stringify(afterOff));
    ok('⑦ 关闭后 .ld-compact 移除', afterOff.cls === false, '');
    ok('⑦ localStorage ld_compact=0', afterOff.kv === '0', afterOff.kv);
    ok('⑦ 状态/资源/端口完整恢复', afterOff.st !== 'none' && afterOff.me !== 'none' && afterOff.po !== 'none', JSON.stringify(afterOff));
    ok('⑦ padding 恢复常规值', afterOff.pad === base.pad, afterOff.pad + ' vs ' + base.pad);
    await shot('LiteDock-App-1.0.11-full-board.png');

    /* --- ⑧ 刷新页面（模拟重开 APP）：偏好持久 --- */
    await send('Page.navigate', { url: URL });
    await sleep(2600);
    const reload = JSON.parse(await evalJs(`(function(){
      return JSON.stringify({
        cls: document.getElementById('ld-root').classList.contains('ld-compact'),
        kv: localStorage.getItem('ld_compact')
      });
    })()`));
    console.log('  reload:', JSON.stringify(reload));
    ok('⑧ 刷新后偏好持久（ld_compact=0 → 无紧凑）', reload.cls === false && reload.kv === '0', JSON.stringify(reload));

    // 再开一次 + 刷新，验证开启态也能持久
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="settings"]');if(t)t.click();})()`);
    await sleep(800);
    const ctr3 = JSON.parse(await evalJs(`(function(){
      var sw=document.querySelector('[data-ev="ldToggleCompact"]');
      if(!sw) return JSON.stringify({found:false});
      var r=sw.getBoundingClientRect();
      return JSON.stringify({found:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
    })()`));
    if (ctr3.found) { await realClick(ctr3.x, ctr3.y); }
    await sleep(700);
    await send('Page.navigate', { url: URL });
    await sleep(2600);
    const reload2 = JSON.parse(await evalJs(`(function(){
      var st=document.querySelector('.scope-index .ct-status');
      return JSON.stringify({
        cls: document.getElementById('ld-root').classList.contains('ld-compact'),
        st: st?getComputedStyle(st).display:'absent'
      });
    })()`));
    console.log('  reload-on:', JSON.stringify(reload2));
    ok('⑧ 开启态刷新后仍紧凑（偏好持久·状态隐藏）', reload2.cls === true && reload2.st === 'none', JSON.stringify(reload2));

    console.log('\n=== 结果：PASS ' + PASS + ' / FAIL ' + FAIL + ' ===');
    process.exitCode = FAIL ? 1 : 0;
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main();
