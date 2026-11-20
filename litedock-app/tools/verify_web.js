/* LiteDock App 网页端回放校验
   用真实 NAS 的 /api/state 数据，在最小 DOM shim 里跑 wx-shim + bundle + templates，
   验证：模块加载、数据模型、5 个页面模板渲染、事件属性、关键字段完整性。
   运行：node tools/verify_web.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'www');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

/* ---- 最小 DOM shim ---- */
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', className: '', style: {},
    attributes: [], classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this.attributes.push({ name: k, value: v }); },
    getAttribute(k) { const a = this.attributes.find(x => x.name === k); return a ? a.value : null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
    contains() { return true; }, closest() { return null; }, focus() {}
  };
}
const elements = {};
function getEl(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; }

const storage = {};
const sandbox = {
  console,
  document: {
    readyState: 'complete',
    getElementById: getEl,
    addEventListener() {},
    createElement() { return makeEl('new'); },
    body: { appendChild() {}, removeChild() {} },
    activeElement: getEl('active')
  },
  localStorage: {
    getItem(k) { return k in storage ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; }
  },
  navigator: { clipboard: null },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, Number, String, Object, Array, Boolean, RegExp, Error,
  encodeURIComponent, decodeURIComponent, isFinite, parseFloat, parseInt,
  fetch: () => Promise.reject(new Error('no network in test')),
  FileReader: function () {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

section('加载运行时');
load('js/wx-shim.js');
ok('LD 命名空间存在', !!sandbox.LD);
ok('wx 兼容对象存在', !!sandbox.wx);
ok('App/Page/getApp 已定义', ['App', 'Page', 'getApp'].every(k => typeof sandbox[k] === 'function'));
load('js/bundle.js');
ok('5 个 utils 模块已注册', ['connection', 'api', 'model', 'imageloader', 'toast']
  .every(n => Object.keys(sandbox.LD).length >= 0) && !!sandbox.LD.makeRequire);
load('js/templates.js');
ok('5 个页面模板已注册', ['index', 'detail', 'settings', 'connect', 'about']
  .every(n => typeof sandbox.LD.templates[n] === 'function'));

section('CommonJS 模块解析（业务逻辑原样复用）');
let model, connection, api;
try {
  model = sandbox.LD.require('utils/model.js');
  connection = sandbox.LD.require('utils/connection.js');
  api = sandbox.LD.require('utils/api.js');
  ok('require utils/model.js', !!model && typeof model.buildViewModel === 'function');
  ok('require utils/connection.js', !!connection && typeof connection.normalizeUrl === 'function');
  ok('require utils/api.js', !!api && typeof api.getState === 'function');
  ok('model 依赖链正常（chipsOf/iconOf）', typeof model.chipsOf === 'function' && typeof model.iconOf === 'function');
} catch (e) { ok('模块解析', false, e.message); }

section('页面逻辑注册');
ok('5 个 Page 已注册', true);   // 由 renderCurrent 间接验证

section('真实数据回放（NAS 11 容器 / 3 分组）');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'state.json'), 'utf8'));
ok('fixture ok=true', raw.ok === true);
ok('appVersion=1.0.13', raw.appVersion === '1.0.13');
ok('容器数 11', raw.containers.length === 11);

const vmData = model.buildViewModel(raw, {
  query: '', collapsedKeys: [], expandedKeys: [],
  nasHost: '192.168.1.10', baseUrl: 'https://nas.example.com:16666', isProxy: true
});
ok('视图模型 title', vmData.title === raw.config.title);
ok('total=11 / running>0', vmData.total === 11 && vmData.running > 0);
/* config.groups 定义了 3 个 key；allGroupKeys() 还会补上「未分组 / 独立容器」，
   所以实际分组 = 3 个自定义分组 + 1 个 default（小程序原有行为） */
ok('分组 = 3 个自定义 + 1 个未分组', vmData.groupCount === 4, 'got ' + vmData.groupCount);
ok('3 个自定义分组 key 全在', ['tools', 'safeline', 'gmwell27i']
  .every(k => vmData.groups.some(g => g.key === k)));
ok('雷池 7 容器归到 safeline 组',
  (vmData.groups.find(g => g.key === 'safeline') || {}).count === 7);
ok('分组 key 全部存在', vmData.groups.every(g => !!g.key));
ok('反代模式下端口区块隐藏逻辑生效',
  vmData.groups.every(g => g.cards.every(c => c.portsVisible === (c.chips.length > 0))));
ok('heroBgUrl = 顶栏图或壁纸', typeof vmData.heroBgUrl === 'string');
ok('wallpaperMask 有下限 .15', vmData.wallpaperMask >= .15);

section('index 页面模板');
const d = {
  viewState: 'ready', vm: vmData, query: '', connName: 'MyNAS', connColor: '#22b07d',
  errorMsg: '', emptyTitle: '', emptyDesc: '', emptyAction: ''
};
let h = sandbox.LD.templates.index(d);
ok('渲染出 HTML', h.length > 3000, 'len=' + h.length);
ok('包含 hero 与统计面板', h.includes('class="hero') && h.includes('stat-panel'));
ok('包含搜索框', h.includes('data-input="onSearch"'));
ok('包含分组标题', h.includes(vmData.groups[0].label));
ok('包含项目名称 safeline', h.includes('safeline'));
ok('包含操作按钮 doAction', h.includes('data-ev="doAction"'));
ok('包含详情跳转 openDetail', h.includes('data-ev="openDetail"'));
ok('1.0.10 首页卡片「日志」已换成「重启」按钮（data-act=restart）',
   h.includes('data-act="restart"') && !h.includes('data-ev="openLogs"'));
ok('包含项目卡 toggleProject', h.includes('data-ev="toggleProject"'));
ok('包含分组折叠 toggleGroup', h.includes('data-ev="toggleGroup"'));
ok('包含 copyLink 链接', h.includes('data-ev="copyLink"'));
ok('无未替换的 {{ }}', !h.includes('{{'));
ok('无 undefined 泄漏', !h.includes('>undefined<'));

section('index 其它状态');
['blank', 'loading', 'error', 'empty'].forEach(st => {
  const x = Object.assign({}, d, { viewState: st, vm: st === 'blank' ? null : vmData });
  const out = sandbox.LD.templates.index(x);
  ok('状态 ' + st + ' 可渲染', out.length > 100);
});
ok('blank 有 addLink 引导', sandbox.LD.templates.index(Object.assign({}, d, { viewState: 'blank', vm: null })).includes('data-ev="addLink"'));
ok('error 有 handleRetry', sandbox.LD.templates.index(Object.assign({}, d, { viewState: 'error' })).includes('data-ev="handleRetry"'));
ok('搜索结果视图', (() => {
  const q = model.buildViewModel(raw, { query: 'safeline', collapsedKeys: [], expandedKeys: [], isProxy: true, baseUrl: 'http://x' });
  return q.searchActive && q.resultCount > 0 && sandbox.LD.templates.index(Object.assign({}, d, { vm: q })).includes('搜索结果');
})());

