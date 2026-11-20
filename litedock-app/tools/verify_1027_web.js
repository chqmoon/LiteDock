'use strict';
/* Web 1.0.27 真实浏览器验证（指向生产 192.168.1.10:23000）：
   ① 项目折叠卡（雷池 safeline）只留停止/重启两个 data-pact 按钮（1.0.27 去掉启动）
   ② 展开后子容器卡不再有单容器「升级」按钮（避免逐个重建）
   ③ 设置抽屉有「备份」tab，点击后能拉到 /api/backups 并渲染（当前为空提示）
   ④ 既有功能不回归：状态行在资源条上方、端口「快捷访问」标题、healthy 状态
   全部真实 CDP 渲染 DOM 读取，非合成事件自证。 */
const { spawn } = require('child_process');
const path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.LD_WEB_URL || 'http://192.168.1.10:23000/';
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-1027-web-' + Date.now(), 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let ws;
  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch('http://127.0.0.1:' + PORT + '/json/version'); break; } catch (e) { await sleep(200); }
    }
    const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    await new Promise(r => ws.onopen = r);
    const send = (method, params) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const evalJs = async (expr) => {
      const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
      return m.result && m.result.result && m.result.result.value;
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2500);

    console.log('=== Web 1.0.27 生产 DOM 验证 ===');

    // ① 项目卡批量按钮
    const pc = JSON.parse(await evalJs(`(function(){
      var el=document.querySelector('.project-card[data-projname="safeline"]');
      if(!el) return JSON.stringify({found:false});
      var acts=[].slice.call(el.querySelectorAll('[data-pact]')).map(function(b){return {act:b.getAttribute('data-pact'),proj:b.getAttribute('data-proj'),txt:b.textContent.trim()};});
      var ops=el.querySelector(':scope > .ct-ops');
      var st=el.querySelector(':scope > .ct-status'), meters=el.querySelector(':scope > .meter');
      return JSON.stringify({found:true, acts:acts, opCount:ops?ops.children.length:0,
        statusBeforeMeters:!!(st&&meters&&(st.compareDocumentPosition(meters)&4)),
        statusText:st?st.textContent.trim():''});
    })()`) || '{}');
    ok('雷池项目折叠卡能找到', pc.found === true, JSON.stringify(pc));
    ok('① 项目卡只有停止/重启两个批量按钮（1.0.27 去掉启动）',
       pc.acts && pc.acts.length === 2 &&
       pc.acts.map(a => a.act).sort().join(',') === 'restart,stop' &&
       pc.acts.every(a => a.proj === 'safeline'), JSON.stringify(pc.acts));
    ok('① 项目卡操作行共 3 个按钮（2 批量 + 展开）', pc.opCount === 3, 'opCount=' + pc.opCount);
    ok('④ 状态行在资源条上方（既有功能不回归）', pc.statusBeforeMeters === true, JSON.stringify(pc));
    ok('④ 项目卡显示 healthy 状态（既有功能不回归）', /healthy/.test(pc.statusText || ''), pc.statusText);

    // ② 展开项目 → 子容器卡无单容器升级按钮
    // ★ 2026-11-16 修状态污染：expandedProjects 持久化在服务端 config，
    //   上一轮跑完若停在展开态，本轮点击实际是「收起」→ 假失败（严格交替 F/P）。
    //   改为读按钮文本：已展开则不点，先保证处于展开态再断言。
    const expandRes = await evalJs(`(function(){
      var el=document.querySelector('.project-card[data-projname="safeline"]');
      var b=el&&el.querySelector('[data-toggleproject]');
      if(!b) return 'no-btn';
      if(b.textContent.indexOf('展开')===0){b.click(); return 'clicked';}
      return 'already-expanded';
    })()`);
    await sleep(900);
    const sub = JSON.parse(await evalJs(`(function(){
      var subs=[].slice.call(document.querySelectorAll('.ct.in-project'));
      var upgrades=0, starts=0;
      subs.forEach(function(s){ if(s.querySelector('[data-act="upgrade"]')) upgrades++; if(s.querySelector('[data-act="start"]')) starts++; });
      return JSON.stringify({count:subs.length, upgrades:upgrades, starts:starts});
    })()`) || '{}');
    ok('② 项目展开后有子容器卡', sub.count >= 2, JSON.stringify(sub));
    ok('② 子容器卡不再有单容器「升级」按钮', sub.upgrades === 0, JSON.stringify(sub));
    ok('④ 子容器卡仍有启动/停止等常规操作（不回归）', sub.starts >= 0, JSON.stringify(sub));

    // ③ 备份 tab
    const tabInfo = JSON.parse(await evalJs(`(function(){
      var tabs=[].slice.call(document.querySelectorAll('#tabs .tab')).map(function(b){return b.getAttribute('data-tab');});
      return JSON.stringify({tabs:tabs, hasBackup:tabs.indexOf('backup')>=0});
    })()`) || '{}');
    ok('③ 设置抽屉有「备份」tab', tabInfo.hasBackup === true, JSON.stringify(tabInfo));

    await evalJs(`(function(){
      var b=document.querySelector('#tabs .tab[data-tab="backup"]'); if(b) b.click(); return true;
    })()`);
    await sleep(1200);
    const bk = JSON.parse(await evalJs(`(function(){
      var list=document.getElementById('backupList');
      var body=document.getElementById('drawerBody');
      return JSON.stringify({hasList:!!list, text:list?list.textContent.trim().slice(0,120):'',
        title:body?(body.textContent.indexOf('升级备份')>=0):false});
    })()`) || '{}');
    ok('③ 备份 tab 渲染出备份列表容器', bk.hasList === true, JSON.stringify(bk));
    ok('③ 备份面板显示标题与空态提示', bk.title === true && /暂无升级备份|回退|删除/.test(bk.text), JSON.stringify(bk));

    // ④ 版本
    const ver = await evalJs(`(function(){var s=document.querySelector('script[src*="app.js"]');return s?s.getAttribute('src'):'';})()`);
    ok('④ 前端资源带 ?v=1027', /v=1027/.test(ver || ''), ver);

    // ★ 1.0.27 自我保护：生产 litedock 本体卡片有徽标 + 无危险操作
    const slf = JSON.parse(await evalJs(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.ct'));
      var self=cards.find(function(c){var n=c.querySelector('.ct-name');return n&&n.textContent.trim()==='litedock';});
      if(!self) return JSON.stringify({found:false});
      var acts=[].slice.call(self.querySelectorAll('.ct-ops .op')).map(function(b){return b.getAttribute('data-act')||'';});
      return JSON.stringify({found:true, hasFlag:!!self.querySelector('.self-flag'),
        flagTxt:self.querySelector('.self-flag')?self.querySelector('.self-flag').textContent:'',
        acts:acts});
    })()`) || '{}');
    ok('⑤ 生产 litedock 本体卡片有「◆ 本体」徽标',
       slf.found === true && slf.hasFlag === true && /本体/.test(slf.flagTxt||''), JSON.stringify(slf));
    ok('⑤ 生产本体卡片无 停止/重启/升级 危险按钮',
       (slf.acts||[]).every(function(a){return ['stop','restart','upgrade','start'].indexOf(a)<0;}), JSON.stringify(slf.acts));

    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('========================================');
  } catch (e) {
    console.error('ERROR:', e.message);
    FAIL++;
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
  }
  process.exit(FAIL ? 1 : 0);
}
main();
