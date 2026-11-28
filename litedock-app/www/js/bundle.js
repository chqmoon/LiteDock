/* LiteDock App — 由 tools/build_bundle.py 从小程序源码自动生成，请勿手改 */
/* 源：litedock-miniprogram 的 utils 模块、app.js 与 pages 各页 JS，业务逻辑零改动 */

LD.define('utils/connection.js', function(require, module, exports) {
/* 连接配置：本地只保存 NAS 的「访问链接」和少量高级项。
   局域网 http://IP:端口，外网填已做好的 HTTPS 反向代理地址；类型自动识别，不缓存容器数据。 */
const KEY_LIST = 'fd_connections';
const KEY_ACTIVE = 'fd_active_id';

function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function put(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  return m ? m[1] : '';
}

function hostnameOf(url) {
  return hostOf(url).replace(/:\d+$/, '');
}

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^localhost$/i.test(host);
}

/* 没写协议时：IP / localhost 自动补 http，域名自动补 https；已写协议则原样保留 */
function normalizeUrl(raw, type) {
  let u = String(raw || '').trim().replace(/\s+/g, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    const bare = u.split('/')[0].replace(/:\d+$/, '');
    if (type === 'proxy') u = 'https://' + u;
    else if (type === 'lan') u = 'http://' + u;
    else u = (isIp(bare) ? 'http://' : 'https://') + u;
  }
  return u.replace(/\/+$/, '');
}

/* 列表标签用：https + 非 IP 视为反向代理，其余都是局域网 / 内网 */
function inferType(url) {
  const s = String(url || '');
  if (!/^https:\/\//i.test(s)) return 'lan';
  return isIp(hostnameOf(s)) ? 'lan' : 'proxy';
}

function makeId() {
  return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 10000).toString(36);
}

function ensureDefaults() {
  const all = get(KEY_LIST, null);
  if (!Array.isArray(all)) put(KEY_LIST, []);
}

function list() {
  const l = get(KEY_LIST, []);
  return Array.isArray(l) ? l : [];
}

function validate(input) {
  const src = input || {};
  const url = normalizeUrl(src.url, src.type);
  if (!/^https?:\/\/[^/?#]+/i.test(url)) return { ok: false, error: '请填写正确的访问链接' };
  /* 主机名含非 ASCII 字符（如整段中文）说明不是有效地址：本地直接拦截，
     不再对必然失败的地址发网络请求（用户会看到干净的提示而不是超时错误） */
  const hostName = hostnameOf(url);
  if (!hostName || /[^\x20-\x7e]/.test(hostName)) return { ok: false, error: '请填写正确的访问链接' };
  const type = inferType(url);
  const defaultName = hostnameOf(url);
  const name = String(src.name || '').trim() || defaultName;
  const hostInput = String(src.host || '').trim();
  const host = (hostInput || defaultName).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return {
    ok: true,
    value: {
      id: src.id || makeId(),
      name: name.slice(0, 24),
      type,
      url,
      host,
      header: String(src.header || '').trim().slice(0, 300),
      password: String(src.password || '').trim().slice(0, 200),
      note: String(src.note || '').trim().slice(0, 60),
      created: src.created || Date.now()
    }
  };
}

function save(input) {
  const r = validate(input);
  if (!r.ok) return r;
  const all = list();
  const idx = all.findIndex((x) => x.id === r.value.id);
  if (idx >= 0) all[idx] = r.value;
  else all.push(r.value);
  if (!put(KEY_LIST, all)) return { ok: false, error: '本地存储写入失败' };
  if (!get(KEY_ACTIVE, '')) put(KEY_ACTIVE, r.value.id);
  return { ok: true, value: r.value };
}

function remove(id) {
  const all = list().filter((x) => x.id !== id);
  put(KEY_LIST, all);
  if (get(KEY_ACTIVE, '') === id) put(KEY_ACTIVE, all.length ? all[0].id : '');
  return all;
}

function setActive(id) {
  put(KEY_ACTIVE, id);
  return getActive();
}

function getActive() {
  const id = get(KEY_ACTIVE, '');
  const all = list();
  return all.find((x) => x.id === id) || all[0] || null;
}

function typeLabel(type) {
  return type === 'proxy' ? '反向代理' : '局域网';
}

/* 反代加鉴权时可用：把 "Authorization: Basic xxxx" 拆成请求头键值 */
function parseHeader(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const key = s.slice(0, i).trim();
  const value = s.slice(i + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

module.exports = {
  list, save, remove, setActive, getActive,
  ensureDefaults, validate,
  normalizeUrl, hostnameOf, inferType, typeLabel, parseHeader,
  KEY_LIST, KEY_ACTIVE
};

});

LD.define('utils/api.js', function(require, module, exports) {
/* LiteDock HTTP 客户端：只读取状态 / 日志，加容器操作，不写 config.json */
const connection = require('./connection.js');

/* 错误提示按连接类型分流：
   局域网 IP 走微信官方豁免（基础库 2.4.0+，同网段即可），不需要白名单 / HTTPS / 调试模式，
   绝不能用公网域名的那套说辞误导用户。 */
function friendly(err, kind) {
  const msg = String((err && err.errMsg) || err || '');
  const lan = kind === 'lan';
  if (/^request:fail\s*$/i.test(msg.trim())) {
    return lan
      ? '连不上局域网：请确认手机与 NAS 在同一 WiFi，且 IP、端口（23000）填写正确。'
      : '当前无法联网，请检查手机网络后重试。';
  }
  if (/domain|url not in|invalid url|不在以下.*域名|fail.*domain/i.test(msg)) {
    return lan
      ? '连不上局域网：微信只允许同网段的局域网 IP 直连。请确认手机和 NAS 在同一 WiFi（不能开流量），地址填 NAS 的内网 IP。'
      : '域名被拒绝：正式版只认已备案 + 已加入后台 request 白名单的 HTTPS 域名，端口建议 443；体验版/开发版可在开发者工具勾「不校验合法域名」临时联调。';
  }
  if (/ssl|certificate|证书/i.test(msg)) {
    return lan
      ? '局域网直连不需要 HTTPS 证书，请确认地址填的是 http://NAS内网IP:23000。'
      : 'HTTPS 证书校验失败，请检查反向代理证书是否可信、未过期、域名一致。';
  }
  if (/timeout|超时/i.test(msg)) {
    return lan
      ? '局域网连接超时：确认手机与 NAS 同 WiFi、LiteDock 服务在线、端口 23000 正确。'
      : '连接超时，请确认域名解析、反代服务与 LiteDock 均在线。';
  }
  if (/ refused|ECONNREFUSED|connect/i.test(msg)) {
    return lan
      ? '无法连接 NAS：检查内网 IP、端口 23000 是否正确，服务是否运行。'
      : '无法建立连接，请检查地址、端口与防火墙。';
  }
  return '网络请求失败：' + (msg || '未知错误');
}

/* LiteDock 访问密码：走独立的 X-LiteDock-Token 头，不与反代 BasicAuth 的 Authorization 冲突 */
function authHeader(active, rawPassword) {
  const header = {};
  const pw = rawPassword !== undefined ? rawPassword : (active && active.password);
  if (pw) header['X-LiteDock-Token'] = pw;
  return header;
}

function request(method, path, payload, timeout) {
  return new Promise((resolve) => {
    const active = connection.getActive();
    if (!active) {
      resolve({ ok: false, code: 'NO_CONNECTION', error: '尚未配置 NAS 连接' });
      return;
    }
    const header = authHeader(active);
    const custom = connection.parseHeader(active.header);
    if (custom) header[custom.key] = custom.value;
    let data = payload;
    if (method === 'POST') {
      header['content-type'] = 'application/json';
      data = payload === undefined || payload === null ? '' : JSON.stringify(payload);
    }
    wx.request({
      url: active.url + path,
      method,
      data,
      header,
      timeout: timeout || 10000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let body = res.data;
          if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { /* 保留原始文本 */ }
          }
          resolve({ ok: true, data: body, status: res.statusCode });
        } else if (res.statusCode === 401) {
          resolve({ ok: false, code: 'NEED_AUTH', error: '需要访问密码，请在「管理多套连接」里填写' });
        } else {
          resolve({ ok: false, code: 'HTTP', error: '服务返回 HTTP ' + res.statusCode });
        }
      },
      fail(err) {
        resolve({ ok: false, code: 'NETWORK', error: friendly(err, connection.inferType(active.url)) });
      }
    });
  });
}

/* 测试一个还没保存的「访问链接」：先 /api/health，再顺带取宿主机名 */
function probe(base, rawHeader, password) {
  return new Promise((resolve) => {
    const root = String(base || '').replace(/\/+$/, '');
    const header = authHeader(null, password);
    const custom = connection.parseHeader(rawHeader);
    if (custom) header[custom.key] = custom.value;
    wx.request({
      url: root + '/api/health',
      method: 'GET',
      header,
      timeout: 8000,
      success(res) {
        let body = res.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) { body = null; }
        }
        if (res.statusCode === 401) {
          resolve({ ok: false, message: '需要访问密码，请在高级选项里填写' });
          return;
        }
        if (res.statusCode !== 200 || !body || !body.ok) {
          resolve({ ok: false, message: '服务返回 HTTP ' + res.statusCode + '，请检查反代路径是否指向 LiteDock' });
          return;
        }
        wx.request({
          url: root + '/api/info',
          method: 'GET',
          header,
          timeout: 8000,
          success(r2) {
            const info = (typeof r2.data === 'object' && r2.data) ? r2.data : {};
            resolve({ ok: true, message: '连接成功' + (info.name ? ' · 宿主机 ' + info.name : '') });
          },
          fail() { resolve({ ok: true, message: '连接成功' }); }
        });
      },
      fail(err) { resolve({ ok: false, message: friendly(err, connection.inferType(root)) }); }
    });
  });
}

/* 取宿主机信息（用于连接默认以宿主机命名）：返回 /api/info 的对象或 null */
function fetchInfo(base, rawHeader, password) {
  const root = String(base || '').replace(/\/+$/, '');
  const header = authHeader(null, password);
  const custom = connection.parseHeader(rawHeader);
  if (custom) header[custom.key] = custom.value;
  return new Promise((resolve) => {
    wx.request({
      url: root + '/api/info',
      method: 'GET',
      header,
      timeout: 8000,
      success(res) {
        let body = res.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) { body = null; }
        }
        if (res.statusCode === 200 && body && body.ok && body.name) resolve(body);
        else resolve(null);
      },
      fail() { resolve(null); }
    });
  });
}

