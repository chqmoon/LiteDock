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
  const out = [];
  const seen = {};
  list.forEach((c) => {
    const custom = normLink((cfg.links || {})[c.name]);
    if (custom && !seen[custom]) {
      seen[custom] = 1;
      out.push({ label: shortLabel(custom), url: custom, custom: true });
    }
    /* 反向代理连接下宿主 IP:端口 根本打不开，1.0.6 起不显示端口映射，只保留自定义链接 */
    if (isProxy) return;
    (c.ports || []).forEach((p) => {
      const u = portUrl(p.host, cfg, nasHost);
      if (!seen[u]) {
        seen[u] = 1;
        out.push({ label: String(p.host) + '→' + String(p.container), url: u, custom: false });
      }
    });
    const isHost = c.networkMode === 'host';
    if (!(c.ports || []).length && isHost) {
      (c.exposedPorts || []).forEach((p) => {
        const u = portUrl(p, cfg, nasHost);
        if (!seen[u]) {
          seen[u] = 1;
          out.push({ label: 'host · ' + String(p), url: u, custom: false });
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
