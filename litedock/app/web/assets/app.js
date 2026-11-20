/* LiteDock — 纯前端逻辑，零依赖 */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* 1.0.25：分组强调色渐变背景（与 APP 1.0.17 同一套机制，此前 Web 端「忘记了」——
     accent 只喂给 4px 的 .group-bar，分组卡片本身一直是浅色玻璃，改强调色看不出变化）。
     有自定义背景图的分组保留原图；无图分组按强调色生成暮色渐变 + 白字，各组配色互不冲突。 */
  var GROUP_PALETTE = ['#e0674c', '#7c6cff', '#2fa08a', '#c2568f', '#3a86c8', '#d0903a', '#6a5acd', '#4a9e5c'];
  var DEFAULT_ACCENTS = ['#6c7cff', '#7c8cff'];
  function shade(hex, factor) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-f]{6}$/i.test(h)) return '#1a2340';
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    function c(x) { return ('0' + Math.round(Math.max(0, Math.min(255, x * factor))).toString(16)).slice(-2); }
    return '#' + c(r) + c(g) + c(b);
  }
  /* 全局统一分配：先锁定各分组显式配的强调色，没配（或仍是默认色）的再从调色板
     挑一个未被占用、彼此不同的色。只按 key 哈希会撞色（APP 曾实测两个组都分到 #e0674c）。 */
  function assignGroupThemes(keys, groupsCfg, globalAccent) {
    var used = {}, i, k, g, a;
    for (i = 0; i < keys.length; i++) {
      g = groupsCfg[keys[i]] || {}; a = String(g.accent || '').toLowerCase();
      if (a && DEFAULT_ACCENTS.indexOf(a) < 0 && !g.image) used[a] = 1;
    }
    var themes = {};
    for (i = 0; i < keys.length; i++) {
      k = keys[i]; g = groupsCfg[k] || {}; themes[k] = '';
      if (g.image) continue;                       /* 有自定义背景图：保留原图与原色 */
      a = String(g.accent || globalAccent || '').toLowerCase();
      if (a && DEFAULT_ACCENTS.indexOf(a) < 0) { themes[k] = g.accent; continue; }
      var s = String(k), h = 0;
      for (var j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) >>> 0;
      var chosen = '';
      for (var n = 0; n < GROUP_PALETTE.length; n++) {
        var cand = GROUP_PALETTE[(h + n) % GROUP_PALETTE.length];
        if (!used[cand]) { chosen = cand; break; }
      }
      if (!chosen) chosen = GROUP_PALETTE[h % GROUP_PALETTE.length];
      used[chosen] = 1; themes[k] = chosen;
    }
    return themes;
  }

  /* ---------------- 内置图标（自绘 SVG，零外部依赖） ---------------- */
  var ICONS = {
    cube:  { c: "#5b6bd6", p: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>' },
    docker:{ c: "#2496ed", p: '<rect x="3" y="9" width="4" height="4" rx=".6"/><rect x="8" y="9" width="4" height="4" rx=".6"/><rect x="13" y="9" width="4" height="4" rx=".6"/><rect x="8" y="4" width="4" height="4" rx=".6"/><rect x="13" y="4" width="4" height="4" rx=".6"/><path d="M2 15c2.5 2 5 3 9 3s7.5-1.2 10-3.5c-.8-1.2-2-1.5-3-1.5H5c-1.2 0-2.3.6-3 2Z"/>' },
    web:   { c: "#e0674c", p: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>' },
    db:    { c: "#3b82c4", p: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>' },
    media: { c: "#9b59d0", p: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/>' },
    download:{ c: "#2fa36b", p: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/>' },
    file:  { c: "#e0a13a", p: '<path d="M4 4h9l6 6v10H4z"/><path d="M13 4v6h6M8 14h8M8 17h5"/>' },
    shield:{ c: "#16a085", p: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>' },
    code:  { c: "#6c7a89", p: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4M14 5l-4 14"/>' },
    sync:  { c: "#3aa6d8", p: '<path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4"/>' },
    chart: { c: "#e2803c", p: '<path d="M4 20V10m5 10V4m5 16v-7m5 7V8"/><path d="M2 20h20"/>' },
    lock:  { c: "#c05a8e", p: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>' },
    ai:    { c: "#7d5ce0", p: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M9 13h.01M15 13h.01M9 17h6M2 12h2m16 0h2"/>' },
    net:   { c: "#4a90d9", p: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>' },
    cloud: { c: "#5b9bd5", p: '<path d="M6 18h11a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 6 18Z"/>' },
    music: { c: "#d8557f", p: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>' },
    book:  { c: "#8a6d3b", p: '<path d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4zM20 4h-3a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h3z"/>' },
    gear:  { c: "#6b7a90", p: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>' }
  };
  var MATCH = [
    [/portainer|docker|container/i, "docker"],
    [/nginx|apache|traefik|caddy|tengine|safeline|chaitin|httpd/i, "web"],
    [/postgres|mysql|mariadb|mongo|redis|mariadb|sqlite|database|pg\b/i, "db"],
    [/jellyfin|plex|emby|navidrome|subsonic|audiobook/i, "media"],
    [/qbittorrent|transmission|deluge|aria2|download/i, "download"],
    [/filebrowser|alist|cloudreve|nextcloud|seafile|syncthing/i, "file"],
    [/adguard|pihole|dns|waf|firewall|vaultwarden|bitwarden/i, "shield"],
    [/gitea|gitlab|github|git\b|svn/i, "code"],
    [/uptime|kuma|grafana|prometheus|monitor|netdata/i, "chart"],
    [/aitutor|ollama|llm|chatbot|openai|anythingllm/i, "ai"],
    [/proxy|clash|tunnel|vpn|wireguard|tailscale/i, "net"],
    [/heimdall|homepage|dashy|bookmark/i, "cloud"],
    [/spotify|music|lyric/i, "music"]
  ];
  function iconKind(ct) {
    var s = (ct.name || "") + " " + (ct.image || "") + " " + (ct.project || "");
    for (var i = 0; i < MATCH.length; i++) if (MATCH[i][0].test(s)) return MATCH[i][1];
    return "cube";
  }
  function iconHTML(ct) {
    var custom = (state.config.icons || {})[ct.name];
    /* 自定义上传的图标默认铺满图标位（cover），内置匹配图标保留 contain 以免被裁切 */
    if (custom) return '<img class="icon-custom" src="' + esc(custom) + '" alt="" onerror="this.style.display=\'none\'">';
    /* 1.0.9：内置图标库自动匹配（服务端按镜像名 / 容器名算好 iconAuto） */
    if (ct.iconAuto) return '<img src="' + esc(ct.iconAuto) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
    var k = iconKind(ct), o = ICONS[k] || ICONS.cube;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="' + o.c + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + o.p + "</svg>";
  }
  function iconBg(ct) {
    var o = ICONS[iconKind(ct)] || ICONS.cube;
    return o.c + "1c";
  }

  /* ---------------- 演示数据（本地打开 HTML 时展示） ---------------- */
  var DEMO = {
    ok: true,
    info: { ok: true, name: "示例 NAS", version: "27.0.0", os: "Demo Linux", apiVersion: "1.41", socket: "/var/run/docker.sock", containers: 10, running: 10, stopped: 0, paused: 0, images: 24 },
    config: null,
    assets: { wallpaper: [], icon: [], card: [] },
    containers: [
      { id: "a1", shortId: "a1b2c3d4e5f6", name: "safeline-mgt", image: "chaitin/safeline-mgt:9.4.3", imageShort: "safeline-mgt:9.4.3", state: "running", status: "Up 5 days (healthy)", project: "safeline", service: "mgt", ports: [{ host: 9443, container: 1443, proto: "tcp", ip: "0.0.0.0" }], stats: { cpu: 3.2, mem: 12.4, memUsed: 420000000, memLimit: 3400000000 } },
      { id: "a2", shortId: "b2c3d4e5f6a1", name: "safeline-tengine", image: "chaitin/safeline-tengine:9.4.3", imageShort: "safeline-tengine:9.4.3", state: "running", status: "Up 5 days", project: "safeline", service: "tengine", ports: [{ host: 80, container: 80, proto: "tcp", ip: "0.0.0.0" }, { host: 443, container: 443, proto: "tcp", ip: "0.0.0.0" }], stats: { cpu: 0.8, mem: 4.1, memUsed: 130000000, memLimit: 3400000000 } },
      { id: "a3", shortId: "c3d4e5f6a1b2", name: "safeline-pg", image: "postgres:15-alpine", imageShort: "postgres:15-alpine", state: "running", status: "Up 5 days (healthy)", project: "safeline", service: "pg", ports: [], stats: { cpu: 1.1, mem: 8.7, memUsed: 290000000, memLimit: 3400000000 } },
      { id: "a4", shortId: "d4e5f6a1b2c3", name: "safeline-detector", image: "chaitin/safeline-detector:9.4.3", imageShort: "safeline-detector:9.4.3", state: "running", status: "Up 5 days (healthy)", project: "safeline", service: "detector", ports: [], stats: { cpu: 6.4, mem: 18.2, memUsed: 610000000, memLimit: 3400000000 } },
      { id: "a5", shortId: "e5f6a1b2c3d4", name: "filebrowser", image: "ghcr.io/gtsteffaniak/filebrowser:stable", imageShort: "filebrowser:stable", state: "running", status: "Up 2 days (healthy)", project: "filebrowser", service: "filebrowser", ports: [{ host: 8395, container: 80, proto: "tcp", ip: "0.0.0.0" }], stats: { cpu: 0.4, mem: 3.3, memUsed: 110000000, memLimit: 3400000000 } },
      { id: "a6", shortId: "f6a1b2c3d4e5", name: "aitutor", image: "aitutor/aitutor:latest", imageShort: "aitutor:latest", state: "running", status: "Up 6 days (healthy)", project: "", service: "", ports: [{ host: 8000, container: 8000, proto: "tcp", ip: "0.0.0.0" }], stats: { cpu: 2.1, mem: 21.6, memUsed: 730000000, memLimit: 3400000000 } },
      { id: "a7", shortId: "112233445566", name: "proxy-switch", image: "proxy-switch:latest", imageShort: "proxy-switch:latest", state: "running", status: "Up 6 days", project: "", service: "", ports: [], networkMode: "host", exposedPorts: [8088], stats: { cpu: 0.2, mem: 1.2, memUsed: 40000000, memLimit: 3400000000 } },
      { id: "a8", shortId: "223344556677", name: "jellyfin", image: "jellyfin/jellyfin:latest", imageShort: "jellyfin:latest", state: "exited", status: "Exited (0) 3 hours ago", project: "", service: "", ports: [{ host: 8096, container: 8096, proto: "tcp", ip: "0.0.0.0" }], stats: null }
    ]
  };

  /* ---------------- 状态 ---------------- */
  var state = {
    data: null, config: {}, assets: { wallpaper: [], icon: [], card: [] },
    query: "", tab: "wall", demo: false, busy: {}, updates: {}, timer: null,
    dirty: false   // 有未保存的外观改动时，自动刷新不覆盖本地预览
  };
  var BUILTIN_WALLS = [
    { url: "/assets/wallpapers/aurora.jpg", name: "极光" },
    { url: "/assets/wallpapers/dusk.jpg", name: "暮色" },
    { url: "/assets/wallpapers/ocean.jpg", name: "深海" },
    { url: "/assets/wallpapers/grid.jpg", name: "网格" },
    { url: "/assets/wallpapers/peach.jpg", name: "暖霞" },
    { url: "/assets/wallpapers/night.jpg", name: "夜航" }
  ];

  function defaults() {
    return {
      title: "LiteDock", subtitle: "NAS容器管理",
      wallpaper: BUILTIN_WALLS[0].url, wallpaperBlur: 0, wallpaperMask: 0.18, wallpaperBrightness: 1,
      cardOpacity: 0.68, cardRadius: 20, accent: "#7c8cff", columns: 3, compact: false,
      groups: { tools: { label: "常用服务", accent: "#7c8cff", blur: 6, mask: .12, image: "", order: 0 } },
      containerGroups: {}, icons: {}, hidden: [],
      cardBackgrounds: {}, links: {}, linksWan: {}, httpsPorts: [443, 5001, 8443, 9443],
      topbar: { image: "", blur: 6, mask: .3 },
      groupMode: "single", collapseProjects: true, expandedProjects: [],
      collapsedGroups: [], configVersion: 3
    };
  }


  /* ---------------- 1.0.1 快捷访问工具 ---------------- */
  function httpsPorts() {
    var v = state.config.httpsPorts;
    if (typeof v === "string") v = v.split(/[,，\s]+/);
    return (v || []).map(function (x) { return parseInt(x, 10); })
      .filter(function (x) { return !isNaN(x) && x > 0 && x < 65536; });
  }
  function portUrl(port) {
    var scheme = httpsPorts().indexOf(parseInt(port, 10)) >= 0 ? "https" : "http";
    return scheme + "://" + (location.hostname || "localhost") + ":" + port;
  }
  /* 1.0.14：域名访问 = 外网视图，IP 访问 = 内网视图 */
  function isWanView() {
    var h = (location.hostname || "").toLowerCase();
    return !!h && h !== "localhost" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  }
  /* 外网视图优先取「外网地址」，没填则沿用内网地址；内网视图只用内网地址 */
  function linkFor(name) {
    var lan = state.config.links || {}, wan = state.config.linksWan || {};
    return isWanView() ? (wan[name] || lan[name] || "") : (lan[name] || "");
  }
  function normLink(u) {
    u = String(u == null ? "" : u).trim();
    if (!u) return "";
    if (u.charAt(0) === "/") return u;
    if (!/^https?:\/\//i.test(u)) u = "http://" + u;
    return u;
  }
  function linkLabel(u) {
    var s = String(u).replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return s.length > 22 ? s.slice(0, 21) + "…" : s;
  }

  /* ---------------- 工具 ---------------- */
  function toast(msg, type) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (type ? " " + type : "");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.className = "toast"; }, 3400);
  }
  function fmtBytes(n) {
    if (!n) return "0";
    var u = ["B", "K", "M", "G", "T"], i = 0;
    while (n >= 1024 && i < 4) { n /= 1024; i++; }
    return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + u[i];
  }
  /* 1.0.22：项目折叠卡要像单容器卡一样显示「启动时间」。Docker status 形如
     "Up 8 days"/"Up 7 hours (healthy)"/"Exited (0) 3 hours ago"/"Created"。
     解析成秒便于比较，取运行中容器里 Up 时间最长的作为「项目已运行时长」——
     Compose 容器通常一起启动，这行即代表项目整体启动时间。 */
  function uptimeSeconds(status) {
    var s = String(status || "");
    var m = /^Up\s+(?:(\d+)\s+year|(\d+)\s+month|(\d+)\s+week|(\d+)\s+day|(\d+)\s+hour|(\d+)\s+minute|(\d+)\s+second)s?/i.exec(s);
    if (!m) return 0;
    if (m[1]) return +m[1] * 31536000;
    if (m[2]) return +m[2] * 2592000;
    if (m[3]) return +m[3] * 604800;
    if (m[4]) return +m[4] * 86400;
    if (m[5]) return +m[5] * 3600;
    if (m[6]) return +m[6] * 60;
    return 0;
  }
  /* 返回项目卡状态行的完整信息：
     text   — 启动时间文字：运行中容器里 Up 最久的 status；若多个容器同为最久
              （Compose 一起启动很常见），优先取带 (healthy) 的那个，这样状态行
              能像单容器卡一样带上 (healthy) 健康标记。
     issues — 异常容器数：非 running 或 status 含 unhealthy。
     warn   — issues > 0，状态行据此加橙色警告标识。 */
  function projectStatusInfo(list) {
    var best = "", bestSec = -1, bestHealthy = false, issues = 0;
    list.forEach(function (c) {
      var st = String(c.status || "");
      if (c.state !== "running" || /unhealthy/i.test(st)) issues++;
      if (c.state !== "running") return;
      var sec = uptimeSeconds(st);
      var healthy = /\(healthy\)/i.test(st);
      /* 同样 Up 最久时优先带 healthy；否则保持先出现的，避免反复横跳 */
      if (sec > bestSec || (sec === bestSec && healthy && !bestHealthy)) {
        bestSec = sec; best = st; bestHealthy = healthy;
      }
    });
    if (!best) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].status) { best = list[i].status; break; }
      }
    }
    return { text: best || "", issues: issues, warn: issues > 0 };
  }
  /* 兼容旧调用点（验证脚本静态断言也用这个名字） */
  function projectStatusText(list) { return projectStatusInfo(list).text; }
  /* ---------------- 1.0.13 访问密码 ---------------- */
  var AUTH_TOKEN = "";
  try { AUTH_TOKEN = localStorage.getItem("litedock_token") || ""; } catch (e) {}
  function api(path, opts) {
    opts = opts || {};
    var h = opts.headers ? Object.assign({}, opts.headers) : {};
    if (AUTH_TOKEN) h["X-LiteDock-Token"] = AUTH_TOKEN;
    opts.headers = h;
    return fetch(path, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return { ok: false, error: "HTTP " + r.status }; });
      return r.json();
    });
  }
  function showLogin() {
    var m = $("#loginMask");
    if (!m) return;
    m.classList.add("show");
    var inp = $("#loginPw");
    if (inp) { inp.value = ""; inp.focus(); }
    var err = $("#loginErr"); if (err) err.textContent = "";
  }
  function hideLogin() {
    var m = $("#loginMask"); if (m) m.classList.remove("show");
  }
  function doLogin(pw) {
    pw = String(pw || "").trim();
    var err = $("#loginErr");
    if (!pw) { if (err) err.textContent = "请输入访问密码"; return; }
    api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) })
      .then(function (r) {
        if (r && r.ok) {
          AUTH_TOKEN = pw;
          try { localStorage.setItem("litedock_token", pw); } catch (e) {}
          hideLogin();
          load();
        } else {
          if (err) err.textContent = (r && r.error) || "密码错误";
        }
      })
      .catch(function () { if (err) err.textContent = "验证失败，请重试"; });
  }
  function onNeedAuth() {
    AUTH_TOKEN = "";
    try { localStorage.removeItem("litedock_token"); } catch (e) {}
    showLogin();
  }
  function postJSON(path, obj) {
    return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  }

  /* ---------------- 外观应用 ---------------- */
  function applyConfig() {
    var c = state.config, r = document.documentElement.style;
    r.setProperty("--wall", 'url("' + c.wallpaper + '")');
    r.setProperty("--wall-blur", (c.wallpaperBlur || 0) + "px");
    r.setProperty("--wall-mask", c.wallpaperMask == null ? .34 : c.wallpaperMask);
    r.setProperty("--wall-bright", c.wallpaperBrightness || 1);
    r.setProperty("--glass", "rgba(255,255,255," + (c.cardOpacity == null ? .68 : c.cardOpacity) + ")");
    r.setProperty("--glass-strong", "rgba(255,255,255," + Math.min(.96, (c.cardOpacity == null ? .68 : c.cardOpacity) + .18) + ")");
    r.setProperty("--glass-chip", "rgba(255,255,255," + Math.max(.3, (c.cardOpacity == null ? .68 : c.cardOpacity) - .12) + ")");
    r.setProperty("--accent", c.accent || "#7c8cff");
    r.setProperty("--radius", (c.cardRadius || 20) + "px");
    r.setProperty("--cols", c.columns || 3);
    document.body.setAttribute("data-cols", String(c.columns || 3));
    $("#brandTitle").textContent = c.title || "LiteDock";
    $("#brandSub").textContent = c.subtitle || "NAS容器管理";
    // 顶部状态栏背景（1.0.5）
    var tb = c.topbar || {};
    var tbOn = !!tb.image;
    r.setProperty("--tb-bg", tbOn ? 'url("' + tb.image + '")' : "none");
    r.setProperty("--tb-blur", (tb.blur == null ? 6 : tb.blur) + "px");
    r.setProperty("--tb-mask", tbOn ? (tb.mask == null ? .3 : tb.mask) : 0);
    r.setProperty("--tb-op", tbOn ? 1 : 0);
    var tbEl = $("#topbar");
    if (tbEl) tbEl.classList.toggle("has-bg", tbOn);
    document.title = (c.title || "LiteDock") + " · 容器管理";
    document.body.classList.toggle("compact", !!c.compact);
  }

  /* ---------------- 渲染 ---------------- */
  /* ---------------- 1.0.3 分组 / 折叠工具 ---------------- */
  var DEFAULT_GROUP = "tools";

  function groupKey(ct) {
    var assigned = (state.config.containerGroups || {})[ct.name];
    if (assigned) return assigned;
    if (state.config.groupMode === "project") return ct.project || "default";
    return DEFAULT_GROUP;   // 新部署：所有容器集中在「常用服务」
  }
  function groupLabel(key) {
    var g = (state.config.groups || {})[key];
    if (g && g.label) return g.label;
    if (key === DEFAULT_GROUP || key === "common") return "常用服务";
    return key === "default" ? "未分组 / 独立容器" : key;
  }
  function allGroupKeys() {
    var keys = {}, out = [];
    // project 模式下若没有显式定义「常用服务」，就不渲染这个空分组
    if (state.config.groupMode !== "project" || (state.config.groups || {})[DEFAULT_GROUP]) keys[DEFAULT_GROUP] = 1;
    Object.keys(state.config.groups || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(state.config.containerGroups || {}).forEach(function (n) {
      var k = state.config.containerGroups[n]; if (k) keys[k] = 1;
    });
    ((state.data && state.data.containers) || []).forEach(function (c) { keys[groupKey(c)] = 1; });
    Object.keys(keys).forEach(function (k) { out.push(k); });
    var gs = state.config.groups || {};
    out.sort(function (a, b) {
      if (a === DEFAULT_GROUP) return -1;
      if (b === DEFAULT_GROUP) return 1;
      return ((gs[a] || {}).order == null ? 999 : gs[a].order) -
             ((gs[b] || {}).order == null ? 999 : gs[b].order);
    });
    return out;
  }
  function groupKeyByName(n) {
    var arr = (state.data && state.data.containers) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].name === n) return groupKey(arr[i]);
    return DEFAULT_GROUP;
  }
  /* ---------------- 1.0.13 设置面板按项目合并 ----------------
     同一 Compose 项目（≥2 容器）在设置里合并成一项，
     读写作用于该项目的全部容器；单容器 / 无项目仍为各自一行。 */
  var SETTINGS_PROJECTS = {};   // project -> [container names]
  function buildSettingsProjects() {
    SETTINGS_PROJECTS = {};
    ((state.data && state.data.containers) || []).forEach(function (c) {
      if (c.project) (SETTINGS_PROJECTS[c.project] = SETTINGS_PROJECTS[c.project] || []).push(c.name);
    });
  }
  function projCount(p) { return (SETTINGS_PROJECTS[p] || []).length; }
  function rowNames(key) {
    if (SETTINGS_PROJECTS[key] && SETTINGS_PROJECTS[key].length >= 2) return SETTINGS_PROJECTS[key].slice();
    return [key];
  }
  function settingsRows() {
    var seen = {}, rows = [];
    ((state.data && state.data.containers) || []).forEach(function (c) {
      if (c.project && projCount(c.project) >= 2) {
        if (!seen[c.project]) { seen[c.project] = 1; rows.push({ key: c.project, label: c.project, isProject: true }); }
      } else {
        rows.push({ key: c.name, label: c.name, isProject: false });
      }
    });
    return rows;
  }
  function rowTag(r) {
    return r.isProject ? ' <small style="color:var(--ink-3)">· 项目(' + rowNames(r.key).length + ')</small>' : '';
  }
  function rowTitle(r) {
    return r.isProject ? ' title="整个项目：' + esc(r.label) + '（' + rowNames(r.key).length + ' 个容器）"' : '';
  }
  function newGroupBox() {
    return '<div class="new-group-box glass"><span>＋ 新建分组</span>' +
      '<input type="text" data-newgroup maxlength="24" placeholder="输入名称，如：影音服务">' +
      '<button class="btn" data-addgroup>添加分组</button></div>';
  }
  function addGroup(label) {
    label = String(label || "").trim();
    if (!label) { toast("请先填写分组名称", "err"); return; }
    var key = "g" + Date.now().toString(36);
    state.config.groups = state.config.groups || {};
    state.config.groups[key] = {
      label: label, accent: state.config.accent || "#7c8cff",
      blur: 6, mask: .12, image: "", order: Object.keys(state.config.groups).length + 1
    };
    toast("已添加「" + label + "」，把容器卡片拖进去即可", "ok");
    saveNow();
  }
  function delGroup(key) {
    if (key === DEFAULT_GROUP) { toast("「常用服务」是默认分组，不能删除", "err"); return; }
    if (!confirm("删除分组「" + groupLabel(key) + "」？\n该分组里的容器会回到默认分组，不会删除任何容器。")) return;
    delete (state.config.groups || {})[key];
    Object.keys(state.config.containerGroups || {}).forEach(function (n) {
      if (state.config.containerGroups[n] === key) delete state.config.containerGroups[n];
    });
    state.config.expandedProjects = (state.config.expandedProjects || []).filter(function (x) {
      return x.indexOf(key + "::") !== 0;
    });
    saveNow("分组已删除");
  }
  function saveNow(msg) {
    state.dirty = false;
    // 1.0.4：先本地即时渲染，不等 /api/config + /api/state 往返（原来要等数秒）。
    // 配置仍在后台异步持久化，手动刷新与 15 秒轮询照常同步容器状态。
    renderBoard();
    if (state.demo) { toast("演示模式：仅在本页生效"); return Promise.resolve(); }
    if (msg) toast(msg, "ok");
    return postJSON("/api/config", state.config).then(function (r) {
      if (!r.ok) toast("保存失败：" + (r.error || ""), "err");
    }).catch(function (e) { toast("保存失败：" + e, "err"); });
  }
  function projectKey(gk, p) { return gk + "::" + p; }
  function expList() {
    // 容错：配置文件被手工改坏成字符串 / null 时也不至于让交互整体失效
    var v = state.config.expandedProjects;
    if (!Array.isArray(v)) v = state.config.expandedProjects = [];
    return v;
  }
  function isExpanded(gk, p) {
    return expList().indexOf(projectKey(gk, p)) >= 0;
  }
  function toggleProject(gk, p) {
    var exp = expList();
    var pk = projectKey(gk, p), i = exp.indexOf(pk);
    if (i >= 0) exp.splice(i, 1); else exp.push(pk);
    saveNow();
  }
  /* ---------------- 分组级折叠（1.0.7） ----------------
     语义：收起 = 该分组只保留标题栏，组内所有容器卡片（含 Compose 项目卡）全部不显示。
     与项目卡自身的「展开 N 个容器」完全无关 —— 那个仍由卡片自己的按钮控制。 */
  var boardGroups = [];   // 本次渲染真正显示出来的分组 key，供「全部展开 / 全部收起」使用
  function colList() {
    // 容错：配置被改成字符串 / null 时不至于让整组交互失效
    var v = state.config.collapsedGroups;
    if (!Array.isArray(v)) v = state.config.collapsedGroups = [];
    return v;
  }
  function isCollapsed(k) { return colList().indexOf(k) >= 0; }
  function toggleGroupCollapse(k) {
    var a = colList(), i = a.indexOf(k), opening = i >= 0;
    if (opening) a.splice(i, 1); else a.push(k);
    saveNow(opening ? "已展开「" + groupLabel(k) + "」" : "已收起「" + groupLabel(k) + "」");
    // 展开后若分组头部已滑出视野，把它拉回视线内
    if (opening) {
      var sec = document.querySelector('.group[data-group="' + String(k).replace(/["\\]/g, "\\$&") + '"]');
      if (sec && sec.getBoundingClientRect && sec.getBoundingClientRect().top < 0) {
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }
  // on = true 全部收起；false 全部展开（清空列表，最彻底）
  function foldAllGroups(on) {
    if (!boardGroups.length) { toast("当前没有分组", "err"); return; }
    if (!on) {
      state.config.collapsedGroups = [];
      saveNow("已展开全部分组");
      return;
    }
    var a = colList();
    boardGroups.forEach(function (k) { if (a.indexOf(k) < 0) a.push(k); });
    saveNow("已收起全部分组（" + boardGroups.length + " 个，只留标题栏）");
  }
  // 把卡片拖进一个已收起的分组时，自动展开它，让落位结果看得见
  function unfoldOnDrop(k) {
    var a = colList(), i = a.indexOf(k);
    if (i >= 0) a.splice(i, 1);
  }
  function foldToolsHTML(order, q) {
    if (q || order.length < 1) return "";
    var n = order.filter(function (k) { return isCollapsed(k); }).length;
    var allFolded = n >= order.length;
    return '<div class="board-tools">' +
      '<span class="bt-hint">' + order.length + " 个分组" + (n ? " · 已收起 " + n + " 个" : "") + "</span>" +
      '<button data-foldall="0"' + (!n ? " disabled" : "") + ' title="展开所有分组的容器卡片">全部展开</button>' +
      '<button data-foldall="1"' + (allFolded ? " disabled" : "") + ' title="收起所有分组，只留标题栏">全部收起</button>' +
      "</div>";
  }

  function projectCardHTML(gk, p, list, expanded) {
    var running = list.filter(function (c) { return c.state === "running"; }).length;
    var color = running === list.length ? "#25c07a" : (running ? "#f0aa3c" : "#9aa3b6");
    var cpu = 0, mem = 0, memLimitMax = 0;
    list.forEach(function (c) {
      if (!c.stats) return;
      cpu += c.stats.cpu || 0;
      mem += c.stats.memUsed || 0;
      /* 1.0.21：memLimit 是「该容器可用内存上限」，本环境每个容器都等于宿主机
         总内存（15G）。旧版把 7 个容器的 memLimit 累加成 105G 当分母，进度条
         永远接近 0；且标签写「合计 7×15G」毫无意义。改为取单个最大值作为
         项目内存天花板：所有容器同配额时就是宿主机内存，占比与单容器卡同口径。 */
      if ((c.stats.memLimit || 0) > memLimitMax) memLimitMax = c.stats.memLimit;
    });
    var chips = [], seenChip = {};
    function pAdd(key, html) { if (!key || seenChip[key] !== undefined) return; seenChip[key] = 1; chips.push(html); }
    list.forEach(function (c) {
      var custom = linkFor(c.name);
      if (custom) {
        var cu = normLink(custom);
        pAdd(cu, '<a class="port port-custom" draggable="false" href="' + esc(cu) + '" target="_blank" rel="noopener" title="打开 ' + esc(cu) + '">' + esc(linkLabel(cu)) + "</a>");
      }
      /* 1.0.16：项目卡片端口和单容器卡片对齐——显示「宿主端口→容器端口」，
         title 里点明宿主端口含义。此前只显示裸数字（如 9443），用户看不懂
         它其实是某服务管理后台对外映射的 HTTPS 端口。 */
      (c.ports || []).forEach(function (pt) {
        var u = portUrl(pt.host);
        pAdd(u, '<a class="port" draggable="false" href="' + esc(u) + '" target="_blank" rel="noopener" title="宿主端口 ' + esc(pt.host) + ' → 容器端口 ' + esc(pt.container) + '（' + esc(u) + '）">' +
          esc(pt.host) + "→" + esc(pt.container) + "</a>");
      });
      if (!(c.ports || []).length && c.networkMode === "host") {
        (c.exposedPorts || []).forEach(function (pt) {
          var u = portUrl(pt);
          pAdd(u, '<a class="port port-host" draggable="false" href="' + esc(u) + '" target="_blank" rel="noopener" title="host 网络：容器直接占用宿主机端口 ' + esc(pt) + '">' +
            "host · " + esc(pt) + "</a>");
        });
      }
    });
    var totalChips = chips.length;
    chips = chips.slice(0, 4);
    var first = list[0];
    /* 1.0.20：项目折叠卡与单容器卡同样支持卡片背景——取项目里第一个容器在
       「编辑卡片背景」里配的图；项目是整体单位，背景对折叠卡与展开子卡一致。 */
    var cbg = (state.config.cardBackgrounds || {})[first.name] || {};
    var hasBg = !!cbg.image;
    var ctStyle = "--state-color:" + color + ";--icon-bg:" + iconBg(first) +
      ";--ct-blur:" + (cbg.blur == null ? 6 : Number(cbg.blur) || 0) + "px" +
      ";--ct-mask:" + (cbg.mask == null ? .42 : Number(cbg.mask) || 0);
    var ctBg = hasBg
      ? '<div class="ct-bg" style="background-image:url(\'' + esc(cbg.image) + '\')"></div><div class="ct-mask"></div>'
      : "";
    /* 1.0.21：项目折叠卡与单容器卡显示完全一致——标签就是「CPU」「内存」，
       值按同样的格式（cpu% / fmtBytes(memUsed)），条形图同口径。1.0.20 曾加
       「（N 容器合计）」「（合计 N×15G）」说明文字，用户反馈既啰嗦又算错
       （memLimit 累加成 105G），本版去掉标注、修正分母，回归一致外观。 */
    var memPct = memLimitMax ? Math.min(100, mem / memLimitMax * 100) : 0;
    /* 1.0.23：项目卡状态行（启动时间 + 可选异常警告），位置与单容器卡一致 */
    var pInfo = projectStatusInfo(list);
    var pStatusHTML = '<div class="ct-status' + (pInfo.warn ? " status-warn" : "") + '" title="' +
      esc(pInfo.text + (totalChips > 4 ? " · 展开可见全部 " + totalChips + " 个快捷访问" : "")) + '">' +
      esc(pInfo.text) +
      (pInfo.warn ? '<span class="status-warn-tag">⚠ ' + pInfo.issues + " 个容器异常</span>" : "") +
      "</div>";
    var meters = '<div class="meter">' +
      '<div class="meter-item"><div class="meter-label"><span>CPU</span><b>' + cpu.toFixed(1) + '%</b></div>' +
        '<div class="bar' + (cpu > 80 ? " warn" : "") + '"><i style="width:' + Math.min(100, cpu) + '%"></i></div></div>' +
      '<div class="meter-item"><div class="meter-label"><span>内存</span><b>' + fmtBytes(mem) + "</b></div>" +
        '<div class="bar' + (memPct > 80 ? " warn" : "") + '"><i style="width:' + memPct + '%"></i></div></div>' +
      "</div>";
    return '<article class="ct project-card' + (expanded ? " is-expanded" : "") + (hasBg ? " has-bg" : "") +
        '" draggable="true" data-projname="' +
        esc(p) + '" data-gkey="' + esc(gk) + '" title="按住卡片可整体拖到其它分组" style="' + ctStyle + '">' +
      ctBg +
      '<div class="ct-top"><div class="ct-icon">' + iconHTML(first) + "</div>" +
        '<div class="ct-meta"><div class="ct-name" title="' + esc(p) + '">' + esc(p) + "</div>" +
        '<div class="ct-image">Compose 项目 · ' + list.length + " 个容器</div></div>" +
        '<div class="ct-state' + (running === list.length ? "" : (running ? " paused" : " off")) + '"><i class="led"></i>' +
          running + "/" + list.length + " 运行中</div></div>" +
      /* 1.0.23：状态行位置对齐单容器卡——放在 CPU/内存资源条「上面」（单容器卡
         是 ct-top → ct-status → meters；旧项目卡误放成 meters 之后，用户一眼看出
         位置不同）。文字取 Up 最久容器（同长优先带 healthy），并显示异常容器数：
         项目里有没启动/unhealthy 的容器时用橙色 ⚠ 警告，避免只看最长那个误以为
         整个项目都健康。端口较多提示移进 title 保留，不占独立行。 */
      pStatusHTML +
      meters +
      /* 1.0.16：和单容器卡片一致，端口区带「快捷访问」小标题，用户一眼能找到 */
      '<div class="ports-label">快捷访问</div>' +
      '<div class="ct-project-meta">' + (chips.length ? chips.join("") : '<span class="no-port">无对外端口</span>') + "</div>" +
      /* 1.0.24：项目折叠卡也能整体启停其下全部容器。1.0.25 起去掉「启动」按钮：
         单容器卡运行态只显示「停止/重启」，项目卡对齐同一口径（启动请用「重启」，
         或展开后单独启动）。后端仍保留 start 动作，仅前端不再暴露入口。停止/重启
         走 /api/project/<project>/<action>，后端按 compose depends_on 拓扑排序。 */
      '<div class="ct-ops">' +
        '<button class="op" data-pact="stop" data-proj="' + esc(p) + '" title="停止项目内全部 ' + list.length + ' 个容器">停止</button>' +
        '<button class="op" data-pact="restart" data-proj="' + esc(p) + '" title="重启项目内全部 ' + list.length + ' 个容器">重启</button>' +
        '<button class="op primary" data-toggleproject="' + esc(p) + '" data-gkey="' + esc(gk) + '">' +
        (expanded ? "收起" : "展开 " + list.length + " 个容器") + "</button></div></article>";
  }

  function groupSection(k, arr, q, groupThemes) {
    var g = (state.config.groups || {})[k] || {};
    var running = arr.filter(function (c) { return c.state === "running"; }).length;
    /* 1.0.25：无图分组用主题色渐变背景（与 APP 同款暮色），有图分组保留原图。
       has-bg 类让标题走白字（CSS 已有 .group.has-bg 系列规则），视觉与 APP 对齐。 */
    var theme = (groupThemes || {})[k] || "";
    var autoBg = !g.image && !!theme;
    var accentColor = theme || g.accent || state.config.accent || "#7c8cff";
    var style = "--g-blur:" + (g.blur == null ? 6 : g.blur) + "px;--g-mask:" + (g.mask == null ? (autoBg ? .18 : 0) : g.mask) +
      ";--g-accent:" + esc(accentColor) + ";--g-op:" + (g.image || autoBg ? 1 : 0);
    var bg = g.image ? "background-image:url('" + esc(g.image) + "')"
      : (autoBg ? "background:linear-gradient(135deg," + theme + " 0%," + shade(theme, .62) + " 46%," + shade(theme, .32) + " 100%)" : "");
    // 1.0.7：分组级折叠。收起后整组只剩标题栏；搜索时自动展开，保证搜到的容器一定看得见。
    var folded = !q && isCollapsed(k);
    var collapse = !!state.config.collapseProjects && !q;
    var counts = {};
    arr.forEach(function (c) { if (c.project) counts[c.project] = (counts[c.project] || 0) + 1; });
    var cards = [], seen = {};
    if (!folded) {
      arr.forEach(function (c) {
        if (!collapse || !c.project) { cards.push(cardHTML(c)); return; }
        if (counts[c.project] < 2) { cards.push(cardHTML(c)); return; }
        if (seen[c.project]) return;
        seen[c.project] = 1;
        var pl = arr.filter(function (x) { return x.project === c.project; });
        var ex = isExpanded(k, c.project);
        cards.push(projectCardHTML(k, c.project, pl, ex));
        /* 1.0.18：项目内的子容器不可单独拖拽，只能整体拖项目卡 */
        if (ex) pl.forEach(function (x) { cards.push(cardHTML(x, true)); });
      });
    }
    var grid = cards.length ? cards.join("") :
      '<div class="group-empty">把容器卡片拖到这里，或在「编辑分组」里手动指派</div>';
    return '<section class="group' + (g.image || autoBg ? " has-bg" : "") + (folded ? " is-collapsed" : "") +
        '" data-group="' + esc(k) + '" style="' + style + '">' +
      '<div class="group-bg" style="' + bg + '"></div><div class="group-mask"></div>' +
      '<div class="group-inner">' +
        '<div class="group-head">' +
          '<i class="group-bar"></i><h2 class="group-title">' + esc(groupLabel(k)) + "</h2>" +
          '<span class="group-sub">' + arr.length + " 个容器 · " + running + " 运行中</span>" +
          '<div class="group-tools">' +
            '<button class="grp-fold' + (folded ? "" : " is-on") + '" data-foldgroup="' + esc(k) + '" title="' +
              (folded ? "展开本分组，显示全部 " + arr.length + " 个容器卡片" : "收起本分组，只保留标题栏") + '">' +
              (folded ? '展开<b class="gx-n">' + arr.length + "</b>" : "收起") + "</button>" +
            '<button data-focusnew>＋ 新分组</button>' +
            '<button data-editgroup="' + esc(k) + '">编辑分组</button>' +
          "</div>" +
        "</div>" +
        (folded
          ? '<div class="group-folded">已收起 ' + arr.length + " 个容器 · 点「展开」查看，也可以直接把卡片拖进来</div>"
          : '<div class="grid">' + grid + "</div>") +
      "</div></section>";
  }


  function renderSummary() {
    var i = (state.data && state.data.info) || {};
    var items = [
      { cls: "green", label: "运行中", v: i.running == null ? "–" : i.running },
      { cls: "gray", label: "已停止", v: i.stopped == null ? "–" : i.stopped },
      { cls: "", label: "镜像", v: i.images == null ? "–" : i.images }
    ];
    $("#summary").innerHTML = items.map(function (x) {
      return '<div class="stat"><i class="dot ' + x.cls + '"></i><span>' + x.label + '</span><b>' + x.v + "</b></div>";
    }).join("") +
      '<div class="stat"><span>' + esc(i.name || "Docker") + '</span><b style="font-size:11px;font-weight:500">' + esc(i.version || "") + "</b></div>";
    $("#footLeft").textContent = (state.config.title || "LiteDock") + (state.demo ? " · 演示模式（未连接 Docker）" : " · 极简本地容器管理面板");
    $("#footRight").textContent = state.demo ? "示例数据" : "最后刷新 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
  }

  function renderBoard() {
    var all = (state.data && state.data.containers) || [];
    var hidden = state.config.hidden || [];
    var q = state.query.trim().toLowerCase();
    var list = all.filter(function (c) {
      if (hidden.indexOf(c.name) >= 0) return false;
      if (!q) return true;
      return (c.name + " " + c.image + " " + c.status + " " + (c.project || "")).toLowerCase().indexOf(q) >= 0;
    });
    var hasCustom = Object.keys(state.config.groups || {}).some(function (k) { return k !== DEFAULT_GROUP; });
    if (!list.length && !hasCustom) {
      $("#board").innerHTML = '<div class="empty">' + (q ? "没有匹配「" + esc(state.query) + "」的容器" : "没有可显示的容器") + "</div>";
      return;
    }
    var buckets = {}, order = allGroupKeys();
    order.forEach(function (k) { buckets[k] = []; });
    list.forEach(function (c) {
      var k = groupKey(c);
      if (!buckets[k]) { buckets[k] = []; order.push(k); }
      buckets[k].push(c);
    });
    boardGroups = order.slice();
    /* 1.0.25：一次算出所有分组的主题色，保证显式配色优先、其余分组互不撞色 */
    var groupThemes = assignGroupThemes(order, state.config.groups || {}, state.config.accent);
    $("#board").innerHTML = foldToolsHTML(order, q) +
      order.map(function (k) { return groupSection(k, buckets[k] || [], q, groupThemes); }).join("") +
      newGroupBox();
  }


  /* inProject：Compose 项目折叠卡展开后的子容器。1.0.18 起这类卡片不参与跨分组拖拽——
     项目是一个管理单元，只能整体拖项目卡；单独拖某个子容器会把项目拆散，不便管理。
     做法：不输出 data-ctname（dragstart 选择器只认它）+ 显式 draggable=false + 标记。 */
  function cardHTML(c, inProject) {
    var running = c.state === "running", paused = c.state === "paused";
    var color = running ? "#25c07a" : (paused ? "#f0aa3c" : "#9aa3b6");
    var stateTxt = running ? "运行中" : (paused ? "已暂停" : "已停止");
    var s = c.stats;
    var meters = s ? '<div class="meter">' +
      '<div class="meter-item"><div class="meter-label"><span>CPU</span><b>' + s.cpu.toFixed(1) + "%</b></div>" +
        '<div class="bar' + (s.cpu > 80 ? " warn" : "") + '"><i style="width:' + Math.min(100, s.cpu) + '%"></i></div></div>' +
      '<div class="meter-item"><div class="meter-label"><span>内存</span><b>' + fmtBytes(s.memUsed) + "</b></div>" +
        '<div class="bar' + (s.mem > 80 ? " warn" : "") + '"><i style="width:' + Math.min(100, s.mem) + '%"></i></div></div>' +
      "</div>" : '<div class="meter"><div class="meter-item"><div class="meter-label"><span>CPU</span><b>–</b></div><div class="bar"><i style="width:0"></i></div></div>' +
        '<div class="meter-item"><div class="meter-label"><span>内存</span><b>–</b></div><div class="bar"><i style="width:0"></i></div></div></div>';
    var chips = [], seenChip = {};
    function addChip(key, html) {
      if (!key || seenChip[key] !== undefined) return;
      seenChip[key] = chips.length;
      chips.push(html);
    }
    /* 1.0.15：host 网络暴露端口与自定义链接常指向同一个 URL，过去会被整条
       去重吞掉，Web 端因此看不到「host · 端口」。让信息量更大的标签顶替它。 */
    function preferChip(key, html) {
      if (!key) return;
      if (seenChip[key] !== undefined) { chips[seenChip[key]] = html; return; }
      seenChip[key] = chips.length;
      chips.push(html);
    }
    var custom = linkFor(c.name);
    if (custom) {
      var cu = normLink(custom);
      if (cu) addChip(cu, '<a class="port port-custom" href="' + esc(cu) + '" target="_blank" rel="noopener" title="打开 ' + esc(cu) + '">' +
        esc(linkLabel(cu)) + "</a>");
    }
    (c.ports || []).forEach(function (p) {
      var url = portUrl(p.host);
      addChip(url, '<a class="port" href="' + esc(url) + '" target="_blank" rel="noopener" title="打开 ' + esc(url) + '">' +
        esc(p.host) + "→" + esc(p.container) + "</a>");
    });
    var isHost = c.networkMode === "host";
    if (!(c.ports || []).length && isHost) {
      (c.exposedPorts || []).forEach(function (p) {
        var url = portUrl(p);
        preferChip(url, '<a class="port port-host" href="' + esc(url) + '" target="_blank" rel="noopener" title="host 网络：容器直接占用宿主机端口 ' + esc(p) + '">' +
          "host · " + esc(p) + "</a>");
      });
    }
    var portsBody = chips.length ? chips.join("") :
      '<span class="no-port">' + (isHost ? "host 网络 · 未声明暴露端口" : "无端口映射") + "</span>";
    var ports = '<div class="ports-label">快捷访问</div><div class="ports-row">' + portsBody + "</div>";
    /* 1.0.26 自我保护：运行本面板的容器（isSelf）只保留只读操作（日志/检查更新），
       隐藏停止/重启/启动/恢复/升级——点停止会自断管理界面且不会自动拉起。 */
    var isSelf = c.isSelf === true;
    var ops = "";
    if (!isSelf) {
      ops = running
        ? '<button class="op" data-act="stop" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">停止</button>' +
          '<button class="op" data-act="restart" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">重启</button>'
        : '<button class="op primary" data-act="start" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">启动</button>';
      if (paused) ops = '<button class="op primary" data-act="unpause" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">恢复</button>';
    }
    ops += '<button class="op" data-act="logs" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">日志</button>' +
           '<button class="op" data-act="check" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">检查更新</button>' +
           /* 1.0.24：Compose 项目内子容器不提供单容器「升级」——逐个重建会破坏
              项目依赖与版本一致性，正确姿势是用项目卡整体启停 + CS3 改 compose。
              1.0.26：本体容器同样不提供升级（由部署脚本负责）。 */
           (!inProject && !isSelf ?
             '<button class="op danger" data-act="upgrade" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">升级</button>' : '');
    var cbg = (state.config.cardBackgrounds || {})[c.name] || {};
    var hasBg = !!cbg.image;
    var ctStyle = "--state-color:" + color + ";--icon-bg:" + iconBg(c) +
      ";--ct-blur:" + (cbg.blur == null ? 6 : Number(cbg.blur) || 0) + "px" +
      ";--ct-mask:" + (cbg.mask == null ? .42 : Number(cbg.mask) || 0);
    var ctBg = hasBg
      ? '<div class="ct-bg" style="background-image:url(\'' + esc(cbg.image) + '\')"></div><div class="ct-mask"></div>'
      : "";
    return '<article class="ct' + (running || paused ? "" : " is-stopped") + (hasBg ? " has-bg" : "") +
      (inProject ? ' in-project' : '') +
      '" draggable="' + (inProject ? "false" : "true") + '"' +
      (inProject ? ' data-inproject="1" title="项目内的容器请拖动外层「项目卡」整体移动"' :
        ' data-ctname="' + esc(c.name) + '"') +
      ' style="' + ctStyle + '">' +
      ctBg +
      '<div class="ct-top"><div class="ct-icon">' + iconHTML(c) + "</div>" +
        '<div class="ct-meta"><div class="ct-name" title="' + esc(c.name) + '">' + esc(c.name) + "</div>" +
        '<div class="ct-image" title="' + esc(c.image) + '">' + esc(c.imageShort || c.image) + "</div></div>" +
        /* 1.0.20：「有新镜像」从右上角独立徽标移进状态行末尾——此前它绝对定位
           在 (right:9,top:9)，与「运行中」状态徽标同行重叠，把状态盖住。 */
        '<div class="ct-state ' + (running ? "" : (paused ? "paused" : "off")) + '"><i class="led"></i>' + stateTxt +
          (isSelf ? '<span class="self-flag" title="这是运行 LiteDock 管理面板的容器，已禁用停止/重启/升级">◆ 本体</span>' : "") +
          (state.updates[c.name] === true ? '<span class="upd-flag">↻ 新镜像</span>' : "") + "</div>" +
      "</div>" +
      '<div class="ct-status" title="' + esc(c.status) + '">' + esc(c.status) + "</div>" +
      meters + '<div class="ct-ports">' + ports + "</div>" +
      '<div class="ct-ops">' + ops + "</div></article>";
  }

  /* ---------------- 数据加载 ---------------- */
  function load(silent) {
    if (!silent) $("#btnRefresh").style.opacity = ".5";
    return api("/api/state").then(function (d) {
      // 访问密码门禁：未带 / 带错 token 时后端返回 NEED_AUTH，弹出密码框
      if (d && d.code === "NEED_AUTH") { onNeedAuth(); return; }
      state.demo = false;
      state.data = d;
      state.assets = d.assets || { wallpaper: [], icon: [], card: [] };
      // 有未保存的改动时保留本地预览，避免 15 秒自动刷新把设置冲掉
      if (!state.dirty) state.config = Object.assign(defaults(), d.config || {});
      applyConfig(); renderSummary(); renderBoard();
      if (state.tab === "icon" || state.tab === "wall" || state.tab === "group") renderDrawer();
    }).catch(function () {
      if (state.data) { return; }  // 已有真实数据，网络抖动不切演示
      state.demo = true;
      state.data = DEMO;
      state.config = Object.assign(defaults(), DEMO.config || {});
      state.config.groups = {
        tools: { label: "常用服务", accent: "#7c8cff", blur: 6, mask: .12, image: "", order: 0 },
        safeline: { label: "Web 服务", accent: "#e0674c", blur: 6, mask: .18, image: "/assets/wallpapers/dusk.jpg", order: 1 }
      };
      state.config.groupMode = "project";
      applyConfig(); renderSummary(); renderBoard();
    }).then(function () {
      $("#btnRefresh").style.opacity = "";
    });
  }

  /* ---------------- 操作 ---------------- */
  /* 日志弹窗自动刷新：打开即每 5 秒拉一次，关闭弹窗即停；选中文本时不打断阅读。 */
  var logTimer = null, logAutoOn = true, logTarget = null;
  function fetchLogs(first) {
    if (!logTarget) return;
    var box = $("#modalLog");
    if (first) box.textContent = "加载中…";
    api("/api/container/" + encodeURIComponent(logTarget.id) + "/logs").then(function (r) {
      if (!logTarget) return;
      var atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
      box.textContent = r.ok ? (r.text || "（无日志输出）") : ("读取失败：" + r.error);
      if (atBottom || first) box.scrollTop = box.scrollHeight;
    });
  }
  function stopLogAuto() {
    if (logTimer) { clearInterval(logTimer); logTimer = null; }
    $("#btnLogAuto").classList.remove("on");
  }
  function startLogAuto() {
    if (logTimer || !logTarget || !logAutoOn) return;
    logTimer = setInterval(function () {
      if (document.hidden) return;
      if (window.getSelection && String(window.getSelection())) return;
      fetchLogs(false);
    }, 5000);
    $("#btnLogAuto").classList.add("on");
  }
  function closeLogModal() {
    logTarget = null;
    stopLogAuto();
    $("#modalMask").classList.remove("show");
  }

  function act(action, id, name, btn) {
    /* 1.0.26 自我保护：前端兜底（后端亦有拦截）。本体容器的危险操作一律拒绝。 */
    if (["stop", "restart", "pause", "upgrade"].indexOf(action) >= 0) {
      var selfContainer = (state.data && state.data.containers || []).some(function (x) {
        return x.isSelf === true && (x.id === id || x.name === name);
      });
      if (selfContainer) {
        toast("这是 LiteDock 本体，禁止停止/重启/升级自己（会导致管理界面中断）", "err");
        return;
      }
    }
    if (action === "logs") {
      logTarget = { id: id, name: name };
      logAutoOn = true;
      $("#modalTitle").textContent = "日志 · " + name;
      $("#modalLog").textContent = "加载中…";
      $("#modalMask").classList.add("show");
      fetchLogs(true);
      startLogAuto();
      return;
    }
    if (action === "upgrade") {
      if (!confirm("确定升级并重建容器「" + name + "」？\n\n· 会先拉取最新镜像\n· 旧版本自动改名备份并从面板隐藏，需要时可在「设置 → 备份」一键回退或彻底删除\n· 端口、挂载、环境变量、网络全部沿用原配置\n· 此操作会短暂中断该容器服务\n\n建议先对重要容器确认配置无误。")) return;
    }
    if (action === "check") toast("正在拉取镜像并检查更新，可能需要几十秒…");
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    api("/api/container/" + encodeURIComponent(id) + "/" + action, { method: "POST" })
      .then(function (r) {
        if (r && r.code === "NEED_AUTH") { onNeedAuth(); return; }
        if (!r.ok) { toast(r.error || "操作失败", "err"); return; }
        if (action === "check") {
          state.updates[name] = !!r.hasUpdate;
          /* 1.0.20：显示具体镜像版本号。后端把 Compose 容器的 sha256: 摘要反查回
             repo:tag（r.repo / r.tag），toast 直接给出「镜像名:当前版本（ID 短码）」，
             有更新时再给出「→ 最新 XXXXXXXXXX」。tag 相同而 ID 不同 = 同版本号刷新
             （常见于 latest / stable 这类滚动 tag）。 */
          var img = String(r.image || "");
          var tag = r.tag || (img.indexOf(":") >= 0 ? img.slice(img.lastIndexOf(":") + 1) : "latest");
          function shortId(s) { return String(s || "").replace(/^sha256:/, "").slice(0, 10); }
          var curId = shortId(r.oldId);
          var newId = shortId(r.newId);
          var ver = "当前 " + tag + (curId ? " (" + curId + ")" : "");
          if (r.hasUpdate) ver += " → 最新 " + tag + (newId ? " (" + newId + ")" : "");
          else if (curId && newId && curId !== newId) ver += " → " + newId;
          toast("「" + name + "」" + img + "\n" + (r.message || (r.hasUpdate ? "有新镜像" : "已是最新")) + " · " + ver,
            r.hasUpdate ? "ok" : "ok");
        } else if (action === "upgrade") {
          toast(r.changed === false ? r.message : r.message, "ok");
          state.updates[name] = false;
        } else {
          toast("「" + name + "」" + ({ start: "已启动", stop: "已停止", restart: "已重启", unpause: "已恢复" }[action] || action), "ok");
        }
        return load(true);
      })
      .catch(function (e) { toast("请求失败：" + e, "err"); })
      .then(function () { if (btn) { btn.disabled = false; } });
  }

  /* 1.0.24：项目整体启动/停止/重启。后端按 depends_on 拓扑排序，逐个执行。 */
  function projectAct(action, proj, btn) {
    var label = { start: "启动", stop: "停止", restart: "重启" }[action] || action;
    if (!confirm("确定" + label + "项目「" + proj + "」下的全部容器？\n\n" +
        (action === "start" ? "· 按依赖顺序启动（被依赖的先起）" :
         action === "stop" ? "· 按依赖逆序停止（依赖方先停）" :
         "· 先按依赖逆序停止，再按依赖顺序启动") +
        "\n· 这会同时影响该项目里的所有服务")) return;
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    api("/api/project/" + encodeURIComponent(proj) + "/" + action, { method: "POST" })
      .then(function (r) {
        if (r && r.code === "NEED_AUTH") { onNeedAuth(); return; }
        if (!r.ok) { toast(r.error || (r.message || "操作失败"), "err"); return; }
        toast(r.message || ("项目已" + label), "ok");
        return load(true);
      })
      .catch(function (e) { toast("请求失败：" + e, "err"); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = label; } });
  }

  /* 1.0.24：备份管理（升级产生的 backup/newer 容器已从主列表隐藏） */
  function loadBackups() {
    var box = $("#backupList");
    if (!box) return;
    box.innerHTML = '<div class="hint">加载中…</div>';
    api("/api/backups").then(function (r) {
      if (r && r.code === "NEED_AUTH") { onNeedAuth(); return; }
      if (!r.ok) { box.innerHTML = '<div class="hint">读取失败：' + esc(r.error || "") + "</div>"; return; }
      var list = r.backups || [];
      if (!list.length) {
        box.innerHTML = '<div class="bk-empty">暂无升级备份。升级独立容器后，旧版本会出现在这里，可随时回退或删除。</div>';
        return;
      }
      box.innerHTML = list.map(function (b) {
        var isNewer = b.kind === "newer";
        return '<div class="bk-row">' +
          '<div class="bk-info"><b>' + esc(b.base) + '</b>' +
            '<span class="bk-kind ' + (isNewer ? "newer" : "") + '">' + (isNewer ? "被替换的新版本" : "升级前旧版本") + "</span>" +
            '<span class="bk-meta">' + esc(b.shortId) + " · " + esc(b.image || "") + " · " + esc(b.status || b.state) + "</span></div>" +
          '<div class="bk-ops">' +
            '<button class="op primary" data-bkact="rollback" data-bkid="' + esc(b.id) + '" data-base="' + esc(b.base) + '">回退到此版本</button>' +
            '<button class="op danger" data-bkact="delete" data-bkid="' + esc(b.id) + '" data-base="' + esc(b.base) + '">彻底删除</button>' +
          "</div></div>";
      }).join("");
    }).catch(function (e) { box.innerHTML = '<div class="hint">读取失败：' + esc(e) + "</div>"; });
  }

  function backupAct(action, bid, base, btn) {
    var isDel = action === "delete";
    if (!confirm(isDel
        ? ("确定彻底删除备份容器「" + base + "」？\n\n此操作不可恢复，删除后就无法再回退到这个版本了。")
        : ("确定回退到「" + base + "」的这个版本？\n\n· 当前运行的版本会改名保留为备份（不会丢失）\n· 选中的备份会改回原名并启动\n· 此操作会短暂中断该容器服务"))) return;
    if (btn) { btn.disabled = true; }
    api("/api/backup/" + encodeURIComponent(bid) + "/" + action, { method: "POST" })
      .then(function (r) {
        if (r && r.code === "NEED_AUTH") { onNeedAuth(); return; }
        toast(r.message || (isDel ? "已删除" : "已回退"), r.ok ? "ok" : "err");
        return loadBackups();
      })
      .catch(function (e) { toast("请求失败：" + e, "err"); })
      .then(function () { if (btn) { btn.disabled = false; } });
  }

  /* ---------------- 设置抽屉 ---------------- */
  function rangeField(label, key, min, max, step, unit) {
    var v = state.config[key];
    return '<div class="field"><label>' + label + '</label><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '" data-cfg="' + key + '"><span class="val">' + v + (unit || "") + "</span></div>";
  }
  function wallThumbs(kind) {
    var pools = kind === "wall" ? BUILTIN_WALLS.concat((state.assets.wallpaper || []).map(function (x) { return { url: x.url, name: x.name }; })) : [];
    if (kind === "card") pools = BUILTIN_WALLS.concat((state.assets.card || []).map(function (x) { return { url: x.url, name: x.name }; }));
    return pools.map(function (w) {
      return '<div class="wall-item' + (state.config.wallpaper === w.url ? " active" : "") + '" style="background-image:url(&quot;' + esc(w.url) + '&quot;)" data-wall="' + esc(w.url) + '" title="' + esc(w.name) + '"><span>' + esc(w.name) + "</span></div>";
    }).join("");
  }
  function renderDrawer() {
    var c = state.config, body = $("#drawerBody");
    buildSettingsProjects();
    if (state.tab === "wall") {
      body.innerHTML =
        '<div class="sec"><h3>内置壁纸</h3><div class="wall-grid">' + wallThumbs("wall") + "</div>" +
          '<label class="btn wide" style="cursor:pointer">上传自定义壁纸<input type="file" accept="image/*" hidden data-upload="wallpaper"></label>' +
          '<div class="hint">壁纸存于容器 <code>/app/data/uploads/wallpaper/</code>，映射到你在 Compose 里挂载的数据目录（即 <code>./data</code>），重建容器不会丢。</div></div>' +
        '<div class="sec"><h3>壁纸效果</h3>' +
          rangeField("模糊", "wallpaperBlur", 0, 20, 1, "px") +
          rangeField("暗色遮罩", "wallpaperMask", 0, .8, .02, "") +
          rangeField("亮度", "wallpaperBrightness", .5, 1.5, .05, "") +
        "</div>" +
        '<div class="sec"><h3>站点文字</h3>' +
          '<div class="field"><label>标题</label><input type="text" data-cfg="title" value="' + esc(c.title) + '"></div>' +
          '<div class="field"><label>副标题</label><input type="text" data-cfg="subtitle" value="' + esc(c.subtitle) + '"></div>' +
        "</div>" + saveRow();
    } else if (state.tab === "look") {
      var tb = c.topbar || {};
      var tbPool = [{ url: "", name: "无背景" }].concat(BUILTIN_WALLS,
        (state.assets.card || []).map(function (x) { return { url: x.url, name: x.name }; }));
      var tbOpts = tbPool.map(function (w) {
        return '<option value="' + esc(w.url) + '"' + ((tb.image || "") === w.url ? " selected" : "") + ">" + esc(w.name) + "</option>";
      }).join("");
      body.innerHTML =
        '<div class="sec"><h3>卡片</h3>' +
          rangeField("不透明度", "cardOpacity", .3, .96, .02, "") +
          rangeField("圆角", "cardRadius", 6, 32, 1, "px") +
          '<div class="field"><label>每行列数</label><select data-cfg="columns">' +
            [2, 3, 4, 5].map(function (n) { return '<option value="' + n + '"' + (c.columns == n ? " selected" : "") + '>' + n + ' 列' + (n === 3 ? "（默认）" : "") + "</option>"; }).join("") +
          "</select></div>" +
          '<div class="field"><label>合并项目卡片</label><input type="checkbox" data-cfg-ck="collapseProjects"' + (c.collapseProjects !== false ? " checked" : "") + ' style="width:auto"></div>' +
          '<div class="hint">开启后，同一个 Docker Compose 项目里的多个容器默认合并成一张卡片，点「展开」看全部；搜索时会自动展开。关掉即恢复每个容器一张卡片。</div>' +
          '<div class="field"><label>紧凑模式</label><input type="checkbox" data-cfg-ck="compact"' + (c.compact ? " checked" : "") + ' style="width:auto"></div>' +
        "</div>" +
        '<div class="sec"><h3>顶部状态栏</h3>' +
          '<div class="field"><label>背景图</label><select data-tb="image">' + tbOpts + "</select></div>" +
          '<div class="field"><label>模糊</label><input type="range" min="0" max="20" step="1" value="' + (tb.blur == null ? 6 : tb.blur) + '" data-tb="blur"><span class="val">' + (tb.blur == null ? 6 : tb.blur) + "px</span></div>" +
          '<div class="field"><label>遮罩</label><input type="range" min="0" max="0.8" step="0.02" value="' + (tb.mask == null ? .3 : tb.mask) + '" data-tb="mask"><span class="val">' + (tb.mask == null ? .3 : tb.mask) + "</span></div>" +
          '<label class="btn" style="cursor:pointer">上传背景图<input type="file" accept="image/*" hidden data-upload="card" data-target="topbg"></label>' +
          '<div class="hint">给顶部状态栏单独设背景图，可选内置壁纸或已上传图片；有背景时标题、状态与按钮自动变白保证可读。选「无背景」则沿用全局毛玻璃。</div>' +
        "</div>" +
        '<div class="sec"><h3>主题色</h3><div class="field"><label>强调色</label><input type="color" data-cfg="accent" value="' + esc(c.accent) + '"><span class="val">' + esc(c.accent) + "</span></div></div>" +
        '<div class="sec"><h3>隐藏容器</h3>' + settingsRows().map(function (r) {
          var names = rowNames(r.key);
          var allHidden = names.every(function (n) { return (c.hidden || []).indexOf(n) >= 0; });
          return '<div class="field"><label' + rowTitle(r) + '>' + esc(r.label) + rowTag(r) + '</label><input type="checkbox" data-hide="' + esc(r.key) + '"' + (allHidden ? " checked" : "") + ' style="width:auto"></div>';
        }).join("") + "</div>" + saveRow();
    } else if (state.tab === "group") {
      var keys = allGroupKeys();
      var cards = keys.map(function (k) {
        var g = (c.groups || {})[k] || {};
        return '<div class="row-card"><div class="rc-head"><b>' + esc(groupLabel(k)) + '</b><small>' + esc(k) + "</small>" +
          (k === DEFAULT_GROUP ? '<small>默认分组</small>' : '<button class="mini-del" data-delgroup="' + esc(k) + '">删除分组</button>') + "</div>" +
          '<div class="field"><label>显示名</label><input type="text" data-g="label" data-k="' + esc(k) + '" value="' + esc(g.label || "") + '" placeholder="' + esc(groupLabel(k)) + '"></div>' +
          '<div class="field"><label>背景图</label><input type="text" data-g="image" data-k="' + esc(k) + '" value="' + esc(g.image || "") + '" placeholder="留空则无背景"></div>' +
          '<div class="field"><label>背景模糊</label><input type="range" min="0" max="20" step="1" value="' + (g.blur == null ? 6 : g.blur) + '" data-g="blur" data-k="' + esc(k) + '"><span class="val">' + (g.blur == null ? 6 : g.blur) + "px</span></div>" +
          '<div class="field"><label>背景遮罩</label><input type="range" min="0" max="0.8" step="0.02" value="' + (g.mask == null ? .12 : g.mask) + '" data-g="mask" data-k="' + esc(k) + '"><span class="val">' + (g.mask == null ? .12 : g.mask) + "</span></div>" +
          '<div class="field"><label>强调色</label><input type="color" data-g="accent" data-k="' + esc(k) + '" value="' + esc(g.accent || c.accent) + '"></div>' +
          '<label class="btn" style="cursor:pointer">上传分组背景<input type="file" accept="image/*" hidden data-upload="card" data-k="' + esc(k) + '"></label>' +
        "</div>";
      }).join("");
      var bindRows = settingsRows().map(function (r) {
        var names = rowNames(r.key);
        var first = ((state.data && state.data.containers) || []).filter(function (cc) { return cc.name === names[0]; })[0] || {};
        var opts = keys.map(function (k) {
          return '<option value="' + esc(k) + '"' + (groupKey(first) === k ? " selected" : "") + '>' + esc(groupLabel(k)) + "</option>";
        }).join("");
        return '<div class="bind-row"><span' + rowTitle(r) + '>' + esc(r.label) + rowTag(r) + '</span><select data-bind="' + esc(r.key) + '">' + opts + "</select></div>";
      }).join("");
      body.innerHTML =
        '<div class="sec"><h3>分组方式</h3>' +
          '<div class="field"><label>分组模式</label><select data-cfg="groupMode">' +
            '<option value="single"' + (c.groupMode !== "project" ? " selected" : "") + '>全部集中在「常用服务」</option>' +
            '<option value="project"' + (c.groupMode === "project" ? " selected" : "") + '>按 Compose 项目自动分组</option>' +
          "</select></div>" +
          '<div class="hint">全新部署默认是「全部集中在常用服务」；从 1.0.2 升级的配置保持原来的按项目分组，不会打乱已有布局。手动指派 / 拖拽的归属始终优先。</div></div>' +
        '<div class="sec"><h3>新建分组</h3>' + newGroupBox() +
          '<div class="hint">名称自己填，例如「影音服务」。新建后分组会立刻出现在主界面（允许为空），把容器卡片拖进去即可；也可以在下方的下拉里指派。</div></div>' +
        '<div class="sec"><h3>分组外观与重命名</h3><div class="hint">改「显示名」即可重命名；每个分组可单独设背景图、模糊、遮罩和强调色。</div>' + cards + "</div>" +
        '<div class="sec"><h3>手动调整容器归属</h3>' + bindRows + "</div>" + saveRow();
    } else if (state.tab === "card") {
      var ctList = ((state.data && state.data.containers) || []);
      var bgPool = [{ url: "", name: "无背景" }].concat(BUILTIN_WALLS,
        (state.assets.card || []).map(function (x) { return { url: x.url, name: x.name }; }));
      var bgCards = settingsRows().map(function (r) {
        var names = rowNames(r.key);
        var b = (c.cardBackgrounds || {})[names[0]] || {};
        var opts = bgPool.map(function (w) {
          return '<option value="' + esc(w.url) + '"' + ((b.image || "") === w.url ? " selected" : "") + ">" + esc(w.name) + "</option>";
        }).join("");
        return '<div class="row-card"><div class="rc-head"><b>' + esc(r.label) + rowTag(r) + '</b><small>单卡片背景</small></div>' +
          '<div class="field"><label>背景图</label><select data-ctbg="image" data-k="' + esc(r.key) + '">' + opts + "</select></div>" +
          '<div class="field"><label>模糊</label><input type="range" min="0" max="20" step="1" value="' + (b.blur == null ? 6 : b.blur) + '" data-ctbg="blur" data-k="' + esc(r.key) + '"><span class="val">' + (b.blur == null ? 6 : b.blur) + "px</span></div>" +
          '<div class="field"><label>遮罩</label><input type="range" min="0" max="0.8" step="0.02" value="' + (b.mask == null ? .42 : b.mask) + '" data-ctbg="mask" data-k="' + esc(r.key) + '"><span class="val">' + (b.mask == null ? .42 : b.mask) + "</span></div>" +
          '<label class="btn" style="cursor:pointer">上传背景图<input type="file" accept="image/*" hidden data-upload="card" data-target="ctbg" data-k="' + esc(r.key) + '"></label>' +
        "</div>";
      }).join("");
      var linkRows = settingsRows().map(function (r) {
        var names = rowNames(r.key);
        return '<div class="link-card">' +
          '<div class="lc-head"><b' + rowTitle(r) + '>' + esc(r.label) + '</b>' + rowTag(r) + '</div>' +
          '<div class="field"><label>内网</label><input type="text" data-link="' + esc(r.key) + '" value="' + esc((c.links || {})[names[0]] || "") +
            '" placeholder="留空 = 自动按端口生成"></div>' +
          '<div class="field"><label>外网</label><input type="text" data-linkwan="' + esc(r.key) + '" value="' + esc((c.linksWan || {})[names[0]] || "") +
            '" placeholder="https://服务名.你的域名:端口（留空 = 沿用内网）"></div>' +
        '</div>';
      }).join("");
      body.innerHTML =
        '<div class="sec"><h3>单个容器卡片背景</h3><div class="hint">每个容器可单独设背景图、模糊和暗色遮罩；带背景时卡片文字自动变白。选「无背景」则沿用全局毛玻璃。上传的图片存 <code>data/uploads/card/</code>，重建容器不丢。</div>' + bgCards + "</div>" +
        '<div class="sec"><h3>快捷访问（内网 / 外网）</h3><div class="hint">' +
          '给每个容器分别准备<b>在家</b>和<b>在外面</b>用的网址：' +
          '<b>内网</b>留空则自动按端口生成；<b>外网</b>填好反向代理对外发布的完整网址。' +
          'APP / 小程序会按当前连接自动挑一个显示；外网留空时沿用内网地址，两栏都留空则仍按端口生成。' +
          '使用 <b>host 网络</b>的容器没有端口映射，建议在这里填。' +
          '<br>常见 HTTPS 端口会自动用 <code>https://</code> 打开，无需额外设置。</div>' +
          linkRows + "</div>" + saveRow();
    } else if (state.tab === "icon") {
      var uploaded = (state.assets.icon || []);
      var iconOpts = '<option value="">自动匹配（内置）</option>' + uploaded.map(function (x) {
        return '<option value="' + esc(x.url) + '">' + esc(x.name) + "</option>";
      }).join("");
      body.innerHTML =
        '<div class="sec"><h3>已上传图标</h3><div class="icon-list">' +
          (uploaded.length ? uploaded.map(function (x) {
            return '<div class="icon-item" title="' + esc(x.name) + '"><img src="' + esc(x.url) + '"><span class="del" data-delicon="' + esc(x.url) + '">✕</span></div>';
          }).join("") : '<div style="grid-column:1/-1;font-size:11px;color:var(--ink-3);padding:10px 0">还没有上传图标</div>') +
        "</div>" +
        '<label class="btn wide" style="cursor:pointer">上传图标（PNG / SVG / WebP）<input type="file" accept="image/*" hidden data-upload="icon"></label>' +
        '<div class="hint">没有手动绑定时，会按容器名 / 镜像名自动匹配内置图标（内置 3900+ 个，来自 homarr-labs/dashboard-icons，MIT 许可）。</div></div>' +
        '<div class="sec"><h3>绑定到容器</h3>' + settingsRows().map(function (r) {
          var names = rowNames(r.key);
          var cur = (c.icons || {})[names[0]] || "";
          var opts = '<option value="">自动匹配（内置）</option>' + uploaded.map(function (x) {
            return '<option value="' + esc(x.url) + '"' + (cur === x.url ? " selected" : "") + '>' + esc(x.name) + "</option>";
          }).join("");
          return '<div class="bind-row"><span' + rowTitle(r) + '>' + esc(r.label) + rowTag(r) + '</span><select data-iconbind="' + esc(r.key) + '">' + opts + "</select></div>";
        }).join("") + "</div>" + saveRow();
    } else if (state.tab === "backup") {
      /* 1.0.24：升级备份管理。列表异步拉取，不进 /api/state，避免污染主流程。 */
      body.innerHTML =
        '<div class="sec"><h3>升级备份</h3>' +
          '<div class="hint">升级独立容器时，旧版本会自动改名备份并从面板隐藏，不会再把停止的旧容器留在项目里。这里可以一键回退到旧版本，或彻底删除备份释放空间。项目内容器请用项目卡的「停止 / 重启」整体管理。</div>' +
          '<div id="backupList" class="bk-list"></div>' +
          '<button class="btn wide" id="btnReloadBackup" style="margin-top:10px">刷新备份列表</button>' +
        "</div>";
      loadBackups();
    } else {
      var i = (state.data && state.data.info) || {};
      var sock = i.socket || "/var/run/docker.sock";
      body.innerHTML =
        '<div class="sec"><div class="about-brand"><img src="/assets/icons/litedock.png" alt="LiteDock"><div class="about-brand-txt"><b>LiteDock</b><span>极简本地容器管理面板</span></div></div></div>' +
        '<div class="sec"><h3>LiteDock</h3><div class="row-card">' +
          '<div class="kv"><span>版本</span><b>' + esc((state.data && state.data.appVersion) || "1.0.16") + '</b></div>' +
          '<div class="kv"><span>后端</span><b>Python 标准库 · 零依赖</b></div>' +
        "</div></div>" +
        '<div class="sec"><h3>运行环境（实时读取）</h3><div class="row-card">' +
          '<div class="kv"><span>Docker API</span><b>' + esc(i.version || "–") + (i.apiVersion ? " · API " + esc(i.apiVersion) : "") + "</b></div>" +
          '<div class="kv"><span>宿主机</span><b>' + esc(i.name || "–") + "</b></div>" +
          '<div class="kv"><span>系统</span><b>' + esc(i.os || "–") + "</b></div>" +
          '<div class="kv"><span>架构</span><b>' + esc(i.arch || "–") + "</b></div>" +
          '<div class="kv"><span>数据源</span><b>' + esc(sock) + "</b></div>" +
        "</div>" +
        '<div class="sec"><h3>安全提示</h3><div class="hint">挂载 docker.sock 等同于宿主机 root 权限。<b>请只在局域网使用，不要把端口映射到公网</b>，也不要套在 WAF 后面直接对外。升级功能只在手动点击时执行，没有任何定时任务。</div></div>' +
        '<div class="sec"><h3>许可与来源</h3><div class="hint">LiteDock 是独立开发的原创项目：后端（Python 标准库）、前端（原生 HTML / CSS / JS）与内置壁纸均由本项目自行编写或绘制，未包含、复制或改写任何第三方项目的源码，因此不受任何第三方开源许可证（如 AGPL）的约束。<br>容器图标来自开源项目 <b>homarr-labs/dashboard-icons</b>（GitHub：github.com/homarr-labs/dashboard-icons，<b>MIT 许可</b>），目前全量引入其 PNG 图标 3900+ 个；各图标商标归原厂商所有，在此感谢该项目的整理与维护。<br>本项目采用 MIT 许可证，代码可自由使用、修改与再分发；运行所依赖的 Python 与 Docker Engine 各自遵循其原有许可证，与本面板代码无关。</div></div>' +
        '<div class="about-sign">LiteDock · By Stark-C</div>';

    }
    // 恢复图标绑定选中态
    if (state.tab === "icon") {
      Object.keys(c.icons || {}).forEach(function (n) {
        var el = body.querySelector('[data-iconbind="' + CSS.escape(n) + '"]');
        if (el) el.value = c.icons[n];
      });
    }
  }
  function saveRow() {
    return '<button class="btn primary wide" id="btnSave">保存设置</button>' +
      '<div class="hint">改动先在本地即时预览，点「保存设置」才写入 NAS；刷新页面后依然生效。</div>';
  }

  function saveConfig() {
    return postJSON("/api/config", state.config).then(function (r) {
      if (r && r.code === "NEED_AUTH") { onNeedAuth(); return; }
      if (r.ok) { state.dirty = false; toast("设置已保存", "ok"); load(true); }
      else toast("保存失败：" + (r.error || ""), "err");
    }).catch(function (e) {
      toast(state.demo ? "演示模式无法保存（未连接后端）" : "保存失败：" + e, state.demo ? "" : "err");
    });
  }
  function openDrawer(tab) {
    if (tab) { state.tab = tab; $("#tabs").querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); }); }
    renderDrawer();
    $("#drawer").classList.add("show"); $("#drawerMask").classList.add("show");
  }
  function closeDrawer() { $("#drawer").classList.remove("show"); $("#drawerMask").classList.remove("show"); }

  /* ---------------- 事件 ---------------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    var bk = t.closest("[data-bkact]");
    if (bk) return backupAct(bk.dataset.bkact, bk.dataset.bkid, bk.dataset.base, bk);
    if (t.closest && t.closest("#btnReloadBackup")) return loadBackups();
    var pa = t.closest("[data-pact]");
    if (pa) return projectAct(pa.dataset.pact, pa.dataset.proj, pa);
    var op = t.closest("[data-act]");
    if (op) return act(op.dataset.act, op.dataset.id, op.dataset.name, op);
    var tp = t.closest("[data-toggleproject]");
    if (tp) return toggleProject(tp.dataset.gkey, tp.dataset.toggleproject);
    var ag = t.closest("[data-addgroup]");
    if (ag) {
      var box = ag.closest(".new-group-box"), inp = box && box.querySelector("[data-newgroup]");
      return addGroup(inp ? inp.value : "");
    }
    var dg = t.closest("[data-delgroup]");
    if (dg) return delGroup(dg.dataset.delgroup);
    var fn = t.closest("[data-focusnew]");
    if (fn) {
      var ni = $("#board .new-group-box [data-newgroup]");
      if (ni) { ni.focus(); if (ni.scrollIntoView) ni.scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }
    var eg = t.closest("[data-editgroup]");
    if (eg) return openDrawer("group");
    var w = t.closest("[data-wall]");
    if (w) {
      state.config.wallpaper = w.dataset.wall; state.dirty = true; applyConfig();
      $("#drawerBody").querySelectorAll(".wall-item").forEach(function (x) { x.classList.toggle("active", x === w); });
      return;
    }
    var del = t.closest("[data-delicon]");
    if (del) { toast("删除上传文件请在 NAS 的 data/uploads/icon/ 目录操作（避免误删）"); return; }
    if (t.closest("#btnSave")) return saveConfig();
  });

  // 分组折叠按钮独立绑定在面板容器上：不走 document 事件链，
  // 避免被其它分支拦截，也不与拖拽逻辑互相影响。
  $("#board").addEventListener("click", function (e) {
    var fg = e.target.closest && e.target.closest("[data-foldgroup]");
    var fa = e.target.closest && e.target.closest("[data-foldall]");
    if (!fg && !fa) return;
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (fg) return toggleGroupCollapse(fg.dataset.foldgroup);
    foldAllGroups(fa.dataset.foldall === "1");
  });

  /* ---------------- 跨分组拖拽（1.0.3，1.0.5 支持整个 Compose 项目拖动） ---------------- */
  // 1.0.4：缓存高亮目标，dragover 高频触发时不再每次全表 querySelectorAll
  var dragOverGroup = null;
  var dragSource = null;   // {type:"container"|"project", names:[...], project, gk}
  function setDropTarget(g) {
    if (dragOverGroup === g) return;
    if (dragOverGroup) dragOverGroup.classList.remove("drop-target");
    dragOverGroup = g;
    if (g) g.classList.add("drop-target");
  }
  document.addEventListener("dragstart", function (e) {
    /* 1.0.18：项目内子容器一律不允许单独拖拽（外层项目卡才有 data-projname） */
    if (e.target.closest && e.target.closest(".ct.in-project, .ct[data-inproject]")) { e.preventDefault(); return; }
    var ct = e.target.closest && e.target.closest(".ct[data-ctname], .ct[data-projname]");
    if (!ct || (e.target.closest && e.target.closest("a,button,input"))) { e.preventDefault(); return; }
    dragSource = null;
    var pn = ct.dataset.projname;
    if (pn) {
      // 项目卡：把当前分组里该项目的全部容器一起搬到目标分组
      var gk = ct.dataset.gkey;
      var names = ((state.data && state.data.containers) || []).filter(function (c) {
        return c.project === pn && groupKey(c) === gk;
      }).map(function (c) { return c.name; });
      if (!names.length) { e.preventDefault(); return; }
      dragSource = { type: "project", project: pn, gk: gk, names: names };
      try {
        e.dataTransfer.setData("text/plain", names.join("\n"));
        e.dataTransfer.effectAllowed = "move";
      } catch (err) {}
    } else {
      dragSource = { type: "container", names: [ct.dataset.ctname] };
      try {
        e.dataTransfer.setData("text/plain", ct.dataset.ctname);
        e.dataTransfer.effectAllowed = "move";
      } catch (err) {}
    }
    ct.classList.add("dragging");
    document.body.classList.add("is-dragging");
  });
  document.addEventListener("dragend", function () {
    dragSource = null;
    setDropTarget(null);
    document.querySelectorAll(".ct.dragging, .group.drop-target").forEach(function (x) {
      x.classList.remove("dragging", "drop-target");
    });
    document.body.classList.remove("is-dragging");
  });
  document.addEventListener("dragover", function (e) {
    var g = e.target.closest && e.target.closest(".group[data-group]");
    if (!g) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDropTarget(g);
  });
  document.addEventListener("dragleave", function (e) {
    var g = e.target.closest && e.target.closest(".group[data-group]");
    if (g && dragOverGroup === g && (!e.relatedTarget || !g.contains(e.relatedTarget))) setDropTarget(null);
  });
  document.addEventListener("drop", function (e) {
    var g = e.target.closest && e.target.closest(".group[data-group]");
    if (!g) return;
    e.preventDefault();
    setDropTarget(null);
    var key = g.dataset.group;
    var src = dragSource;
    dragSource = null;
    if (src && src.type === "project") {
      if (src.gk === key) { toast("「" + src.project + "」已经在这个分组里了"); return; }
      state.config.containerGroups = state.config.containerGroups || {};
      src.names.forEach(function (n) { state.config.containerGroups[n] = key; });
      unfoldOnDrop(key);
      saveNow("「" + src.project + "」" + src.names.length + " 个容器已移入「" + groupLabel(key) + "」");
      return;
    }
    var name = src && src.names && src.names[0] || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
    if (!name) return;
    var cur = (state.config.containerGroups || {})[name];
    if (cur === key || (!cur && groupKeyByName(name) === key)) {
      toast("已经在「" + groupLabel(key) + "」里了"); return;
    }
    state.config.containerGroups = state.config.containerGroups || {};
    state.config.containerGroups[name] = key;
    unfoldOnDrop(key);
    saveNow("「" + name + "」已移入「" + groupLabel(key) + "」");
  });


  $("#btnRefresh").addEventListener("click", function () { load(); });
  $("#btnSettings").addEventListener("click", function () { openDrawer(); });
  $("#btnCloseDrawer").addEventListener("click", closeDrawer);
  $("#drawerMask").addEventListener("click", closeDrawer);
  $("#btnCloseModal").addEventListener("click", closeLogModal);
  $("#modalMask").addEventListener("click", function (e) { if (e.target === this) closeLogModal(); });
  $("#btnLogAuto").addEventListener("click", function () {
    logAutoOn = !logAutoOn;
    if (logAutoOn) { startLogAuto(); toast("已开启日志自动刷新（5 秒）"); }
    else { stopLogAuto(); toast("已暂停自动刷新"); }
  });
  $("#tabs").addEventListener("click", function (e) {
    var b = e.target.closest(".tab"); if (!b) return;
    state.tab = b.dataset.tab;
    $("#tabs").querySelectorAll(".tab").forEach(function (x) { x.classList.toggle("active", x === b); });
    renderDrawer();
  });
  $("#search").addEventListener("input", function (e) { state.query = e.target.value; renderBoard(); });

  // 配置表单：即时预览
  $("#drawerBody").addEventListener("input", function (e) {
    var el = e.target, k = el.dataset.cfg;
    if (k || el.dataset.cfgCk || el.dataset.g || el.dataset.hide !== undefined ||
        el.dataset.ctbg || el.dataset.link !== undefined || el.dataset.linkwan !== undefined ||
        el.dataset.https !== undefined ||
        el.dataset.tb !== undefined) state.dirty = true;
    if (k) {
      var v = el.type === "range" ? parseFloat(el.value) : el.value;
      if (k === "columns" || k === "cardRadius") v = parseInt(v, 10);
      state.config[k] = v; applyConfig();
      if (k === "groupMode" || k === "columns") renderBoard();
      var val = el.parentNode.querySelector(".val");
      if (val) val.textContent = v + (k === "wallpaperBlur" || k === "cardRadius" ? "px" : "");
    }
    if (el.dataset.cfgCk) { state.config[el.dataset.cfgCk] = el.checked; applyConfig(); renderBoard(); }
    var gk = el.dataset.g;
    if (gk) {
      var key = el.dataset.k;
      state.config.groups = state.config.groups || {};
      state.config.groups[key] = state.config.groups[key] || {};
      var v2 = el.type === "range" ? parseFloat(el.value) : el.value;
      state.config.groups[key][gk] = v2;
      var val2 = el.parentNode.querySelector(".val");
      if (val2) val2.textContent = v2 + (gk === "blur" ? "px" : "");
      renderBoard();
    }
    var tbk = el.dataset.tb;
    if (tbk) {
      state.config.topbar = state.config.topbar || {};
      var tbv = el.type === "range" ? parseFloat(el.value) : el.value;
      state.config.topbar[tbk] = tbv;
      var tbVal = el.parentNode.querySelector(".val");
      if (tbVal) tbVal.textContent = tbv + (tbk === "blur" ? "px" : "");
      applyConfig();
    }
    var h = el.dataset.hide;
    if (h !== undefined) {
      var hnames = rowNames(h);
      state.config.hidden = state.config.hidden || [];
      if (el.checked) hnames.forEach(function (n) { if (state.config.hidden.indexOf(n) < 0) state.config.hidden.push(n); });
      else hnames.forEach(function (n) { var i = state.config.hidden.indexOf(n); if (i >= 0) state.config.hidden.splice(i, 1); });
      renderBoard();
    }
    var cbk = el.dataset.ctbg;
    if (cbk && el.tagName !== "SELECT") {
      var cbNames = rowNames(el.dataset.k);
      state.config.cardBackgrounds = state.config.cardBackgrounds || {};
      cbNames.forEach(function (n) {
        var b = state.config.cardBackgrounds[n] = state.config.cardBackgrounds[n] || {};
        b[cbk] = el.type === "range" ? parseFloat(el.value) : el.value;
      });
      var cbVal = el.parentNode.querySelector(".val");
      if (cbVal) cbVal.textContent = (el.type === "range" ? parseFloat(el.value) : el.value) + (cbk === "blur" ? "px" : "");
      renderBoard();
    }
    if (el.dataset.link !== undefined) {
      var lnames = rowNames(el.dataset.link);
      state.config.links = state.config.links || {};
      lnames.forEach(function (n) { state.config.links[n] = el.value; });
      renderBoard();
    }
    if (el.dataset.linkwan !== undefined) {
      var wnames = rowNames(el.dataset.linkwan);
      state.config.linksWan = state.config.linksWan || {};
      wnames.forEach(function (n) { state.config.linksWan[n] = el.value; });
      renderBoard();
    }
    if (el.dataset.https !== undefined) {
      state.config.httpsPorts = el.value.split(/[,，\s]+/).map(function (x) { return parseInt(x, 10); })
        .filter(function (x) { return !isNaN(x) && x > 0 && x < 65536; });
      renderBoard();
    }
  });
  $("#drawerBody").addEventListener("change", function (e) {
    var el = e.target;
    if (el.dataset.bind !== undefined || el.dataset.iconbind !== undefined ||
        el.dataset.cfg || el.dataset.cfgCk || el.dataset.ctbg || el.dataset.tb !== undefined) state.dirty = true;
    if (el.dataset.tb && el.tagName === "SELECT") {
      state.config.topbar = state.config.topbar || {};
      state.config.topbar[el.dataset.tb] = el.value;
      applyConfig();
    }
    if (el.dataset.ctbg && el.tagName === "SELECT") {
      var cbnNames = rowNames(el.dataset.k);
      state.config.cardBackgrounds = state.config.cardBackgrounds || {};
      cbnNames.forEach(function (n) {
        state.config.cardBackgrounds[n] = state.config.cardBackgrounds[n] || {};
        state.config.cardBackgrounds[n][el.dataset.ctbg] = el.value;
      });
      renderBoard();
    }
    if (el.dataset.bind !== undefined) {
      var bnames = rowNames(el.dataset.bind);
      state.config.containerGroups = state.config.containerGroups || {};
      bnames.forEach(function (n) { state.config.containerGroups[n] = el.value; });
      renderBoard();
    }
    if (el.dataset.iconbind !== undefined) {
      var innames = rowNames(el.dataset.iconbind);
      state.config.icons = state.config.icons || {};
      innames.forEach(function (n) {
        if (el.value) state.config.icons[n] = el.value;
        else delete state.config.icons[n];
      });
      renderBoard();
    }
    if (el.dataset.cfg && el.tagName === "SELECT") {
      var sv = el.value;
      if (el.dataset.cfg === "columns" || el.dataset.cfg === "cardRadius") sv = parseInt(sv, 10);
      state.config[el.dataset.cfg] = sv; applyConfig(); renderBoard();
    }
    if (el.dataset.cfgCk) { state.config[el.dataset.cfgCk] = el.checked; applyConfig(); renderBoard(); }
    var up = el.dataset.upload;
    if (up && el.files && el.files[0]) {
      var f = el.files[0];
      toast("正在上传 " + f.name + "…");
      var upHeaders = {};
      if (AUTH_TOKEN) upHeaders["X-LiteDock-Token"] = AUTH_TOKEN;
      fetch("/api/upload?kind=" + up + "&name=" + encodeURIComponent(f.name), { method: "POST", headers: upHeaders, body: f })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (!r.ok) { toast("上传失败：" + r.error, "err"); return; }
          state.dirty = true;
          if (up === "wallpaper") { state.config.wallpaper = r.url; applyConfig(); }
          if (up === "card") {
            var key = el.dataset.k;
            if (el.dataset.target === "ctbg") {
              var upNames = rowNames(key);
              state.config.cardBackgrounds = state.config.cardBackgrounds || {};
              upNames.forEach(function (n) {
                state.config.cardBackgrounds[n] = state.config.cardBackgrounds[n] || {};
                state.config.cardBackgrounds[n].image = r.url;
              });
            } else if (el.dataset.target === "topbg") {
              state.config.topbar = state.config.topbar || {};
              state.config.topbar.image = r.url;
              applyConfig();
            } else {
              state.config.groups = state.config.groups || {};
              state.config.groups[key] = state.config.groups[key] || {};
              state.config.groups[key].image = r.url;
            }
            renderBoard();
            if (el.dataset.target === "ctbg" || el.dataset.target === "topbg") renderDrawer();
          }
          toast("上传成功", "ok");
          return load(true);
        })
        .catch(function (err) { toast("上传失败：" + err, "err"); });
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeDrawer(); closeLogModal(); }
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); $("#search").focus(); }
    if (e.key === "Enter" && e.target.dataset && e.target.dataset.newgroup !== undefined) {
      e.preventDefault();
      var nb = e.target.closest(".new-group-box"), btn = nb && nb.querySelector("[data-addgroup]");
      if (btn && btn.click) btn.click();
    }
  });

  /* ---------------- 登录（1.0.13 访问密码） ---------------- */
  var loginBtn = $("#btnLogin"), loginPw = $("#loginPw");
  if (loginBtn) loginBtn.addEventListener("click", function () { doLogin(loginPw ? loginPw.value : ""); });
  if (loginPw) loginPw.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); doLogin(this.value); }
  });

  /* ---------------- 启动 ---------------- */
  state.config = defaults();
  applyConfig();
  load();
  state.timer = setInterval(function () { if (!document.hidden) load(true); }, 15000);

  /* 1.0.20：受限调试出口（仅验证脚本用，不承载任何业务逻辑）。
     浏览器控制台/CDP 可读 panelRuntime.state() 与 panelRuntime.testRender()，
     配置写入仍走 config 对象由面板自身渲染管线下发，不绕过任何既有校验。 */
  window.panelRuntime = {
    state: function () { return state; },
    rerender: function () { renderBoard(); }
  };
})();