module.exports = {
  request,
  friendly,
  probe,
  fetchInfo,
  getState: () => request('GET', '/api/state', undefined, 15000),
  getLogs: (id, tail) => request('GET', '/api/container/' + encodeURIComponent(id) + '/logs?tail=' + (tail || 100), undefined, 10000),
  /* 微信 request 超时上限 60s；升级/拉镜像可能更久，服务端仍会继续执行完，
     因此调用方对超时要提示「稍后下拉刷新确认结果」，不要说操作必然失败。 */
  action: (id, act) => request('POST', '/api/container/' + encodeURIComponent(id) + '/' + act, undefined, 60000),
  checkUpdate: (id) => request('POST', '/api/container/' + encodeURIComponent(id) + '/check', undefined, 60000),
  upgrade: (id) => request('POST', '/api/container/' + encodeURIComponent(id) + '/upgrade', undefined, 60000),
  /* 1.0.15：Compose 项目整体启停（后端按 depends_on 拓扑排序） */
  projectAction: (project, act) => request('POST', '/api/project/' + encodeURIComponent(project) + '/' + act, undefined, 60000),
  /* 1.0.15：升级备份管理（已从主列表隐藏的 backup/newer 容器） */
  getBackups: () => request('GET', '/api/backups', undefined, 15000),
  backupRollback: (id) => request('POST', '/api/backup/' + encodeURIComponent(id) + '/rollback', undefined, 60000),
  backupDelete: (id) => request('POST', '/api/backup/' + encodeURIComponent(id) + '/delete', undefined, 60000),
  /* 1.0.26 APP 自更新：不复用 request()，因为更新源是固定的 GitHub 公开 API，
     与用户填写的 NAS 连接完全无关。APP 构建补丁会把此函数替换为原生严格 TLS 实现，
     小程序端保持 wx.request（未发布、且不需要自更新）。 */
  fetchAppRelease: () => new Promise((resolve) => {
    wx.request({
      url: 'https://api.github.com/repos/chqmoon/LiteDock/releases/latest',
      method: 'GET',
      header: { Accept: 'application/vnd.github+json', 'User-Agent': 'LiteDock-App-Updater' },
      timeout: 12000,
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.tag_name) {
          resolve({ ok: true, data: res.data });
        } else {
          resolve({ ok: false, error: 'GitHub API HTTP ' + res.statusCode });
        }
      },
      fail(err) { resolve({ ok: false, error: String((err && err.errMsg) || err || '网络失败') }); }
    });
  })
};

});

LD.define('utils/model.js', function(require, module, exports) {
/* 把 LiteDock /api/state 的原始响应转换成移动端视图模型。
   WXML 不支持函数调用，所有文本、颜色、宽度、链接都在这里预算好。 */
const DEFAULT_GROUP = 'tools';

/* 1.0.20：分组自动渐变——移植 APP/Web 的 GROUP_PALETTE 算法。
   没有自定义背景图的分组，按 group key 分配一个全局唯一主题色，生成暮色渐变，
   保证各组配色各异，避免白板分组与玻璃卡的视觉割裂。 */
const GROUP_PALETTE = ['#e0674c', '#7c6cff', '#2fa08a', '#c2568f', '#3a86c8', '#d0903a', '#6a5acd', '#4a9e5c'];
const DEFAULT_ACCENTS = ['#6c7cff', '#7c8cff'];
function shade(hex, factor) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  if (!/^[0-9a-f]{6}$/i.test(h)) return '#1a2340';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const c = (x) => ('0' + Math.round(Math.max(0, Math.min(255, x * factor))).toString(16)).slice(-2);
  return '#' + c(r) + c(g) + c(b);
}
/* 就地给每个分组写 _theme / autoBg / autoBar。先锁定显式强调色，其余从调色板取未占用色，
   避免哈希独立取色撞色（实测两个分组分到同色）。 */
function assignGroupThemes(groups) {
  const used = {};
  (groups || []).forEach((g) => {
    const a = String(g.accent || '').toLowerCase();
    if (a && DEFAULT_ACCENTS.indexOf(a) < 0) used[a] = 1;
  });
  (groups || []).forEach((g) => {
    g._theme = '';
    if (g.hasBg) return;
    const a = String(g.accent || '').toLowerCase();
    if (a && DEFAULT_ACCENTS.indexOf(a) < 0) {
      g._theme = a;
    } else {
      const s = String(g.key == null ? '' : g.key);
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      let chosen = '';
      for (let k = 0; k < GROUP_PALETTE.length; k++) {
        const cand = GROUP_PALETTE[(h + k) % GROUP_PALETTE.length];
        if (!used[cand]) { chosen = cand; break; }
      }
      if (!chosen) chosen = GROUP_PALETTE[h % GROUP_PALETTE.length];
      used[chosen] = 1;
      g._theme = chosen;
    }
    g.autoBg = 'linear-gradient(135deg,' + g._theme + ' 0%,' + shade(g._theme, .62) + ' 46%,' + shade(g._theme, .32) + ' 100%)';
    g.autoBar = g._theme;
  });
  /* 所有分组统一走 has-bg 视觉（有图的用图、无图的用渐变），白字玻璃卡 */
  (groups || []).forEach((g) => { g.visualBg = !!(g.hasBg || g._theme); });
  return groups;
}

const ICONS = [
  { re: /portainer|docker|container/i, text: 'D', color: '#2496ed' },
  { re: /nginx|apache|traefik|caddy|tengine|safeline|chaitin|httpd/i, text: 'W', color: '#e0674c' },
  { re: /postgres|mysql|mariadb|mongo|redis|sqlite|database|pg/i, text: 'DB', color: '#3b82c4' },
  { re: /jellyfin|plex|emby|navidrome|subsonic|audiobook/i, text: '▶', color: '#9b59d0' },
  { re: /qbittorrent|transmission|deluge|aria2|download/i, text: '↓', color: '#2fa36b' },
  { re: /filebrowser|alist|cloudreve|nextcloud|seafile|syncthing/i, text: '▤', color: '#e0a13a' },
  { re: /adguard|pihole|dns|waf|firewall|vaultwarden|bitwarden/i, text: '◆', color: '#16a085' },
  { re: /gitea|gitlab|github|git|svn/i, text: '</>', color: '#6c7a89' },
  { re: /uptime|kuma|grafana|prometheus|monitor|netdata/i, text: '▥', color: '#e2803c' },
  { re: /aitutor|ollama|llm|chatbot|openai|anythingllm/i, text: 'AI', color: '#7d5ce0' },
  { re: /proxy|clash|tunnel|vpn|wireguard|tailscale/i, text: '◎', color: '#4a90d9' },
  { re: /heimdall|homepage|dashy|bookmark/i, text: '☁', color: '#5b9bd5' },
  { re: /spotify|music|lyric/i, text: '♪', color: '#d8557f' },
  { re: /syncthing|backup|sync/i, text: '↻', color: '#3aa6d8' },
  { re: /book|wiki|note/i, text: '▧', color: '#8a6d3b' },
  { re: /gear|config|admin/i, text: '⚙', color: '#6b7a90' }
];

function iconOf(ct) {
  const s = (ct.name || '') + ' ' + (ct.image || '') + ' ' + (ct.project || '');
  for (let i = 0; i < ICONS.length; i++) {
    if (ICONS[i].re.test(s)) return { text: ICONS[i].text, color: ICONS[i].color, bg: ICONS[i].color + '1c' };
  }
  return { text: '▣', color: '#5b6bd6', bg: '#5b6bd61c' };
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return (x >= 100 ? x.toFixed(0) : x.toFixed(1)) + ' ' + units[i];
}

/* 1.0.13：项目折叠卡要像单容器卡一样显示启动时间。解析 Docker status
   （"Up 8 days"/"Exited (0) 3 hours ago" 等）成秒，取运行中容器里 Up 最久的。 */
function uptimeSeconds(status) {
  const s = String(status || '');
  const m = /^Up\s+(?:(\d+)\s+year|(\d+)\s+month|(\d+)\s+week|(\d+)\s+day|(\d+)\s+hour|(\d+)\s+minute|(\d+)\s+second)s?/i.exec(s);
  if (!m) return 0;
  if (m[1]) return +m[1] * 31536000;
  if (m[2]) return +m[2] * 2592000;
  if (m[3]) return +m[3] * 604800;
  if (m[4]) return +m[4] * 86400;
  if (m[5]) return +m[5] * 3600;
  if (m[6]) return +m[6] * 60;
  return 0;
}
/* 1.0.14：与 Web 端同源。返回项目卡状态行信息：
   text — Up 最久容器 status，同长优先带 (healthy)；issues — 非 running/unhealthy 容器数；
   warn — issues>0 时状态行加橙色 ⚠ 警告。 */
function projectStatusInfo(list) {
  let best = '', bestSec = -1, bestHealthy = false, issues = 0;
  list.forEach((c) => {
    const st = String(c.status || '');
    if (c.state !== 'running' || /unhealthy/i.test(st)) issues++;
    if (c.state !== 'running') return;
    const sec = uptimeSeconds(st);
    const healthy = /\(healthy\)/i.test(st);
    if (sec > bestSec || (sec === bestSec && healthy && !bestHealthy)) {
      bestSec = sec; best = st; bestHealthy = healthy;
    }
  });
  if (!best) {
    for (let i = 0; i < list.length; i++) { if (list[i].status) { best = list[i].status; break; } }
  }
  return { text: best || '', issues, warn: issues > 0 };
}
function projectStatusText(list) { return projectStatusInfo(list).text; }

function stateInfo(state) {
  if (state === 'running') return { text: '运行中', color: '#22b07d' };
  if (state === 'paused') return { text: '已暂停', color: '#e3a13a' };
  if (state === 'exited' || state === 'created' || state === 'dead') return { text: '已停止', color: '#9aa3b2' };
  if (state === 'restarting') return { text: '重启中', color: '#6c7cff' };
  return { text: state || '未知', color: '#9aa3b2' };
}

function groupKey(ct, cfg) {
  const assigned = (cfg.containerGroups || {})[ct.name];
  if (assigned) return assigned;
  if (cfg.groupMode === 'project') return ct.project || 'default';
  return DEFAULT_GROUP;
}

function groupLabel(key, cfg) {
  const g = (cfg.groups || {})[key];
  if (g && g.label) return g.label;
  if (key === DEFAULT_GROUP || key === 'common') return '常用服务';
  return key === 'default' ? '未分组 / 独立容器' : key;
}

function allGroupKeys(cfg, containers) {
  const seen = {};
  const keys = [];
  function add(k) { if (k && !seen[k]) { seen[k] = 1; keys.push(k); } }
  if (cfg.groupMode !== 'project' || (cfg.groups || {})[DEFAULT_GROUP]) add(DEFAULT_GROUP);
  Object.keys(cfg.groups || {}).forEach(add);
  Object.keys(cfg.containerGroups || {}).forEach((n) => add(cfg.containerGroups[n]));
  containers.forEach((c) => add(groupKey(c, cfg)));
  const gs = cfg.groups || {};
  keys.sort((a, b) => {
    if (a === DEFAULT_GROUP) return -1;
    if (b === DEFAULT_GROUP) return 1;
    return ((gs[a] || {}).order == null ? 999 : gs[a].order) - ((gs[b] || {}).order == null ? 999 : gs[b].order);
  });
  return keys;
}

function portUrl(port, cfg, nasHost) {
  let hp = cfg.httpsPorts || [443, 5001, 8443, 9443];
  if (typeof hp === 'string') hp = hp.split(/[,，\s]+/);
  const nums = (Array.isArray(hp) ? hp : []).map((x) => Number(x));
  const scheme = nums.indexOf(Number(port)) >= 0 ? 'https' : 'http';
  return scheme + '://' + (nasHost || 'localhost') + ':' + port;
}

function normLink(u) {
  let v = String(u == null ? '' : u).trim();
  if (!v) return '';
  if (v.charAt(0) === '/') return v;
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
  return v;
}

/* Web 端 config 里的图片都是站内路径（内置 /assets/...、上传 /media/...）。
   反代带子路径前缀时，访问链接本身就是前缀，直接拼即可。 */
function assetUrl(p, baseUrl) {
  const v = String(p == null ? '' : p).trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v) || v.slice(0, 2) === '//') return v;
  if (!baseUrl) return '';
  return String(baseUrl).replace(/\/+$/, '') + (v.charAt(0) === '/' ? v : '/' + v);
}

