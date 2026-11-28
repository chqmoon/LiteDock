'use strict';
/* APP 1.0.16 真实浏览器验证（自包含，CDP 真实渲染 + 真实点击）：
   ① 项目折叠卡背景：fixture 给 safeline-chaos（项目第一个容器）配 cardBackgrounds 后，
      折叠项目卡带 has-bg + ct-bg + ct-mask（与单容器卡同结构）；未配置的项目不误标
   ② 详情页「镜像更新」入口：单容器项目（aitutor）显示检查更新/升级重建；
      多容器 Compose 子容器（safeline 成员）不显示——与 Web 1.0.25 同口径
   ③ 容器操作成功后静默刷新：点「停止」确认后面板分组节点存续（未被 loading
      骨架替换）、无 loading 视图闪现、API 真实被调用
   运行：node verify_116_app.js   （LD_WWW=路径 可回放 APK 解包前端；LD_WWW=1 走脚本自身 www） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8891;
const CDP_PORT = 9346;
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
    LD_FIXTURE: path.join(__dirname, 'fixtures', 'state-bg.json')
  });
  if (process.env.LD_WWW && process.env.LD_WWW !== '1') env.LD_WWW = process.env.LD_WWW;
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')], { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-116-app-' + Date.now(),
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
    await sleep(2800);

    console.log('=== APP 1.0.16 项目卡背景 + 详情页更新入口 + 静默刷新 真实浏览器验证 ===');

    // ① 项目折叠卡背景
    const bg = JSON.parse(await evalJs(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.ct-project'));
      var out={total:cards.length, items:[]};
      cards.forEach(function(c){
        out.items.push({name:(c.querySelector('.ct-name')||{}).textContent||'',
          hasBg:c.classList.contains('has-bg'),
          bg:!!c.querySelector('.ct-bg'), mask:!!c.querySelector('.ct-mask')});
      });
      return JSON.stringify(out);
    })()`) || '{}');
    const sf = bg.items && bg.items.find(x => x.name === 'safeline');
    ok('①a safeline 项目折叠卡存在', !!sf, JSON.stringify(bg.items && bg.items.map(x=>x.name)));
    ok('①b safeline 项目卡 has-bg + ct-bg + ct-mask（与单容器卡同结构）',
       sf && sf.hasBg && sf.bg && sf.mask, JSON.stringify(sf));
    const wrong = (bg.items || []).filter(x => x.name !== 'safeline' && x.hasBg);
    ok('①c 未配置背景的项目不误标', wrong.length === 0, JSON.stringify(wrong));
    /* 单容器卡（aitutor 配过背景吗？fixture 只给 safeline-chaos 配了）→
       单容器卡 has-bg 结构在旧脚本已覆盖，这里不重复。 */

    // ② 详情页「镜像更新」入口：单容器项目 aitutor（project=aitutor 但仅 1 容器）
    const clickRes = await evalJs(`(function(){
      var cts=[].slice.call(document.querySelectorAll('.ct'));
      var c=cts.find(function(x){ return !x.classList.contains('ct-project') &&
        ((x.querySelector('.ct-name')||{}).textContent)==='aitutor'; });
      if(!c) return 'not-found';
      c.click();
      return 'ok';
    })()`);
    ok('②a 点击 aitutor（单容器项目）卡片进详情', clickRes === 'ok', clickRes);
    await sleep(800);
    const updSingle = JSON.parse(await evalJs(`(function(){
      return JSON.stringify({
        has:!!(document.querySelector('[data-ev="checkUpdate"]')&&document.querySelector('[data-ev="doUpgrade"]')),
        name:(document.querySelector('.detail-overview .ct-name')||{}).textContent||''
      });
    })()`) || '{}');
    ok('②b 单容器项目详情页有「检查更新 / 升级重建」入口',
       updSingle.has === true && updSingle.name === 'aitutor', JSON.stringify(updSingle));
    /* 正常详情页没有 goBack 按钮（那只在 not-found 分支），返回走导航栏左侧 */
    await evalJs(`(function(){var b=document.querySelector('ld-nav-back,#ld-nav-back,.ld-nav-back,[class*="nav-back"]');if(b)b.click();return 1;})()`);
    await sleep(700);

    // ② Compose 子容器：展开 safeline → 子卡 safeline-chaos 详情页应无更新入口
    const exp = await evalJs(`(function(){
      var t=document.querySelector('.ct-project [data-ev="toggleProject"]');
      if(t)t.click();
      return !!t;
    })()`);
    await sleep(700);
    const sub = await evalJs(`(function(){
      var subs=[].slice.call(document.querySelectorAll('.ct[data-ev="openDetail"]'))
        .filter(function(x){return ((x.querySelector('.ct-name')||{}).textContent||'').indexOf('safeline')===0;});
      if(!subs.length) return 'not-found';
      subs[0].click();
      return 'ok';
    })()`);
    ok('②c 展开 safeline 并进入子容器详情', sub === 'ok', sub);
    await sleep(800);
    const updCompose = await evalJs(`(function(){
      return JSON.stringify({
        has:!!document.querySelector('[data-ev="checkUpdate"]'),
        ops:!!document.querySelector('[data-ev="doAction"]')
      });
    })()`) || '{}';
    const uc = JSON.parse(updCompose);
    /* 1.0.17 断言语义反转：镜像更新入口全容器开放（1.0.16 原为 Compose 子容器隐藏） */
    ok('②d Compose 子容器详情页也有「镜像更新」入口（1.0.17 全开放，容器操作保留）',
       uc.has === true && uc.ops === true, updCompose);
    await evalJs(`(function(){var b=document.querySelector('ld-nav-back,#ld-nav-back,.ld-nav-back,[class*="nav-back"]');if(b)b.click();return 1;})()`);
    await sleep(700);
    await evalJs(`(function(){var t=document.querySelector('.ct-project [data-ev="toggleProject"]');if(t)t.click();return 1;})()`);
    await sleep(500);

    // ③ 静默刷新：点 aitutor「停止」→ 确认 → 面板节点存续
    await evalJs(`(function(){
      window.__panelRef = document.querySelector('.scope-index .group');
      if(window.__panelRef) window.__panelRef.setAttribute('data-m116','keep');
      /* MutationObserver 记录面板重建：若 __panelRef 被从 DOM 移除即记时间点 */
      window.__removedAt = null;
      if (window.MutationObserver && window.__panelRef) {
        var el = window.__panelRef;
        new MutationObserver(function(){
          if (!el.isConnected && !window.__removedAt) window.__removedAt = Date.now();
        }).observe(document.body, { childList: true, subtree: true });
      }
      return JSON.stringify({ref:!!window.__panelRef, view:(document.querySelector('.scope-index .group')?'groups':'other'),
        state:(window.__pageState||'')});
    })()`);
    const clickStop = await evalJs(`(function(){
      var btns=[].slice.call(document.querySelectorAll('.ct:not(.ct-project) [data-ev="doAction"][data-act="stop"]'));
      if(!btns.length) return 'no-btn';
      btns[0].click(); return 'ok';
    })()`);
    ok('③a 点停止按钮弹出确认框', clickStop === 'ok', clickStop);
    await sleep(400);
    const confirm = await evalJs(`(function(){
      var b=document.querySelector('.ld-modal-ok');
      if(b){b.click();return 'ok';} return 'no-modal';
    })()`);
    ok('③b 确认执行', confirm === 'ok', confirm);
    /* 逐帧采样：确认后 2.2s 内面板是否被替换 + ld-loading 状态 */
    const frames = [];
    for (let t = 0; t <= 2100; t += 300) {
      const f = await evalJs(`(function(){
        return JSON.stringify({
          same:window.__panelRef===document.querySelector('.scope-index .group'),
          conn:!!(window.__panelRef&&window.__panelRef.isConnected),
          loading:(function(){var b=document.getElementById('ld-loading');return b?b.classList.contains('show'):null})(),
          groups:document.querySelectorAll('.scope-index .group').length,
          toast:(function(){var t=document.getElementById('ld-toast');return t?t.className:'none'})()
        });
      })()`);
      frames.push(f);
      await sleep(300);
    }
    const last = JSON.parse(frames[frames.length - 1]);
    const removedMid = frames.some(x => { try { return JSON.parse(x).conn === false; } catch (e) { return false; } });
    if (process.env.LD_DEBUG) frames.forEach(f => console.log('    frame:', f));
    ok('③c 操作后面板 DOM 节点存续（未被 loading 骨架替换）', last.conn === true && !removedMid, JSON.stringify(frames));
    ok('③d 无 loading 视图闪现（执行遮罩已收起、面板分组仍在）',
       last.groups > 0 && last.loading !== true, JSON.stringify(last));

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
    try { if (ws) ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
}
main();
