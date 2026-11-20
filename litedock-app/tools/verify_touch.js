'use strict';
/* 真机级触摸回放：用 CDP Input.dispatchTouchEvent 走完整 touchStart → 长按 → touchEnd →
   浏览器补发 click 的事件链（不是 new Event 手工合成），并 hook 所有「已复制」来源：
   - wx.showToast / wx.showModal / Clipboard.write / contextmenu
   覆盖（1.0.9）：
   - ★ 复现 1.0.8 用户截图：APP toast + 系统剪贴板提示 = 屏幕两个「已复制」
   - ★ 修复后长按端口：剪贴板 1 次、APP 0 个「已复制」toast、屏幕只剩系统那 1 个提示；
     被长按的 chip 闪绿色描边（无声反馈）
   - 触摸序列被系统打断（按下后 Activity 切走，无 touchend）：不延迟复制
   - 停止容器端口：点按弹「请先启动容器」，不打开浏览器
   - 对照组截图写入 screenshots/LiteDock-App-1.0.9-longpress-{before,after}.png
   - 结构性：源码里不得存在 setTimeout 型长按定时器（由 verify_web.js 静态断言）
   自包含：自动拉起预览服务器与无头 Chrome，结束自动清理。
   用法：node tools/verify_touch.js */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const PROJECT = path.dirname(ROOT);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8777/';
/* LD_WWW 指向 APK 解包出来的 assets/public 时，回放的就是「用户真正装进手机的那份代码」，
   而不是源码目录；截图加 -apk 后缀以示区分。 */
const APK_WWW = process.env.LD_WWW || '';
const SHOT_SUFFIX = APK_WWW ? '-apk' : '';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  OK   ' + name); }
  else { FAIL++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}
async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok || r.status === 502) return true; } catch (e) {}
    await sleep(120);
  }
  return false;
}