/* Web 的 mask 原值偏浅，手机上白字容易糊；只做可读性下限，不改 NAS 配置 */
function maskVal(v, dflt, min, max) {
  const n = Number(v);
  const x = isFinite(n) && v !== null && v !== '' ? n : dflt;
  return Math.max(min, Math.min(max, x));
}

function shortLabel(u) {
  const s = String(u).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return s.length > 20 ? s.slice(0, 19) + '…' : s;
}

function chipsOf(list, cfg, nasHost, isProxy) {
  /* APP 1.0.8：反代连接下两个独立开关，互不干扰；局域网直连时两项都不生效。
     A「外网显示已配反代的服务」→ 自定义访问链接（linksWan 优先、回退 links）
     B「外网也显示容器端口」    → NAS 内网端口映射
     默认 A 开 / B 关，与 1.0.7 的表现一致；小程序源码零改动。 */
  const pref = (typeof window !== 'undefined' && window.LD && window.LD.appLinkPrefs)
    ? window.LD.appLinkPrefs() : { wan: true, ports: false };
  const showCustom = isProxy ? pref.wan : true;
  const showPorts = isProxy ? pref.ports : true;
  const out = [];
  const seen = {};
  list.forEach((c) => {
    const lanLink = normLink((cfg.links || {})[c.name]);
    const wanLink = normLink((cfg.linksWan || {})[c.name]);
    const custom = showCustom ? (isProxy ? (wanLink || lanLink) : lanLink) : '';
    if (custom && !seen[custom]) {
      seen[custom] = 1;
      out.push({ label: shortLabel(custom), url: custom, custom: true });
    }
    if (!showPorts) return;
    (c.ports || []).forEach((p) => {
      const u = portUrl(p.host, cfg, nasHost);
      if (!seen[u]) {
        seen[u] = 1;
        out.push({ label: String(p.host) + '→' + String(p.container), url: u, custom: false, state: c.state });
      }
    });
    const isHost = c.networkMode === 'host';
    if (!(c.ports || []).length && isHost) {
      (c.exposedPorts || []).forEach((p) => {
        const u = portUrl(p, cfg, nasHost);
        if (!seen[u]) {
          seen[u] = 1;
          out.push({ label: 'host · ' + String(p), url: u, custom: false, state: c.state });
        }
      });
    }
  });
  return out;
}

function primaryAction(c) {
  if (c.state === 'paused') return { key: 'unpause', label: '恢复', style: 'primary' };
  if (c.state === 'running') return { key: 'stop', label: '停止', style: 'plain' };
  return { key: 'start', label: '启动', style: 'primary' };
}

function containerCard(c, cfg, nasHost, baseUrl, gkey, isProxy) {
  const si = stateInfo(c.state);
  const ic = iconOf(c);
  const st = c.stats || null;
  const cpu = st ? Number(st.cpu) || 0 : 0;
  const mem = st ? Number(st.mem) || 0 : 0;
  const chips = chipsOf([c], cfg, nasHost, isProxy);
  const cbg = (cfg.cardBackgrounds || {})[c.name] || {};
  const customIcon = (cfg.icons || {})[c.name] || '';
  const bgUrl = assetUrl(cbg.image, baseUrl);
  /* 图标优先级：自定义（Web 端设置）> 内置图标库自动匹配（iconAuto）> 字母兜底 */
  const iconUrl = assetUrl(customIcon, baseUrl) || assetUrl(c.iconAuto, baseUrl);
  return {
    key: 'c:' + c.id,
    isContainer: true,
    isProject: false,
    id: c.id,
    name: c.name,
    imageShort: c.imageShort || c.image || '',
    status: c.status || '',
    state: c.state,
    stateText: si.text,
    stateColor: si.color,
    ledColor: si.color,
    iconText: ic.text,
    iconColor: ic.color,
    iconBg: ic.bg,
    iconUrl,
    /* 区分自定义上传图标（铺满）与内置匹配图标（保留比例），APP 模板据此加 class */
    iconIsCustom: !!customIcon,
    customIcon: iconUrl,
    cpuText: st ? cpu.toFixed(1) + '%' : '–',
    memText: st ? fmtBytes(st.memUsed) : '–',
    cpuWidth: Math.min(100, cpu) + '%',
    memWidth: Math.min(100, mem) + '%',
    cpuWarn: cpu > 80,
    memWarn: mem > 80,
    hasStats: !!st,
    chips,
    hasChips: chips.length > 0,
    /* 反代模式下没有自定义链接时，整个「访问链接」区块都不显示 */
    portsVisible: chips.length > 0 || !isProxy,
    noPortText: c.networkMode === 'host' ? 'host 网络 · 未声明暴露端口' : '无端口映射',
    primary: primaryAction(c),
    isRunning: c.state === 'running',
    /* 1.0.19：运行本面板的容器自己——模板据此显示「本体」徽标并禁用危险操作 */
    isSelf: c.isSelf === true,
    hasBg: !!bgUrl,
    bgUrl,
    bgMask: maskVal(cbg.mask, .42, .38, .68),
    /* 卡片背景模糊：同步 Web 的 --ct-blur（默认 6px） */
    bgBlur: cbg.blur == null ? 6 : (Number(cbg.blur) || 0),
    groupKey: gkey,
    project: c.project || ''
  };
}

function projectCard(list, project, gkey, expanded, cfg, nasHost, baseUrl, isProxy) {
  let cpu = 0;
  let memUsed = 0;
  let memLimitMax = 0;
  let nStats = 0;
  let running = 0;
  list.forEach((c) => {
    if (c.stats) {
      nStats++;
      cpu += Number(c.stats.cpu) || 0;
      memUsed += Number(c.stats.memUsed) || 0;
      /* 1.0.12：memLimit 每容器都等于宿主机内存，累加会得出 7×15G 的荒谬分母。
         取单个最大值作为项目内存天花板，与单容器卡 memWidth 同口径。 */
      if ((Number(c.stats.memLimit) || 0) > memLimitMax) memLimitMax = Number(c.stats.memLimit) || 0;
    }
    if (c.state === 'running') running++;
  });
  const memPct = memLimitMax ? Math.min(100, memUsed / memLimitMax * 100) : 0;
  const chips = chipsOf(list, cfg, nasHost, isProxy);
  const ic = iconOf(list[0]);
  const pStatus = projectStatusInfo(list);
  /* 1.0.16：项目折叠卡也吃「编辑卡片背景」——取项目第一个容器配的图，
     与 Web 1.0.20 同口径（cardBackgrounds[first.name]）；未配置时与旧版一致无背景。
     此前 APP 项目卡从未算过背景字段，模板无从渲染，雷池这类项目一直是白板。 */
  const pBg = (cfg.cardBackgrounds || {})[list[0].name] || {};
  const pBgUrl = assetUrl(pBg.image, baseUrl);
  return {
    key: 'p:' + gkey + '::' + project,
    isContainer: false,
    isProject: true,
    name: project,
    project,
    groupKey: gkey,
    hasBg: !!pBgUrl,
    bgUrl: pBgUrl,
    bgMask: maskVal(pBg.mask, .42, .38, .68),
    bgBlur: pBg.blur == null ? 6 : (Number(pBg.blur) || 0),
    count: list.length,
    runningText: running + '/' + list.length,
    stateColor: running === list.length ? '#22b07d' : (running ? '#e3a13a' : '#9aa3b2'),
    /* 1.0.12：项目卡与单容器卡显示完全一致——复用同一套 meter 字段，
       标签由模板固定为「CPU」「内存」，不再写「· 内存 xxx」一行文字。 */
    cpuText: nStats ? cpu.toFixed(1) + '%' : '–',
    memText: nStats ? fmtBytes(memUsed) : '–',
    /* 1.0.14：项目卡状态行，与 Web 同源：Up 最久容器（同长优先 healthy）+ 异常容器警告 */
    statusText: pStatus.text,
    statusIssues: pStatus.issues,
    statusWarn: pStatus.warn,
    cpuWidth: Math.min(100, cpu) + '%',
    memWidth: memPct + '%',
    cpuWarn: cpu > 80,
    memWarn: memPct > 80,
    hasStats: nStats > 0,
    chips: chips.slice(0, 4),
    hasChips: chips.length > 0,
    portsVisible: chips.length > 0 || !isProxy,
    extraChips: chips.length > 4 ? ' · 另有 ' + (chips.length - 4) + ' 个端口' : '',
    expanded,
    toggleLabel: expanded ? '收起' : '展开 ' + list.length + ' 个容器',
    iconText: ic.text,
    iconColor: ic.color,
    iconBg: ic.bg,
    /* 项目卡也吃内置图标：用第一个容器的自动匹配结果 */
    iconUrl: assetUrl(list[0].iconAuto, baseUrl)
  };
}

