'use strict';
/* CDP 交互回放：LiteDock App 1.0.6 交互回归（含 1.0.2 / 1.0.3 / 1.0.5 打磨）
   - 启动过渡页出现并按期消失
   - DOM diff 后输入框节点被复用、光标不跳位
   - 展开 Compose 项目时未变化的卡片被复用、同步耗时可忽略
   - 端口链接点击直接打开（不再弹「已复制」）
   - 长按链接仍可复制地址
   - 1.0.4：打开浏览器后不得因悬挂长按定时器而延迟弹「已复制」
   - 1.0.5：内外双地址，外网连接只显示外网链接、直连只显示端口
   - 1.0.6：长按端口只出现一个「已复制」提示
   自包含：自动拉起预览服务器与无头 Chrome，结束自动清理。
   用法：node tools/verify_ui.js [截图输出目录] */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const PROJECT = path.dirname(ROOT);
const SHOT_DIR = process.argv[2] || path.join(ROOT, 'screenshots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8777/';
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
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const srv = spawn('python', [path.join(ROOT, 'tools', 'serve_preview.py')],
    { cwd: PROJECT, stdio: 'ignore', windowsHide: true });
  /* 每次用全新 profile：固定目录会残留 ld_wan_links / ld_ports_always 等偏好，
     导致「A 默认开启」这类默认态断言被上一次运行污染（1.0.9 验证时踩过）。 */
  const profile = 'C:/ldbuild/chrome-prof-ui-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=9222', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  try {
    if (!await waitPort('http://127.0.0.1:8777/index.html', 15000)) throw new Error('preview server timeout');
    if (!await waitPort('http://127.0.0.1:9222/json/version', 15000)) throw new Error('chrome CDP timeout');

    const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json();
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
      const r = m.result && m.result.result;
      if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300));
      return r ? r.value : undefined;
    };
    const shot = async (file) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (r.result && r.result.data) {
        fs.writeFileSync(path.join(SHOT_DIR, file), Buffer.from(r.result.data, 'base64'));
      }
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
      screenWidth: 390, screenHeight: 844
    });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__ui = {atLoad:null, at2s:null};
        document.addEventListener('DOMContentLoaded',function(){window.__ui.atLoad=!!document.getElementById('ld-splash');});
        setTimeout(function(){window.__ui.at2s=!!document.getElementById('ld-splash');},2000);`
    });

    await send('Page.navigate', { url: URL });
    await sleep(750);   /* 等入场动画走完，截图能完整呈现 Logo / 文案 / 进度条 / 署名 */
    console.log('=== 启动过渡页 ===');
    const splashEarly = await evalJs(`JSON.stringify({exists:!!document.getElementById('ld-splash'),
      tag:(document.querySelector('.ld-splash-tag')||{}).textContent,
      logo:!!document.querySelector('.ld-splash-logo'),
      hidden:document.getElementById('ld-splash')?document.getElementById('ld-splash').classList.contains('hide'):null})`);
    const se = JSON.parse(splashEarly || '{}');
    ok('启动页存在且未淡出', se.exists === true && se.hidden === false, splashEarly);
    ok('显示 Logo 与极简定位文案', se.logo === true && /极简 Docker 容器管理面板/.test(se.tag || ''), splashEarly);
    await shot('LiteDock-App-1.0.6-splash.png');

    await sleep(2100);
    const ui = JSON.parse(await evalJs('JSON.stringify(window.__ui)') || '{}');
    ok('DOMContentLoaded 时已挂载', ui.atLoad === true, JSON.stringify(ui));
    ok('约 1.4s 后淡出并移除', ui.at2s === false, JSON.stringify(ui));
    ok('首屏已渲染（4 分组 / 3 tab）',
      (await evalJs(`document.querySelectorAll('.group').length`)) >= 3 &&
      (await evalJs(`document.querySelectorAll('.ld-tab').length`)) === 3);
    await shot('LiteDock-App-1.0.6-390x844.png');

    console.log('=== 1.0.2 设置页精简 ===');
    const setRes = JSON.parse(await evalJs(`(function(){
      window.wx.switchTab({url:'/pages/settings/settings'});
      return JSON.stringify({
        noForm: !document.querySelector('[data-input="onLinkInput"]') && !document.querySelector('[data-ev="saveLink"]'),
        hasSummary: !!document.querySelector('.conn-summary'),
        hasGo: !!document.querySelector('[data-ev="goConnect"]'),
        hasRefresh: !!document.querySelector('[data-ev="ldRefresh"]'),
        hasSwitch: !!document.querySelector('[data-ev="ldToggleChooser"]'),
        hasWanSwitch: !!document.querySelector('[data-ev="ldToggleWanLinks"]'),
        hasPortsSwitch: !!document.querySelector('[data-ev="ldTogglePorts"]')
      });
    })()`) || '{}');
    ok('设置页已移除与连接页重复的表单（且不再有残缺的密码框）', setRes.noForm === true, JSON.stringify(setRes));
    ok('设置页 = 当前连接 + 管理入口 + 刷新 + 三个行为开关（1.0.8 拆成外网链接/端口两项）',
       setRes.hasSummary && setRes.hasGo && setRes.hasRefresh && setRes.hasSwitch &&
       setRes.hasWanSwitch && setRes.hasPortsSwitch,
       JSON.stringify(setRes));
    await shot('LiteDock-App-1.0.6-settings.png');

    console.log('=== 浏览器选择开关 ===');
    const chooserRes = JSON.parse(await evalJs(`(function(){
      var sw=document.querySelector('[data-ev="ldToggleChooser"]');
      if(sw) sw.click();
      /* 1.0.11：设置页在「链接与打开方式」前新增「显示」卡（紧凑模式），
         .switch-row 不再唯一，必须锚定在 ldToggleChooser 行内取文案 */
      var row=document.querySelector('[data-ev="ldToggleChooser"]');
      return JSON.stringify({stored:localStorage.getItem('ld_link_chooser'),
        on:!!(row&&row.querySelector('.ld-switch.on')),
        label:row?(row.querySelector('span')||{}).textContent:''});
    })()`) || '{}');
    ok('开关写入偏好并即时刷新 UI', chooserRes.stored === '1' && chooserRes.on === true, JSON.stringify(chooserRes));
    ok('开关文案说明「每次询问」', /每次询问/.test(chooserRes.label || ''), JSON.stringify(chooserRes));

    console.log('=== 外网端口链接开关 ===');
    const portsRes = JSON.parse(await evalJs(`(function(){
      var s1=document.querySelector('[data-ev="ldTogglePorts"]'); if(s1) s1.click();
      var on1={stored:localStorage.getItem('ld_ports_always'), fn:LD.appPortsAlways()};
      var s2=document.querySelector('[data-ev="ldTogglePorts"]'); if(s2) s2.click();
      var on2={stored:localStorage.getItem('ld_ports_always'), fn:LD.appPortsAlways()};
      return JSON.stringify({on1:on1,on2:on2});
    })()`) || '{}');
    ok('B「外网也显示容器端口」写入偏好并可来回切换',
       (portsRes.on1 || {}).stored === '1' && (portsRes.on1 || {}).fn === true &&
       (portsRes.on2 || {}).stored === '0' && (portsRes.on2 || {}).fn === false,
       JSON.stringify(portsRes));

    console.log('=== 1.0.8：A「外网显示已配反代的服务」独立开关 ===');
    const wanRes = JSON.parse(await evalJs(`(function(){
      var d0={stored:localStorage.getItem('ld_wan_links'), fn:LD.appWanLinks()};
      var s1=document.querySelector('[data-ev="ldToggleWanLinks"]'); if(s1) s1.click();
      var d1={stored:localStorage.getItem('ld_wan_links'), fn:LD.appWanLinks(),
              ports:localStorage.getItem('ld_ports_always')};
      var s2=document.querySelector('[data-ev="ldToggleWanLinks"]'); if(s2) s2.click();
      var d2={stored:localStorage.getItem('ld_wan_links'), fn:LD.appWanLinks()};
      return JSON.stringify({d0:d0,d1:d1,d2:d2});
    })()`) || '{}');
    ok('A 默认开启（老用户升级不改变表现）',
       (wanRes.d0 || {}).fn === true && (wanRes.d0 || {}).stored === null, JSON.stringify(wanRes));
    ok('A 可独立关闭/开启，且不动 B 的偏好',
       (wanRes.d1 || {}).fn === false && (wanRes.d1 || {}).stored === '0' &&
       (wanRes.d1 || {}).ports === '0' && (wanRes.d2 || {}).fn === true,
       JSON.stringify(wanRes));

    console.log('=== 输入光标（DOM diff，连接页新增表单）===');
    const inputRes = JSON.parse(await evalJs(`(function(){
      var go=document.querySelector('[data-ev="goConnect"]'); if(go) go.click();
      var add=document.querySelector('[data-ev="openAdd"]'); if(add) add.click();
      var inp=document.querySelector('[data-input="onField"][data-field="url"]');
      if(!inp) return JSON.stringify({err:'no url input'});
      inp.__keep=1; inp.focus();
      inp.value='https://nas.example.com:16666';
      inp.setSelectionRange(12,12);
      var caret0=inp.selectionStart;
      inp.dispatchEvent(new Event('input',{bubbles:true}));
      var after=document.querySelector('[data-input="onField"][data-field="url"]');
      return JSON.stringify({same:after===inp, keep:after.__keep===1,
        caret0:caret0, caret1:after.selectionStart, value:after.value,
        detect:!!document.querySelector('.detect-type'),
        active:document.activeElement===after,
        nameBefore:(document.querySelector('[data-field="name"]')||{}).value});
    })()`) || '{}');
    ok('输入框 DOM 节点被复用（不再整体替换）', inputRes.same === true && inputRes.keep === true, JSON.stringify(inputRes));
    ok('光标位置不变', inputRes.caret0 === 12 && inputRes.caret1 === 12, JSON.stringify(inputRes));
    ok('输入值保持且联动提示仍生效', /16666$/.test(inputRes.value || '') && inputRes.detect === true, JSON.stringify(inputRes));
    ok('焦点未丢失', inputRes.active === true, JSON.stringify(inputRes));
    ok('仅填网址、还没填密码时未预填名称（复现旧缺陷场景）', !inputRes.nameBefore, JSON.stringify(inputRes));

    console.log('=== 默认连接名称：密码晚填后应为宿主机名（不是 IP）===');
    const nameRes = JSON.parse(await evalJs(`(async function(){
      function inp(f){ return document.querySelector('[data-input="onField"][data-field="'+f+'"]'); }
      function type(f,v){ var el=inp(f); if(!el) return; el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); }
      var adv=document.querySelector('[data-ev="toggleAdvanced"]'); if(adv) adv.click();
      type('password','123456');
      await new Promise(function(r){setTimeout(r,450);});
      var after=(inp('name')||{}).value||'';
      var save=document.querySelector('[data-ev="saveForm"]'); if(save) save.click();
      await new Promise(function(r){setTimeout(r,500);});
      var list=[];
      try { list=JSON.parse(localStorage.getItem('fd_connections')||'[]').map(function(c){return c.name;}); } catch(e){}
      return JSON.stringify({host:window.__mockHost, after:after, list:list});
    })()`, true) || '{}');
    ok('填完密码后自动预填宿主机名', nameRes.after === nameRes.host && !!nameRes.host, JSON.stringify(nameRes));
    ok('保存后连接名是宿主机名，未回退成 IP/域名',
       (nameRes.list || []).indexOf(nameRes.host) >= 0 &&
       (nameRes.list || []).indexOf('nas.example.com') < 0, JSON.stringify(nameRes));

    // 回到面板做性能与链接验证
    await evalJs("window.wx.switchTab({url:'/pages/index/index'})");
    await sleep(250);

    console.log('=== 展开 Compose 项目（批处理渲染 + DOM 复用）===');
    const expand = JSON.parse(await evalJs(`(function(){
      var before=document.querySelectorAll('.ct').length;
      var first=document.querySelector('.ct'); if(first) first.__keepMark=1;
      var btn=document.querySelector('[data-ev="toggleProject"]');
      if(!btn) return JSON.stringify({err:'no toggle button',before:before});
      var r0=LD._perf.renders;
      var t0=performance.now(); btn.click(); var ms=performance.now()-t0;
      var cards=document.querySelectorAll('.ct');
      var kept=0; for(var i=0;i<cards.length;i++) if(cards[i].__keepMark===1) kept++;
      return JSON.stringify({before:before,after:cards.length,ms:Math.round(ms*10)/10,kept:kept,
        renders:LD._perf.renders-r0,
        label:(document.querySelector('[data-ev="toggleProject"]')||{}).textContent});
    })()`) || '{}');
    console.log('   展开指标:', JSON.stringify(expand));
    ok('展开后容器卡数量增加', expand.after > expand.before, JSON.stringify(expand));
    ok('未变化卡片节点被复用（无整页重建）', expand.kept >= 1, JSON.stringify(expand));
    ok('点击到 DOM 更新同步耗时 < 25ms', expand.ms < 25, JSON.stringify(expand));
    ok('一次点击最多渲染 2 次（图片落地不再逐张刷全页）', expand.renders <= 2, JSON.stringify(expand));
    const collapse = JSON.parse(await evalJs(`(function(){
      var btn=document.querySelector('[data-ev="toggleProject"]');
      if(!btn) return '{}';
      var t0=performance.now(); btn.click(); var ms=performance.now()-t0;
      return JSON.stringify({after:document.querySelectorAll('.ct').length,ms:Math.round(ms*10)/10});
    })()`) || '{}');
    ok('可再次收起且同样迅速', collapse.after === expand.before && collapse.ms < 40, JSON.stringify(collapse));

    /* 1.0.6：启动时序加固。预览服务与 WebView 就绪速度会波动，
       等面板首个访问链接渲染出来再跑交互断言，避免偶发 no chip 误报。 */
    for (let i = 0; i < 30; i++) {
      if (await evalJs(`!!document.querySelector('[data-ev="copyLink"]')`)) break;
      await sleep(200);
    }

    console.log('=== 访问链接：点击打开 / 长按复制 ===');
    const openRes = JSON.parse(await evalJs(`(function(){
      window.__openedNative=[];
      var chip=document.querySelector('[data-ev="copyLink"]');
      if(!chip) return JSON.stringify({err:'no chip'});
      chip.click();
      return JSON.stringify({opened:window.__openedNative,
        toast:(document.getElementById('ld-toast')||{}).textContent,
        modal:document.getElementById('ld-modal').classList.contains('show')});
    })()`) || '{}');
    ok('点击直接调起原生 openUrl（带端口 URL）',
      (openRes.opened || []).length === 1 && /^https?:\/\/.+:\d+/.test((openRes.opened[0] || {}).url || ''), JSON.stringify(openRes));
    ok('浏览器选择偏好已传给原生插件（chooser=true）',
      (openRes.opened[0] || {}).chooser === true, JSON.stringify(openRes));
    ok('不再弹「已复制」模态框', openRes.modal === false, JSON.stringify(openRes));
    ok('1.0.10：点击链接静默打开，不再弹「打开浏览器」toast',
       !/打开浏览器/.test(openRes.toast || ''), JSON.stringify(openRes));

    const chooserOff = JSON.parse(await evalJs(`(function(){
      window.wx.switchTab({url:'/pages/settings/settings'});
      var sw=document.querySelector('[data-ev="ldToggleChooser"]'); if(sw) sw.click();
      window.wx.switchTab({url:'/pages/index/index'});
      window.__openedNative=[];
      var chip=document.querySelector('[data-ev="copyLink"]'); if(chip) chip.click();
      return JSON.stringify({stored:localStorage.getItem('ld_link_chooser'), opened:window.__openedNative});
    })()`) || '{}');
    ok('关掉开关后恢复「系统默认浏览器」（chooser=false）',
      chooserOff.stored === '0' && (chooserOff.opened[0] || {}).chooser === false, JSON.stringify(chooserOff));

    const relRes = JSON.parse(await evalJs(`(function(){
      window.__openedNative=[];
      var chip=document.querySelector('[data-ev="copyLink"]');
      if(!chip) return JSON.stringify({err:'no chip'});
      chip.setAttribute('data-url','/jellyfin/');
      chip.click();
      return JSON.stringify({opened:window.__openedNative});
    })()`) || '{}');
    ok('相对路径自动拼当前反代地址（含自定义端口 :16666）',
      /^https:\/\/nas\.example\.com:16666\/jellyfin\/$/.test(((relRes.opened || [])[0] || {}).url || ''),
      JSON.stringify(relRes));

    const longPress = JSON.parse(await evalJs(`new Promise(function(resolve){
      window.__clipboardWrites=[];
      var chip=document.querySelector('[data-ev="copyLink"]');
      if(!chip) return resolve(JSON.stringify({err:'no chip'}));
      chip.dispatchEvent(new Event('touchstart',{bubbles:true}));
      setTimeout(function(){
        chip.dispatchEvent(new Event('touchend',{bubbles:true}));
        resolve(JSON.stringify({toast:(document.getElementById('ld-toast')||{}).textContent,
          writes:window.__clipboardWrites.length}));
      },650);
    })`, true) || '{}');
    ok('1.0.9 长按仍写入剪贴板 1 次，且 APP 不再输出「已复制」文案',
      longPress.writes === 1 && !/已复制/.test(longPress.toast || ''), JSON.stringify(longPress));

    console.log('=== 1.0.6 复现：长按端口出现两个「已复制」 ===');
    /* 真机长按后 WebView 仍可能派发一次 tap，命中小程序原始 copyLink：
       wx.setClipboardData（shim 又弹一次「已复制」toast）+ wx.showModal
       （内容也带「已复制」）⇒ 与长按本身的 toast 叠成两个提示。 */
    const doubleCopy = JSON.parse(await evalJs(`new Promise(function(resolve){
      window.__clipboardWrites=[];
      if(window.LD && LD._resetCopyDedup) LD._resetCopyDedup();
      var chip=document.querySelector('[data-ev="copyLink"]');
      if(!chip) return resolve(JSON.stringify({err:'no chip'}));
      var t=document.getElementById('ld-toast'); if(t){t.textContent='';t.className='ld-toast';}
      var m=document.getElementById('ld-modal'); if(m) m.classList.remove('show');
      chip.dispatchEvent(new Event('touchstart',{bubbles:true}));
      setTimeout(function(){
        chip.dispatchEvent(new Event('touchend',{bubbles:true}));
        try {
          var inst = window.LD && window.LD.pageInstance && window.LD.pageInstance('index');
          if (inst && inst.copyLink) inst.copyLink({currentTarget:{dataset:{url:chip.getAttribute('data-url')}}});
        } catch(e) {}
        setTimeout(function(){
          resolve(JSON.stringify({
            writes:window.__clipboardWrites.length,
            toast:(document.getElementById('ld-toast')||{}).textContent,
            modal:document.getElementById('ld-modal').classList.contains('show'),
            content:(document.querySelector('.ld-modal-content')||{}).textContent
          }));
        },80);
      },650);
    })`, true) || '{}');
    ok('长按只出现一个「已复制」提示（不叠小程序模态框）',
      doubleCopy.modal === false && !/已复制/.test(doubleCopy.content || ''), JSON.stringify(doubleCopy));
    ok('同一条链接不被重复写入剪贴板', doubleCopy.writes === 1, JSON.stringify(doubleCopy));
    ok('1.0.9：APP 不再出现第二个「已复制」提示（系统提示独占）',
      !/已复制/.test(doubleCopy.toast || ''), JSON.stringify(doubleCopy));

    console.log('=== 1.0.4 回归：点开浏览器后不再延迟冒出「已复制」 ===');
    /* 真机路径：手指按下 chip 会启动 550ms 长按定时器；click 里立刻 startActivity
       打开外部浏览器时 Activity 切走，WebView 可能收不到 touchend / touchcancel。
       定时器悬挂到 APP 回前台才 fire，于是用户看到「过了 30 秒突然弹已复制」。 */
    const ghostCopy = JSON.parse(await evalJs(`new Promise(function(resolve){
      window.__openedNative=[]; window.__clipboardWrites=[];
      if(window.LD && LD._resetCopyDedup) LD._resetCopyDedup();   /* 隔离上一组长按的遗留标志 */
      var chip=document.querySelector('[data-ev="copyLink"]');
      if(!chip) return resolve(JSON.stringify({err:'no chip'}));
      chip.setAttribute('data-url','http://192.168.1.10:3782');
      var t=document.getElementById('ld-toast'); if(t){t.textContent='';t.className='ld-toast';}
      var m=document.getElementById('ld-modal'); if(m) m.classList.remove('show');
      chip.dispatchEvent(new Event('touchstart',{bubbles:true}));
      chip.click();                       /* 只按下不抬起，模拟触摸序列被系统打断 */
      setTimeout(function(){
        resolve(JSON.stringify({
          opened:window.__openedNative.length,
          writes:window.__clipboardWrites.length,
          toast:(document.getElementById('ld-toast')||{}).textContent,
          modal:document.getElementById('ld-modal').classList.contains('show')
        }));
      },1200);
    })`, true) || '{}');
    ok('点击端口仍能调起浏览器', ghostCopy.opened === 1, JSON.stringify(ghostCopy));
    ok('触摸序列被打断时不延迟写入剪贴板', ghostCopy.writes === 0, JSON.stringify(ghostCopy));
    ok('触摸序列被打断时不延迟弹「已复制」',
      !/已复制/.test(ghostCopy.toast || '') && ghostCopy.modal === false, JSON.stringify(ghostCopy));

    const bgCopy = JSON.parse(await evalJs(`new Promise(function(resolve){
      window.__clipboardWrites=[];
      if(window.LD && LD._resetCopyDedup) LD._resetCopyDedup();
      var chip=document.querySelector('[data-ev="copyLink"]');
      if(!chip) return resolve(JSON.stringify({err:'no chip'}));
      var t=document.getElementById('ld-toast'); if(t){t.textContent='';t.className='ld-toast';}
      chip.dispatchEvent(new Event('touchstart',{bubbles:true}));
      document.dispatchEvent(new Event('visibilitychange'));   /* 模拟 APP 切后台 */
      setTimeout(function(){
        resolve(JSON.stringify({
          writes:window.__clipboardWrites.length,
          toast:(document.getElementById('ld-toast')||{}).textContent,
          suppress:!!(window.LD&&window.LD._suppressLinkClick)
        }));
      },1200);
    })`, true) || '{}');
    ok('APP 切后台再回来不会补一次「已复制」',
      bgCopy.writes === 0 && !/已复制/.test(bgCopy.toast || ''), JSON.stringify(bgCopy));
    ok('后台恢复后不会吞掉下一次点击', bgCopy.suppress === false, JSON.stringify(bgCopy));

    const badLink = JSON.parse(await evalJs(`(function(){
      window.__clipboardWrites=[];
      if(window.LD && LD._resetCopyDedup) LD._resetCopyDedup();
      var chip=document.querySelector('[data-ev="copyLink"]');
      if(!chip) return JSON.stringify({err:'no chip'});
      chip.setAttribute('data-url','host:8088');   /* 无 scheme：旧版会 fallthrough 到小程序 copyLink */
      var t=document.getElementById('ld-toast'); if(t){t.textContent='';t.className='ld-toast';}
      var m=document.getElementById('ld-modal'); if(m) m.classList.remove('show');
      chip.click();
      return JSON.stringify({
        writes:window.__clipboardWrites.length,
        toast:(document.getElementById('ld-toast')||{}).textContent,
        modal:m.classList.contains('show'),
        content:(m.querySelector('.ld-modal-content')||{}).textContent
      });
    })()`) || '{}');
    ok('非 http 链接不再弹小程序的「已复制」模态框',
      badLink.modal === false && badLink.writes === 0, JSON.stringify(badLink));
    ok('非 http 链接给出提示而不是静默复制',
      !/已复制/.test(badLink.toast || ''), JSON.stringify(badLink));

    console.log('=== 关于页版本号 ===');
    await evalJs("window.wx.switchTab({url:'/pages/about/about'})");
    await sleep(400);   /* about.onShow 会异步读取 /api/state 填充服务端版本 */
    const aboutRes = JSON.parse(await evalJs(`(function(){
      return JSON.stringify({ver:(document.querySelector('.brand-ver')||{}).textContent||'',
        appVer:(window.LD&&LD.APP_VERSION)||''});
    })()`) || '{}');
    ok('关于页显示 APK 自身版本，不再误用小程序版本',
       !!aboutRes.appVer && aboutRes.ver.indexOf('APP ' + aboutRes.appVer) >= 0 &&
       !/APP 1\.0\.16/.test(aboutRes.ver),
       JSON.stringify(aboutRes));
    ok('仍显示服务端版本', /1\.0\.13/.test(aboutRes.ver), JSON.stringify(aboutRes));

    console.log('=== 1.0.3 ① 下拉刷新：仅面板可用 ===');
    const pullRes = JSON.parse(await evalJs(`(function(){
      function gesture(page){
        wx.switchTab({url:'/pages/'+page+'/'+page});
        var sc=document.getElementById('ld-scroll');
        var bar=document.getElementById('ld-pull');
        function t(type,y){
          var ev=new Event(type,{bubbles:true});
          ev.touches=[{clientY:y}];
          sc.dispatchEvent(ev);
        }
        t('touchstart',100);
        t('touchmove',180);
        return {shown:bar.classList.contains('show'), text:bar.textContent};
      }
      var r={index:gesture('index'), settings:gesture('settings'), about:gesture('about')};
      wx.stopPullDownRefresh();
      return JSON.stringify(r);
    })()`) || '{}');
    console.log('   下拉指标:', JSON.stringify(pullRes));
    ok('面板 index 仍保留下拉刷新',
       pullRes.index && pullRes.index.shown === true && /刷新/.test(pullRes.index.text || ''), JSON.stringify(pullRes));
    ok('设置页下拉不再出现刷新提示', pullRes.settings && pullRes.settings.shown === false, JSON.stringify(pullRes));
    ok('关于页下拉不再出现刷新提示', pullRes.about && pullRes.about.shown === false, JSON.stringify(pullRes));

    console.log('=== 1.0.3 ② 连续打开不同容器详情 ===');
    const detailRes = JSON.parse(await evalJs(`(function(){
      wx.switchTab({url:'/pages/index/index'});
      var g=(window.getApp && getApp().globalData) || {};
      var cs=((g.state||{}).containers||[]).filter(function(c){return c && c.id;});
      if(cs.length<2) return JSON.stringify({err:'need 2 containers', n:cs.length});
      var a=cs[0], b=cs[1];
      LD.navigateTo('/pages/detail/detail?id='+encodeURIComponent(a.id));
      var i1=LD.pageInstance('detail');
      var n1=(document.querySelector('.detail-overview .ct-name')||{}).textContent||'';
      LD.navigateBack({});
      LD.navigateTo('/pages/detail/detail?id='+encodeURIComponent(b.id));
      var i2=LD.pageInstance('detail');
      var n2=(document.querySelector('.detail-overview .ct-name')||{}).textContent||'';
      var out={a:a.name,b:b.name,idA:a.id,idB:b.id,
               n1:n1,n2:n2,id1:i1&&i1.data?i1.data.id:'',id2:i2&&i2.data?i2.data.id:'',
               same:i1===i2};
      LD.navigateBack({});
      return JSON.stringify(out);
    })()`) || '{}');
    console.log('   详情指标:', JSON.stringify(detailRes));
    ok('第一次详情显示 A 容器',
       detailRes.n1 === detailRes.a && detailRes.id1 === detailRes.idA, JSON.stringify(detailRes));
    ok('每次进入详情都创建新页面实例（onLoad 重新执行）', detailRes.same === false, JSON.stringify(detailRes));
    ok('第二次详情显示 B 容器，不再停留在第一个',
       detailRes.n2 === detailRes.b && detailRes.id2 === detailRes.idB && detailRes.n1 !== detailRes.n2,
       JSON.stringify(detailRes));

    console.log('=== 1.0.3 ③ 切回面板毫秒级（tab DOM 缓存）===');
    const tabRes = JSON.parse(await evalJs(`(function(){
      wx.switchTab({url:'/pages/index/index'});
      var p=document.querySelector('.index-page'); if(p) p.__tabKeep=7;
      wx.switchTab({url:'/pages/settings/settings'});
      var r0=LD._perf.tabReuse;
      var t0=performance.now();
      wx.switchTab({url:'/pages/index/index'});
      var ms=performance.now()-t0;
      var back=document.querySelector('.index-page');
      return JSON.stringify({ms:Math.round(ms*100)/100,
        reuse:!!back && back.__tabKeep===7,
        delta:LD._perf.tabReuse-r0,
        groups:document.querySelectorAll('.group').length,
        cards:document.querySelectorAll('.ct').length});
    })()`) || '{}');
    console.log('   切页指标:', JSON.stringify(tabRes));
    ok('切回面板复用原有 DOM 节点（未整页重建）', tabRes.reuse === true, JSON.stringify(tabRes));
    ok('切页同步耗时 < 10ms', typeof tabRes.ms === 'number' && tabRes.ms < 10, JSON.stringify(tabRes));
    ok('命中 tab DOM 缓存', (tabRes.delta || 0) >= 1, JSON.stringify(tabRes));
    ok('面板内容完整保留', (tabRes.groups || 0) >= 3 && (tabRes.cards || 0) > 0, JSON.stringify(tabRes));

    console.log('=== 1.0.3 ④ 浏览器选择开关 → 原生插件参数 ===');
    const chooserMap = JSON.parse(await evalJs(`(function(){
      wx.switchTab({url:'/pages/index/index'});
      if(LD._resetCopyDedup) LD._resetCopyDedup();
      function fire(v){
        localStorage.setItem('ld_link_chooser', v?'1':'0');
        window.__openedNative=[];
        var chip=document.querySelector('[data-ev="copyLink"]');
        if(chip) chip.click();
        return window.__openedNative[0]||{};
      }
      var on=fire(true), off=fire(false);
      return JSON.stringify({on:on,off:off});
    })()`) || '{}');
    ok('开关开 → 原生插件收到 chooser=true（由插件弹 APP 内浏览器列表）',
       (chooserMap.on || {}).chooser === true, JSON.stringify(chooserMap));
    ok('开关关 → 恢复系统默认浏览器（chooser=false）',
       (chooserMap.off || {}).chooser === false, JSON.stringify(chooserMap));

    console.log('=== 布局 ===');
    const sw = await evalJs('document.body.scrollWidth');
    ok('无横向溢出（body.scrollWidth = 390）', sw === 390, 'sw=' + sw);

    ws.close();
    console.log('\n========================================');
    console.log('PASS=' + PASS + '  FAIL=' + FAIL);
    console.log('========================================');
    if (FAIL) process.exitCode = 1;
  } finally {
    try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) {}
    try { srv.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch(e => { console.error('VERIFY_UI_ERROR', e); process.exit(1); });