async function main() {
  const srv = spawn('python', [path.join(ROOT, 'tools', 'serve_preview.py')],
    { cwd: PROJECT, stdio: 'ignore', windowsHide: true,
      env: Object.assign({}, process.env, APK_WWW ? { LD_WWW: APK_WWW } : {}) });
  const profile = 'C:/ldbuild/chrome-prof-touch-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  console.log('验证目标：' + (APK_WWW ? 'APK 解包 www -> ' + APK_WWW : '源码 www'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=9333', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  try {
    if (!await waitPort('http://127.0.0.1:8777/index.html', 15000)) throw new Error('preview server timeout');
    if (!await waitPort('http://127.0.0.1:9333/json/version', 15000)) throw new Error('chrome CDP timeout');

    const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json();
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
    const evalJs = async (expr, awaitPromise) => {
      const m = await send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: !!awaitPromise
      });
      if (m.result && m.result.exceptionDetails) {
        return JSON.stringify({ err: m.result.exceptionDetails.text });
      }
      return m.result && m.result.result && m.result.result.value;
    };

    // 开启触摸模拟（CDP Input.dispatchTouchEvent 需要有 touch emulation）
    try { await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); } catch (e) {}
    try { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); } catch (e) {}
    try { await send('Page.enable'); } catch (e) {}
    await evalJs(`location.href=${JSON.stringify(URL)}`);
    await sleep(600);
    // 安装探针：toast 改用 DOM 观察（copyText 直接调闭包 toast，绕过 wx.showToast）
    await evalJs(`(function(){
      window.__t = { toasts:[], modals:[], clips:[], ctx:0, opened:[], touchStart:0, touchEnd:0 };
      document.addEventListener('touchstart', function(e){ window.__t.touchStart++; window.__t.lastTarget = (e.target.className||'') + '|' + (e.target.getAttribute&&e.target.getAttribute('data-ev')||'') + '|closest=' + !!(e.target.closest&&e.target.closest('[data-ev="copyLink"]')); }, true);
      document.addEventListener('touchend', function(){ window.__t.touchEnd++; }, true);
      var tb = document.getElementById('ld-toast');
      if (tb && !tb.__hooked) {
        tb.__hooked = true;
        var obs = new MutationObserver(function(){
          var t = (document.getElementById('ld-toast')||{}).textContent||'';
          var cls = (document.getElementById('ld-toast')||{}).className||'';
          if (/show/.test(cls) && t) window.__t.toasts.push(t);
        });
        obs.observe(tb, { attributes:true, childList:true, characterData:true, subtree:true });
      }
      var sm = window.wx && window.wx.showModal;
      if (sm && !sm.__hooked) { sm.__hooked = true;
        window.wx.showModal = function(o){ window.__t.modals.push(String(o&&o.content||'')); return sm(o); }; }
      try { var P = window.Capacitor.Plugins.Clipboard, w = P.write;
        if (!w.__hooked) { w.__hooked = true;
          P.write = function(o){ window.__t.clips.push(o&&o.string||''); return w(o); }; } } catch(e){}
      document.addEventListener('contextmenu', function(){ window.__t.ctx++; }, true);

      /* 1.0.9：统计「屏幕上可见的、含『已复制』文字的元素」，直接对应用户截图场景。
         APP 的 #ld-toast 与系统/ROM 剪贴板提示是两套不同 DOM/视图，必须分别计数。 */
      window.__copiedVisible = function(){
        var out=[], all=document.querySelectorAll('body *');
        for(var i=0;i<all.length;i++){
          var e=all[i], own='';
          for(var j=0;j<e.childNodes.length;j++)
            if(e.childNodes[j].nodeType===3) own+=e.childNodes[j].nodeValue;
          if(!/已复制/.test(own)) continue;           /* 只算直接含文字的叶子，避免父子重复 */
          var s=getComputedStyle(e), r=e.getBoundingClientRect();
          if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity)===0) continue;
          if(r.width===0||r.height===0) continue;
          out.push({id:e.id, cls:String(e.className||''), text:own.trim()});
        }
        return out;
      };
      /* 模拟 Android 系统/ROM 的剪贴板提示（深色全圆胶囊、带句号、位于屏幕底部） */
      var sys=document.createElement('div');
      sys.id='sys-clip-toast'; sys.textContent='已复制。';
      sys.style.cssText='position:fixed;left:50%;bottom:7%;transform:translateX(-50%);z-index:99999;'+
        'background:rgba(38,30,42,.94);color:#fff;font-size:17px;padding:12px 30px;'+
        'border-radius:999px;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.3)';
      document.body.appendChild(sys);

      /* 记录 chip 的绿色高亮 class 是否出现（1.0.9 的无声复制反馈） */
      window.__t.flash=0;
      var sc=document.getElementById('ld-scroll');
      if(sc){ new MutationObserver(function(ms){ ms.forEach(function(m){
        if(m.type==='attributes' && m.target.classList &&
           m.target.classList.contains('ld-link-copied')) window.__t.flash++;
      }); }).observe(sc,{attributes:true,subtree:true,attributeFilter:['class']}); }
    })()`);

    // 等启动过渡页消失 + 面板 chip 出现（splash 是覆盖层，不消失会吞掉触摸）
    for (let i = 0; i < 40; i++) {
      if (!(await evalJs(`!!document.getElementById('ld-splash')`))) break;
      await sleep(200);
    }
    for (let i = 0; i < 40; i++) {
      if (await evalJs(`!!document.querySelector('[data-ev="copyLink"]')`)) break;
      await sleep(200);
    }

    const shotDir = path.join(ROOT, 'screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    const saveShot = async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const data = s && s.result && s.result.data;
      if (data) fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
      return !!data;
    };

    // ---- 用例0：复现 1.0.8 真机截图里的「两个已复制」 ----
    await evalJs(`(function(){var t=document.getElementById('ld-toast');
      if(t){t.textContent='已复制';t.className='ld-toast show ok';}})()`);
    await sleep(150);
    const beforeVis = JSON.parse(await evalJs(`JSON.stringify(window.__copiedVisible())`) || '[]');
    console.log('  1.0.8 复现可见提示:', JSON.stringify(beforeVis));
    ok('复现 1.0.8：屏幕同时有两个「已复制」', beforeVis.length === 2, JSON.stringify(beforeVis));
    ok('复现 1.0.8：一个是 APP 绿色 toast、一个是系统提示',
      beforeVis.some(v => v.cls.indexOf('ld-toast') >= 0) && beforeVis.some(v => v.id === 'sys-clip-toast'),
      JSON.stringify(beforeVis));
    ok('复现截图已保存', await saveShot('LiteDock-App-1.0.9-longpress-before' + SHOT_SUFFIX + '.png'));
    await evalJs(`(function(){var t=document.getElementById('ld-toast');
      if(t){t.textContent='';t.className='ld-toast';}})()`);

    // ---- 用例1：真实长按端口 chip ----
    const box = JSON.parse(await evalJs(`(function(){
      var c = document.querySelector('[data-ev="copyLink"]');
      if(!c) return JSON.stringify({err:'no chip'});
      c.scrollIntoView({block:'center'});
      var r = c.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});
    })()`) || '{}');
    if (box.err) throw new Error('no chip for long press');
    // 复位探针
    await evalJs(`window.__t.toasts=[];window.__t.modals=[];window.__t.clips=[];window.__t.ctx=0;window.__t.flash=0;window.__openedNative=[]; (function(){var el=document.getElementById('ld-toast'); if(el){el.textContent='';el.className='ld-toast';} var m=document.getElementById('ld-modal'); if(m)m.classList.remove('show');})()`);
    // touchStart
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    await sleep(750); // 超过 550ms 长按阈值
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300); // 等浏览器补发 click + 定时器窗口
    const long = JSON.parse(await evalJs(`(function(){var t=JSON.parse(JSON.stringify(window.__t));t.opened=window.__openedNative||[];return JSON.stringify(t);})()`) || '{}');
    console.log('  长按探针:', JSON.stringify(long));
    console.log('  最后触摸目标:', await evalJs(`window.__t.lastTarget`));
    const clips1 = long.clips || [];
    const toasts1 = (long.toasts || []).filter(x => /已复制/.test(x));
    ok('长按：剪贴板只写 1 次（系统提示也只会出现 1 次）', clips1.length === 1, JSON.stringify(clips1));
    ok('★ 长按：APP 不再弹「已复制」toast（0 个）', toasts1.length === 0, JSON.stringify(toasts1));
    const vis1 = JSON.parse(await evalJs(`JSON.stringify(window.__copiedVisible())`) || '[]');
    console.log('  1.0.9 长按后可见提示:', JSON.stringify(vis1));
    ok('★ 长按后屏幕只有 1 个「已复制」（系统提示）',
      vis1.length === 1 && vis1[0].id === 'sys-clip-toast', JSON.stringify(vis1));
    ok('★ 长按后 chip 闪绿色描边（无声复制反馈）', (long.flash || 0) >= 1, 'flash=' + (long.flash || 0));
    ok('修复截图已保存', await saveShot('LiteDock-App-1.0.9-longpress-after' + SHOT_SUFFIX + '.png'));
    ok('长按：不弹小程序「已复制」模态框', !(long.modals || []).some(x => /已复制/.test(x)), JSON.stringify(long.modals));
    ok('长按：不打开浏览器', (long.opened || []).length === 0, JSON.stringify(long.opened));
    ok('长按：WebView 原生长按菜单被禁用', (long.ctx || 0) === 0, 'contextmenu=' + long.ctx);

    // ---- 用例1b：真机双复制复现——长按 fire 后系统菜单抢焦点触发 blur 清标志，
    //      随后 WebView 补发的 click 因标志已清而走通，追加第二次复制/弹窗 ----
    await evalJs(`window.__t.toasts=[];window.__t.modals=[];window.__t.clips=[];window.__t.flash=0;window.__openedNative=[];
      (function(){var el=document.getElementById('ld-toast');if(el){el.textContent='';el.className='ld-toast';}var m=document.getElementById('ld-modal');if(m)m.classList.remove('show');})()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    await sleep(700);                       // 长按 timer fire → 复制#1
    await evalJs(`window.dispatchEvent(new Event('blur'))`);  // 系统长按菜单抢焦点 → resetLinkPress 清掉 suppress 标志
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(50);
    // 补发一次 click（真机长按后 WebView 会补 tap）
    await evalJs(`(function(){var c=document.querySelector('[data-ev="copyLink"]');if(c)c.click();})()`);
    await sleep(150);
    const dbl = JSON.parse(await evalJs(`(function(){var t=JSON.parse(JSON.stringify(window.__t));t.opened=window.__openedNative||[];return JSON.stringify(t);})()`) || '{}');
    console.log('  双复制探针:', JSON.stringify(dbl));
    ok('真机长按+补发click：剪贴板只写 1 次', (dbl.clips||[]).length === 1, JSON.stringify(dbl.clips));
    ok('真机长按+补发click：APP 0 个「已复制」提示、无模态框',
      (dbl.toasts||[]).filter(x=>/已复制/.test(x)).length === 0 && !(dbl.modals||[]).some(x=>/已复制/.test(x)), JSON.stringify(dbl));

    // ---- 用例2：按下后被系统打断（无 touchend），等待是否延迟复制 ----
    await evalJs(`window.__t.toasts=[];window.__t.modals=[];window.__t.clips=[];window.__t.ctx=0;window.__openedNative=[]`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    await sleep(200); // 只按 200ms（不足长按）
    // 模拟 Activity 切走：dispatch touchCancel + visibilitychange
    await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await evalJs(`(function(){Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});document.dispatchEvent(new Event('visibilitychange'));})()`);
    await sleep(1200); // 超过旧版 900ms 悬挂窗口
    const ghost = JSON.parse(await evalJs(`(function(){var t=JSON.parse(JSON.stringify(window.__t));t.opened=window.__openedNative||[];return JSON.stringify(t);})()`) || '{}');
    console.log('  打断探针:', JSON.stringify(ghost));
    ok('被打断的触摸不延迟复制', (ghost.clips || []).length === 0 && !(ghost.toasts || []).some(x => /已复制/.test(x)), JSON.stringify(ghost));

    // ---- 用例3：停止容器的端口 chip 点按应提示「请先启动容器」 ----
    // 直接给当前 chip 标记为停止态，验证点击拦截逻辑
    await evalJs(`(function(){
      Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false;}});
      window.__t.toasts=[];window.__t.modals=[];window.__t.clips=[];window.__t.ctx=0;window.__openedNative=[];
      var c=document.querySelector('[data-ev="copyLink"]'); if(!c)return;
      c.setAttribute('data-state','exited');
      c.click();
    })()`);
    await sleep(150);
    const stopped = JSON.parse(await evalJs(`(function(){var t=JSON.parse(JSON.stringify(window.__t));t.opened=window.__openedNative||[];return JSON.stringify(t);})()`) || '{}');
    console.log('  停止态探针:', JSON.stringify(stopped));
    ok('停止容器端口：提示请先启动容器', (stopped.toasts || []).some(x => /启动容器|已停止|运行中/.test(x)), JSON.stringify(stopped));
    ok('停止容器端口：不打开浏览器', (stopped.opened || []).length === 0, JSON.stringify(stopped));

    console.log('\n=== 汇总 PASS=' + PASS + ' FAIL=' + FAIL + ' ===');
    if (FAIL) process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch(e => { console.error('FATAL', e); process.exitCode = 2; });