function buildCards(list, gkey, cfg, nasHost, baseUrl, expandedKeys, query, isProxy) {
  const collapse = cfg.collapseProjects !== false && !query;
  const byProject = {};
  const order = [];
  list.forEach((c) => {
    const p = c.project || '';
    if (!byProject[p]) { byProject[p] = []; if (p) order.push(p); }
    byProject[p].push(c);
  });
  const cards = [];
  const visited = {};
  list.forEach((c) => {
    const p = c.project || '';
    const group = byProject[p] || [];
    if (p && collapse && group.length >= 2) {
      if (visited[p]) return;
      visited[p] = 1;
      const exp = expandedKeys.indexOf(gkey + '::' + p) >= 0;
      cards.push(projectCard(group, p, gkey, exp, cfg, nasHost, baseUrl, isProxy));
      if (exp) group.forEach((x) => cards.push(containerCard(x, cfg, nasHost, baseUrl, gkey, isProxy)));
      return;
    }
    cards.push(containerCard(c, cfg, nasHost, baseUrl, gkey, isProxy));
  });
  return cards;
}

function buildViewModel(raw, opts) {
  const o = opts || {};
  const cfg = (raw && raw.config) || {};
  const info = (raw && raw.info) || {};
  const all = (raw && raw.containers) || [];
  const hidden = cfg.hidden || [];
  const query = String(o.query || '').trim().toLowerCase();
  const collapsedKeys = Array.isArray(o.collapsedKeys) ? o.collapsedKeys : [];
  const expandedKeys = Array.isArray(o.expandedKeys) ? o.expandedKeys : [];
  const nasHost = o.nasHost || '';
  const baseUrl = o.baseUrl || '';
  /* 反向代理连接（https + 域名）：端口映射打不开，不显示（1.0.6） */
  const isProxy = !!o.isProxy;
  const visible = all.filter((c) => hidden.indexOf(c.name) < 0);

  let groups = [];
  if (query) {
    const matched = visible.filter((c) => {
      const hay = ((c.name || '') + ' ' + (c.imageShort || c.image || '') + ' ' + (c.project || '') + ' ' + (c.status || '')).toLowerCase();
      return hay.indexOf(query) >= 0;
    });
    if (matched.length) {
      groups = [{
        key: '__search__',
        label: '搜索结果',
        count: matched.length,
        running: matched.filter((c) => c.state === 'running').length,
        collapsed: false,
        canFold: false,
        toggleText: '',
        accent: cfg.accent || '#6c7cff',
        hasBg: false,
        bgUrl: '',
        bgMask: 0,
        bgBlur: 6,
        cards: buildCards(matched, '__search__', cfg, nasHost, baseUrl, expandedKeys, query, isProxy),
        hint: ''
      }];
    }
    groups = assignGroupThemes(groups);
  } else {
    groups = allGroupKeys(cfg, visible).map((k) => {
      const list = visible.filter((c) => groupKey(c, cfg) === k);
      const collapsed = collapsedKeys.indexOf(k) >= 0 && !query;
      const g = (cfg.groups || {})[k] || {};
      const gBg = assetUrl(g.image, baseUrl);
      return {
        key: k,
        label: groupLabel(k, cfg),
        accent: g.accent || cfg.accent || '#6c7cff',
        hasBg: !!gBg,
        bgUrl: gBg,
        bgMask: maskVal(g.mask, .42, .34, .62),
        /* 分组背景模糊：同步 Web 的 --g-blur（默认 6px） */
        bgBlur: g.blur == null ? 6 : (Number(g.blur) || 0),
        count: list.length,
        running: list.filter((c) => c.state === 'running').length,
        collapsed,
        canFold: true,
        toggleText: collapsed ? '展开 ' + list.length : '收起',
        cards: collapsed ? [] : buildCards(list, k, cfg, nasHost, baseUrl, expandedKeys, query, isProxy),
        hint: collapsed ? '已收起 ' + list.length + ' 个容器 · 点「展开」查看' : ''
      };
    });
    groups = assignGroupThemes(groups);
  }

  const running = visible.filter((c) => c.state === 'running').length;
  const wallpaperUrl = assetUrl(cfg.wallpaper, baseUrl);
  const topbarUrl = assetUrl(cfg.topbar && cfg.topbar.image, baseUrl);
  /* 顶栏/概览背景模糊：同步 Web 的 --tb-blur（默认 6px） */
  const topbarBlur = (cfg.topbar && cfg.topbar.blur != null) ? (Number(cfg.topbar.blur) || 0) : 6;
  return {
    title: cfg.title || 'LiteDock',
    subtitle: cfg.subtitle || 'NAS容器管理',
    accent: cfg.accent || '#6c7cff',
    wallpaperUrl,
    topbarUrl,
    /* 顶部背景优先用桌面版顶栏图，没有则用壁纸；小程序只读同步 Web 的外观 */
    heroBgUrl: topbarUrl || wallpaperUrl,
    /* 顶栏背景模糊：同步 Web 的 --tb-blur（默认 6px）。heroBgUrl 取顶栏图或壁纸，统一用顶栏模糊值 */
    heroBlur: topbarBlur,
    /* 整页壁纸遮罩 / 模糊：同步 Web 的 wall-mask / wall-blur，小程序只读同步外观。
       mask 夹在 .15~.6：太浅壁纸会糊、太深则分组白色玻璃外的间隙过黑；.6 上限保证整页底色仍通透 */
    wallpaperMask: maskVal(cfg.wallpaperMask, .34, .15, .6),
    wallpaperBlur: cfg.wallpaperBlur == null ? 0 : (Number(cfg.wallpaperBlur) || 0),
    appVersion: (raw && raw.appVersion) || '–',
    hostName: info.name || '未知主机',
    hostOs: info.os || '–',
    hostKernel: info.kernel || '–',
    hostArch: info.arch || '–',
    dockerVersion: info.version || '–',
    apiVersion: info.apiVersion || info.apiPath || '–',
    socket: info.socket || '–',
    images: info.images == null ? '–' : String(info.images),
    total: visible.length,
    running,
    stopped: visible.length - running,
    paused: visible.filter((c) => c.state === 'paused').length,
    groups,
    groupCount: groups.length,
    hasGroups: groups.length > 0,
    searchActive: !!query,
    resultCount: query ? groups.reduce((n, g) => n + g.count, 0) : 0
  };
}

module.exports = {
  buildViewModel,
  containerCard,
  chipsOf,
  iconOf,
  fmtBytes,
  stateInfo,
  groupLabel,
  portUrl,
  assetUrl,
  maskVal,
  DEFAULT_GROUP
};

});

LD.define('utils/imageloader.js', function(require, module, exports) {
/* 图片落地（1.0.8 新增）：<image> 标签发请求不能携带自定义鉴权头，
   反代加 BasicAuth 时远程图会 401 一片空白；且真机上 http 远程图也可能被拦。
   统一用 wx.downloadFile（支持 header）把图换成本地临时路径再显示；
   失败时保留远程 URL 兜底（行为与旧版一致），会话内按 URL 缓存避免重复下载。 */
const connection = require('./connection.js');

function authHeader() {
  const c = connection.getActive();
  if (!c || !c.header) return null;
  const h = connection.parseHeader(c.header);
  if (!h) return null;
  const o = {};
  o[h.key] = h.value;
  return o;
}

function store() {
  const app = getApp();
  if (!app.globalData.imgCache) app.globalData.imgCache = {};
  return app.globalData.imgCache;
}

/* items: [{ path, url }]。path 是 setData 路径（如 'vm.groups[0].bgUrl'）。
   已缓存 → 校验本地文件仍在（微信可能清理临时文件）后再用，否则重新下载；
   未缓存 → 后台下载成功后覆盖，失败不动（保留远程 URL 兜底）。 */
function localize(page, items) {
  if (!page || !items || !items.length) return;
  const header = authHeader();
  const cache = store();

  function apply(path, localPath) {
    const d = {};
    d[path] = localPath;
    page.setData(d);
  }

  function fetchInto(path, url) {
    wx.downloadFile({
      url: url,
      header: header || {},
      success: (r) => {
        if (r.statusCode === 200 && r.tempFilePath) {
          cache[url] = r.tempFilePath;
          apply(path, r.tempFilePath);
        }
      },
      fail: () => {}
    });
  }

  function useCached(path, url) {
    const localPath = cache[url];
    let fs = null;
    try {
      fs = wx.getFileSystemManager && wx.getFileSystemManager();
    } catch (e) {
      fs = null;
    }
    if (!fs || !fs.access) {
      apply(path, localPath);
      return;
    }
    fs.access({
      path: localPath,
      success: () => apply(path, localPath),
      fail: () => {
        delete cache[url];
        fetchInto(path, url);
      }
    });
  }

  items.forEach((it) => {
    if (!it || !it.url) return;
    if (cache[it.url]) useCached(it.path, it.url);
    else fetchInto(it.path, it.url);
  });
}

/* 面板页 vm → 待落地清单 */
function fromIndexVm(vm) {
  const items = [];
  if (!vm) return items;
  /* 整页壁纸：和顶栏图一样必须落地（反代 BasicAuth 下 <image> 直接 401），
     否则「项目总背景」在反代连接里整片空白（1.0.11 修） */
  if (vm.wallpaperUrl) items.push({ path: 'vm.wallpaperUrl', url: vm.wallpaperUrl });
  if (vm.heroBgUrl) items.push({ path: 'vm.heroBgUrl', url: vm.heroBgUrl });
  (vm.groups || []).forEach((g, gi) => {
    if (g.bgUrl) items.push({ path: 'vm.groups[' + gi + '].bgUrl', url: g.bgUrl });
    (g.cards || []).forEach((c, ci) => {
      const base = 'vm.groups[' + gi + '].cards[' + ci + ']';
      if (c.bgUrl) items.push({ path: base + '.bgUrl', url: c.bgUrl });
      if (c.iconUrl) items.push({ path: base + '.iconUrl', url: c.iconUrl });
    });
  });
  return items;
}

/* 详情页 card → 待落地清单 */
function fromDetailCard(card) {
  const items = [];
  if (!card) return items;
  if (card.bgUrl) items.push({ path: 'card.bgUrl', url: card.bgUrl });
  if (card.iconUrl) items.push({ path: 'card.iconUrl', url: card.iconUrl });
  return items;
}

module.exports = { localize, fromIndexVm, fromDetailCard };

});

LD.define('utils/toast.js', function(require, module, exports) {
/* 弹提示的统一出口：微信 showLoading 与 showToast 共用同一个原生视图，
   hideLoading 之后立即 showToast 在真机上会被吞掉，必须延迟一拍再弹 */
function toast(opts) {
  setTimeout(() => {
    wx.showToast(Object.assign({ icon: 'none', duration: 2500 }, opts || {}));
  }, 80);
}

module.exports = { toast };

});

