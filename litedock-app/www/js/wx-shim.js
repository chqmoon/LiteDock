/* LiteDock App — 微信小程序运行时兼容层
   目标：让 litedock-miniprogram 的 utils 模块与 pages 各页 JS 业务逻辑一行不改跑在 WebView 里。
   - wx.request / downloadFile 走 Capacitor 原生 HTTP（CapacitorHttp），彻底绕开 WebView 的
     CORS、自签证书、任意端口、明文 http 限制 —— 这正是安卓 APK 相对微信小程序的优势。
   - wx.* 其余 API、App()/getApp()/Page()、setData、路由、tabBar 全部在此实现。
*/
(function (global) {
  'use strict';

  var LD = global.LD = global.LD || {};
  LD.APP_NAME = 'LiteDock';
  LD.APP_VERSION = '1.0.26';

  /* 1.0.9：长按复制不再叠加两个「已复制」提示。
     ★ 取证（用户 1.0.8 真机截图）：绿色方块「已复制」= APP 的 #ld-toast.ok
       （fixed bottom 22%）；深色全圆胶囊「已复制。」= Android 系统/ROM 在应用
       写入剪贴板时自己弹的提示 —— APK dex 内无任何中文「已复制」字符串、
       Java 层无 Toast、页面只有一个 #ld-toast 节点（连续调用只会覆盖，
       不可能同时呈现两种样式）。1.0.7/1.0.8 一直在 JS 里去重，方向错了。
     ⇒ APP 端长按成功后不再输出任何「已复制」文字，只让 chip 闪一下绿色描边；
       剪贴板写入仍严格一次（系统提示也只会出现一次）。 */

  /* 渲染性能计数（常驻、开销可忽略；真机排查或 CDP 回放时读取 LD._perf） */
  LD._perf = { renders: 0, lastMs: 0, maxMs: 0, totalMs: 0,
               batched: 0, imgPatches: 0, imgFlushes: 0, skipped: 0, tabReuse: 0 };

  /* 1.0.8：反向代理连接下的两个「互不干扰」的独立开关。
     A 外网显示已配反代的服务（ld_wan_links，默认开）：显示 Web 端配好的
       外网访问链接 linksWan（留空回退 links）；Web 端没配就没有链接。
     B 外网也显示容器端口（ld_ports_always，默认关）：显示 NAS 内网端口映射，
       仅在手机通过 WiFi / VPN / Tailscale / WireGuard / 组网连回家里网络时有意义，
       此时请把连接管理 → 高级选项的「容器链接主机」填成 NAS 内网 IP 或组网 IP。
     直连（局域网）连接下两个开关都不生效，始终显示内网链接 + 端口。
     ★ 旧版只有一个二态开关，开启 B 会把 isProxy 整体覆盖成 false，导致外网
       访问链接被换成内网链接、无法「链接 + 端口」同时显示；1.0.8 起彻底解耦。 */
  LD.appWanLinks = function () {
    try { return localStorage.getItem('ld_wan_links') !== '0'; } catch (err) { return true; }
  };
  LD.appPortsAlways = function () {
    try { return localStorage.getItem('ld_ports_always') === '1'; } catch (err) { return false; }
  };
  /* model.js 的 chipsOf 只认这一个聚合入口，避免两个开关在多处判断时走偏 */
  LD.appLinkPrefs = function () {
    return { wan: LD.appWanLinks(), ports: LD.appPortsAlways() };
  };

  /* 1.0.11：紧凑模式（UI 显示密度开关，与 Web 端「设置 → 紧凑模式」一致）。
     纯本地视觉：隐藏卡片里的状态行 / 资源条 / 快捷访问区，缩小内边距与图标，
     卡片剩下的名字 / 镜像 / state 行 / 按钮全部保留，不影响任何数据与操作。
     开关只写 ld_compact 一个键，class 挂在 #ld-root 上（对齐 Web 挂 body）。 */
  LD.appCompact = function () {
    try { return localStorage.getItem('ld_compact') === '1'; } catch (err) { return false; }
  };
  LD.applyCompact = function () {
    var root = document.getElementById('ld-root');
    if (root) root.classList.toggle('ld-compact', LD.appCompact());
    return LD.appCompact();
  };

  /* ============ 1. CommonJS 微运行时 ============ */
  var modules = {};          // name -> exports
  var factories = {};        // name -> fn

  function resolve(from, rel) {
    if (rel.charAt(0) !== '.') return rel;
    var base = from.split('/').slice(0, -1);
    var seg = rel.split('/');
    for (var i = 0; i < seg.length; i++) {
      if (seg[i] === '.' || seg[i] === '') continue;
      if (seg[i] === '..') base.pop();
      else base.push(seg[i]);
    }
    return base.join('/');
  }

  LD.define = function (name, fn) { factories[name] = fn; };
  LD.makeRequire = function (fromName) {
    return function (rel) {
      var name = resolve(fromName, rel);
      if (!(name in modules)) {
        if (!(name in factories)) throw new Error('module not found: ' + name + ' (from ' + fromName + ')');
        var mod = { exports: {} };
        modules[name] = mod.exports;
        factories[name](LD.makeRequire(name), mod, mod.exports);
        modules[name] = mod.exports;
      }
      return modules[name];
    };
  };
  LD.require = function (name) { return LD.makeRequire('app.js')(name); };
  LD.pageModule = function (page, fn) {
    LD._pendingPage = page;
    try { fn(LD.makeRequire('pages/' + page + '/' + page + '.js'), { exports: {} }, {}); }
    finally { LD._pendingPage = null; }
  };

  /* ============ 2. 网络层：优先 LiteDock 原生 HTTP ============
     三级回退：
       ① LiteDockHttp（自写插件）：放行自签证书、任意端口、任意域名、明文 http
       ② CapacitorHttp（官方插件）：浏览器预览或无自定义插件时
       ③ window.fetch：纯浏览器本地调试
     这样 WebView 的 CORS / 证书校验完全不参与，等价于小程序 wx.request 的自由网络能力。 */
  function liteHttp() {
    try {
      if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LiteDockHttp) {
        return global.Capacitor.Plugins.LiteDockHttp;
      }
    } catch (e) {}
    return null;
  }
  function nativeHttp() {
    try {
      if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.CapacitorHttp) {
        return global.Capacitor.Plugins.CapacitorHttp;
      }
    } catch (e) {}
    return null;
  }

  function withTimeout(promise, ms, onTimeout) {
    var timer;
    return Promise.race([
      promise.then(function (v) { clearTimeout(timer); return v; },
                   function (e) { clearTimeout(timer); throw e; }),
      new Promise(function (_, reject) {
        timer = setTimeout(function () { reject(new Error(onTimeout || 'timeout')); }, ms);
      })
    ]);
  }

  function parseBody(data) {
    if (data && typeof data === 'object') return data;
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch (e) { return data; }
    }
    return data;
  }

  /* 统一请求：返回 { statusCode, data, header }；失败 reject(Error) */
  function httpRequest(opts) {
    var url = opts.url;
    var method = (opts.method || 'GET').toUpperCase();
    var headers = {};
    Object.keys(opts.header || {}).forEach(function (k) { headers[k] = String(opts.header[k]); });
    var body = opts.data;
    if (method === 'POST' && body === undefined) body = '';
    if (body && typeof body !== 'string') body = JSON.stringify(body);
    var timeout = opts.timeout || 10000;

    var lite = liteHttp();
    if (lite && lite.request) {
      var p0 = lite.request({
        url: url, method: method, headers: headers,
        data: (method === 'GET' || method === 'HEAD') ? null : (body || ''),
        timeout: timeout, binary: false
      }).then(function (res) {
        return { statusCode: res.status, data: parseBody(res.data), header: {} };
      });
      return withTimeout(p0, timeout + 3000, 'request timeout');
    }

    var plugin = nativeHttp();
    if (plugin && plugin.request) {
      var p = plugin.request({
        url: url, method: method, headers: headers,
        data: (method === 'GET' || method === 'HEAD') ? undefined : body,
        responseType: 'text',
        connectTimeout: Math.max(1, Math.ceil(timeout / 1000)),
        readTimeout: Math.max(1, Math.ceil(timeout / 1000))
      }).then(function (res) {
        return { statusCode: res.status, data: parseBody(res.data), header: res.headers || {} };
      });
      return withTimeout(p, timeout + 2000, 'request timeout');
    }

    /* 浏览器预览 / 无插件时的兜底 */
    var fetchOpts = { method: method, headers: headers };
    if (method !== 'GET' && method !== 'HEAD') fetchOpts.body = body;
    var p2 = fetch(url, fetchOpts).then(function (res) {
      return res.text().then(function (txt) {
        return { statusCode: res.status, data: parseBody(txt), header: {} };
      });
    });
    return withTimeout(p2, timeout, 'request timeout');
  }

  /* 图片：带自定义鉴权头下载，转 data: URL（<img> 本身无法带 header） */
  function httpBinary(url, headers, timeout) {
    var lite = liteHttp();
    if (lite && lite.request) {
      var p0 = lite.request({
        url: url, method: 'GET', headers: headers || {},
        timeout: timeout || 15000, binary: true
      }).then(function (res) {
        if (res.status !== 200) throw new Error('HTTP ' + res.status);
        if (typeof res.data === 'string' && /^data:/.test(res.data)) return res.data;
        throw new Error('bad binary');
      });
      return withTimeout(p0, (timeout || 15000) + 3000, 'image timeout');
    }

    var plugin = nativeHttp();
    if (plugin && plugin.request) {
      var p = plugin.request({
        url: url, method: 'GET', headers: headers || {},
        responseType: 'blob',
        connectTimeout: 10, readTimeout: 15
      }).then(function (res) {
        if (res.status !== 200) throw new Error('HTTP ' + res.status);
        var d = res.data;
        /* CapacitorHttp 的 blob 响应是 base64 字符串 */
        if (typeof d === 'string') {
          if (/^data:/.test(d)) return d;
          return 'data:image/png;base64,' + d.replace(/\s/g, '');
        }
        if (d && d.base64) return 'data:image/png;base64,' + d.base64;
        throw new Error('bad binary');
      });
      return withTimeout(p, timeout || 15000, 'image timeout');
    }
    var p2 = fetch(url, { headers: headers || {} }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    });
    return withTimeout(p2, timeout || 15000, 'image timeout');
  }
  LD.httpRequest = httpRequest;
  LD.httpBinary = httpBinary;

  /* ============ 3. UI 层：toast / loading / modal ============ */
  var toastTimer = null;
  function el(id) { return document.getElementById(id); }

  function toast(opts) {
    opts = opts || {};
    var box = el('ld-toast');
    if (!box) return;
    box.textContent = opts.title || '';
    box.className = 'ld-toast show' + (opts.icon === 'success' ? ' ok' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'ld-toast'; }, opts.duration || 2200);
  }
  function loading(opts) {
    var box = el('ld-loading');
    if (!box) return;
    box.querySelector('.ld-loading-text').textContent = (opts && opts.title) || '请稍候';
    box.classList.add('show');
  }
  function hideLoading() {
    var box = el('ld-loading');
    if (box) box.classList.remove('show');
  }
  function modal(opts) {
    opts = opts || {};
    var box = el('ld-modal');
    if (!box) return;
    box.querySelector('.ld-modal-title').textContent = opts.title || '提示';
    box.querySelector('.ld-modal-content').textContent = String(opts.content == null ? '' : opts.content);
    var cancel = box.querySelector('.ld-modal-cancel');
    var ok = box.querySelector('.ld-modal-ok');
    cancel.style.display = opts.showCancel === false ? 'none' : '';
    ok.textContent = opts.confirmText || '确定';
    box.classList.add('show');
    function done(confirm) {
      box.classList.remove('show');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      if (opts.success) opts.success({ confirm: confirm, cancel: !confirm });
    }
    function onOk() { done(true); }
    function onCancel() { done(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  }
  /* 1.0.7：长按复制彻底改成「时间戳判定」，不再用 setTimeout。
     ── 为什么必须重构 ────────────────────────────────────────────
     1.0.4~1.0.6 用 550ms 定时器做长按，靠 blur/visibilitychange/touchend 等
     多个出口去 clearTimeout。真机上这套「布尔标志 + 多出口清理」有两类漏网：
       ① 定时器在 Activity 切走后被冻结，几十秒后回前台才 fire ⇒ 莫名「已复制」；
       ② 系统长按菜单抢焦点触发 blur 把标志清掉，WebView 随后补发的 click 漏过去，
          再走一次业务 copyLink ⇒ 一个长按出现两个「已复制」。
     根治办法：任何时刻都不存在悬挂的定时器。touchstart 只记时间戳，touchend
     时再按「按住时长」判定是不是长按。去重也一律用 Date.now() 时间戳，
     不依赖任何可被系统事件清除的布尔标志。 */
  var LONG_PRESS_MS = 550;      // 判定为长按的按住时长
  var COPY_DEDUP_MS = 1000;     // 复制去重窗口：这段时间内绝不重复写/重复弹
  var CLICK_SUPPRESS_MS = 800;  // 长按后补发 click 的吞掉窗口
  var lastCopyAt = 0;           // 上次成功复制的时间戳（不受可见性事件影响）
  var lastLongPressAt = 0;      // 上次长按判定的时间戳

  function writeClipboard(text) {
    if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Clipboard) {
      global.Capacitor.Plugins.Clipboard.write({ string: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
  }
  /* 唯一的复制出口：时间戳去重，保证一个长按只写一次系统剪贴板。
     即使补发的 click 漏到业务 copyLink → wx.setClipboardData，也会被这里挡住。
     ★ 1.0.9：这里不再弹「已复制」toast。系统/ROM 在写剪贴板时已经会提示，
       APP 再弹一个就成了用户看到的两个「已复制」。反馈改由 flashCopied 承担。 */
  function copyText(text) {
    var now = Date.now();
    if (now - lastCopyAt < COPY_DEDUP_MS) return false;
    lastCopyAt = now;
    writeClipboard(text);
    return true;
  }

  /* 1.0.9：长按成功后的「无声」视觉反馈 —— 只让被长按的 chip 闪一下绿色描边，
     不出现任何「已复制」字样，因此屏幕上只剩系统那一个提示。
     用 CSS animation + animationend 清除 class，不挂任何定时器（不会后台冻结/迟发）。 */
  function flashCopied(node) {
    if (!node || !node.classList) return;
    try {
      node.classList.remove('ld-link-copied');
      void node.offsetWidth;              /* 强制重排：连续两次长按也能重播动画 */
      if (!node.__ldFlashBound) {
        node.__ldFlashBound = true;
        node.addEventListener('animationend', function (e) {
          if (e.target === node) node.classList.remove('ld-link-copied');
        });
      }
      node.classList.add('ld-link-copied');
    } catch (err) {}
  }

  /* 长按按压状态：只有时间戳和节点，没有任何定时器 */
  var pressStartAt = 0;
  var pressNode = null;
  function clearLinkPress() { pressStartAt = 0; pressNode = null; }
  /* 长按成功后调用：记录时间戳 + 发送一次复制 */
  function commitLongPress(node) {
    if (!node) return;
    lastLongPressAt = Date.now();
    clearLinkPress();
    /* 清掉任何残留的小程序模态框，避免与系统复制提示叠在一起 */
    var mb = el('ld-modal'); if (mb) mb.classList.remove('show');
    if (copyText(linkUrlOf(node))) flashCopied(node);
  }
  /* click 处理里问：这次点击是不是紧跟在一次长按之后（补发的 tap）？
     用时间戳而非布尔标志，blur/visibilitychange 不会把它清掉。 */
  function isLongPressFollower() {
    return (Date.now() - lastLongPressAt) < CLICK_SUPPRESS_MS;
  }
  LD._cancelLinkPress = clearLinkPress;
  LD._resetLinkPress = clearLinkPress;   // 兼容旧调用：仅需丢弃待决按压，无需动时间戳
  LD._copyText = copyText;
  /* 仅测试用：清空复制去重时间戳，让回放脚本各组用例互相隔离。
     真机运行期不会有调用，不影响去重语义。 */
  LD._resetCopyDedup = function () {
    lastCopyAt = 0; lastLongPressAt = 0; clearLinkPress();
  };

  /* ---- APP 增强：访问链接直接打开浏览器（小程序因 web-view 限制只能复制）---- */
  function linkUrlOf(node) {
    var raw = node.getAttribute('data-url') || '';
    if (raw.charAt(0) !== '/') return raw;
    try {
      var c = LD.require('utils/connection.js').getActive();
      return (c ? c.url : '') + raw;
    } catch (err) { return raw; }
  }
  function openExternal(url) {
    /* 短按打开外链：先取消手指按下时挂起的长按计时，不留尾巴 */
    clearLinkPress();
    /* 1.0.2：设置页可开启「每次询问浏览器」，多浏览器手机可自行选择 */
    var chooser = false;
    try { chooser = localStorage.getItem('ld_link_chooser') === '1'; } catch (err) {}
    var lite = liteHttp();
    if (lite && lite.openUrl) {
      lite.openUrl({ url: url, chooser: chooser }).catch(function () { browserFallback(url); });
      return true;
    }
    return browserFallback(url);
  }
  function browserFallback(url) {
    try {
      var b = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Browser;
      if (b && b.open) { b.open({ url: url }); return true; }
      global.open(url, '_system');
      return true;
    } catch (err) { return false; }
  }

  /* ============ 4. App / Page / setData / 路由 ============ */
  var appDef = null, appInstance = null;
  var pageDefs = {};        // name -> def
  var pageInstances = {};   // name -> instance
  var stack = [];           // 页面栈，元素 = {name, options}
  var currentTab = 'index';
  var TABS = ['index', 'settings', 'about'];

  global.App = function (def) { appDef = def || {}; };
  global.getApp = function () {
    if (!appInstance) {
      appInstance = {
        globalData: Object.assign({}, appDef.globalData || {})
      };
      Object.keys(appDef).forEach(function (k) {
        if (k !== 'globalData' && typeof appDef[k] === 'function') {
          appInstance[k] = appDef[k].bind(appInstance);
        }
      });
      if (appInstance.onLaunch) appInstance.onLaunch();
    }
    return appInstance;
  };

  global.Page = function (def) {
    var name = LD._pendingPage;
    if (!name) return;
    pageDefs[name] = def || {};
  };

  function setByPath(obj, path, value) {
    var segs = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    var cur = obj;
    for (var i = 0; i < segs.length - 1; i++) {
      var k = segs[i];
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[segs[segs.length - 1]] = value;
  }

  /* imageloader.localize 每落地一张图就 setData 一次。29 容器 ≈ 29 次全量重渲染，
     且图片分散到达会持续掉帧。图片类 patch 合并到短窗口里统一渲染；交互 setData
     取消挂起窗口并立即渲染（此时 data 已是全量最新，不会丢任何图片结果）。 */
  LD._batching = 0;
  var imgTimer = null;
  var IMG_KEY = /(?:bgUrl|iconUrl|wallpaperUrl|heroBgUrl)$/;
  function isImagePatch(patch) {
    var keys = Object.keys(patch || {});
    return keys.length > 0 && keys.every(function (k) { return IMG_KEY.test(k); });
  }
  function flushImageRender() {
    if (imgTimer) { clearTimeout(imgTimer); imgTimer = null; }
  }

  function instanceOf(name) {
    if (pageInstances[name]) return pageInstances[name];
    var def = pageDefs[name] || {};
    var inst = { data: JSON.parse(JSON.stringify(def.data || {})), __name: name };
    Object.keys(def).forEach(function (k) {
      if (k !== 'data' && typeof def[k] === 'function') inst[k] = def[k].bind(inst);
    });
    inst.setData = function (patch) {
      Object.keys(patch || {}).forEach(function (k) { setByPath(inst.data, k, patch[k]); });
      if (isImagePatch(patch)) {
        LD._perf.imgPatches++;
        if (!imgTimer) {
          imgTimer = setTimeout(function () {
            imgTimer = null;
            LD._perf.imgFlushes++;
            renderCurrent();
          }, 40);
        }
        return;
      }
      if (LD._batching > 0) { LD._perf.batched++; return; }
      flushImageRender();
      renderCurrent();
    };
    pageInstances[name] = inst;
    return inst;
  }

  /* 当前显示的页面（栈顶，或 tab 页） */
  function currentPage() {
    if (stack.length) return stack[stack.length - 1];
    return { name: currentTab, options: {} };
  }

  /* ---- 轻量 DOM diff（同页 setData 只更新变化的节点）----
     小程序是虚拟 DOM 局部更新；1.0.0 这里每次 setData 都整页 innerHTML 重建，带来两个实测问题：
       ① 输入 IP/反代地址时输入框被整体替换，光标跳位；
       ② 展开雷池 7 个容器时全树重建 + 图片重新加载，肉眼可见卡顿。
     用 data-k 标记节点身份，复用未变化的 DOM；切页仍走整页重建（差异大，重建更快）。 */
  var lastHtmlKey = '';
  /* 三个 tab 页已渲染的 DOM 子树缓存：切页只挂载节点，不再整页 innerHTML 重建 */
  var pageDomCache = {};      // name -> { node, htmlKey, scrollTop }

  function keyOf(n) {
    return (n && n.nodeType === 1) ? n.getAttribute('data-k') : null;
  }
  function sameType(a, b) {
    if (!a || !b || a.nodeType !== b.nodeType) return false;
    if (a.nodeType === 3) return true;
    if (a.tagName !== b.tagName) return false;
    var ka = keyOf(a), kb = keyOf(b);
    return (ka || kb) ? ka === kb : true;
  }
  function syncAttrs(oldN, newN) {
    var i, a;
    for (i = oldN.attributes.length - 1; i >= 0; i--) {
      a = oldN.attributes[i].name;
      if (!newN.hasAttribute(a)) oldN.removeAttribute(a);
    }
    for (i = 0; i < newN.attributes.length; i++) {
      a = newN.attributes[i];
      if (oldN.getAttribute(a.name) === a.value) continue;
      /* 正在输入的框不同步 value：光标与输入法组合态完全不受打扰 */
      if (a.name === 'value' && oldN === document.activeElement) continue;
      oldN.setAttribute(a.name, a.value);
    }
    if ((oldN.tagName === 'INPUT' || oldN.tagName === 'TEXTAREA') &&
        oldN !== document.activeElement) {
      var v = newN.getAttribute('value') || '';
      if (oldN.value !== v) oldN.value = v;
    }
  }
  function patchNode(oldN, newN) {
    if (oldN.nodeType === 3 && newN.nodeType === 3) {
      if (oldN.nodeValue !== newN.nodeValue) oldN.nodeValue = newN.nodeValue;
      return oldN;
    }
    syncAttrs(oldN, newN);
    patchChildren(oldN, newN);
    return oldN;
  }
  function patchChildren(oldP, newP) {
    var pool = Array.prototype.slice.call(oldP.childNodes);
    var fresh = Array.prototype.slice.call(newP.childNodes);
    var used = new Array(pool.length), keyMap = {}, i, j, k;
    for (j = 0; j < pool.length; j++) {
      k = keyOf(pool[j]);
      if (k && !(k in keyMap)) keyMap[k] = j;
    }
    var resolved = new Array(fresh.length);
    for (i = 0; i < fresh.length; i++) {
      var nk = fresh[i], idx = -1, nkKey = keyOf(nk);
      if (nkKey && (nkKey in keyMap)) { idx = keyMap[nkKey]; delete keyMap[nkKey]; }
      else {
        for (j = 0; j < pool.length; j++) {
          if (!used[j] && sameType(pool[j], nk)) { idx = j; break; }
        }
      }
      if (idx < 0) { resolved[i] = nk.cloneNode(true); continue; }
      used[idx] = true;
      var cur = pool[idx];
      if (!sameType(cur, nk)) {
        var rep = nk.cloneNode(true);
        if (cur.parentNode === oldP) oldP.replaceChild(rep, cur);
        pool[idx] = rep;
        resolved[i] = rep;
      } else {
        resolved[i] = patchNode(cur, nk);
      }
    }
    for (j = 0; j < pool.length; j++) {
      if (!used[j] && pool[j].parentNode === oldP) oldP.removeChild(pool[j]);
    }
    /* 倒序对齐顺序：绝大多数交互里节点顺序不变，不做任何移动 */
    var next = null;
    for (i = fresh.length - 1; i >= 0; i--) {
      var node = resolved[i];
      if (next) {
        if (node.parentNode !== oldP || node.nextSibling !== next) oldP.insertBefore(node, next);
      } else if (node.parentNode !== oldP || node.nextSibling) {
        oldP.appendChild(node);
      }
      next = node;
    }
  }
  function morph(host, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    patchChildren(host, tmp);
  }

  function renderCurrent() {
    var __t0 = (global.performance && performance.now) ? performance.now() : 0;
    var cp = currentPage();
    var inst = instanceOf(cp.name);
    var host = el('ld-page');
    if (!host) return;

    /* 保留滚动位置 / 输入焦点，避免 setData 重渲染打断输入 */
    var scroller = el('ld-scroll');
    var keepScroll = scroller ? scroller.scrollTop : 0;
    var active = document.activeElement;
    var focusKey = active && active.getAttribute ? active.getAttribute('data-input') : null;
    var focusField = active && active.getAttribute ? active.getAttribute('data-field') : null;
    var caret = active && active.selectionStart != null ? active.selectionStart : null;

    var tpl = LD.templates && LD.templates[cp.name];
    var html = '<div class="scope-' + cp.name + '">' + (tpl ? tpl(inst.data) : '') + '</div>';
    var prevPage = host.getAttribute('data-page');
    var pageChanged = prevPage !== cp.name;
    var htmlKey = cp.name + '\u0000' + html;
    var rebuilt = false;
    var restoreScroll = keepScroll;

    if (pageChanged) {
      /* 切 tab 时整页 innerHTML 重建 39KB / 796 节点，还会让所有图片重新解码，
         这就是点「面板」比点「设置 / 关于」慢一拍的根因。
         这里把旧 tab 的整棵 DOM 收进缓存，切回来直接挂载（毫秒级）；
         数据若真的变了，再由 onShow 的 setData 走同页 morph 增量更新，
         数据没变则连 morph 都跳过，缓存各页自己的滚动位置。 */
      var oldNode = host.firstChild;
      if (oldNode && prevPage && TABS.indexOf(prevPage) >= 0) {
        host.removeChild(oldNode);
        pageDomCache[prevPage] = { node: oldNode, htmlKey: lastHtmlKey, scrollTop: keepScroll };
      } else {
        host.innerHTML = '';
      }
      var cached = TABS.indexOf(cp.name) >= 0 ? pageDomCache[cp.name] : null;
      if (cached && cached.node) {
        host.appendChild(cached.node);
        lastHtmlKey = cached.htmlKey;
        restoreScroll = cached.scrollTop || 0;
        LD._perf.tabReuse++;
      } else {
        host.innerHTML = html;
        lastHtmlKey = htmlKey;
        restoreScroll = 0;
        rebuilt = true;
      }
    } else if (htmlKey !== lastHtmlKey) {
      morph(host, html);         /* 同页更新：只动变化的节点 */
      lastHtmlKey = htmlKey;
    } else {
      LD._perf.skipped++;
    }
    host.setAttribute('data-page', cp.name);
    if (scroller) scroller.scrollTop = restoreScroll;

    var nav = el('ld-navbar');
    var tabbar = el('ld-tabbar');
    var isTab = TABS.indexOf(cp.name) >= 0;
    if (nav) {
      nav.classList.toggle('show', !isTab);
      var t = el('ld-nav-title');
      if (t) t.textContent = (LD.navTitles && LD.navTitles[cp.name]) || 'LiteDock';
    }
    if (tabbar) tabbar.classList.toggle('hide', !isTab);
    Array.prototype.forEach.call(tabbar ? tabbar.querySelectorAll('[data-tab]') : [], function (b) {
      var on = b.getAttribute('data-tab') === (isTab ? cp.name : currentTab);
      b.classList.toggle('on', on);
      var img = b.querySelector('img');
      if (img) {
        var n = b.getAttribute('data-tab');
        img.src = 'assets/tab/' + (n === 'settings' ? 'settings' : n === 'about' ? 'about' : 'panel') +
                  '-' + (on ? 'active' : 'normal') + '.png';
      }
    });
    /* 只有整页重建才需要恢复焦点/光标；morph 复用了 input 节点，天然不会跳位 */
    if (focusKey && rebuilt) {
      var inputs = host.querySelectorAll('[data-input="' + focusKey + '"]');
      var target = inputs[0];
      if (focusField) {
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].getAttribute('data-field') === focusField) { target = inputs[i]; break; }
        }
      }
      if (target) {
        target.focus();
        if (caret != null && target.setSelectionRange) {
          try { target.setSelectionRange(caret, caret); } catch (e) {}
        }
      }
    }
    LD.bindEvents && LD.bindEvents(host, inst);
    if (__t0) {
      var ms = performance.now() - __t0;
      LD._perf.renders++;
      LD._perf.lastMs = +ms.toFixed(2);
      LD._perf.totalMs = +(LD._perf.totalMs + ms).toFixed(2);
      if (ms > LD._perf.maxMs) LD._perf.maxMs = +ms.toFixed(2);
    }
  }
  LD.renderCurrent = renderCurrent;
  LD.pageInstance = function (name) { return instanceOf(name); };

  function fireLifecycle(name, hook, options) {
    var inst = instanceOf(name);
    if (hook === 'onLoad' && !inst.__loaded) {
      inst.__loaded = true;
      if (inst.onLoad) inst.onLoad(options || {});
    } else if (hook === 'onShow' && inst.onShow) {
      inst.onShow();
    }
  }

  function show(name, options, isPush) {
    if (isPush) {
      /* 小程序的 navigateTo 每次都创建新的页面实例并重新执行 onLoad(options)。
         这里 pageInstances 按页名缓存，若不重置，第二次进详情页时 __loaded
         已为 true，onLoad 不再跑，data.id 仍是第一次点开的那个容器。 */
      delete pageInstances[name];
      stack.push({ name: name, options: options || {} });
    } else { stack = []; currentTab = name; }
    if (LD.navTitles) delete LD.navTitles[name];
    fireLifecycle(name, 'onLoad', options);
    renderCurrent();
    fireLifecycle(name, 'onShow');
  }

  function parseUrl(url) {
    var q = String(url || '').split('?')[1] || '';
    var out = {};
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? '' : kv.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
    return out;
  }
  function nameFromUrl(url) {
    var m = /\/pages\/([^/]+)\//.exec(String(url || ''));
    return m ? m[1] : 'index';
  }

  function switchTab(url) { show(nameFromUrl(url), {}, false); }
  function navigateTo(url) { show(nameFromUrl(url), parseUrl(url), true); }
  function navigateBack(opt) {
    if (!stack.length) { if (opt && opt.fail) opt.fail(); return; }
    stack.pop();
    var cp = currentPage();
    renderCurrent();
    fireLifecycle(cp.name, 'onShow');
  }
  LD.switchTab = switchTab;
  LD.navigateTo = navigateTo;
  LD.navigateBack = navigateBack;

  /* ============ 5. wx.* 兼容实现 ============ */
  var wx = {
    getStorageSync: function (k) {
      try { var v = localStorage.getItem(k); return v === null ? '' : JSON.parse(v); }
      catch (e) { return ''; }
    },
    setStorageSync: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    request: function (o) {
      httpRequest(o).then(function (r) {
        if (o.success) o.success({ statusCode: r.statusCode, data: r.data, header: r.header });
      }).catch(function (err) {
        if (o.fail) o.fail({ errMsg: 'request:fail ' + (err && err.message ? err.message : 'network error') });
      });
    },
    downloadFile: function (o) {
      httpBinary(o.url, o.header || {}).then(function (dataUrl) {
        if (o.success) o.success({ statusCode: 200, tempFilePath: dataUrl });
      }).catch(function (err) {
        if (o.fail) o.fail({ errMsg: 'downloadFile:fail ' + (err && err.message || '') });
      });
    },
    showToast: toast,
    showLoading: loading,
    hideLoading: hideLoading,
    /* 小程序「复制链接 → 弹窗让用户粘到浏览器」在 APP 里是多余的：
       点击已直接打开浏览器、长按由系统给出复制提示。静默拦截，避免提示叠加。 */
    showModal: function (o) {
      var c = String((o && o.content) || '');
      if (/已复制，粘贴到浏览器即可打开/.test(c)) return;
      modal(o);
    },
    /* 1.0.9：业务 copyLink 万一漏过 APP 拦截，也统一走去重出口——
       1 秒内只写一次系统剪贴板，杜绝补发 click 造成系统提示重复弹出。 */
    setClipboardData: function (o) { copyText(String((o && o.data) || '')); },
    setNavigationBarTitle: function (o) {
      LD.navTitles = LD.navTitles || {};
      LD.navTitles[currentPage().name] = o.title || 'LiteDock';
      var t = el('ld-nav-title');
      if (t) t.textContent = o.title || 'LiteDock';
    },
    stopPullDownRefresh: function () {
      var bar = el('ld-pull');
      if (bar) { bar.classList.remove('show'); bar.textContent = '下拉刷新'; }
      LD._pulling = false;
    },
    navigateTo: function (o) { navigateTo(o.url); },
    navigateBack: navigateBack,
    switchTab: function (o) { switchTab(o.url); },
    showNavigationBarLoading: function () {},
    hideNavigationBarLoading: function () {},
    vibrateShort: function () {}
    /* 故意不提供 getFileSystemManager：imageloader.js 会自动走「缓存直用」分支 */
  };
  global.wx = wx;

  /* ============ 6. 启动 ============ */
  LD.start = function () {
    getApp();                       // 触发 onLaunch / ensureDefaults
    show('index', {}, false);
    LD.applyCompact();             /* 1.0.11：按已存偏好挂 .ld-compact（默认关） */

    /* tabBar */
    var tabbar = el('ld-tabbar');
    if (tabbar) {
      tabbar.addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]');
        if (!b) return;
        switchTab('/pages/' + b.getAttribute('data-tab') + '/' + b.getAttribute('data-tab'));
      });
    }
    /* 返回按钮 + 安卓物理返回键 */
    var back = el('ld-nav-back');
    if (back) back.addEventListener('click', function () { navigateBack({ fail: function () { switchTab('/pages/index/index'); } }); });

    /* 下拉刷新手势（对齐小程序 onPullDownRefresh）
       1.0.3：只有声明了 onPullDownRefresh 的页面（目前仅面板 index）才启用。
       设置 / 关于 / 连接 / 详情不需要下拉刷新，不再出现「下拉刷新 / 松开刷新」提示条。 */
    var scroller = el('ld-scroll');
    if (scroller) {
      var startY = 0, pulling = false;
      function pullEnabled() {
        try {
          return typeof instanceOf(currentPage().name).onPullDownRefresh === 'function';
        } catch (err) { return false; }
      }
      scroller.addEventListener('touchstart', function (e) {
        LD._pulling = false;
        pulling = false;
        var bar0 = el('ld-pull');
        if (bar0) { bar0.classList.remove('show'); bar0.textContent = '下拉刷新'; }
        if (!pullEnabled()) return;
        if (scroller.scrollTop <= 0) { startY = e.touches[0].clientY; pulling = true; }
      }, { passive: true });
      scroller.addEventListener('touchmove', function (e) {
        if (!pulling) return;
        var d = e.touches[0].clientY - startY;
        var bar = el('ld-pull');
        if (d > 8 && scroller.scrollTop <= 0) {
          if (bar) { bar.classList.add('show'); bar.textContent = d > 70 ? '松开刷新' : '下拉刷新'; }
          LD._pulling = d > 70;
        }
      }, { passive: true });
      scroller.addEventListener('touchend', function () {
        if (!pulling) return;
        pulling = false;
        var inst = instanceOf(currentPage().name);
        if (LD._pulling && inst.onPullDownRefresh) {
          var bar = el('ld-pull');
          if (bar) bar.textContent = '正在刷新…';
          inst.onPullDownRefresh();
        } else {
          wx.stopPullDownRefresh();
        }
      });
    }
  };

  /* 事件委托：data-ev="方法名" + data-* -> e.currentTarget.dataset */
  LD.bindEvents = function (host, inst) {
    if (host.__ldBound) {
      host.__ldInst = inst;
      return;
    }
    host.__ldBound = true;
    host.__ldInst = inst;

    host.addEventListener('click', function (e) {
      var node = e.target.closest('[data-ev]');
      if (!node || !host.contains(node)) return;
      /* 1.0.6：访问链接永远由 APP 自己处理，小程序业务 copyLink 零参与。
         否则长按后 WebView 补派发的 tap 会再走一次「复制 + 已复制模态框」。 */
      if (node.getAttribute('data-ev') === 'copyLink') {
        /* 长按成功后 WebView 补发的那次 click：用时间戳吞掉，blur/可见性事件清不掉 */
        if (isLongPressFollower()) return;
        clearLinkPress();
        /* 容器已停止：端口链接点开也连不上，给用户明确提示，绝不跳浏览器。
           只有「端口映射 / host 暴露端口」这类 chip 才带 data-state；
           用户手配的快捷访问（data-state 不存在）不受此限制，始终可点。 */
        var ctState = node.getAttribute('data-state');
        if (ctState && ctState !== 'running' && ctState !== '') {
          toast({ title: '容器已停止，请先启动容器', icon: 'none', duration: 2200 });
          return;
        }
        var link = linkUrlOf(node);
        if (/^https?:\/\//i.test(link) && openExternal(link)) {
          /* 1.0.10：静默打开浏览器。原先这里弹「正在打开浏览器 / 已打开浏览器」toast，
             但 APP 随即切到后台，用户只看到它一闪而过，反而像 bug —— 直接去掉。
             长按复制的反馈由 chip 绿框承担（1.0.9），点击不再给任何文字提示。 */
          return;               /* 不执行小程序原来的「复制 + 弹窗」 */
        }
        /* 1.0.4：APP 里不再回落到小程序业务 copyLink。它会 wx.setClipboardData
           + wx.showModal 弹「访问链接 / 已复制，粘贴到浏览器即可打开。」，
           模态框不会自动消失，用户从浏览器回来就会撞见这个莫名弹窗。
           复制能力完全由长按承担，点击只负责打开，二者不再混在一起。 */
        toast({ title: '该链接无法直接打开，长按可复制地址', duration: 2200 });
        return;
      }
      /* 其它事件：长按复制后紧跟的 click 同样不触发 */
      if (isLongPressFollower()) return;
      if (node.getAttribute('data-catch') === '1') e.stopPropagation();
      var inst = host.__ldInst;
      var evName = node.getAttribute('data-ev');

      /* APP 自有事件：settings.js 里没有同名方法，必须在「方法存在」检查之前处理 */
      if (evName === 'ldToggleChooser') {
        var on = false;
        try {
          on = localStorage.getItem('ld_link_chooser') !== '1';
          localStorage.setItem('ld_link_chooser', on ? '1' : '0');
        } catch (err) {}
        toast({ title: on ? '每次都会询问浏览器' : '使用系统默认浏览器', icon: 'none' });
        renderCurrent();
        return;
      }
      if (evName === 'ldRefresh') {
        toast({ title: '正在刷新…', icon: 'none' });
        try {
          var appObj = global.getApp && global.getApp();
          if (appObj && appObj.invalidate) appObj.invalidate();
          if (appObj && appObj.loadState) appObj.loadState(true);
        } catch (err) {}
        return;
      }
      /* 1.0.11：紧凑模式开关。切 #ld-root 的 class 即时生效（已渲染的三个 tab
         缓存树原样保留，切回面板立即是新密度）；renderCurrent 只为把设置页
         开关自己的 .on 状态翻转过来（对齐 ldToggleChooser / ldToggleWanLinks）。 */
      if (evName === 'ldToggleCompact') {
        var compactOn = false;
        try {
          compactOn = localStorage.getItem('ld_compact') !== '1';
          localStorage.setItem('ld_compact', compactOn ? '1' : '0');
        } catch (err) {}
        LD.applyCompact();
        toast({
          title: compactOn ? '已开启紧凑模式 · 隐藏状态 / 资源 / 快捷访问' : '已恢复完整显示',
          icon: 'none'
        });
        renderCurrent();
        return;
      }
      /* 1.0.8：两个独立开关，各自只写一个偏好键，互不影响。
         任一开关变化都要立刻用新偏好重建首页/详情页的卡片，不用等用户切页。 */
      if (evName === 'ldToggleWanLinks' || evName === 'ldTogglePorts') {
        var isWan = evName === 'ldToggleWanLinks';
        var key = isWan ? 'ld_wan_links' : 'ld_ports_always';
        var nowOn = false;
        try {
          nowOn = isWan
            ? localStorage.getItem(key) === '0'          // 当前关 → 打开
            : localStorage.getItem(key) !== '1';          // 当前关 → 打开
          localStorage.setItem(key, nowOn ? '1' : '0');
        } catch (err) {}
        toast({
          title: isWan
            ? (nowOn ? '已显示已配反代的服务' : '已隐藏外网访问链接')
            : (nowOn ? '已显示容器端口 · 需能连到 NAS 内网' : '已隐藏容器端口'),
          icon: 'none'
        });
        try {
          var appObj2 = global.getApp && global.getApp();
          if (appObj2 && appObj2.invalidate) appObj2.invalidate();
          var idx = LD.pageInstance && LD.pageInstance('index');
          if (idx && idx.load) idx.load(true);
          var det = LD.pageInstance && LD.pageInstance('detail');
          if (det && det.reload) det.reload();
        } catch (err) {}
        renderCurrent();
        return;
      }

      var fn = inst[evName];
      if (typeof fn !== 'function') return;
      var ds = {};
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (a.name.indexOf('data-') === 0 && a.name !== 'data-ev' && a.name !== 'data-catch' && a.name !== 'data-input') {
          var key = a.name.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
          ds[key] = a.value;
        }
      });
      var ev = { currentTarget: { dataset: ds }, detail: {}, type: 'tap', target: e.target };

      /* 同一次点击里的多次 setData 合并成一次渲染。
         toggleProject 原会连续 setData(expandedKeys) + rebuild→applyState(vm) +
         refreshConn，共 3 次全量重渲染；29 容器时肉眼可见卡顿。 */
      var before = LD._perf.batched;
      LD._batching++;
      try { fn.call(inst, ev); }
      finally {
        LD._batching--;
        if (LD._batching === 0 && LD._perf.batched > before) {
          flushImageRender();
          renderCurrent();
        }
      }
    });

    host.addEventListener('input', function (e) {
      var node = e.target.closest('[data-input]');
      if (!node) return;
      var fn = host.__ldInst[node.getAttribute('data-input')];
      if (typeof fn !== 'function') return;
      var ds = {};
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (a.name.indexOf('data-') === 0 && a.name !== 'data-input' && a.name !== 'data-ev') {
          var key = a.name.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
          ds[key] = a.value;
        }
      });
      fn.call(host.__ldInst, { currentTarget: { dataset: ds }, detail: { value: e.target.value }, type: 'input' });
    });

    /* 1.0.7：长按访问链接 = 复制地址，彻底改成「时间戳判定」，全程无 setTimeout。
       touchstart 只记录起始时间和坐标，touchend 时再按按住时长判定是不是长按。
       任何时刻都不存在悬挂定时器 ⇒ 从根上杜绝「切后台冻结、回前台几十秒后补复制」。
       去重一律用 Date.now() 时间戳（lastCopyAt / lastLongPressAt），
       blur / visibilitychange 清不掉，补发 click 也无法造成双复制。 */
    var pressX = 0, pressY = 0;
    host.addEventListener('touchstart', function (e) {
      var n = e.target.closest && e.target.closest('[data-ev="copyLink"]');
      if (!n) return;
      clearLinkPress();
      pressStartAt = Date.now();
      pressNode = n;
      /* 真机 CDP 触摸带 touches；verify_ui 的合成 Event 没有 touches，
         给默认坐标 0，让它也能走通「记录按压→touchend 按时长判定」的路径。 */
      pressX = (e.touches && e.touches.length) ? e.touches[0].clientX : 0;
      pressY = (e.touches && e.touches.length) ? e.touches[0].clientY : 0;
    }, { passive: true });
    host.addEventListener('touchmove', function (e) {
      if (!pressNode || !e.touches || !e.touches.length) return;
      var t = e.touches[0];
      /* 手指明显滑动（>12px）视为滚动，取消这次长按判定 */
      if (Math.abs(t.clientX - pressX) > 12 || Math.abs(t.clientY - pressY) > 12) clearLinkPress();
    }, { passive: true });
    /* touchend / touchcancel 放 document 捕获阶段：系统长按菜单抢焦点时结束事件
       可能不派发到 host，但一定到得了 document；捕获阶段先于 click，正好先落定长按。 */
    function finishLinkPress() {
      if (!pressNode) return;
      var node = pressNode;
      var held = Date.now() - pressStartAt;
      clearLinkPress();
      if (held >= LONG_PRESS_MS && node.isConnected && !document.hidden) commitLongPress(node);
    }
    document.addEventListener('touchend', finishLinkPress, true);
    document.addEventListener('touchcancel', clearLinkPress, true);
    host.addEventListener('contextmenu', function (e) {
      if (e.target.closest && e.target.closest('[data-ev="copyLink"]')) e.preventDefault();
    });

    /* 说明：不使用额外的捕获阶段拦截。事件委托按「离 target 最近的 [data-ev]」匹配，
       卡片内的按钮天然比卡片本身更近，点按钮时只会命中按钮，等价于小程序的 catchtap。 */
  };

})(window);
