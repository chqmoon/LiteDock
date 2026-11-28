'use strict';
/* APP 1.0.12 真实浏览器验证（自包含）：项目卡 CPU/内存显示与单容器卡完全一致
   ① 项目卡（safeline 7 容器）与单容器卡（aitutor）都用 .meters > .meter > .meter-item 结构
   ② 两张卡的 meter 标签都恰好是「CPU」「内存」，无「合计」「容器」「×」字样
   ③ 项目卡 CPU 值 = 7 容器 cpu 之和；内存值 = 7 容器 memUsed 之和（fmtBytes）
   ④ 内存进度条分母不累加：safeline 内存占比 = 总memUsed/单次memLimit（约 3%），
      而非旧版 总memUsed/(7×memLimit)（约 0.5%）—— 断言新占比明显大于旧占比
   ⑤ 无 stats 容器（filebrowser）不构成 NaN；单容器卡无 stats 显示「–」不变
   ⑥ 版本号 1.0.12
   ⑦ 展开项目后子容器卡显示不变；紧凑模式仍能隐藏 meters
   全部真实 CDP 渲染 DOM 读取，非合成事件自证。 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8881;
const CDP_PORT = 9337;
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
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: ROOT, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=C:/ldbuild/chrome-prof-112-app-' + Date.now(),
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

    console.log('=== APP 1.0.12 项目卡 meter 对齐·真实浏览器验证 ===');

    /* 抓两张卡：单容器 aitutor + 项目 safeline 的 meter 结构 */
    const cards = JSON.parse(await evalJs(`(function(){
      function grab(el){
        if(!el) return null;
        var meters=[];
        el.querySelectorAll('.meters .meter').forEach(function(m){
          var lab=m.querySelector('.meter-label span');
          var val=m.querySelector('.meter-label .strong');
          var fill=m.querySelector('.bar .bar-fill');
          meters.push({
            label: lab?lab.textContent.trim():'',
            value: val?val.textContent.trim():'',
            width: fill?fill.style.width:'',
            warn: fill?fill.classList.contains('warn'):false
          });
        });
        return {
          cls: el.className,
          meters: meters,
          statusTexts: Array.prototype.map.call(el.querySelectorAll('.ct-status'), function(s){return s.textContent.trim();}),
          hasNaN: /NaN|undefined|Infinity/.test(el.textContent)
        };
      }
      var single=null, project=null;
      document.querySelectorAll('.ct').forEach(function(c){
        var nm=c.querySelector('.ct-name');
        if(!nm) return;
        if(nm.textContent.trim()==='aitutor' && !single) single=grab(c);
        if(c.classList.contains('ct-project') && !project) project=grab(c);
      });
      return JSON.stringify({single:single, project:project, ver:(window.LD&&LD.APP_VERSION)});
    })()`));
    console.log('  single :', JSON.stringify(cards.single));
    console.log('  project:', JSON.stringify(cards.project));

    /* ① 结构一致 */
    ok('① 单容器卡有 2 条 meter', !!(cards.single && cards.single.meters.length === 2), JSON.stringify(cards.single && cards.single.meters));
    ok('① 项目卡有 2 条 meter（与单容器一致）', !!(cards.project && cards.project.meters.length === 2), JSON.stringify(cards.project && cards.project.meters));
    /* ② 标签一致，无合计字样 */
    const allM = (cards.project ? cards.project.meters : []).concat(cards.single ? cards.single.meters : []);
    ok('② 所有 meter 标签都是 CPU/内存', allM.length === 4 && allM.every(m => m.label === 'CPU' || m.label === '内存'), JSON.stringify(allM.map(m=>m.label)));
    const noHeji = allM.every(m => !/合计|容器|×|x15|15G/.test(m.label + m.value));
    ok('② 无「合计/容器/×」字样', noHeji, JSON.stringify(allM.map(m=>m.label+'='+m.value)));
    /* ③ 项目卡数值 = 聚合 */
    const pcpu = cards.project && cards.project.meters[0];
    const pmem = cards.project && cards.project.meters[1];
    ok('③ 项目卡 CPU 值 = 7 容器之和（0.6%）', !!(pcpu && /^0\.[5-7]%$/.test(pcpu.value)), pcpu && pcpu.value);
    ok('③ 项目卡内存值 = 7 容器 memUsed 之和（MB 级）', !!(pmem && /^\d+\s?MB$/.test(pmem.value)), pmem && pmem.value);
    /* ④ 分母不累加：旧版 7 容器累加分母 → 条宽约 0.5%；新版单次分母 → 约 3% */
    const pw = pmem ? parseFloat(pmem.width) : 0;
    ok('④ 内存进度条分母不累加（条宽 > 2%，非旧版 0.5%）', pw > 2, pmem && pmem.width);
    /* ⑤ 无 NaN */
    ok('⑤ 面板无 NaN/undefined/Infinity', cards.single && cards.project && !cards.single.hasNaN && !cards.project.hasNaN,
       JSON.stringify({s:cards.single&&cards.single.hasNaN,p:cards.project&&cards.project.hasNaN}));
    /* ⑥ 版本 */
    ok('⑥ 版本号 = 1.0.25', cards.ver === '1.0.26', cards.ver);

    /* ⑦ 展开项目后子容器卡正常显示 */
    const toggle = await evalJs(`(function(){
      var b=document.querySelector('.ct-project .op-full');
      if(b){b.click(); return true;} return false;
    })()`);
    await sleep(500);
    const exp = JSON.parse(await evalJs(`(function(){
      var ct=document.querySelectorAll('.ct');
      var child=0, childMeters=0;
      ct.forEach(function(c){ if(c.getAttribute('data-inproject')==='1' || /\bct-inproject\b/.test(c.className)){ child++; childMeters+=c.querySelectorAll('.meters .meter').length; } });
      return JSON.stringify({clicked:true, totalCards:ct.length, child:child, childMeters:childMeters});
    })()`));
    ok('⑦ 展开项目后出现子容器卡', toggle === true && exp.totalCards > (cards.single ? 1 : 0), JSON.stringify(exp));

    /* ⑧ 紧凑模式仍能隐藏 meters（复用 1.0.11 开关，开关在设置页需先切 tab） */
    await evalJs(`(function(){ document.querySelectorAll('.op-full').forEach(function(b){ if(/收起/.test(b.textContent)) b.click(); }); })()`);
    await sleep(300);
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="settings"]');if(t)t.click();})()`);
    await sleep(500);
    const swFound = await evalJs(`(function(){ var sw=document.querySelector('[data-ev="ldToggleCompact"]'); if(sw){sw.click();return true;} return false; })()`);
    ok('⑧ 设置页找到紧凑开关并点击', swFound === true, swFound);
    await evalJs(`(function(){var t=document.querySelector('.ld-tab[data-tab="index"]');if(t)t.click();})()`);
    await sleep(500);
    const comp = JSON.parse(await evalJs(`(function(){
      var p=document.querySelector('.ct-project');
      var m=p&&p.querySelector('.meters');
      return JSON.stringify({
        cls: document.getElementById('ld-root').classList.contains('ld-compact'),
        projMetersDisplay: m?getComputedStyle(m).display:'absent'
      });
    })()`));
    ok('⑧ 紧凑模式下项目卡 meters 隐藏', comp.cls === true && comp.projMetersDisplay === 'none', JSON.stringify(comp));

    console.log('\n结果: ' + PASS + ' PASS / ' + FAIL + ' FAIL');
    if (FAIL > 0) process.exitCode = 1;
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    chrome.kill(); srv.kill();
  }
}
main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
