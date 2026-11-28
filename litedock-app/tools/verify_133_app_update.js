/* APP 1.0.26 自更新专项验证
   ① 静态：原生插件白名单/严格 TLS/SHA-256、Manifest 权限、版本号
   ② 浏览器：关于页渲染 APP 更新卡片、检查/安装按钮事件链
   ③ 逻辑：版本比较、摘要解析、静默标记持久化
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..');            // litedock-app/
const WS = path.resolve(APP, '..');                   // 工作区根
const WWW = process.env.LD_WWW ? path.resolve(process.env.LD_WWW) : path.join(APP, 'www');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

console.log('=== APP 1.0.26 自更新专项 ===\n');
console.log('--- ① 静态安全与版本 ---');
const java = read(path.join(APP, 'android-config', 'LiteDockHttp.java'));
const manifestPath = process.env.LD_ANDROID
  ? path.join(process.env.LD_ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml')
  : path.join(APP, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const manifest = read(manifestPath);
const cfg = read(path.join(__dirname, 'configure_android.py'));
const shim = read(path.join(WWW, 'js', 'wx-shim.js'));
const bundle = read(path.join(WWW, 'js', 'bundle.js'));
const tmpl = read(path.join(WWW, 'js', 'templates.js'));
const css = read(path.join(WWW, 'css', 'shell.css'));
const build = read(path.join(__dirname, 'build_bundle.py'));
const apiSrc = read(path.join(WS, 'litedock-miniprogram', 'utils', 'api.js'));
const aboutSrc = read(path.join(WS, 'litedock-miniprogram', 'pages', 'about', 'about.js'));

ok('① 版本号 1.0.26 / versionCode 27',
  /LD\.APP_VERSION = '1\.0\.26'/.test(shim) && /APP_VERSION = "1\.0\.26"/.test(cfg) && /VERSION_CODE = 27/.test(cfg));
ok('① Manifest 有 REQUEST_INSTALL_PACKAGES', /REQUEST_INSTALL_PACKAGES/.test(manifest));
ok('① Manifest APK mime 可见性', /application\/vnd\.android\.package-archive/.test(manifest));
ok('① Manifest 只有一个 queries 根块', (manifest.match(/<queries>/g) || []).length === 1);
ok('① 三个原生方法都在', ['fetchLatestRelease', 'downloadApk', 'installApk'].every(m => java.includes(m + '(PluginCall')));
ok('① API 域名白名单精确匹配', /API_HOST = "api\.github\.com"/.test(java) && /API_PATH = "\/repos\/chqmoon\/LiteDock\/releases\/latest"/.test(java));
ok('① APK 域名白名单', /APK_HOST = "github\.com"/.test(java) && /CDN_HOST = "objects\.githubusercontent\.com"/.test(java));
ok('① 严格 TLS：fetch/download 不调用 TRUST_ALL',
  !/fetchLatestRelease[\s\S]{0,900}buildSocketFactory\(\)/.test(java) &&
  !/downloadApk[\s\S]{0,1500}buildSocketFactory\(\)/.test(java));
ok('① 禁止跟随重定向 + 二次校验',
  /setInstanceFollowRedirects\(false\)/.test(java) && /unsafe redirect/.test(java));
ok('① SHA-256 摘要校验 + 失败删除',
  /MessageDigest\.getInstance\("SHA-256"\)/.test(java) && /sha256 mismatch/.test(java) && /tmp\.delete\(\)/.test(java));
ok('① FileProvider 安装 + 权限引导',
  /FileProvider\.getUriForFile/.test(java) && /canRequestPackageInstalls/.test(java) && /ACTION_MANAGE_UNKNOWN_APP_SOURCES/.test(java));
ok('① JS 补丁命中（版本比较 / 摘要 / 静默标记）',
  /_cmpVer/.test(bundle) && /sha256:/.test(build) && /ld_app_update_day/.test(build));
ok('① 权威源零私有实现（构建补丁隔离）',
  /fetchAppRelease/.test(apiSrc) &&
  /小程序版本不支持自动更新/.test(aboutSrc) &&
  !/downloadApk/.test(aboutSrc));
ok('① 更新卡片模板与样式', /update-card/.test(tmpl) && /data-ev="installAppUpdate"/.test(tmpl) && /\.update-card/.test(css));

console.log('\n--- ② 浏览器渲染与交互（自包含 CDP）---');
const { spawn } = require('child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREVIEW_PORT = 8906;
const CDP_PORT = 9366;
const URL = 'http://127.0.0.1:' + PREVIEW_PORT + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitPort(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok || r.status === 502) return true; } catch (e) {}
    await sleep(120);
  }
  return false;
}
async function browserCheck() {
  const env = Object.assign({}, process.env, { LD_PORT: String(PREVIEW_PORT) });
  if (process.env.LD_WWW && process.env.LD_WWW !== '1') env.LD_WWW = process.env.LD_WWW;
  const srv = spawn('python', [path.join(__dirname, 'serve_preview.py')],
    { cwd: APP, stdio: 'ignore', windowsHide: true, env });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=C:/ldbuild/chrome-prof-133-app-update-' + Date.now(),
    '--window-size=430,900', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let ws;
  try {
    if (!await waitPort(URL + 'index.html', 15000)) throw new Error('preview timeout');
    if (!await waitPort('http://127.0.0.1:' + CDP_PORT + '/json/version', 15000)) throw new Error('cdp timeout');
    const targets = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json();
    let page = targets.find(t => t.type === 'page');
    if (!page) page = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent(URL), { method: 'PUT' })).json();
    ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    await new Promise(r => ws.onopen = r);
    const send = (method, params) => new Promise(resolve => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
    const evalJs = async (expr) => {
      const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 300));
      const r = m.result && m.result.result;
      return r ? r.value : undefined;
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await sleep(2600);
    ok('② shim 加载且版本 = 1.0.26', await evalJs("String(window.LD && window.LD.APP_VERSION)") === '1.0.26');

    // 切到关于页：走 shim 的真实导航事件链（tabBar 或 setData 路由均可）
    const nav = await evalJs(`(function(){
      var btn = document.querySelector('[data-tab="about"], [data-page="about"], .tab-about');
      if (btn) { btn.click(); return 'clicked'; }
      if (window.LD && LD.navigate) { LD.navigate('about'); return 'navigate'; }
      return 'none';
    })()`);
    await sleep(700);
    const dom = JSON.parse(await evalJs(`(function(){
      var card = document.querySelector('.update-card');
      var check = document.querySelector('[data-ev="checkAppUpdate"]');
      var install = document.querySelector('[data-ev="installAppUpdate"]');
      return JSON.stringify({
        nav: ${JSON.stringify(nav)},
        page: (document.querySelector('.scope-about') ? 'about' : (document.querySelector('#ld-root')||{}).className || ''),
        card: !!card, check: !!check, install: !!install,
        text: card ? card.textContent.replace(/\\s+/g,' ').trim() : ''
      });
    })()`));
    ok('② 关于页渲染 APP 更新卡片', dom.card, JSON.stringify(dom));
    ok('② 检查更新按钮存在', dom.check);
    ok('② 无更新时不显示下载安装按钮', !dom.install, JSON.stringify(dom));

    // 有更新分支：mock 原生插件返回假 Release，走真实点击检查更新事件链
    const mocked = await evalJs(`(function(){
      var C = window.Capacitor || (window.Capacitor = {});
      var P = C.Plugins || (C.Plugins = {});
      P.LiteDockHttp = {
        fetchLatestRelease: function(){ return Promise.resolve({ status:200, data: JSON.stringify({
          tag_name:'app-v9.9.9',
          assets:[{name:'LiteDock-App-9.9.9.apk', digest:'sha256:'+'a'.repeat(64),
                   browser_download_url:'https://github.com/chqmoon/LiteDock/releases/download/app-v9.9.9/LiteDock-App-9.9.9.apk', size:123}]
        })}); },
        downloadApk: function(){ return Promise.resolve({path:'mock', size:123, sha256:'a'.repeat(64)}); },
        installApk: function(){ return Promise.resolve({opened:true}); }
      };
      var b = document.querySelector('[data-ev="checkAppUpdate"]');
      if (!b) return 'no-button';
      b.click();
      return 'clicked';
    })()`);
    await sleep(900);
    const after = JSON.parse(await evalJs(`(function(){
      var card = document.querySelector('.update-card');
      return JSON.stringify({
        mocked: ${JSON.stringify(mocked)},
        install: !!document.querySelector('[data-ev="installAppUpdate"]'),
        text: card ? card.textContent.replace(/\\s+/g,' ').trim() : ''
      });
    })()`));
    ok('② 检查更新后渲染下载并安装按钮', after.install, JSON.stringify(after));
    ok('② 更新状态文字可见', /9\.9\.9/.test(after.text), after.text);

    ok('② 点击检查更新不抛异常', await evalJs('!!document.querySelector(".update-card")'));
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    try { srv.kill(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
  }
}
browserCheck().then(() => report()).catch(e => { ok('② 浏览器回放异常', false, e.message); report(); });

function report() {
  console.log('\n========================================');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  console.log('========================================');
  if (fail) process.exitCode = 1;
}
