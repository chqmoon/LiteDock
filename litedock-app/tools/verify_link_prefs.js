'use strict';
/* LiteDock App 1.0.8 真实浏览器验证：两个外网开关能否真正作用到容器卡片。
 *
 * 为什么单独写这个脚本：上一轮用合成事件回放宣称修好了长按，真机仍复现。
 * 本脚本只走真实链路 —— 真实 Chrome（CDP 390x844）+ 真实鼠标事件
 * Input.dispatchMouseEvent 点设置页开关 + 真实 UI tab 切页，然后读取真实
 * 渲染出来的容器卡片 DOM，逐项断言「访问链接 / 容器端口」chip 的出现与消失。
 *
 * 覆盖：
 *   四组合 A(外网显示已配反代的服务) x B(外网也显示容器端口)
 *   A开B关(默认) / A开B开 / A关B开 / A关B关
 *   + 外网地址优先于内网地址、没配外网访问的容器不凭空出现链接
 *   + 开关持久化(reload)、直连不受开关影响、详情页 chips 与卡片一致
 *
 * 运行：node tools/verify_link_prefs.js
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOOLS = __dirname;
const ROOT = path.join(TOOLS, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 23108;
const CDP_PORT = 9238;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const SHOT_DIR = path.join(ROOT, 'screenshots');
const FIXTURE = path.join(TOOLS, 'fixtures', 'state_link_prefs.json');

let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { if (c) { PASS++; console.log('  OK   ' + n); } else { FAIL++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 读取真实渲染的卡片 DOM。data-kind 由 templates.js 输出：
   custom = Web 端配的访问链接，port = 容器端口映射。 */
const READ = `(function(){
  function cardOf(name){
    var cs=document.querySelectorAll('.ct');
    for(var i=0;i<cs.length;i++){
      var n=cs[i].querySelector('.ct-name');
      if(n && n.textContent.trim()===name) return cs[i];
    }
    return null;
  }
  function stat(name){
    var c=cardOf(name);
    if(!c) return {found:false};
    function urls(k){ return [].slice.call(c.querySelectorAll('.chip[data-kind="'+k+'"]'))
      .map(function(x){ return x.getAttribute('data-url'); }); }
    return {found:true, custom:urls('custom'), port:urls('port'),
            portsBlock:!!c.querySelector('.ports'),
            noPort:!!c.querySelector('.no-port')};
  }
  return JSON.stringify({
    aitutor:stat('aitutor'),
    litedock:stat('litedock'),
    proxySwitch:stat('proxy-switch'),
    prefs:{wan:(window.LD&&LD.appWanLinks)?LD.appWanLinks():null,
           ports:(window.LD&&LD.appPortsAlways)?LD.appPortsAlways():null},
    stored:{wan:localStorage.getItem('ld_wan_links'),
            ports:localStorage.getItem('ld_ports_always')},
    conn:(function(){try{var c=LD.require('utils/connection.js').getActive();return c?{type:c.type,url:c.url}:null;}catch(e){return null;}})()
  });
})()`;