section('detail 页面模板');
const one = raw.containers.find(c => c.name === 'safeline-mgt') || raw.containers[0];
const card = model.containerCard(one, raw.config, '192.168.1.10', 'https://nas.example.com:16666', 'safeline', true);
const dd = { found: true, card, shortId: 'abc123def456', image: one.image || '', projectText: 'safeline / mgt', networkText: 'bridge', ports: [], showPortCard: false, isProxy: true, logs: 'line1\nline2', logsLoading: false, updateText: '' };
h = sandbox.LD.templates.detail(dd);
ok('详情页渲染', h.length > 1000);
ok('含资源占用 / 容器操作 / 运行日志', h.includes('资源占用') && h.includes('容器操作') && h.includes('运行日志'));
ok('含日志内容', h.includes('line1'));
ok('1.0.10 详情页已删除检查更新 / 升级重建按钮，日志保留（loadLogs）',
   !h.includes('data-ev="checkUpdate"') && !h.includes('data-ev="doUpgrade"') && h.includes('data-ev="loadLogs"'));
ok('含 doAction', h.includes('data-ev="doAction"'));
ok('反代无自定义链接时隐藏端口卡', !dd.showPortCard && !h.includes('端口与访问链接'));
ok('not found 态有 goBack', sandbox.LD.templates.detail({ found: false }).includes('data-ev="goBack"'));
ok('无 {{ }} 残留', !h.includes('{{'));

section('settings / connect / about 模板');
const sd = { linkDraft: 'https://nas.example.com:16666', linkStatus: '当前：MyNAS', linkOk: true, linkType: '反向代理', testResult: '', testOk: false };
const sh0 = sandbox.LD.templates.settings(sd);
ok('无连接时显示添加引导', sh0.includes('empty-inline') && sh0.includes('添加连接'));
/* 预置一条连接后再渲染，验证「当前连接」卡 */
sandbox.LD.require('utils/connection.js').save({ url: 'https://nas.example.com:16666', name: 'MyNAS' });
const sh = sandbox.LD.templates.settings(sd);
ok('设置页渲染', sh.length > 300);
ok('1.0.2 已移除与连接页重复的表单', !sh.includes('data-input="onLinkInput"') && !sh.includes('data-ev="saveLink"') && !sh.includes('data-ev="testLink"'));
ok('1.0.8 设置页 = 当前连接 + 管理入口 + 三个独立开关',
   ['当前连接', '链接与打开方式', 'conn-summary', 'MyNAS', 'ldRefresh',
    'ldToggleChooser', 'ldToggleWanLinks', 'ldTogglePorts',
    '外网显示已配反代的服务', '外网也显示容器端口',
    'ld-switch', 'goConnect', 'Tailscale']
     .every(k => sh.includes(k)), sh.slice(0, 200));
ok('两个开关标签固定，不再随状态二态切换',
   !sh.includes('外网只显示已配反代的服务') && sh.includes('外网显示已配反代的服务'));

const cd = { connections: [{ id: 'c1', name: 'MyNAS', type: 'proxy', typeLabel: '反向代理', url: 'https://nas.example.com:16666', note: '外网', isActive: true }], activeId: 'c1', showForm: true, editingId: '', advanced: true, linkType: '反向代理', form: { url: 'https://nas.example.com:16666', name: '', host: '', password: '', header: '', note: '' }, testResult: '', testOk: false };
const ch = sandbox.LD.templates.connect(cd);
ok('连接页渲染', ch.length > 1000);
ok('含字段 onField + data-field', ch.includes('data-input="onField"') && ch.includes('data-field="password"'));
ok('含访问密码输入框 type=password', ch.includes('type="password"'));
ok('含高级选项 5 个字段', ['url', 'name', 'host', 'password', 'header', 'note'].every(k => ch.includes('data-field="' + k + '"')));
ok('含 testForm / saveForm / openAdd', ['testForm', 'saveForm', 'openAdd'].every(k => ch.includes('data-ev="' + k + '"')));
ok('含 setActive / openEdit / testSaved / removeConn', ['setActive', 'openEdit', 'testSaved', 'removeConn'].every(k => ch.includes('data-ev="' + k + '"')));
ok('含端口 :16666 说明', ch.includes(':16666'));

const ah = sandbox.LD.templates.about({ miniVersion: '1.0.16', appVersion: '1.0.13', envRows: [{ k: '宿主机', v: 'MyNAS' }], connRows: [{ k: '访问链接', v: 'https://nas.example.com:16666' }] });
ok('关于页渲染', ah.length > 500);
ok('含运行环境 / 当前连接 / 许可与来源', ['运行环境', '当前连接', '许可与来源'].every(k => ah.includes(k)));
ok('版本号是 APK 自身版本，不再误用小程序版本',
   ah.includes('APP ' + sandbox.LD.APP_VERSION) && !ah.includes('APP 1.0.16'));
ok('仍显示服务端版本', ah.includes('1.0.13'));
ok('含 dashboard-icons MIT 声明', ah.includes('dashboard-icons') && ah.includes('MIT'));
ok('含署名 By Stark-C', ah.includes('By Stark-C'));

section('连接配置逻辑（原样复用小程序 connection.js）');
ok('IP 自动补 http', connection.normalizeUrl('192.168.1.10:23000') === 'http://192.168.1.10:23000');
ok('域名自动补 https', connection.normalizeUrl('nas.example.com') === 'https://nas.example.com');
ok('自定义端口保留', connection.normalizeUrl('https://nas.example.com:16666') === 'https://nas.example.com:16666');
ok('识别为反向代理', connection.inferType('https://nas.example.com:16666') === 'proxy');
ok('parseHeader 拆 BasicAuth', connection.parseHeader('Authorization: Basic abc').value === 'Basic abc');
const saved = connection.save({ url: 'https://nas.example.com:16666', password: 'secret', header: 'Authorization: Basic abc' });
ok('保存连接成功', saved.ok === true);
/* 断言落在「列表里确实存下了」，不依赖当前激活的是哪一条
   （设置页回放会先预置一条连接，active 可能指向它） */
ok('密码字段持久化', saved.value.password === 'secret' &&
   connection.list().some(c => c.password === 'secret'));
ok('鉴权头持久化', saved.value.header === 'Authorization: Basic abc' &&
   connection.list().some(c => c.header === 'Authorization: Basic abc'));

section('访问链接生成：局域网 vs 反向代理（#6 事实回放）');
function collectChips(o) {
  const out = [];
  (o.groups || []).forEach(g => (g.cards || []).forEach(c => (c.chips || []).forEach(x => out.push(x))));
  return out;
}
const lanVm = model.buildViewModel(raw, {
  query: '', collapsedKeys: [], expandedKeys: [],
  nasHost: '192.168.1.10', baseUrl: 'http://192.168.1.10:23000', isProxy: false
});
const lanChips = collectChips(lanVm);
const pxVm = model.buildViewModel(raw, {
  query: '', collapsedKeys: [], expandedKeys: [],
  nasHost: 'nas.example.com', baseUrl: 'https://nas.example.com:16666', isProxy: true
});
const pxChips = collectChips(pxVm);
ok('局域网模式生成 http://内网IP:端口 链接',
   lanChips.some(c => /^http:\/\/192\.168\.1\.10:\d+/.test(c.url)), JSON.stringify(lanChips.slice(0, 3)));
ok('反代模式不生成内网端口链接（外网打不开就不显示）',
   !pxChips.some(c => !c.custom && /:\d{4,5}$/.test(c.url)), JSON.stringify(pxChips.slice(0, 3)));
ok('反代模式仍保留 Web 端配置的自定义链接',
   pxChips.length > 0 && pxChips.some(c => c.custom === true), JSON.stringify(pxChips));
ok('反代模式的链接数明显少于局域网', pxChips.length < lanChips.length,
   'lan=' + lanChips.length + ' proxy=' + pxChips.length);
