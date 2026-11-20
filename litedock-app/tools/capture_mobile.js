/* 用 CDP 精确设置 390×844 手机视口再截图（headless Chrome 默认最小宽度 512，
   直接 --window-size 不准）。Node 22 自带 WebSocket，无需额外依赖。
   用法：先启动 chrome --headless --remote-debugging-port=9222，再 node tools/capture_mobile.js <out.png> [url] */
'use strict';
const fs = require('fs');
const out = process.argv[2] || 'preview.png';
const url = process.argv[3] || 'http://127.0.0.1:8777/';

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  let page = targets.find(t => t.type === 'page');
  if (!page) {
    const created = await (await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
    page = created;
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params) => new Promise(resolve => {
    const n = ++id; pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    screenWidth: 390, screenHeight: 844
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 3500));

  const metrics = await send('Runtime.evaluate', {
    expression: `JSON.stringify({w:document.documentElement.clientWidth,sw:document.body.scrollWidth,v:document.querySelector('#ld-page')?document.querySelector('#ld-page').getAttribute('data-page'):'?',LD:typeof LD,wx:typeof wx,cap:!!(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.LiteDockHttp),conn:localStorage.getItem('fd_active_id'),body:document.body.innerText.slice(0,180),pageLen:(document.querySelector('#ld-page')||{}).innerHTML?.length||0,hero:!!document.querySelector('.hero'),groups:document.querySelectorAll('.group').length,cards:document.querySelectorAll('.ct').length,tabs:document.querySelectorAll('.ld-tab').length})`,
    returnByValue: true
  });
  console.log('metrics:', metrics.result && metrics.result.result && metrics.result.result.value);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('wrote', out, fs.statSync(out).size, 'bytes');
  } else {
    console.log('screenshot failed', JSON.stringify(shot).slice(0, 300));
    process.exitCode = 1;
  }
  ws.close();
}
main().catch(e => { console.error(e); process.exit(1); });
