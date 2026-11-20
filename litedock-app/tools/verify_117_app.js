'use strict';
/* APP 1.0.17 真实浏览器验证（自包含，CDP 真实渲染 + 真实点击）：
   ① 项目卡「展开/收起」与上方批量操作行拉开间距（.ct-project .op-full margin-top 1.8667vw ≈ 8px）
      —— 常规与紧凑模式都要验证（用户反馈"收起"贴着启动/停止/重启太近）
   ② 检查更新结果弹窗反馈（用户反馈点了没提示）：
      a. 无更新分支：mock 默认返回 hasUpdate:false → modal 标题「已是最新版本」
      b. 有更新分支：window.__ldCheckResult 注入 hasUpdate:true → modal 标题「发现新镜像」
   ③ 多容器项目成员（safeline 子容器）详情页有「镜像更新」卡（1.0.17 全开放），
      且卡内有 ⚠ 项目警告行；点升级重建弹出的确认框含警告文案
   ④ 单容器项目（aitutor）详情页入口不回归（无警告行）
   ⑤ APP 版本 1.0.25
   运行：node verify_117_app.js   （LD_WWW=路径 可回放 APK 解包前端；LD_WWW=1 走脚本自身 www） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8893;
const CDP_PORT = 9348;
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
    '--user-data-dir=C:/ldbuild/chrome-prof-117-app-' + Date.now(),
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
    const closeModal = async () => {
      await evalJs(`(function(){var b=document.querySelector('.ld-modal-ok');if(b)b.click();return 1;})()`);
      await sleep(250);
    };
    const goBack = async () => {
      await evalJs(`(function(){var b=document.querySelector('ld-nav-back,#ld-nav-back,.ld-nav-back,[class*="nav-back"]');if(b)b.click();return 1;})()`);
      await sleep(650);
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2800);

    console.log('=== APP 1.0.25 项目卡间距 + 检查更新弹窗 + 项目成员更新入口 真实浏览器验证 ===');

    // ① 项目卡「展开/收起」与批量操作行的间距（常规模式）
    const gapNormal = JSON.parse(await evalJs(`(function(){
      var p=document.querySelector('.ct-project');
      if(!p) return JSON.stringify({found:false});
      var opsRow=p.querySelector('.project-ops'), toggle=p.querySelector('.op-full');
      if(!opsRow||!toggle) return JSON.stringify({found:true, missing:true});
      var r1=opsRow.getBoundingClientRect(), r2=toggle.getBoundingClientRect();
      var cs=getComputedStyle(toggle);
      return JSON.stringify({found:true, gapPx:Math.round((r2.top-r1.bottom)*100)/100,
        margin:cs.marginTop, display:cs.display});
    })()`) || '{}');
    ok('①a 项目卡同时有批量操作行与展开/收起按钮', gapNormal.found === true && !gapNormal.missing, JSON.stringify(gapNormal));
    /* 430px 视口下 1.8667vw = 8.03px；按钮行 .op-cell 有 padding 3.44px 上下沿
       （op-cell 内 button 高约 39px），视觉间距 = margin + 0（gap 计算的是
       opsRow 底沿到按钮顶沿，含 op-cell 的 padding-bottom 3.44px）。
       断言 margin 生效：gap >= 8px（放宽到 8~14px 区间，防字体渲染差异）。 */
    ok('①b 常规模式展开/收起与批量行间距 ≥ 8px（margin-top 1.8667vw 生效）',
       gapNormal.gapPx >= 8, JSON.stringify(gapNormal));
    ok('①c 间距来源正确（margin-top 计算值 = 1.8667vw = 8.0267px）',
       /^8(\.0[0-9]*)?px$/.test(String(gapNormal.margin)), String(gapNormal.margin));

    // ① 紧凑模式下间距同样存在（.ld-compact 下规则同值）
    await evalJs(`(function(){try{localStorage.setItem('ld_compact','1');}catch(e){}if(window.LD&&LD.applyCompact)LD.applyCompact();return 1;})()`);
    await sleep(400);
    const gapCompact = JSON.parse(await evalJs(`(function(){
      var p=document.querySelector('.ct-project');
      if(!p) return JSON.stringify({found:false});
      var opsRow=p.querySelector('.project-ops'), toggle=p.querySelector('.op-full');
      if(!opsRow||!toggle) return JSON.stringify({found:true, missing:true});
      var r1=opsRow.getBoundingClientRect(), r2=toggle.getBoundingClientRect();
      return JSON.stringify({found:true, gapPx:Math.round((r2.top-r1.bottom)*100)/100,
        margin:getComputedStyle(toggle).marginTop});
    })()`) || '{}');
    ok('①d 紧凑模式展开/收起间距同样 ≥ 8px（不倒挂）',
       gapCompact.found === true && gapCompact.gapPx >= 8, JSON.stringify(gapCompact));
    await evalJs(`(function(){try{localStorage.setItem('ld_compact','0');}catch(e){}if(window.LD&&LD.applyCompact)LD.applyCompact();return 1;})()`);
    await sleep(400);

    // ② 检查更新弹窗（无更新分支：mock 默认 hasUpdate:false）
    //    进 safeline 子容器详情前先展开项目
    await evalJs(`(function(){var t=document.querySelector('.ct-project [data-ev="toggleProject"]');if(t)t.click();return 1;})()`);
    await sleep(700);
    const sub = await evalJs(`(function(){
      var subs=[].slice.call(document.querySelectorAll('.ct[data-ev="openDetail"]'))
        .filter(function(x){return ((x.querySelector('.ct-name')||{}).textContent||'').indexOf('safeline')===0;});
      if(!subs.length) return 'not-found';
      subs[0].click();
      return 'ok';
    })()`);
    ok('②a 展开 safeline 并进入子容器详情', sub === 'ok', sub);
    await sleep(900);

    // ③ 项目成员详情有「镜像更新」卡 + 警告行
    const projDetail = JSON.parse(await evalJs(`(function(){
      var card=null;
      [].slice.call(document.querySelectorAll('.card')).forEach(function(c){
        if(c.textContent.indexOf('镜像更新')>=0) card=c;
      });
      if(!card) return JSON.stringify({found:false});
      var warn=[].slice.call(card.querySelectorAll('.tiny')).some(function(t){return /属于多容器项目/.test(t.textContent);});
      return JSON.stringify({found:true, hasCheck:!!card.querySelector('[data-ev="checkUpdate"]'),
        hasUpgrade:!!card.querySelector('[data-ev="doUpgrade"]'), warn:warn});
    })()`) || '{}');
    ok('③a 项目成员详情页有「镜像更新」卡（检查更新 + 升级重建）',
       projDetail.found === true && projDetail.hasCheck === true && projDetail.hasUpgrade === true, JSON.stringify(projDetail));
    ok('③b 镜像更新卡内有 ⚠ 多容器项目警告行',
       projDetail.warn === true, JSON.stringify(projDetail));

    // ②b 无更新：点检查更新 → modal「已是最新版本」
    await evalJs(`(function(){var b=document.querySelector('[data-ev="checkUpdate"]');if(b)b.click();return 1;})()`);
    await sleep(700);
    const modalNo = JSON.parse(await evalJs(`(function(){
      var box=document.getElementById('ld-modal');
      var show=box&&box.classList.contains('show');
      return JSON.stringify({show:show, title:(box&&show)?box.querySelector('.ld-modal-title').textContent:'',
        text:(box&&show)?box.querySelector('.ld-modal-content').textContent.slice(0,60):''});
    })()`) || '{}');
    ok('②b 检查更新（无更新）弹出 modal：标题「已是最新版本」',
       modalNo.show === true && modalNo.title === '已是最新版本', JSON.stringify(modalNo));
    await closeModal();

    // ②c 有更新：注入 __ldCheckResult 点检查更新 → modal「发现新镜像」
    await evalJs(`(function(){window.__ldCheckResult={ok:true,hasUpdate:true,image:'ghcr.io/litedock-demo/aitutor:latest',repo:'ghcr.io/litedock-demo/aitutor',tag:'latest',oldId:'sha256:0f3575a85c8',newId:'sha256:7c84a186f0',message:'「aitutor」ghcr.io/litedock-demo/aitutor:latest 发现新镜像，可点「升级」重建'};var b=document.querySelector('[data-ev="checkUpdate"]');if(b)b.click();return 1;})()`);
    await sleep(700);
    const modalUpd = JSON.parse(await evalJs(`(function(){
      var box=document.getElementById('ld-modal');
      var show=box&&box.classList.contains('show');
      return JSON.stringify({show:show, title:(box&&show)?box.querySelector('.ld-modal-title').textContent:'',
        text:(box&&show)?box.querySelector('.ld-modal-content').textContent.slice(0,80):''});
    })()`) || '{}');
    ok('②c 检查更新（有更新）弹出 modal：标题「发现新镜像」+ 内容含提示',
       modalUpd.show === true && modalUpd.title === '发现新镜像' && /新镜像/.test(modalUpd.text || ''), JSON.stringify(modalUpd));
    await closeModal();

    // ③c 项目成员升级确认框含显著警告
    await evalJs(`(function(){var b=document.querySelector('[data-ev="doUpgrade"]');if(b)b.click();return 1;})()`);
    await sleep(500);
    const upConfirm = JSON.parse(await evalJs(`(function(){
      var box=document.getElementById('ld-modal');
      var show=box&&box.classList.contains('show');
      return JSON.stringify({show:show, title:(box&&show)?box.querySelector('.ld-modal-title').textContent:'',
        text:(box&&show)?box.querySelector('.ld-modal-content').textContent:''});
    })()`) || '{}');
    ok('③c 项目成员升级确认框含 ⚠ 属于多容器项目警告',
       upConfirm.show === true && upConfirm.title === '升级重建容器' &&
       /属于多容器项目/.test(upConfirm.text || '') && /版本不一致/.test(upConfirm.text || ''), JSON.stringify(upConfirm).slice(0, 200));
    await closeModal();
    await goBack();
    await evalJs(`(function(){var t=document.querySelector('.ct-project [data-ev="toggleProject"]');if(t)t.click();return 1;})()`);
    await sleep(500);

    // ④ 单容器项目（aitutor）详情入口不回归 + 无警告行
    const dt = await evalJs(`(function(){
      var cts=[].slice.call(document.querySelectorAll('.ct'));
      var c=cts.find(function(x){ return !x.classList.contains('ct-project') &&
        ((x.querySelector('.ct-name')||{}).textContent)==='aitutor'; });
      if(!c) return 'not-found';
      c.click();
      return 'ok';
    })()`);
    ok('④a 进入单容器项目 aitutor 详情', dt === 'ok', dt);
    await sleep(900);
    const singleDetail = JSON.parse(await evalJs(`(function(){
      var card=null;
      [].slice.call(document.querySelectorAll('.card')).forEach(function(c){
        if(c.textContent.indexOf('镜像更新')>=0) card=c;
      });
      if(!card) return JSON.stringify({found:false});
      var warn=[].slice.call(card.querySelectorAll('.tiny')).some(function(t){return /属于多容器项目/.test(t.textContent);});
      return JSON.stringify({found:true, hasCheck:!!card.querySelector('[data-ev="checkUpdate"]'), warn:warn});
    })()`) || '{}');
    ok('④b 单容器项目详情仍有「镜像更新」入口（不回归）',
       singleDetail.found === true && singleDetail.hasCheck === true, JSON.stringify(singleDetail));
    ok('④c 单容器项目不显示多容器警告行',
       singleDetail.warn === false, JSON.stringify(singleDetail));
    await goBack();

    // ⑤ 版本号
    const ver = await evalJs(`(function(){return (window.LD&&LD.APP_VERSION)||'';})()`);
    ok('⑤ APP 版本 1.0.25', ver === '1.0.25', ver);

    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('========================================');
    if (FAIL > 0) process.exitCode = 1;
  } catch (e) {
    console.error('ERROR:', e.message);
    FAIL++;
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
  }
}
main();