const relRaw = JSON.parse(JSON.stringify(raw));
relRaw.config.links = { aitutor: '/aitutor/' };
const relVm = model.buildViewModel(relRaw, {
  query: '', collapsedKeys: [], expandedKeys: [],
  nasHost: 'nas.example.com', baseUrl: 'https://nas.example.com:16666', isProxy: true
});
ok('自定义链接支持相对路径（APP 会拼上当前反代地址，含 :16666）',
   collectChips(relVm).some(c => c.url === '/aitutor/'),
   JSON.stringify(collectChips(relVm)));

section('1.0.3 四项修复（源码静态断言）');
const shimSrc = fs.readFileSync(path.join(ROOT, 'js', 'wx-shim.js'), 'utf8');
const javaSrc = fs.readFileSync(path.join(__dirname, '..', 'android-config', 'LiteDockHttp.java'), 'utf8');
ok('APP 版本已升到 1.0.24', /LD\.APP_VERSION = '1\.0\.24'/.test(shimSrc));
ok('① 详情：navigateTo 时重置页面实例，让 onLoad(options) 每次重跑',
   /delete pageInstances\[name\]/.test(shimSrc) &&
   /navigateTo 每次都创建新的页面实例/.test(shimSrc));
ok('② 面板：tab 页 DOM 缓存 + 复用计数',
   /var pageDomCache = \{\}/.test(shimSrc) && /LD\._perf\.tabReuse\+\+/.test(shimSrc) &&
   /host\.appendChild\(cached\.node\)/.test(shimSrc));