/* ===== app.js ===== */
(function(require, module, exports) {
/* LiteDock Mini — 全局状态与数据缓存
   小程序只做展示：外观、分组、壁纸等设置全部读取 Web 端 config.json，不写回。 */
const connection = require('./utils/connection.js');
const api = require('./utils/api.js');

App({
  globalData: {
    appName: 'LiteDock Mini',
    miniVersion: '1.0.21',
    state: null,
    stateAt: 0,
    connectionKey: ''
  },

  onLaunch() {
    connection.ensureDefaults();
    this.globalData.connectionKey = this.currentKey();
    /* APP 1.0.26：启动静默检查 APP 更新（每天一次，延迟 8s 不抢首屏）。
       只走原生插件；无插件（浏览器预览/小程序）自动跳过。 */
    if (typeof window !== 'undefined' && window.LD) {
      setTimeout(function () {
        try {
          const today = new Date().toISOString().slice(0, 10);
          if (localStorage.getItem('ld_app_update_day') === today) return;
          const C = window.Capacitor;
          const p = C && C.Plugins && C.Plugins.LiteDockHttp;
          if (!p || !p.fetchLatestRelease) return;
          localStorage.setItem('ld_app_update_day', today);
          p.fetchLatestRelease().then(function (res) {
            let body; try { body = JSON.parse(res.data); } catch (e) { return; }
            const tag = String(body.tag_name || '');
            const latest = String(body.tag_name || '').replace(/^app-v/i, '');
            const current = String(window.LD.APP_VERSION || '0.0.0');
            const cu = current.split('.').map(Number), lu = latest.split('.').map(Number);
            let newer = false;
            for (let i = 0; i < 3; i++) {
              if ((lu[i] || 0) > (cu[i] || 0)) { newer = true; break; }
              if ((lu[i] || 0) < (cu[i] || 0)) break;
            }
            if (newer) localStorage.setItem('ld_app_update_seen', latest);
          }).catch(function () {});
        } catch (e) {}
      }, 8000);
    }
  },

  currentKey() {
    const c = connection.getActive();
    return c ? c.id + '|' + c.url : 'none';
  },

  invalidate() {
    this.globalData.stateAt = 0;
  },

  /* 未填访问链接：不发任何网络请求，由页面显示空白引导。
     真实连接走 /api/state，15 秒内复用缓存。 */
  loadState(force) {
    const g = this.globalData;
    const now = Date.now();
    if (!connection.getActive()) {
      g.state = null;
      g.stateAt = 0;
      g.connectionKey = 'none';
      return Promise.resolve({ ok: true, data: null, noConnection: true });
    }
    if (!force && g.state && now - g.stateAt < 15000 && g.connectionKey === this.currentKey()) {
      return Promise.resolve({ ok: true, data: g.state, cached: true });
    }
    return api.getState().then((r) => {
      if (r.ok && r.data && r.data.ok !== false) {
        g.state = r.data;
        g.stateAt = now;
        g.connectionKey = this.currentKey();
        return { ok: true, data: r.data, cached: false };
      }
      const err = (r.data && r.data.error) || r.error || '读取失败';
      return { ok: false, error: err };
    });
  }
});

})(LD.makeRequire('app.js'), {exports:{}}, {});

/* ===== pages/index/index.js ===== */
LD.pageModule('index', function(require, module, exports) {
/* 容器面板：只读展示 Web 端的分组 / 折叠 / 壁纸 / 访问链接 */
const app = getApp();
const model = require('../../utils/model.js');
const api = require('../../utils/api.js');
const connection = require('../../utils/connection.js');
const imageloader = require('../../utils/imageloader.js');
const ui = require('../../utils/toast.js');

Page({
  data: {
    viewState: 'loading',
    vm: null,
    query: '',
    connName: '未连接',
    connColor: '#9aa3b2',
    errorMsg: '',
    emptyTitle: '',
    emptyDesc: '',
    emptyAction: '',
    collapsedKeys: [],
    expandedKeys: [],
    foldLoadedFor: ''
  },

  onShow() {
    this.load(false);
  },

  onPullDownRefresh() {
    this.load(true).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  /* 1.0.16：load(force, silent)。silent=true 为容器操作后的静默刷新——
     面板内容保持原位，数据到达后由 wx-shim 的 morph 做 DOM 级增量更新，
     不再把 viewState 切成 loading（此前点「停止」成功瞬间整个面板被
     loading 骨架替换再重绘，表现为强制刷新闪烁；操作已有 toast 反馈，
     整页 loading 属于多余设定）。首次进入 / 切连接保持原 loading 行为。 */
  load(force, silent) {
    const key = app.currentKey();
    const needInit = this.data.foldLoadedFor !== key;
    if (!silent && (force || needInit || this.data.viewState !== 'ready')) {
      this.setData({ viewState: 'loading' });
    }
    return app.loadState(force).then((r) => {
      if (r.noConnection) {
        this.setData({
          viewState: 'blank', vm: null, query: '', errorMsg: '',
          connName: '未连接', connColor: '#9aa3b2', foldLoadedFor: ''
        });
        return;
      }
      if (!r.ok) {
        /* 静默刷新失败不打断现有面板（数据还是旧的，内容仍有价值），仅提示 */
        if (silent) {
          wx.showToast({ title: '刷新失败，稍后下拉重试', icon: 'none' });
          return;
        }
        this.setData({ viewState: 'error', errorMsg: r.error || '读取失败' });
        this.refreshConn('#d0564a');
        return;
      }
      this.applyState(r.data, key, needInit);
    });
  },

  applyState(raw, key, needInit) {
    const cfg = raw.config || {};
    let collapsedKeys = this.data.collapsedKeys;
    let expandedKeys = this.data.expandedKeys;
    /* 折叠态来自 Web 端 config.json；小程序内的展开/收起只在本次会话生效，不写回 NAS */
    if (needInit) {
      collapsedKeys = Array.isArray(cfg.collapsedGroups) ? cfg.collapsedGroups.slice() : [];
      expandedKeys = Array.isArray(cfg.expandedProjects) ? cfg.expandedProjects.slice() : [];
    }
    const c = connection.getActive();
    const vm = model.buildViewModel(raw, {
      query: this.data.query,
      collapsedKeys,
      expandedKeys,
      nasHost: c ? c.host : '',
      baseUrl: c ? c.url : '',
      isProxy: !!(c && c.type === 'proxy')
    });

    let viewState = 'ready';
    let emptyTitle = '';
    let emptyDesc = '';
    let emptyAction = '';
    if (!vm.hasGroups) {
      viewState = 'empty';
      if (vm.searchActive) {
        emptyTitle = '没有匹配的容器';
        emptyDesc = '换个关键词试试，或清空搜索查看全部容器。';
        emptyAction = 'clear';
      } else {
        emptyTitle = '没有可显示的容器';
        emptyDesc = '当前 NAS 上没有容器，或所有容器都被设置为隐藏。';
      }
    }

    this.setData({
      vm,
      viewState,
      emptyTitle,
      emptyDesc,
      emptyAction,
      collapsedKeys,
      expandedKeys,
      foldLoadedFor: key
    });
    /* 壁纸 / 分组背景 / 卡片背景 / 容器图标：下载换本地路径（鉴权反代与真机 http 直显都会失败） */
    imageloader.localize(this, imageloader.fromIndexVm(vm));
    this.refreshConn();
  },

  refreshConn(colorOverride) {
    const c = connection.getActive();
    this.setData({
      connName: c ? c.name : '未连接',
      connColor: colorOverride || (c ? '#22b07d' : '#9aa3b2')
    });
  },

  rebuild() {
    const raw = app.globalData.state;
    if (!raw) return;
    this.applyState(raw, app.currentKey(), false);
  },

  onSearch(e) {
    this.setData({ query: e.detail.value || '' });
    this.rebuild();
  },

  clearSearch() {
    this.setData({ query: '' });
    this.rebuild();
  },

  toggleGroup(e) {
    const k = e.currentTarget.dataset.key;
    if (!k || k === '__search__') return;
    const keys = this.data.collapsedKeys.slice();
    const i = keys.indexOf(k);
    if (i >= 0) keys.splice(i, 1);
    else keys.push(k);
    this.setData({ collapsedKeys: keys });
    this.rebuild();
  },

  toggleProject(e) {
    const d = e.currentTarget.dataset;
    const pk = d.key + '::' + d.project;
    const keys = this.data.expandedKeys.slice();
    const i = keys.indexOf(pk);
    if (i >= 0) keys.splice(i, 1);
    else keys.push(pk);
    this.setData({ expandedKeys: keys });
    this.rebuild();
  },

  /* 1.0.15：项目整体启动/停止/重启，与 Web 项目卡一致。后端按依赖拓扑排序。 */
  projectAction(e) {
    const d = e.currentTarget.dataset;
    const proj = d.proj;
    const act = d.act;
    const label = { start: '启动', stop: '停止', restart: '重启' }[act] || act;
    const run = () => {
      wx.showLoading({ title: '执行中', mask: true });
      api.projectAction(proj, act).then((r) => {
        wx.hideLoading();
        if (r.ok && r.data && r.data.ok !== false) {
          wx.showToast({ title: label + '成功', icon: 'success' });
          /* 1.0.16：项目操作成功后静默刷新，面板不再整页闪 loading */
          app.invalidate();
          this.load(true, true);
        } else {
          const msg = (r.data && (r.data.message || r.data.error)) || r.error || '未知错误';
          wx.showModal({ title: label + '项目失败', content: msg, showCancel: false });
        }
      });
    };
    wx.showModal({
      title: '确认' + label + '项目',
      content: '确定要' + label + '项目「' + proj + '」下的全部容器吗？\n' +
        (act === 'stop' ? '依赖方会先停止。' : act === 'start' ? '被依赖的服务会先启动。' : '先停后起，按依赖顺序。'),
      confirmText: label,
      success: (res) => { if (res.confirm) run(); }
    });
  },

  copyLink(e) {
    let url = e.currentTarget.dataset.url || '';
    if (url.charAt(0) === '/') {
      const c = connection.getActive();
      url = (c ? c.url : '') + url;
    }
    wx.setClipboardData({ data: url });
    wx.showModal({
      title: '访问链接',
      content: url + '\n\n已复制，粘贴到浏览器即可打开。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  doAction(e) {
    const d = e.currentTarget.dataset;
    const id = d.id;
    const act = d.act;
    const name = d.name || '容器';
    const label = { start: '启动', stop: '停止', restart: '重启', unpause: '恢复' }[act] || act;
    const run = () => {
      wx.showLoading({ title: '执行中', mask: true });
      api.action(id, act).then((r) => {
        wx.hideLoading();
        if (r.ok && r.data && r.data.ok !== false) {
          wx.showToast({ title: label + '成功', icon: 'success' });
          /* 1.0.16：单容器操作成功后静默刷新（与项目操作一致），不闪 loading */
          app.invalidate();
          this.load(true, true);
        } else {
          wx.showModal({
            title: label + '失败',
            content: (r.data && r.data.error) || r.error || '未知错误',
            showCancel: false
          });
        }
      });
    };
    if (act === 'stop' || act === 'restart') {
      wx.showModal({
        title: '确认' + label,
        content: '确定要' + label + '「' + name + '」吗？',
        confirmText: label,
        success: (res) => { if (res.confirm) run(); }
      });
    } else {
      run();
    }
  },

  openDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(e.currentTarget.dataset.id) });
  },

  openLogs(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(e.currentTarget.dataset.id) + '&tab=logs' });
  },

  goConnect() {
    wx.navigateTo({ url: '/pages/connect/connect' });
  },

  /* 空白引导的主按钮：直达新增表单，不再让用户二次点「＋ 新增」 */
  addLink() {
    wx.navigateTo({ url: '/pages/connect/connect?add=1' });
  },

  handleRetry() {
    this.load(true).then(() => {
      /* 用户手点的重试必须给回音：失败了把原因弹出来（离线秒失败时 loading 一闪而过，肉眼等于没反应） */
      if (this.data.viewState === 'error') {
        ui.toast({ title: this.data.errorMsg || '连接失败', duration: 3000 });
      }
    });
  }
});

});