const SWITCHES = `(function(){
  function st(ev){
    var r=document.querySelector('[data-ev="'+ev+'"]');
    if(!r) return {found:false};
    return {found:true, on:!!r.querySelector('.ld-switch.on'),
            text:((r.querySelector('span')||{}).textContent||'').trim()};
  }
  return JSON.stringify({wan:st('ldToggleWanLinks'), ports:st('ldTogglePorts')});
})()`;

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const env = Object.assign({}, process.env, {
    LD_FIXTURE: FIXTURE, LD_PORT: String(PREVIEW_PORT)
  });
  const py = process.env.LD_PY || 'python';
  const server = spawn(py, [path.join(TOOLS, 'serve_preview.py')],
    { stdio: 'ignore', windowsHide: true, cwd: TOOLS, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-app-108-' + Date.now(), 'about:blank'
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
    const read = async () => JSON.parse(await evalJs(READ) || '{}');
    const switches = async () => JSON.parse(await evalJs(SWITCHES) || '{}');

    /* 真实鼠标点击（CDP Input 域），点击前滚动到视口内 */
    const click = async (sel) => {
      const box = JSON.parse(await evalJs(`(function(){
        var el=document.querySelector(${JSON.stringify(sel)});
        if(!el) return JSON.stringify({found:false});
        el.scrollIntoView({block:'center'});
        var b=el.getBoundingClientRect();
        return JSON.stringify({found:true,x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});
      })()`) || '{}');
      if (!box.found) return false;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(380);
      return true;
    };
    const tab = async (name) => click('.ld-tab[data-tab="' + name + '"]');
    const toggle = async (ev) => click('[data-ev="' + ev + '"]');
    /* 精确点某张容器卡片的左上角（避开 chips 与操作按钮），进详情页 */
    const clickCard = async (name) => {
      const box = JSON.parse(await evalJs(`(function(){
        var cs=document.querySelectorAll('.ct[data-ev="openDetail"]');
        for(var i=0;i<cs.length;i++){
          var n=cs[i].querySelector('.ct-name');
          if(n && n.textContent.trim()===${JSON.stringify(name)}){
            cs[i].scrollIntoView({block:'center'});
            var b=cs[i].getBoundingClientRect();
            return JSON.stringify({found:true,x:Math.round(b.left+40),y:Math.round(b.top+28)});
          }
        }
        return JSON.stringify({found:false});
      })()`) || '{}');
      if (!box.found) return false;
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(480);
      return true;
    };

    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: URL });
    await sleep(1600);
    /* 双保险：profile 每次都是新的，这里再把两个偏好键清掉并重载，
       确保「默认 A 开 / B 关」的断言不被上一次回放的残留值污染。 */
    await evalJs(`(function(){
      localStorage.removeItem('ld_wan_links');
      localStorage.removeItem('ld_ports_always');
      return 1;
    })()`);
    await send('Page.reload', { ignoreCache: true });
    await sleep(2400);

    console.log('=== 1.0.8 双开关：真实浏览器四组合验证（390x844） ===');

    /* ---------- 默认：A 开 / B 关 ---------- */
    let r = await read();
    ok('预览连接是反向代理类型', (r.conn || {}).type === 'proxy', JSON.stringify(r.conn));
    ok('默认 A 开 / B 关（与 1.0.7 表现一致）',
      r.prefs.wan === true && r.prefs.ports === false && r.stored.wan === null, JSON.stringify(r.prefs));
    ok('默认：aitutor 卡片渲染出来了', (r.aitutor || {}).found === true, JSON.stringify(r.aitutor));
    ok('默认：只显示 Web 端配的「外网」访问链接（不是内网 links）',
      (r.aitutor.custom || []).length === 1 &&
      /aitutor\.nas\.example\.com/.test(r.aitutor.custom[0] || '') &&
      (r.aitutor.port || []).length === 0, JSON.stringify(r.aitutor));
    ok('默认：没配外网访问的容器不凭空出现访问链接',
      (r.litedock.custom || []).length === 0 && (r.litedock.port || []).length === 0,
      JSON.stringify(r.litedock));
    await shot('LiteDock-App-1.0.8-A-on-B-off.png');

    /* ---------- 设置页：两个固定标签的独立开关 ---------- */
    ok('能真实点开设置 tab', await tab('settings'), '');
    await sleep(350);
    let sw = await switches();
    ok('设置页同时存在两个独立开关',
      sw.wan.found && sw.ports.found &&
      sw.wan.text === '外网显示已配反代的服务' &&
      sw.ports.text === '外网也显示容器端口', JSON.stringify(sw));
    ok('开关初始状态 A 亮 / B 灭', sw.wan.on === true && sw.ports.on === false, JSON.stringify(sw));

    /* ---------- 组合 2：A 开 / B 开（用户明确要求「确实能同时显示」） ---------- */
    ok('真实点击 B 开关', await toggle('ldTogglePorts'), '');
    await tab('index'); await sleep(500);
    r = await read();
    ok('A开B开：访问链接与容器端口「同时」出现在同一张卡片',
      (r.aitutor.custom || []).length === 1 && (r.aitutor.port || []).length === 1,
      JSON.stringify(r.aitutor));
    ok('A开B开：访问链接仍是外网 linksWan（旧版开启端口会把它换成内网 links）',
      /aitutor\.nas\.example\.com/.test(r.aitutor.custom[0] || ''), JSON.stringify(r.aitutor.custom));
    ok('A开B开：端口按「容器链接主机」生成 192.168.1.10:3782',
      (r.aitutor.port[0] || '') === 'http://192.168.1.10:3782', JSON.stringify(r.aitutor.port));
    ok('A开B开：没配访问链接的容器只出现端口，不凭空造链接',
      (r.litedock.custom || []).length === 0 && (r.litedock.port || []).length >= 1,
      JSON.stringify(r.litedock));
    ok('A开B开：偏好确实写入 localStorage',
      r.stored.ports === '1' && r.prefs.ports === true && r.prefs.wan === true, JSON.stringify(r.stored));
    await shot('LiteDock-App-1.0.8-A-on-B-on.png');

    /* ---------- 组合 3：A 关 / B 开 ---------- */
    await tab('settings'); await sleep(300);
    ok('真实点击 A 开关', await toggle('ldToggleWanLinks'), '');
    await tab('index'); await sleep(500);
    r = await read();
    ok('A关B开：访问链接消失，只剩容器端口',
      (r.aitutor.custom || []).length === 0 && (r.aitutor.port || []).length === 1,
      JSON.stringify(r.aitutor));
    ok('A关B开：B 的偏好没有被 A 连带改掉',
      r.stored.wan === '0' && r.stored.ports === '1' && r.prefs.ports === true, JSON.stringify(r.stored));
    await shot('LiteDock-App-1.0.8-A-off-B-on.png');

    /* ---------- 组合 4：A 关 / B 关 ---------- */
    await tab('settings'); await sleep(300);
    ok('再次真实点击 B 开关', await toggle('ldTogglePorts'), '');
    await tab('index'); await sleep(500);
    r = await read();
    ok('A关B关：卡片里两类链接都不显示',
      (r.aitutor.custom || []).length === 0 && (r.aitutor.port || []).length === 0,
      JSON.stringify(r.aitutor));
    ok('A关B关：整个「访问链接」区块收起（不是留一块空白）',
      r.aitutor.portsBlock === false, JSON.stringify(r.aitutor));
    ok('A关B关：未配链接的容器同样收起',
      r.litedock.portsBlock === false, JSON.stringify(r.litedock));
    await shot('LiteDock-App-1.0.8-A-off-B-off.png');

    /* ---------- 回到默认，并验证开关可再次打开 ---------- */
    await tab('settings'); await sleep(300);
    await toggle('ldToggleWanLinks');
    sw = await switches();
    ok('重新打开 A 后开关变亮，B 仍保持关闭',
      sw.wan.on === true && sw.ports.on === false, JSON.stringify(sw));
    await tab('index'); await sleep(450);
    r = await read();
    ok('恢复默认：只剩外网访问链接',
      (r.aitutor.custom || []).length === 1 && (r.aitutor.port || []).length === 0,
      JSON.stringify(r.aitutor));

    /* ---------- 持久化：设成 A开B开 后 reload ---------- */
    await tab('settings'); await sleep(300);
    await toggle('ldTogglePorts');
    await send('Page.reload', { ignoreCache: true });
    await sleep(2400);
    r = await read();
    ok('reload 后两个开关偏好仍然保留',
      r.prefs.wan === true && r.prefs.ports === true, JSON.stringify(r.prefs));
    ok('reload 后卡片仍同时显示访问链接 + 端口（不是只记住开关样子）',
      (r.aitutor.custom || []).length === 1 && (r.aitutor.port || []).length === 1,
      JSON.stringify(r.aitutor));

    /* ---------- 详情页 chips 与卡片一致 ---------- */
    const detailClicked = await clickCard('aitutor');
    await sleep(500);
    const detail = JSON.parse(await evalJs(`(function(){
      var chips=[].slice.call(document.querySelectorAll('.detail-page .chips .chip'));
      return JSON.stringify({found:!!document.querySelector('.detail-page'),
        custom:chips.filter(function(x){return x.getAttribute('data-kind')==='custom';}).length,
        port:chips.filter(function(x){return x.getAttribute('data-kind')==='port';}).length});
    })()`) || '{}');
    ok('详情页能打开', detailClicked === true && detail.found === true, JSON.stringify(detail));
    ok('详情页 chips 与卡片一致（A开B开 = 1 链接 + 至少 1 端口）',
      detail.custom === 1 && detail.port >= 1, JSON.stringify(detail));

    /* ---------- 直连：两个开关都不影响 ---------- */
    await send('Page.navigate', { url: URL });
    await sleep(2300);
    const swapped = await evalJs(`(function(){
      try{
        var c=LD.require('utils/connection.js');
        var r=c.save({url:'http://192.168.1.10:23000',name:'LAN 直连',host:'192.168.1.10'});
        if(!r.ok) return 'save failed: '+r.error;
        c.setActive(r.value.id);
        var a=getApp(); if(a&&a.invalidate) a.invalidate();
        var i=LD.pageInstance('index'); if(i&&i.load) i.load(true);
        return 'ok:'+r.value.type;
      }catch(e){ return 'ERR '+e.message; }
    })()`);
    await sleep(900);
    r = await read();
    ok('能切到局域网直连连接', /^ok:lan$/.test(String(swapped)), String(swapped));
    ok('直连不受两个开关影响：照常显示内网 links + 自动端口（既有功能不变）',
      (r.aitutor.custom || []).some(u => u === 'http://192.168.1.10:18081/aitutor/') &&
      (r.aitutor.port || []).some(u => /:3782$/.test(u || '')), JSON.stringify(r.aitutor));

    ws.close();
    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('截图目录: ' + SHOT_DIR);
    if (FAIL) process.exitCode = 1;
  } finally {
    try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { }
    try { execSync('taskkill /PID ' + server.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) { }
  }
}
main().catch(e => { console.error('ERROR', e && e.stack || e); process.exitCode = 1; });