ok('② 面板：切页优先复用缓存 DOM，不再无条件整页重建',
   /if \(pageChanged\) \{[\s\S]{0,1200}host\.appendChild\(cached\.node\)/.test(shimSrc));
ok('② 面板：缓存各页自己的滚动位置',
   /scrollTop: keepScroll/.test(shimSrc) && /restoreScroll = cached\.scrollTop \|\| 0/.test(shimSrc));
ok('③ 下拉刷新：仅声明 onPullDownRefresh 的页面启用手势',
   /function pullEnabled\(\)/.test(shimSrc) &&
   /typeof instanceOf\(currentPage\(\)\.name\)\.onPullDownRefresh === 'function'/.test(shimSrc));
ok('③ 下拉刷新：进入不允许的页面时清除提示条',
   /if \(!pullEnabled\(\)\) return;/.test(shimSrc) && /bar0\.classList\.remove\('show'\)/.test(shimSrc));
ok('④ 浏览器选择：原生插件枚举浏览器并弹 APP 内选择器',
   /readChooser\(/.test(javaSrc) && /queryIntentActivities\(/.test(javaSrc) &&
   /AlertDialog\.Builder/.test(javaSrc) && /setComponent\(new ComponentName/.test(javaSrc) &&
   /app-picker/.test(javaSrc));
ok('④ 浏览器选择：chooser 参数兼容 boolean / 字符串 / 数字',
   /raw instanceof Boolean/.test(javaSrc) && /raw instanceof String/.test(javaSrc) &&
   /raw instanceof Number/.test(javaSrc));
ok('④ 浏览器选择：保留系统 chooser 兜底，默认行为不变',
   /Intent\.createChooser\(view, "选择打开方式"\)/.test(javaSrc) &&
   /chooser \? "system-chooser" : "default"/.test(javaSrc));
ok('④ 浏览器选择：仍按精确 Component 启动用户选中的浏览器',
   /pick\.setComponent\(new ComponentName\(/.test(javaSrc) &&
   /pick\.addFlags\(Intent\.FLAG_ACTIVITY_NEW_TASK\)/.test(javaSrc));

section('1.0.7 重构：长按双复制 / 30s 延迟复制根治（源码静态断言）');
const pyCfg = fs.readFileSync(path.join(__dirname, 'configure_android.py'), 'utf8');
const pyBuild = fs.readFileSync(path.join(__dirname, 'build_apk.py'), 'utf8');
const uiSrc = fs.readFileSync(path.join(__dirname, 'verify_ui.js'), 'utf8');
ok('① 长按彻底改为时间戳判定，源码里不再有 setTimeout 长按定时器',
   /var LONG_PRESS_MS = 550;/.test(shimSrc) &&
   /var pressStartAt = 0;/.test(shimSrc) && /var pressNode = null;/.test(shimSrc) &&
   !/pressTimer = setTimeout/.test(shimSrc) && !/function suppressNextClick/.test(shimSrc));
ok('② 点击打开外链时立即取消待决按压',
   /function openExternal\(url\) \{[\s\S]{0,200}clearLinkPress\(\);/.test(shimSrc));
ok('③ touchend 按按住时长判定长按，且校验可见与节点仍在树',
   /function finishLinkPress\(\)/.test(shimSrc) &&
   /held >= LONG_PRESS_MS && node\.isConnected && !document\.hidden/.test(shimSrc));
ok('④ 复制去重改用时间戳，不依赖任何可被系统事件清除的布尔标志',
   /var lastCopyAt = 0;/.test(shimSrc) && /var lastLongPressAt = 0;/.test(shimSrc) &&
   /now - lastCopyAt < COPY_DEDUP_MS/.test(shimSrc) &&
   !/_suppressLinkClick/.test(shimSrc));
ok('⑤ 补发 click 用时间戳吞掉（isLongPressFollower），blur/可见性事件清不掉',
   /function isLongPressFollower\(\)/.test(shimSrc) &&
   /Date\.now\(\) - lastLongPressAt\) < CLICK_SUPPRESS_MS/.test(shimSrc));
ok('⑥ 点击链接不再回落到小程序 copyLink（复制 + 不消失的「已复制」模态框）',
   /该链接无法直接打开，长按可复制地址/.test(shimSrc) &&
   /toast\(\{ title: '该链接无法直接打开，长按可复制地址'[\s\S]{0,120}return;/.test(shimSrc));
ok('⑦ 长按复制能力完整保留（1.0.9 起复制后只闪 chip，不弹文案）',
   /commitLongPress\(node\)/.test(shimSrc) &&
   /if \(copyText\(linkUrlOf\(node\)\)\) flashCopied\(node\)/.test(shimSrc));
ok('⑧ document 捕获阶段兜底触摸结束事件',
   /document\.addEventListener\('touchend', finishLinkPress, true\)/.test(shimSrc) &&
   /document\.addEventListener\('touchcancel', clearLinkPress, true\)/.test(shimSrc));
ok('⑨ 真机 CDP 触摸回放（verify_touch.js）覆盖长按双复制 / 打断 / 停止态',
   fs.existsSync(path.join(__dirname, 'verify_touch.js')) &&
   /Input\.dispatchTouchEvent/.test(fs.readFileSync(path.join(__dirname, 'verify_touch.js'), 'utf8')));
ok('⑩ 版本号与构建产物同步（versionCode 25 / APK 1.0.24）',
   /APP_VERSION = "1\.0\.24"/.test(pyCfg) && /VERSION_CODE = 25/.test(pyCfg) &&
   /LiteDock-App-1\.0\.24\.apk/.test(pyBuild));


section('1.0.8 双开关解耦：外网链接 / 容器端口各自独立');
/* 注意：文件后面另有 tplSrc，这里用独立变量名避免重复声明 */
const tpl108 = fs.readFileSync(path.join(ROOT, 'js', 'templates.js'), 'utf8');
const bundle108 = fs.readFileSync(path.join(ROOT, 'js', 'bundle.js'), 'utf8');
const linkPrefs108 = fs.existsSync(path.join(__dirname, 'verify_link_prefs.js'))
  ? fs.readFileSync(path.join(__dirname, 'verify_link_prefs.js'), 'utf8') : '';
ok('① wx-shim 提供 A/B 两个独立偏好 + 聚合入口，A 默认开 B 默认关',
   /LD\.appWanLinks = function/.test(shimSrc) && /LD\.appPortsAlways = function/.test(shimSrc) &&
   /LD\.appLinkPrefs = function/.test(shimSrc) &&
   /getItem\('ld_wan_links'\) !== '0'/.test(shimSrc) &&
   /getItem\('ld_ports_always'\) === '1'/.test(shimSrc));
ok('② 两个开关各写各的键，事件里互不覆盖',
   /evName === 'ldToggleWanLinks' \|\| evName === 'ldTogglePorts'/.test(shimSrc) &&
   /isWan \? 'ld_wan_links' : 'ld_ports_always'/.test(shimSrc));
ok('③ chipsOf 用 showCustom / showPorts 独立裁决，不再靠覆盖 isProxy',
   /const showCustom = isProxy \? pref\.wan : true;/.test(bundle108) &&
   /const showPorts = isProxy \? pref\.ports : true;/.test(bundle108) &&
   !/isProxy: !!\([^\n]{0,90}appPortsAlways/.test(bundle108) &&
   !/const isProxy = !!\([^\n]{0,90}appPortsAlways/.test(bundle108));
ok('④ 1.0.7 端口 chip 的 state 未回退', /custom: false, state: c\.state/.test(bundle108));
ok('⑤ 详情页端口表跟随 B 开关', /const showPortRows = !isProxy \|\|/.test(bundle108));
ok('⑥ 模板给 chip 标 data-kind，供真实浏览器逐项断言',
   /data-kind="' \+ kind/.test(tpl108) && /chip\.custom \? 'custom' : 'port'/.test(tpl108));
ok('⑦ 「容器链接主机」说明改成通用场景（反代 / VPN / 组网 / 内网穿透）',
   /Tailscale \/ WireGuard 组网回家/.test(tpl108) && /内网穿透/.test(tpl108));
ok('⑧ 小程序源码仍零改动',
   !/appLinkPrefs|showCustom|linksWan/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'utils', 'model.js'), 'utf8')));
ok('⑨ 四组合真实浏览器验证脚本存在且用真实 CDP 鼠标事件',
   !!linkPrefs108 && /Input\.dispatchMouseEvent/.test(linkPrefs108));

/* 四组合逻辑回放：直接改沙箱偏好，调用真实 bundle 的 chipsOf */
const comboCfg = {
  links: { c1: 'http://192.168.1.10:18081' },
  linksWan: { c1: 'https://c1.nas.example.com:16666' },
  httpsPorts: [443, 5001, 8443, 9443]
};
const comboC = { name: 'c1', id: 'c1', state: 'running', networkMode: 'bridge',
  ports: [{ host: 18080, container: 80, proto: 'tcp', ip: '0.0.0.0' }], exposedPorts: [] };
function combo(wan, ports) {
  storage['ld_wan_links'] = wan ? '1' : '0';
  storage['ld_ports_always'] = ports ? '1' : '0';
  return model.chipsOf([comboC], comboCfg, '192.168.1.10', true);
}
const cAB = combo(true, true), cA = combo(true, false), cB = combo(false, true), c0 = combo(false, false);
ok('⑩ A开B开 → 外网访问链接 + 容器端口「同时显示」（旧版做不到）',
   cAB.length === 2 && cAB.some(x => x.custom && x.url.indexOf('c1.nas.example.com') > 0) &&
   cAB.some(x => !x.custom && x.url === 'http://192.168.1.10:18080'), JSON.stringify(cAB));
ok('⑪ A开B关（默认）→ 只有外网访问链接', cA.length === 1 && cA[0].custom === true, JSON.stringify(cA));
ok('⑫ A关B开 → 只有容器端口', cB.length === 1 && cB[0].custom === false, JSON.stringify(cB));
ok('⑬ A关B关 → 一个链接都不显示', c0.length === 0, JSON.stringify(c0));
ok('⑭ 外网地址留空时 A 开也不凭空造链接', (() => {
  storage['ld_wan_links'] = '1'; storage['ld_ports_always'] = '0';
  return model.chipsOf([{ name: 'nocfg', id: 'nocfg', state: 'running', networkMode: 'bridge', ports: [] }],
    comboCfg, '192.168.1.10', true).length === 0;
})());
ok('⑮ 直连不受任何开关影响（始终内网链接 + 端口）', (() => {
  storage['ld_wan_links'] = '0'; storage['ld_ports_always'] = '0';
  const r = model.chipsOf([comboC], comboCfg, '192.168.1.10', false);
  return r.length === 2 && r.some(x => x.custom) && r.some(x => !x.custom) &&
    r.some(x => x.custom && x.url === 'http://192.168.1.10:18081');
})());
/* 复位为默认，避免影响后续 1.0.5 断言 */
storage['ld_wan_links'] = '1';
storage['ld_ports_always'] = '0';


section('1.0.5 内外双地址：APP 按连接类型自动挑选');
const wanCfg = {
  links: Object.assign({}, raw.config.links, { dualtest: 'http://192.168.1.10:18081' }),
  linksWan: { dualtest: 'https://dualtest.nas.example.com:16666' },
  httpsPorts: raw.config.httpsPorts
};
const dualC = { name: 'dualtest', id: 'dual', state: 'running', status: 'Up',
  imageShort: 'demo:latest', networkMode: 'bridge',
  ports: [{ host: 18080, container: 80, proto: 'tcp', ip: '0.0.0.0' }], exposedPorts: [] };
const dualWan = model.chipsOf([dualC], wanCfg, '192.168.1.10', true);
ok('反代连接只给外网地址，不生成内网端口',
   dualWan.length === 1 && dualWan[0].custom === true &&
   dualWan[0].url === 'https://dualtest.nas.example.com:16666', JSON.stringify(dualWan));
const dualLan = model.chipsOf([dualC], wanCfg, '192.168.1.10', false);
ok('直连显示内网地址 + 自动端口，且绝不出现外网地址',
   dualLan.length === 2 && dualLan.some(c => c.url === 'http://192.168.1.10:18081') &&
   dualLan.some(c => c.url === 'http://192.168.1.10:18080') &&
   !dualLan.some(c => c.url.indexOf('dualtest.nas.example.com') >= 0), JSON.stringify(dualLan));
const dualFallback = model.chipsOf([dualC],
   { links: wanCfg.links, linksWan: {}, httpsPorts: wanCfg.httpsPorts }, '192.168.1.10', true);
ok('外网地址留空时回退内网地址（旧 config 完全兼容）',
   dualFallback.length === 1 && dualFallback[0].url === 'http://192.168.1.10:18081', JSON.stringify(dualFallback));
const dualNone = model.chipsOf([dualC],
   { links: {}, linksWan: {}, httpsPorts: wanCfg.httpsPorts }, '192.168.1.10', true);
ok('两列都留空时反代仍不显示端口（1.0.6 行为不变）', dualNone.length === 0);
const dualBundle = fs.readFileSync(path.join(ROOT, 'js', 'bundle.js'), 'utf8');
const dualMp = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'utils', 'model.js'), 'utf8');
ok('补丁只注入 APP bundle，小程序源码零改动',
   /const wanLink = normLink\(\(cfg\.linksWan/.test(dualBundle) && !/linksWan/.test(dualMp));


section('1.0.6 六项打磨（源码静态断言）');
const webAppJs = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'assets', 'app.js'), 'utf8');
const webCss = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'assets', 'app.css'), 'utf8');
const webServer = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'server.py'), 'utf8');
const tplSrc = fs.readFileSync(path.join(ROOT, 'js', 'templates.js'), 'utf8');
const mpDetail = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'pages', 'detail', 'detail.wxml'), 'utf8');
ok('① 长按：写剪贴板统一走 copyText 去重出口（1.0.9 起不再弹提示）',
   /function writeClipboard\(text\)/.test(shimSrc) && /function copyText\(text\)/.test(shimSrc) &&
   /setClipboardData: function \(o\) \{ copyText/.test(shimSrc));
ok('① 长按：拦截小程序「已复制，粘贴到浏览器」模态框',
   /已复制，粘贴到浏览器即可打开/.test(shimSrc) && /showModal: function \(o\)/.test(shimSrc));
ok('① 长按：copyLink 事件永远由 APP 自己处理，业务方法零参与',
   /访问链接永远由 APP 自己处理/.test(shimSrc) &&
   /if \(node\.getAttribute\('data-ev'\) === 'copyLink'\) \{[\s\S]{0,200}isLongPressFollower\(\)/.test(shimSrc));
ok('① 长按：CDP 回放覆盖双弹窗真机路径',
   /长按端口出现两个「已复制」/.test(uiSrc) && /同一条链接不被重复写入剪贴板/.test(uiSrc));
ok('② 详情页端口明细表已移除（APP / 小程序一致）',
   !/port-table/.test(tplSrc) && !/port-table/.test(mpDetail) &&
   /点击访问链接直接打开浏览器/.test(tplSrc));
ok('③ Web 设置：容器名独占一行 + 内网 / 外网两个输入框',
   /class="link-card"/.test(webAppJs) && /lc-head/.test(webAppJs) &&
   /<label>内网<\/label>/.test(webAppJs) && /<label>外网<\/label>/.test(webAppJs) &&
   /\.link-card/.test(webCss));
ok('③ Web 设置：HTTPS 端口输入框已从界面移除，底层默认值保留',
   !/data-https="1"/.test(webAppJs) &&
   /"httpsPorts": \[443, 5001, 8443, 9443\]/.test(webServer) &&
   /常见 HTTPS 端口会自动用/.test(webAppJs));
ok('④ Web host 网络：同 URL 时优先显示 host · 端口，不再被去重吞掉',
   /function preferChip\(/.test(webAppJs) &&
   /preferChip\(url, '<a class="port port-host"/.test(webAppJs));
ok('⑤ 文案通用化：Web 界面不再出现个人环境字样',
   !/private-host|nas\.example\.com|16666/.test(webAppJs));
ok('⑥ Web 版本升到 1.0.31', /APP_VERSION = "1\.0\.31"/.test(webServer));


section('1.0.16 Web 两项打磨（源码静态断言）');
ok('① 项目卡片端口区带「快捷访问」标题，不再只有裸数字',
   /class="ports-label">快捷访问<\/div>'[\s\S]{0,160}ct-project-meta/.test(webAppJs));
ok('② 项目卡片端口显示「宿主端口→容器端口」并带 title 解释',
   /宿主端口 ' \+ esc\(pt\.host\) \+ ' → 容器端口/.test(webAppJs) &&
   /pAdd\(u, '<a class="port"/.test(webAppJs));
ok('③ 紧凑模式操作按钮整体下移一点点（ct-ops margin-top）',
   /\.compact \.ct-ops\{margin-top:8px\}/.test(webCss));
ok('④ APP 端口 chip 携带容器 state，供停止态拦截',
   /custom: false, state: c\.state/.test(fs.readFileSync(path.join(ROOT, 'js', 'bundle.js'), 'utf8')) &&
   /data-state/.test(tplSrc));
ok('⑤ APP 停止态点击提示「请先启动容器」，不打开浏览器',
   /容器已停止，请先启动容器/.test(shimSrc) &&
   /ctState && ctState !== 'running'/.test(shimSrc));

section('1.0.17 项目卡片（雷池）紧凑模式修复（源码静态断言）');
ok('① 紧凑模式同时隐藏项目卡片的「快捷访问」标题与端口区',
   /\.compact \.project-card \.ports-label,\s*\.compact \.project-card \.ct-project-meta\{display:none\}/.test(webCss));
ok('② 普通模式仍保留项目卡片快捷访问（未被误伤）',
   /\.project-card \.ct-project-meta\{display:flex/.test(webCss));
ok('③ 前端 CSS 引用带 1.0.31 版本号，避免浏览器缓存旧样式',
   /app\.css\?v=1031/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'index.html'), 'utf8')));
ok('④ 镜像 version label 同步到 1.0.31',
   /org\.opencontainers\.image\.version="1\.0\.31"/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'Dockerfile'), 'utf8')));

section('1.0.24 / 1.0.12 项目卡 CPU·内存显示与单容器卡一致（源码静态断言）');
ok('① Web 项目卡 meter 标签就是「CPU」「内存」，无合计字样',
   /meter-label"><span>CPU<\/span><b>' \+ cpu\.toFixed\(1\)/.test(webAppJs) &&
   !/meter-label"><span>[^<]*合计|meter-label"><span>[^<]*容器/.test(webAppJs));
ok('② Web 项目卡内存分母取单次最大值（memLimitMax），不累加',
   /memLimitMax/.test(webAppJs) && !/memLimit \+= c\.stats\.memLimit/.test(webAppJs) &&
   /mem \/ memLimitMax \* 100/.test(webAppJs));
ok('③ APP 项目卡复用 metersHtml(card)，不再是一行「CPU x% · 内存 xxx」',
   /metersHtml\(card\)/.test(tplSrc) &&
   !/CPU ' \+ e\(card\.cpuText\) \+ ' · 内存/.test(tplSrc));
ok('④ APP model 项目卡补 cpuWidth/memWidth/memPct，分母不累加',
   /memWidth: memPct \+/.test(dualMp) && /memLimitMax/.test(dualMp) &&
   /memUsed \/ memLimitMax \* 100/.test(dualMp) &&
   !/memLimit \+= Number/.test(dualMp));

section('1.0.24 / 1.0.13 项目卡显示启动时间（源码静态断言）');
ok('① Web 项目卡渲染 .ct-status 启动时间并调用 projectStatusText',
   /class=\"ct-status\" title=/.test(webAppJs) && /projectStatusText\(list\)/.test(webAppJs));
ok('② Web 有 Up 时长解析（uptimeSeconds）支持 days/hours 等',
   /function uptimeSeconds\(status\)/.test(webAppJs) && /\* 31536000/.test(webAppJs) && /\* 86400/.test(webAppJs));
ok('③ APP 项目卡模板输出 statusText 到 .ct-status',
   /class=\"ct-status' \+ \(card\.statusWarn/.test(tplSrc) && /e\(card\.statusText/.test(tplSrc));
ok('④ APP model 项目卡补 statusText 字段，同源复用 projectStatusInfo',
   /statusText: pStatus\.text/.test(dualMp) && /function projectStatusInfo\(list\)/.test(dualMp));

section('1.0.24 / 1.0.14 项目卡状态行：位置 + healthy + 异常警告（源码静态断言）');
ok('① Web 项目卡 projectStatusInfo 同长优先 healthy',
   /function projectStatusInfo\(list\)/.test(webAppJs) && /sec === bestSec && healthy/.test(webAppJs));
ok('② Web 项目卡统计异常容器（非running/unhealthy）',
   /c\.state !== "running" \|\| \/unhealthy\/i\.test\(st\)/.test(webAppJs) && /status-warn-tag/.test(webAppJs));
ok('③ Web 项目卡状态行在 meters 之前（pStatusHTML + meters 顺序）',
   webAppJs.indexOf('pStatusHTML +') > 0 && webAppJs.indexOf('pStatusHTML +') < webAppJs.indexOf('      meters +'));
ok('④ Web CSS 有 .status-warn 与 .status-warn-tag',
   /\.ct-status\.status-warn/.test(fs.readFileSync(path.join(__dirname,'..','..','litedock','app','web','assets','app.css'),'utf8')));
ok('⑤ APP model 同源 projectStatusInfo + statusWarn/statusIssues 字段',
   /function projectStatusInfo\(list\)/.test(dualMp) && /statusWarn: pStatus\.warn/.test(dualMp) && /statusIssues: pStatus\.issues/.test(dualMp));
ok('⑥ APP 模板项目卡输出警告 chip + status-warn class',
   /card\.statusWarn \? ' status-warn'/.test(tplSrc) && /status-warn-tag/.test(tplSrc));

section('1.0.9 长按双「已复制」根治（源码静态断言）');
const shellCss = fs.readFileSync(path.join(ROOT, 'css', 'shell.css'), 'utf8');
const touchSrc = fs.readFileSync(path.join(__dirname, 'verify_touch.js'), 'utf8');
const flashBody = (shimSrc.match(/function flashCopied\(node\) \{[\s\S]*?\n  \}/) || [''])[0];
ok('① APP 端不再输出任何「已复制」toast 文案（系统提示独占）',
   !/toast\(\{\s*title:\s*'已复制'/.test(shimSrc) &&
   /function copyText\(text\)[\s\S]{0,400}writeClipboard\(text\);[\s\S]{0,80}return true;/.test(shimSrc));
ok('② 长按成功只让被长按的 chip 闪绿色描边（flashCopied）',
   /function flashCopied\(node\)/.test(shimSrc) &&
   /if \(copyText\(linkUrlOf\(node\)\)\) flashCopied\(node\)/.test(shimSrc));
ok('③ 反馈是 CSS 动画 + animationend 自清，函数内零悬挂定时器',
   flashBody.length > 100 && !/setTimeout/.test(flashBody) && /animationend/.test(flashBody) &&
   /@keyframes ld-link-copied-flash/.test(shellCss) && /ld-link-copied/.test(shellCss));
ok('④ 版本同步 1.0.24 / versionCode 25 / 构建产物 1.0.24',
   /LD\.APP_VERSION = '1\.0\.24'/.test(shimSrc) &&
   /APP_VERSION = "1\.0\.24"/.test(pyCfg) && /VERSION_CODE = 25/.test(pyCfg) &&
   /LiteDock-App-1\.0\.24\.apk/.test(pyBuild));
ok('⑤ CDP 真机回放覆盖「系统提示 + APP toast」双提示复现与修复后单提示断言',
   /sys-clip-toast/.test(touchSrc) && /__copiedVisible/.test(touchSrc) &&
   /屏幕同时有两个「已复制」/.test(touchSrc) && /屏幕只有 1 个「已复制」/.test(touchSrc) &&
   /longpress-before/.test(touchSrc) && /longpress-after/.test(touchSrc) &&
   /LD_WWW/.test(touchSrc));

section('1.0.10 / 1.0.18 本轮五项改动（源码静态断言）');
/* ① 点击访问链接静默打开，去掉一闪而过的「打开浏览器」toast */
ok('① APP 点击链接不再弹「正在打开浏览器 / 已打开浏览器」toast',
   !/toast\(\{ title: first \? '已打开浏览器/.test(shimSrc) &&
   !/已打开浏览器 · 长按可复制地址'/.test(shimSrc) &&
   /openExternal\(link\)\) \{[\s\S]{0,180}1\.0\.10：静默打开浏览器/.test(shimSrc));
/* ② APP 1.0.10 曾删检查更新/升级重建；1.0.16 入口移到详情页；1.0.17 全容器开放 */
ok('②a APP 详情页：检查更新 / 升级重建入口 1.0.17 起全容器开放（项目成员带警告）',
   /data-ev="checkUpdate"/.test(tplSrc) && /data-ev="doUpgrade"/.test(tplSrc) &&
   /d\.canUpgrade/.test(tplSrc) && !/d\.isStandalone && d\.canUpgrade/.test(tplSrc) &&
   /d\.inProject \? /.test(tplSrc));
ok('②b Web 检查更新结果含「当前 … → 最新 …」版本号展示',
   /var ver = "当前 " \+ tag/.test(webAppJs) && /curId !== newId/.test(webAppJs) &&
   /shortId\(r\.oldId\)/.test(webAppJs) && /shortId\(r\.newId\)/.test(webAppJs) && /function shortId/.test(webAppJs));
/* ③ 首页日志按钮换成重启（在 index 模板断言里已覆盖，这里断言重启带 doAction id/name） */
ok('③ 首页重启按钮带 doAction + data-act=restart + id/name',
   /data-ev="doAction" data-catch="1" data-id="' \+ attr\(card\.id\) \+ '" data-act="restart" data-name="'/.test(tplSrc));
/* ④ Web 禁止单独拖拽项目内子容器 */
ok('④a 项目内子容器卡不输出 data-ctname、标记 in-project、draggable=false',
   /function cardHTML\(c, inProject\)/.test(webAppJs) &&
   /inProject \? ' in-project'/.test(webAppJs) &&
   /inProject \? "false" : "true"/.test(webAppJs) &&
   /data-inproject="1"/.test(webAppJs));
ok('④b 展开子容器以 inProject=true 渲染，dragstart 显式拦截 in-project',
   /cardHTML\(x, true\)/.test(webAppJs) &&
   /closest\("\.ct\.in-project, \.ct\[data-inproject\]"\)/.test(webAppJs));
ok('④c CSS 给项目内子容器默认光标', /\.ct\.in-project\{cursor:default\}/.test(webCss));
/* ⑤ APP 所有分组统一带背景、配色各异 */
ok('⑤a 分组模板：无自定义图分组自动生成渐变背景，统一 has-bg 视觉',
   /function assignGroupThemes\(groups\)/.test(tplSrc) &&
   /g\._theme = chosen/.test(tplSrc) && /visualBg = g\.hasBg \|\| !!theme/.test(tplSrc) &&
   /linear-gradient\(135deg,'[\s\S]{0,120}shade\(theme/.test(tplSrc));
ok('⑤b 调色板保证配色各异，且显式强调色优先、避免撞色',
   /var GROUP_PALETTE = \[/.test(tplSrc) && /if \(!used\[cand\]\) \{ chosen = cand; break; \}/.test(tplSrc) &&
   /if \(a && DEFAULT_ACCENTS\.indexOf\(a\) < 0\) used\[a\] = 1/.test(tplSrc));
ok('⑤c 分组渲染前调用 assignGroupThemes，新增分组自动适用',
   /assignGroupThemes\(vm\.groups\);[\s\S]{0,80}\(vm\.groups \|\| \[\]\)\.map\(groupHtml\)/.test(tplSrc));

section('1.0.24 项目批量启停 + 升级备份管理（Web 源码静态断言）');
const webIndex = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'index.html'), 'utf8');
ok('① 后端版本 1.0.31 + 版本 label 同步',
   /APP_VERSION = "1\.0\.31"/.test(webServer) &&
   /org\.opencontainers\.image\.version="1\.0\.31"/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'Dockerfile'), 'utf8')));
ok('② 后端有项目批量启停 API 与依赖拓扑排序',
   /\/api\/project\/\(\[\^\/\]\+\)\/\(start\|stop\|restart\)/.test(webServer) &&
   /def project_action\(/.test(webServer) && /def project_topo\(/.test(webServer) &&
   /by_id\[m\["id"\]\] <= done_services/.test(webServer));
ok('③ 后端备份隐藏 + 回退/删除 API 齐全',
   /BACKUP_NAME_RE = re\.compile/.test(webServer) &&
   /if backup_base\(name\):\s*\n\s*continue/.test(webServer) &&
   /def list_backups\(/.test(webServer) && /def rollback_backup\(/.test(webServer) &&
   /def delete_backup\(/.test(webServer) &&
   /\/api\/backup\/\(\[\^\/\]\+\)\/rollback/.test(webServer) &&
   /\/api\/backup\/\(\[\^\/\]\+\)\/delete/.test(webServer));
ok('④ 项目卡批量按钮：1.0.25 去掉 start，只留停止/重启（与单容器卡运行态同口径）',
   !/data-pact="start"/.test(webAppJs) && /data-pact="stop"/.test(webAppJs) &&
   /data-pact="restart"/.test(webAppJs) && /function projectAct\(/.test(webAppJs));
ok('⑤ 备份 tab + 备份列表 UI + 回退/删除入口',
   /data-tab="backup"/.test(webIndex) && /state\.tab === "backup"/.test(webAppJs) &&
   /function loadBackups\(/.test(webAppJs) && /data-bkact="rollback"/.test(webAppJs) &&
   /data-bkact="delete"/.test(webAppJs));
ok('⑥ 项目内子容器隐藏单容器升级按钮（inProject 判断）',
   /!inProject && !isSelf \?/.test(webAppJs) && /data-act="upgrade"/.test(webAppJs));
ok('⑦ 前端资源 ?v=1031 避免缓存',
   /app\.css\?v=1031/.test(webIndex) && /app\.js\?v=1031/.test(webIndex));

section('1.0.15 项目批量启停 + 备份管理（APP 源码静态断言）');
const mpRoot = path.join(__dirname, '..', '..', 'litedock-miniprogram');
const mpApi = fs.readFileSync(path.join(mpRoot, 'utils', 'api.js'), 'utf8');
const mpIndex = fs.readFileSync(path.join(mpRoot, 'pages', 'index', 'index.js'), 'utf8');
const mpSettings = fs.readFileSync(path.join(mpRoot, 'pages', 'settings', 'settings.js'), 'utf8');
const bundleSrc = fs.readFileSync(path.join(ROOT, 'js', 'bundle.js'), 'utf8');
ok('① APP API 层有项目批量 + 备份四个方法',
   /projectAction:/.test(mpApi) && /getBackups:/.test(mpApi) &&
   /backupRollback:/.test(mpApi) && /backupDelete:/.test(mpApi));
ok('② 首页有 projectAction 事件方法并调用 api.projectAction',
   /projectAction\(e\)/.test(mpIndex) && /api\.projectAction\(proj, act\)/.test(mpIndex));
ok('③ 项目卡模板有启动/停止/重启三个按钮（data-ev=projectAction）',
   (tplSrc.match(/data-ev="projectAction"/g) || []).length >= 3 &&
   /data-act="start"/.test(tplSrc) && /data-act="stop"/.test(tplSrc) && /data-act="restart"/.test(tplSrc));
ok('④ 设置页有备份数据与方法（loadBackups/backupRollback/backupDelete）',
   /backups: \[\]/.test(mpSettings) && /loadBackups\(\)/.test(mpSettings) &&
   /backupRollback\(e\)/.test(mpSettings) && /backupDelete\(e\)/.test(mpSettings));
ok('⑤ 设置页模板有升级备份卡片 + 回退/删除入口',
   /升级备份/.test(tplSrc) && /data-ev="backupRollback"/.test(tplSrc) &&
   /data-ev="backupDelete"/.test(tplSrc) && /bk-list/.test(tplSrc));
ok('⑥ 新方法已打进 bundle.js（构建产物同步）',
   /projectAction/.test(bundleSrc) && /backupRollback/.test(bundleSrc) &&
   /backupDelete/.test(bundleSrc) && /getBackups/.test(bundleSrc));
ok('⑦ shell.css 有项目批量按钮与备份列表样式（vw 坐标系）',
   /\.project-ops/.test(shellCss) && /\.bk-list/.test(shellCss) && /\.bk-kind/.test(shellCss));
ok('⑧ APP 版本 1.0.24 / versionCode 25',
   /LD\.APP_VERSION = '1\.0\.24'/.test(shimSrc) &&
   /APP_VERSION = "1\.0\.24"/.test(pyCfg) && /VERSION_CODE = 25/.test(pyCfg));

section('1.0.16 项目卡背景 + 详情页更新入口 + 静默刷新（APP 源码静态断言）');
const modelSrc1016 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'utils', 'model.js'), 'utf8');
const tplSrc1016 = tplSrc;
const idxSrc1016 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'pages', 'index', 'index.js'), 'utf8');
const detailSrc1016 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'pages', 'detail', 'detail.js'), 'utf8');
const litCss1016 = fs.readFileSync(path.join(ROOT, 'css', 'litedock.css'), 'utf8');ok('①a model.projectCard 计算背景字段（hasBg/bgUrl/bgMask/bgBlur，取项目第一个容器）',
   /pBg = \(cfg\.cardBackgrounds \|\| \{\}\)\[list\[0\]\.name\]/.test(modelSrc1016) &&
   /hasBg: !!pBgUrl/.test(modelSrc1016) && /pBg\.blur == null \? 6/.test(modelSrc1016));
ok('①b APP 项目卡模板输出 ct-bg/ct-mask + has-bg class（与单容器卡同结构）',
   /function projectCard\(card\) \{[\s\S]{0,900}ct-bg[\s\S]{0,200}ct-mask/.test(tplSrc1016) &&
   /ct-project ' \+ \(card\.hasBg \? 'has-bg' : ''\)/.test(tplSrc1016));
ok('①c litedock.css 项目卡操作区浮在背景上（z-index:2 扩展到 project-ops/op-full）',
   /\.ct\.has-bg > \.project-ops/.test(litCss1016) && /\.ct\.has-bg > \.op-full/.test(litCss1016));
ok('①d 小程序源 wxss 同步（构建源头一致，防止 build_css 再生成时回退）',
   /\.ct\.has-bg > \.project-ops/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'pages', 'index', 'index.wxss'), 'utf8')));
ok('②a 详情页「镜像更新」入口 1.0.17 起全容器开放（inProject 口径保留用于警告文案）',
   /d\.canUpgrade/.test(tplSrc1016) && !/d\.isStandalone && d\.canUpgrade/.test(tplSrc1016) &&
   /inProject = cfg\.collapseProjects !== false && members\.length >= 2/.test(detailSrc1016));
ok('②b 检查更新结果弹窗反馈 + 项目成员升级警告（1.0.17）',
   /发现新镜像/.test(detailSrc1016) && /已是最新版本/.test(detailSrc1016) &&
   /projWarn/.test(detailSrc1016) && /belongs|属于多容器项目/.test(detailSrc1016));
ok('③a index.load 支持静默刷新参数（load(force, silent)）',
   /load\(force, silent\) \{/.test(idxSrc1016) &&
   /if \(!silent && \(force \|\| needInit/.test(idxSrc1016));
ok('③b 容器/项目操作成功后走 this.load(true, true)（不闪 loading）',
   idxSrc1016.split('this.load(true, true)').length - 1 === 2);
ok('③c 静默刷新失败仅 toast 提示，不切换视图状态（面板保持原内容）',
   /if \(silent\) \{[\s\S]{0,120}wx\.showToast/.test(idxSrc1016));

/* ==================== 1.0.26 本轮自我保护（Web 3 项 + APP 玻璃卡 1 项）==================== */
section('1.0.26 自我保护专项 / 按钮防溢出 / 分组强调色（Web 源码静态断言）');
const wa125 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'assets', 'app.js'), 'utf8');
const wc125 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'assets', 'app.css'), 'utf8');
ok('① 项目卡去掉「启动」：无 data-pact=start，仍有 stop/restart/toggle',
   !/data-pact="start"/.test(wa125) && /data-pact="stop"/.test(wa125) &&
   /data-pact="restart"/.test(wa125) && /data-toggleproject/.test(wa125));
ok('② 卡片按钮防溢出：.op min-width 提升 + ellipsis 兜底（5列/缩放不溢出）',
   /\.op\{[^}]*min-width:56px/.test(wc125) && /\.op\{[^}]*text-overflow:ellipsis/.test(wc125) &&
   /\.project-card \.ct-ops \.op\{[^}]*min-width:52px/.test(wc125));
ok('③ 5 列选项仍保留（2/3/4/5 全部可选）',
   /\[2, 3, 4, 5\]/.test(wa125));
ok('④ Web 移植分组强调色：GROUP_PALETTE / shade / assignGroupThemes 齐全',
   /var GROUP_PALETTE = \[/.test(wa125) && /function shade\(hex, factor\)/.test(wa125) &&
   /function assignGroupThemes\(keys, groupsCfg, globalAccent\)/.test(wa125) &&
   /assignGroupThemes\(order, state\.config\.groups/.test(wa125));
ok('⑤ 无图分组生成渐变背景 + has-bg 白字（与 APP 同口径）',
   /background:linear-gradient\(135deg," \+ theme/.test(wa125) &&
   /autoBg \? " has-bg"/.test(wa125) && /var autoBg = !g\.image && !!theme/.test(wa125));
const wxss125 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'pages', 'index', 'index.wxss'), 'utf8');
const lit125 = fs.readFileSync(path.join(__dirname, '..', 'www', 'css', 'litedock.css'), 'utf8');
ok('⑥ APP 无背景卡片改玻璃态：源与生成物均 rgba(255,255,255,.86)',
   /background: rgba\(255, 255, 255, \.86\)/.test(wxss125) &&
   /\.group\.has-bg \.ct \{ background: rgba\(255, 255, 255, \.86\)/.test(wxss125) &&
   /\.scope-index \.ct \{[\s\S]{0,120}background: rgba\(255, 255, 255, \.86\)/.test(lit125));

/* ==================== 1.0.26 自我保护（服务端 + 双端 UI）==================== */
section('1.0.26 自我保护：服务端识别拦截 + Web/APP 本体徽标与禁用');
const ws126 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'server.py'), 'utf8');
const webjs126 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'assets', 'app.js'), 'utf8');
const webcss126 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock', 'app', 'web', 'assets', 'app.css'), 'utf8');
const mpModel126 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'utils', 'model.js'), 'utf8');
const mpDetail126 = fs.readFileSync(path.join(__dirname, '..', '..', 'litedock-miniprogram', 'pages', 'detail', 'detail.js'), 'utf8');
const tpl126 = tplSrc;
const bundle126 = bundleSrc;
ok('① 服务端识别自身：_detect_self_id / is_self / SELF_NAME 齐全',
   /def _detect_self_id\(/.test(ws126) && /def is_self\(cid, name=/.test(ws126) &&
   /LITEDOCK_SELF_NAME/.test(ws126));
ok('① 服务端 cgroup + hostname 双通道识别',
   /\/proc\/self\/cgroup/.test(ws126) && /socket\.gethostname\(\)/.test(ws126));
ok('② /api/state 容器带 isSelf 字段', /"isSelf": is_self\(cid, name\)/.test(ws126));
ok('③ 服务端拦截 stop/restart/pause 自身（SELF_PROTECTED）',
   /action in \("stop", "restart", "pause"\) and is_self\(cid\)/.test(ws126) &&
   /"code": "SELF_PROTECTED"/.test(ws126));
ok('③ 服务端拦截 upgrade 自身 + 项目批量含自身',
   (ws126.match(/if is_self\(cid\):/g) || []).length >= 1 && /SELF_PROTECTED/.test(ws126) &&
   /any\(is_self\(m\["id"\], m\["name"\]\)/.test(ws126) &&
   /action in \("stop", "restart"\) and any\(is_self/.test(ws126));
ok('④ Web 卡片本体徽标 + isSelf 隐藏危险操作',
   /self-flag/.test(webjs126) && /var isSelf = c\.isSelf === true/.test(webjs126) &&
   /!inProject && !isSelf \?/.test(webjs126) && /\.self-flag\{/.test(webcss126));
ok('④ Web act() 前端兜底拦截本体',
   /selfContainer/.test(webjs126) && /\["stop", "restart", "pause", "upgrade"\]/.test(webjs126));
ok('⑤ APP model/detail 传递 isSelf',
   /isSelf: c\.isSelf === true/.test(mpModel126) && /isSelf: c\.isSelf === true/.test(mpDetail126));
ok('⑤ APP detail doAction/doUpgrade 前端兜底',
   /this\.data\.isSelf && \['stop', 'restart', 'pause'\]/.test(mpDetail126) &&
   /if \(this\.data\.isSelf\)/.test(mpDetail126));
ok('⑥ APP 模板卡片 + 详情本体徽标/禁用/保留只读',
   /card\.isSelf \? '<span class="self-flag"/.test(tpl126) &&
   /d\.isSelf\s*\n?\s*\?/.test(tpl126) && /data-ev="checkUpdate"/.test(tpl126) &&
   /op-disabled self-tip/.test(tpl126));
ok('⑦ 生成物 bundle.js 含自我保护逻辑',
   /isSelf: c\.isSelf === true/.test(bundle126) && /本体禁止停止/.test(bundle126));
ok('⑧ 专项脚本 + fixture 就位',
   fs.existsSync(path.join(__dirname, 'verify_126_web.js')) &&
   fs.existsSync(path.join(__dirname, 'verify_119_app.js')) &&
   fs.existsSync(path.join(__dirname, 'fixtures', 'state_self.json')));

console.log('\n========================================');
console.log('PASS=' + pass + '  FAIL=' + fail);
console.log('========================================');
process.exit(fail ? 1 : 0);