/* ===== pages/detail/detail.js ===== */
LD.pageModule('detail', function(require, module, exports) {
/* 容器详情：状态 / 资源 / 端口 / 日志 / 操作。配置一律在 Web 页面设置 */
const app = getApp();
const model = require('../../utils/model.js');
const api = require('../../utils/api.js');
const connection = require('../../utils/connection.js');
const imageloader = require('../../utils/imageloader.js');

Page({
  data: {
    found: false,
    id: '',
    card: null,
    shortId: '',
    image: '',
    projectText: '',
    networkText: '',
    ports: [],
    showPortCard: true,
    isProxy: false,
    logs: '',
    logsLoading: false,
    logAuto: true,
    updateText: ''
  },

  onLoad(options) {
    this.setData({ id: (options && options.id) || '' });
    this.init(options && options.tab === 'logs');
    this.refreshLogsQuiet();
    this._tickLogAuto();
  },

  onUnload() { this._stopLogAuto(); },
  onHide() { this._stopLogAuto(); },

  init(autoLogs) {
    const raw = app.globalData.state;
    if (raw) {
      this.build(raw, autoLogs);
      return;
    }
    app.loadState(false).then((r) => {
      if (r.noConnection) { this.setData({ found: false }); return; }
      if (r.ok) this.build(r.data, autoLogs);
      else this.setData({ found: false });
    });
  },

  build(raw, autoLogs) {
    if (!raw) { this.setData({ found: false }); return; }
    const c = (raw.containers || []).find((x) => x.id === this.data.id);
    if (!c) {
      this.setData({ found: false });
      return;
    }
    const cfg = raw.config || {};
    const conn = connection.getActive();
    const isProxy = !!(conn && conn.type === 'proxy');
    /* 1.0.16：「镜像更新」入口与 Web 的 inProject 同口径——项目内 ≥2 个容器
       且开启项目折叠时视为项目子容器（升级按钮隐藏，走项目卡整体管理）；
       单容器项目（filebrowser 这类 compose 单实例）与独立容器都显示。 */
    const proj = c.project || '';
    let inProject = false;
    if (proj) {
      const members = (raw.containers || []).filter((x) => (x.project || '') === proj);
      inProject = cfg.collapseProjects !== false && members.length >= 2;
    }
    const card = model.containerCard(c, cfg, conn ? conn.host : '', conn ? conn.url : '', '', isProxy);
    const ports = [];
    /* APP 1.0.8：B 开关开启时反代连接也显示端口表，与卡片保持一致 */
    const showPortRows = !isProxy || (typeof window !== 'undefined' && window.LD && LD.appPortsAlways && LD.appPortsAlways());
    if (showPortRows) {
      const seenPort = {};
      (c.ports || []).forEach((p) => {
        /* 双栈 NAS 的 /containers/json 会为同一映射返回 IPv4 + IPv6 两条，按宿主端口去重 */
        const key = String(p.host) + '/' + String(p.container) + '/' + String(p.proto || 'tcp');
        if (seenPort[key]) return;
        seenPort[key] = 1;
        ports.push({ label: String(p.host) + ' → ' + String(p.container), desc: (p.proto || 'tcp') + ' · ' + (p.ip || '0.0.0.0') });
      });
      if (!(c.ports || []).length && c.networkMode === 'host') {
        (c.exposedPorts || []).forEach((p) => {
          const key = 'host/' + String(p);
          if (seenPort[key]) return;
          seenPort[key] = 1;
          ports.push({ label: 'host · ' + String(p), desc: 'host 网络暴露端口' });
        });
      }
    }
    /* 1.0.17：「镜像更新」入口对全部容器开放（用户反馈：多容器项目成员详情页
       也应有检查更新）。检查更新是只读操作（registry 查 tag 比对），无风险；
       升级重建保留入口但项目成员会带显著警告（见 doUpgrade）。
       isStandalone 保留给模板控制提示文案。 */
    this.setData({
      found: true,
      card,
      shortId: c.shortId || String(c.id).slice(0, 12),
      image: c.image || c.imageShort || '',
      projectText: [c.project, c.service].filter(Boolean).join(' / ') || '独立容器',
      networkText: c.networkMode || 'bridge',
      ports,
      showPortCard: !isProxy || card.hasChips,
      isProxy,
      isStandalone: !inProject,
      inProject: inProject,
      /* 1.0.19：本体容器受自我保护——禁用容器操作与升级重建，保留检查更新/日志等只读项 */
      isSelf: c.isSelf === true,
      canUpgrade: true,
      updateText: ''
    });
    imageloader.localize(this, imageloader.fromDetailCard(card));
    wx.setNavigationBarTitle({ title: c.name });
    if (autoLogs) this.loadLogs();
  },

  copyLink(e) {
    let url = e.currentTarget.dataset.url || '';
    if (url.charAt(0) === '/') {
      const c = connection.getActive();
      url = (c ? c.url : '') + url;
    }
    wx.setClipboardData({ data: url });
    wx.showModal({
      title: '访问链接',
      content: url + '\n\n已复制，粘贴到浏览器即可打开。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  doAction(e) {
    const act = e.currentTarget.dataset.act;
    const label = { start: '启动', stop: '停止', restart: '重启', pause: '暂停', unpause: '恢复' }[act] || act;
    /* 1.0.19 自我保护前端兜底（后端亦有拦截）：本体禁止停止/重启/暂停 */
    if (this.data.isSelf && ['stop', 'restart', 'pause'].indexOf(act) >= 0) {
      wx.showModal({ title: '受保护', content: '这是 LiteDock 本体容器，禁止停止/重启/暂停自己（会导致管理界面中断）。', showCancel: false, confirmText: '知道了' });
      return;
    }
    const run = () => {
      wx.showLoading({ title: label + '中', mask: true });
      api.action(this.data.id, act).then((r) => {
        wx.hideLoading();
        if (r.ok && r.data && r.data.ok !== false) {
          wx.showToast({ title: label + '成功', icon: 'success' });
          this.reload();
        } else {
          this.showError(label + '失败', (r.data && r.data.error) || r.error);
        }
      });
    };
    if (act === 'stop' || act === 'restart' || act === 'pause') {
      wx.showModal({
        title: '确认' + label,
        content: '确定要' + label + '「' + this.data.card.name + '」吗？',
        confirmText: label,
        success: (res) => { if (res.confirm) run(); }
      });
    } else {
      run();
    }
  },

  checkUpdate() {
    wx.showLoading({ title: '检查中', mask: true });
    api.checkUpdate(this.data.id).then((r) => {
      wx.hideLoading();
      /* 1.0.17：结果弹窗反馈（用户反馈点了没提示）。原先只写进页面底部一行
         小字 updateText，注意力集中在按钮上根本看不到。
         服务端返回 {ok, hasUpdate, image, tag, oldId, newId, message}。 */
      const d = r.data || {};
      if (r.ok && d.ok) {
        /* 小字提示照旧保留（弹窗关闭后还能回看），但主要反馈走弹窗 */
        this.setData({ updateText: d.message || '检查完成' });
        wx.showModal({
          title: d.hasUpdate ? '发现新镜像' : '已是最新版本',
          content: d.hasUpdate
            ? String(d.message || ('当前 ' + (d.tag || '') + ' → 最新已发布，可在本卡「升级重建」更新。'))
            : String(d.message || '当前运行的就是最新版本，无需升级。'),
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        this.setData({ updateText: '检查超时或失败，服务端可能仍在执行，稍后可重试。' });
        wx.showModal({
          title: '检查更新失败',
          content: String((r.data && r.data.error) || r.error || '检查超时或失败，服务端可能仍在执行，稍后可重试。'),
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  doUpgrade() {
    /* 1.0.20 自我保护前端兜底：本体禁止升级重建（由 NAS 上更新 LiteDock 服务负责） */
    if (this.data.isSelf) {
      wx.showModal({ title: '受保护', content: '这是 LiteDock 本体容器，禁止在面板内升级重建自己。请在 NAS 上更新 LiteDock 服务容器。', showCancel: false, confirmText: '知道了' });
      return;
    }
    /* 1.0.17：多容器项目成员升级带显著警告——逐个重建可能与项目其它容器
       版本不匹配（Compose 项目应整体升级），让用户明确知道自己在干什么。 */
    const projWarn = this.data.inProject
      ? '\n\n⚠ 该容器属于多容器项目（' + (this.data.projectText || '') + '）：' +
        '逐个升级可能造成项目内版本不一致，建议优先用项目卡整体管理。确定仍要单独升级吗？'
      : '';
    wx.showModal({
      title: '升级重建容器',
      content: '会拉取新镜像、备份旧容器并用原配置重建。请求可能超过 60 秒，但 NAS 会继续执行完成，稍后回到面板下拉刷新确认结果。' + projWarn,
      confirmText: '开始升级',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '升级中', mask: true });
        api.upgrade(this.data.id).then((r) => {
          wx.hideLoading();
          const d = r.data || {};
          const msg = d.ok ? (d.changed === false ? '已是最新，无需重建' : '升级完成，请下拉刷新面板') : ((d.error || r.error || '未知错误'));
          wx.showModal({ title: d.ok ? '升级结果' : '升级未完成', content: String(msg), showCancel: false });
          this.reload();
        });
      }
    });
  },

  loadLogs() {
    this.setData({ logsLoading: true });
    api.getLogs(this.data.id, 100).then((r) => {
      if (r.ok && r.data && r.data.ok) {
        this.setData({ logs: r.data.text || '（无日志输出）', logsLoading: false });
      } else {
        this.setData({ logs: '读取日志失败：' + ((r.data && r.data.error) || r.error || '未知错误'), logsLoading: false });
      }
    });
  },

  /* 日志自动刷新：APP 的页面切换不触发标准 onUnload，用「当前实例 + DOM 是否还在」
     双重判据让旧定时器自然终止，避免详情页关掉后仍每 5 秒打一次接口。 */
  _tickLogAuto() {
    const self = this;
    this._logTimer = setTimeout(function () {
      const cur = (typeof LD !== 'undefined' && LD.pageInstance) ? LD.pageInstance('detail') : null;
      if (cur && cur !== self) { self._logTimer = null; return; }
      if (typeof document !== 'undefined' && !document.querySelector('.detail-page')) {
        self._logTimer = null; return;
      }
      if (!self.data.logAuto) { self._logTimer = null; return; }
      self.refreshLogsQuiet();
      self._tickLogAuto();
    }, 5000);
  },

  _stopLogAuto() {
    if (this._logTimer) { clearTimeout(this._logTimer); this._logTimer = null; }
  },

  toggleLogAuto() {
    const on = !this.data.logAuto;
    this.setData({ logAuto: on });
    this._stopLogAuto();
    if (on) this._tickLogAuto();
    wx.showToast({ title: on ? '日志每 5 秒自动刷新' : '已暂停自动刷新', icon: 'none' });
  },

  refreshLogsQuiet() {
    api.getLogs(this.data.id, 100).then((r) => {
      if (r.ok && r.data && r.data.ok) {
        this.setData({ logs: r.data.text || '（无日志输出）' });
      }
    });
  },

  reload() {
    app.invalidate();
    app.loadState(true).then((r) => {
      if (r.noConnection) { this.setData({ found: false }); return; }
      if (r.ok) this.build(r.data, false);
    });
  },

  showError(title, content) {
    wx.showModal({ title, content: String(content || '未知错误'), showCancel: false });
  },

  goBack() {
    wx.navigateBack({
      fail: () => { wx.switchTab({ url: '/pages/index/index' }); }
    });
  }
});

});

/* ===== pages/settings/settings.js ===== */
LD.pageModule('settings', function(require, module, exports) {
/* 设置：只管「访问链接」。外观与分组全部在 Web 页面设置，小程序只读同步 */
const app = getApp();
const connection = require('../../utils/connection.js');
const api = require('../../utils/api.js');
const ui = require('../../utils/toast.js');

Page({
  data: {
    linkDraft: '',
    linkStatus: '未连接',
    linkOk: false,
    linkType: '',
    testResult: '',
    testOk: false,
    /* 1.0.15：升级备份管理（升级独立容器后隐藏的旧版本，可回退/删除） */
    backups: [],
    backupLoaded: false
  },

  onShow() {
    this.load();
    this.loadBackups();
  },

  /* 1.0.15：拉取升级备份列表。设置页打开即加载，静默失败不影响其它设置。 */
  loadBackups() {
    api.getBackups().then((r) => {
      const list = (r.ok && r.data && r.data.backups) ? r.data.backups : [];
      this.setData({ backups: list, backupLoaded: true });
    }).catch(() => {
      this.setData({ backups: [], backupLoaded: true });
    });
  },

  backupRollback(e) {
    const d = e.currentTarget.dataset;
    const base = d.base || '该版本';
    wx.showModal({
      title: '确认回退',
      content: '确定回退到「' + base + '」的这个版本？\n\n· 当前运行的版本会改名保留为备份（不会丢失）\n· 选中的备份会改回原名并启动\n· 此操作会短暂中断该容器服务',
      confirmText: '回退',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '回退中', mask: true });
        api.backupRollback(d.id).then((r) => {
          wx.hideLoading();
          const body = r.data || {};
          if (r.ok && body.ok !== false) {
            wx.showToast({ title: '已回退', icon: 'success' });
            app.invalidate();
            this.loadBackups();
          } else {
            wx.showModal({ title: '回退失败', content: body.error || r.error || '未知错误', showCancel: false });
          }
        });
      }
    });
  },

  backupDelete(e) {
    const d = e.currentTarget.dataset;
    const base = d.base || '该备份';
    wx.showModal({
      title: '彻底删除备份',
      content: '确定彻底删除备份容器「' + base + '」？\n\n此操作不可恢复，删除后就无法再回退到这个版本了。',
      confirmText: '删除',
      confirmColor: '#e05252',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        api.backupDelete(d.id).then((r) => {
          wx.hideLoading();
          const body = r.data || {};
          if (r.ok && body.ok !== false) {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadBackups();
          } else {
            wx.showModal({ title: '删除失败', content: body.error || r.error || '未知错误', showCancel: false });
          }
        });
      }
    });
  },

  load() {
    const c = connection.getActive() || connection.list()[0] || null;
    this.setData({
      linkDraft: c ? c.url : '',
      linkStatus: c ? '当前：' + c.name + ' · ' + c.url : '未连接 · 填入访问链接后即可使用',
      linkOk: !!c,
      linkType: c ? connection.typeLabel(c.type) : '',
      testResult: ''
    });
  },

  onLinkInput(e) {
    const v = e.detail.value || '';
    const u = connection.normalizeUrl(v);
    this.setData({
      linkDraft: v,
      linkType: u ? connection.typeLabel(connection.inferType(u)) : '',
      testResult: ''
    });
  },

  testLink() {
    const u = connection.normalizeUrl(this.data.linkDraft);
    if (!u) {
      wx.showToast({ title: '请填写访问链接', icon: 'none' });
      return;
    }
    const c = connection.getActive() || connection.list()[0] || null;
    wx.showLoading({ title: '测试中', mask: true });
    api.probe(u, c ? c.header : '', c ? c.password : '').then((r) => {
      wx.hideLoading();
      this.setData({ testResult: r.message, testOk: r.ok });
      /* 结果必须弹出来：失败弹原因，成功弹确认（真机上小字容易被忽略） */
      ui.toast({ title: r.message, icon: r.ok ? 'success' : 'none', duration: r.ok ? 1800 : 3000 });
    });
  },

  saveLink() {
    const raw = String(this.data.linkDraft || '').trim();
    if (!raw) {
      wx.showToast({ title: '请填写访问链接', icon: 'none' });
      return;
    }
    const c = connection.getActive() || connection.list()[0] || null;
    const draft = {
      id: c ? c.id : '',
      name: c ? c.name : '',
      url: raw,
      host: c ? c.host : '',
      header: c ? c.header : '',
      password: c ? c.password : '',
      note: c ? c.note : ''
    };
    /* 首次添加且未命名：默认以宿主机命名（取 /api/info 的 name） */
    if (!c && !draft.name) {
      wx.showLoading({ title: '保存中', mask: true });
      api.fetchInfo(connection.normalizeUrl(raw), draft.header, draft.password).then((info) => {
        if (info && info.name) draft.name = info.name;
        wx.hideLoading();
        this._commit(draft);
      });
      return;
    }
    this._commit(draft);
  },

  _commit(draft) {
    const r = connection.save(draft);
    if (!r.ok) {
      wx.showToast({ title: r.error, icon: 'none' });
      return;
    }
    connection.setActive(r.value.id);
    app.invalidate();
    this.setData({
      linkDraft: r.value.url,
      linkStatus: '当前：' + r.value.name + ' · ' + r.value.url,
      linkOk: true,
      linkType: connection.typeLabel(r.value.type),
      testResult: ''
    });
    wx.showToast({ title: '已保存，正在读取 NAS', icon: 'none' });
    app.loadState(true).then((res) => {
      if (res.ok && !res.noConnection) this.setData({ linkStatus: '已连接：' + r.value.name + ' · ' + r.value.url });
      else this.setData({ linkStatus: '地址已保存，但读取失败：' + ((res && res.error) || '请点「测试连接」检查') });
    });
  },

  goConnect() {
    wx.navigateTo({ url: '/pages/connect/connect' });
  }
});

});

/* ===== pages/connect/connect.js ===== */
LD.pageModule('connect', function(require, module, exports) {
/* 连接管理：一个「访问链接」走天下，局域网 / 反向代理自动识别，高级项默认折叠 */
const app = getApp();
const connection = require('../../utils/connection.js');
const api = require('../../utils/api.js');
const ui = require('../../utils/toast.js');

function emptyForm() {
  return { id: '', name: '', url: '', host: '', header: '', password: '', note: '' };
}

function typeOfInput(value) {
  const u = connection.normalizeUrl(value);
  return u ? connection.typeLabel(connection.inferType(u)) : '';
}

Page({
  data: {
    connections: [],
    activeId: '',
    showForm: false,
    editingId: '',
    advanced: false,
    linkType: '',
    form: emptyForm(),
    nameTouched: false,
    probingName: false,
    testResult: '',
    testOk: false
  },

  onLoad(options) {
    if (options && options.add === '1') this.openAdd();
  },

  onShow() {
    this.reload();
  },

  reload() {
    const active = connection.getActive();
    const list = connection.list().map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      typeLabel: connection.typeLabel(c.type),
      url: c.url,
      note: c.note,
      isActive: !!active && active.id === c.id
    }));
    this.setData({
      connections: list,
      activeId: active ? active.id : ''
    });
  },

  openAdd() {
    this.setData({ showForm: true, editingId: '', advanced: false, linkType: '', form: emptyForm(), nameTouched: false, testResult: '' });
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const c = connection.list().find((x) => x.id === id);
    if (!c) return;
    this.setData({
      showForm: true,
      editingId: id,
      advanced: !!(c.header || c.note),
      linkType: typeOfInput(c.url),
      form: { id: c.id, name: c.name, url: c.url, host: c.host || '', header: c.header || '', password: c.password || '', note: c.note || '' },
      nameTouched: true,
      testResult: ''
    });
  },

  closeForm() {
    this.setData({ showForm: false, editingId: '', testResult: '' });
  },

  toggleAdvanced() {
    this.setData({ advanced: !this.data.advanced });
  },

  onField(e) {
    const field = e.currentTarget.dataset.field;
    const v = e.detail.value || '';
    const patch = {};
    patch['form.' + field] = v;
    patch.testResult = '';
    if (field === 'url') {
      patch.linkType = typeOfInput(v);
      const u = connection.normalizeUrl(v);
      if (u && !this.data.nameTouched && !this.data.probingName) this.tryPrefillName(u);
    } else if (field === 'name') {
      this.setData({ nameTouched: true });
    } else if (field === 'password' && v) {
      /* APP 补丁：密码填完后重试宿主机命名（首次 URL 预填时密码还没填 → 401） */
      const u2 = connection.normalizeUrl(this.data.form.url);
      if (u2 && !this.data.nameTouched) {
        const self = this;
        setTimeout(function () { self.tryPrefillName(u2); }, 0);
      }
    }
    this.setData(patch);
  },

  /* 新增连接时：用户没手填名称，则自动用「宿主机名」命名（取 /api/info 的 name） */
  tryPrefillName(url) {
    const cur = connection.getActive();
    this.setData({ probingName: true });
    api.fetchInfo(url, cur ? cur.header : '', this.data.form.password).then((info) => {
      this.setData({ probingName: false });
      if (info && info.name && !this.data.nameTouched) this.setData({ 'form.name': info.name });
    });
  },

  saveForm() {
    /* APP 补丁：名称仍为空时用已填的访问密码再取一次宿主机名，避免回退成 IP */
    const form = this.data.form || {};
    if (!String(form.name || '').trim() && String(form.password || '').trim() && form.url) {
      const self = this;
      wx.showLoading({ title: '保存中', mask: true });
      const probe = api.fetchInfo(connection.normalizeUrl(form.url), form.header || '', form.password);
      Promise.race([probe, new Promise((r) => setTimeout(() => r(null), 3000))]).then((info) => {
        wx.hideLoading();
        if (info && info.name && !String(self.data.form.name || '').trim()) {
          self.data.form.name = info.name;
        }
        self._saveNow();
      });
      return;
    }
    this._saveNow();
  },

  _saveNow() {
    const r = connection.save(this.data.form);
    if (!r.ok) {
      wx.showToast({ title: r.error, icon: 'none' });
      return;
    }
    connection.setActive(r.value.id);
    app.invalidate();
    this.setData({ showForm: false, editingId: '', form: emptyForm(), linkType: '', testResult: '' });
    this.reload();
    wx.showToast({ title: '已保存并切换', icon: 'success' });
  },

  setActive(e) {
    connection.setActive(e.currentTarget.dataset.id);
    app.invalidate();
    this.reload();
    wx.showToast({ title: '已切换连接', icon: 'none' });
  },

  removeConn(e) {
    const id = e.currentTarget.dataset.id;
    const c = connection.list().find((x) => x.id === id);
    wx.showModal({
      title: '删除访问链接',
      content: '确定删除「' + (c ? c.name : id) + '」吗？只删除本机保存的地址，不影响 NAS。',
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return;
        connection.remove(id);
        app.invalidate();
        this.reload();
      }
    });
  },

  testForm() {
    const r = connection.validate(this.data.form);
    if (!r.ok) {
      this.setData({ testResult: r.error, testOk: false });
      ui.toast({ title: r.error, duration: 2500 });
      return;
    }
    this.doTest(r.value.url, r.value.header, r.value.password);
  },

  testSaved(e) {
    const c = connection.list().find((x) => x.id === e.currentTarget.dataset.id);
    if (c) this.doTest(c.url, c.header, c.password);
  },

  doTest(base, rawHeader, password) {
    wx.showLoading({ title: '测试中', mask: true });
    api.probe(base, rawHeader, password).then((r) => {
      wx.hideLoading();
      this.setData({ testResult: r.message, testOk: r.ok });
      /* 结果必须弹出来：失败弹原因，成功弹确认 */
      ui.toast({ title: r.message, icon: r.ok ? 'success' : 'none', duration: r.ok ? 1800 : 3000 });
    });
  }
});

});

/* ===== pages/about/about.js ===== */
LD.pageModule('about', function(require, module, exports) {
/* 关于：运行环境、当前连接、许可与来源 */
const app = getApp();
const connection = require('../../utils/connection.js');

Page({
  data: {
    miniVersion: '1.0.21',
    appVersion: '–',
    envRows: [],
    connRows: [],
    updateState: '',
    updateAvailable: false,
    updateInfo: null
  },

  onShow() {
    this.load();
    if (this._showSilentHint) this._showSilentHint();
  },

  load() {
    const c = connection.getActive();
    this.setData({
      miniVersion: app.globalData.miniVersion,
      connRows: [
        { k: '连接名称', v: c ? c.name : '未配置' },
        { k: '访问链接', v: c ? c.url : '未填写' },
        { k: '识别方式', v: c ? connection.typeLabel(c.type) : '–' },
        { k: '容器链接主机', v: c ? c.host : '–' }
      ]
    });
    app.loadState(false).then((r) => {
      if (r.noConnection) {
        this.setData({ appVersion: '未连接', envRows: [{ k: '提示', v: '填写访问链接后显示 NAS 的真实环境信息' }] });
        return;
      }
      if (!r.ok) {
        this.setData({ appVersion: '读取失败', envRows: [{ k: '错误', v: r.error || '无法读取 /api/state' }] });
        return;
      }
      this.fill(r.data);
    });
  },

  fill(raw) {
    if (!raw) {
      this.setData({ appVersion: '未连接', envRows: [{ k: '提示', v: '填写访问链接后显示 NAS 的真实环境信息' }] });
      return;
    }
    const i = raw.info || {};
    this.setData({
      appVersion: raw.appVersion || '–',
      envRows: [
        { k: '宿主机', v: i.name || '–' },
        { k: '操作系统', v: i.os || '–' },
        { k: '内核', v: i.kernel || '–' },
        { k: '架构', v: i.arch || '–' },
        { k: 'Docker 版本', v: i.version || '–' },
        { k: 'Engine API', v: i.apiVersion || i.apiPath || '–' },
        { k: '数据源', v: i.socket || '/var/run/docker.sock' },
        { k: '镜像数', v: i.images == null ? '–' : String(i.images) },
        { k: '容器数', v: (raw.containers || []).length + ' 个' }
      ]
    });
  },

  refresh() {
    app.invalidate();
    app.loadState(true).then((r) => {
      if (r.noConnection) {
        wx.showToast({ title: '请先填写访问链接', icon: 'none' });
        return;
      }
      if (r.ok) this.fill(r.data);
      wx.showToast({ title: r.ok ? '已刷新' : '刷新失败', icon: 'none' });
    });
  },

  /* APP 1.0.26：GitHub Release 自更新（原生严格 TLS + SHA-256 校验） */
  _cmpVer(a, b) {
    const pa = String(a || '').replace(/^v/i, '').split('.').map(Number);
    const pb = String(b || '').replace(/^v/i, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  },

  _updatePlugin() {
    try {
      /* bundle 模块作用域里没有 global（shim 用闭包传参），只能读 window */
      const C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.LiteDockHttp) || null;
    } catch (e) { return null; }
  },

  /* 启动静默检查只写 ld_app_update_seen，关于页打开时读出来提示 */
  _showSilentHint() {
    const seen = localStorage.getItem('ld_app_update_seen');
    if (seen) {
      this.setData({ updateState: '发现新版本 ' + seen + '，可点击检查更新后安装', updateAvailable: false });
    }
  },

  checkAppUpdate(silent) {
    const self = this;
    const plugin = this._updatePlugin();
    const current = (window.LD && window.LD.APP_VERSION) || '0.0.0';
    if (!plugin || !plugin.fetchLatestRelease) {
      if (!silent) this.setData({ updateState: '当前环境不支持自动更新，请到 GitHub Releases 手动下载' });
      return Promise.resolve({ ok: false });
    }
    return plugin.fetchLatestRelease().then((res) => {
      let body;
      try { body = JSON.parse(res.data); } catch (e) { throw new Error('解析版本信息失败'); }
      const tag = String(body.tag_name || '');
      const latest = tag.replace(/^app-v/i, '');
      const asset = (body.assets || []).find((a) =>
        /\.apk$/i.test(a.name || '') && /^sha256:[0-9a-f]{64}$/i.test(a.digest || ''));
      if (!asset) throw new Error('未找到带校验值的 APK');
      if (this._cmpVer(latest, current) <= 0) {
        self.setData({ updateState: '已是最新版本 ' + current, updateAvailable: false, updateInfo: null });
        if (!silent) wx.showToast({ title: '已是最新版本', icon: 'none' });
        return { ok: true, hasUpdate: false };
      }
      const info = {
        version: latest,
        tag: tag,
        url: asset.browser_download_url,
        sha256: String(asset.digest).replace(/^sha256:/i, ''),
        size: asset.size
      };
      self.setData({ updateState: '发现新版本 ' + latest + '，点击下方按钮下载安装', updateAvailable: true, updateInfo: info });
      try { localStorage.setItem('ld_app_update_seen', latest); } catch (e) {}
      if (!silent) {
        wx.showModal({
          title: '发现新版本 ' + latest,
          content: '新版已发布到 GitHub Releases。下载将校验 SHA-256，安装需系统确认。',
          confirmText: '去更新',
          success(r) { if (r.confirm) self.installAppUpdate(); }
        });
      }
      return { ok: true, hasUpdate: true, info: info };
    }).catch((err) => {
      if (!silent) {
        self.setData({ updateState: '检查失败：' + ((err && err.message) || err) });
        wx.showToast({ title: '检查更新失败', icon: 'none' });
      }
      return { ok: false, error: String((err && err.message) || err) };
    });
  },

  installAppUpdate() {
    const info = this.data.updateInfo;
    if (!info) { wx.showToast({ title: '请先检查更新', icon: 'none' }); return; }
    const plugin = this._updatePlugin();
    if (!plugin || !plugin.downloadApk || !plugin.installApk) {
      wx.showToast({ title: '当前环境不支持安装', icon: 'none' });
      return;
    }
    const self = this;
    this.setData({ updateState: '正在下载 ' + info.version + '…（校验通过后安装）', updateAvailable: false });
    wx.showLoading({ title: '下载中', mask: true });
    plugin.downloadApk({ url: info.url, sha256: info.sha256 }).then((r) => {
      wx.hideLoading();
      return plugin.installApk({ path: r.path }).then((ins) => {
        if (ins && ins.need_permission) {
          self.setData({ updateState: '请允许安装未知应用后，再点「下载并安装」', updateAvailable: true });
        } else {
          self.setData({ updateState: '安装包已校验，等待系统安装…', updateAvailable: false });
        }
        return ins;
      });
    }).catch((err) => {
      wx.hideLoading();
      self.setData({ updateState: '下载或校验失败：' + ((err && err.message) || err), updateAvailable: true });
      wx.showToast({ title: '更新失败', icon: 'none' });
    });
  }
});

});

