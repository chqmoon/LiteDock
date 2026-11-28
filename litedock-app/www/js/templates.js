/* LiteDock App — WXML 1:1 网页模板
   类名 / 层级 / 条件渲染 / 绑定字段与 litedock-miniprogram 的 pages 各页 WXML 完全一致。
   映射：<view>→<div>  <text>→<span>  <image>→<img>  <block>→无
        bindtap/catchtap → data-ev(+data-catch)   bindinput → data-input
*/
(function (global) {
  'use strict';
  var LD = global.LD;
  var T = LD.templates = {};

  function e(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attr(v) { return e(v); }
  function n(v) { return Number(v) || 0; }

  /* ---------------- 面板 index ---------------- */
  function bgLayer(vm) {
    if (!vm.wallpaperUrl) return '';
    return '<div class="page-bg-base"></div>' +
      '<img class="page-bg" src="' + attr(vm.wallpaperUrl) + '" style="filter:blur(' + n(vm.wallpaperBlur) + 'px)">' +
      '<div class="page-bg-mask" style="background:linear-gradient(160deg,rgba(8,14,30,.34),rgba(10,16,34,.06) 45%,rgba(8,14,30,.4)),rgba(8,12,26,' + n(vm.wallpaperMask) + ')"></div>';
  }

  function welcome() {
    return '<div class="welcome">' +
      '<img class="welcome-mark" src="assets/logo.png">' +
      '<span class="welcome-title">还没有连接 LiteDock</span>' +
      '<span class="welcome-desc">填入 NAS 的访问链接，就能看到容器、分组和运行状态。</span>' +
      '<div class="welcome-eg">' +
        '<div class="welcome-eg-row"><span class="welcome-eg-k">局域网</span><span class="welcome-eg-v">http://192.168.1.100:23000</span></div>' +
        '<div class="welcome-eg-row"><span class="welcome-eg-k">外网 / 反代</span><span class="welcome-eg-v">https://nas.example.com</span></div>' +
      '</div>' +
      '<button class="btn btn-primary welcome-btn" data-ev="addLink" data-catch="1">填写访问链接</button>' +
    '</div>';
  }

  function hero(vm, d) {
    return '<div class="hero ' + (vm.heroBgUrl ? 'hero-has-bg' : '') + '">' +
      (vm.heroBgUrl ? '<img class="hero-bg" src="' + attr(vm.heroBgUrl) + '" style="filter:blur(' + n(vm.heroBlur) + 'px)"><div class="hero-mask"></div>' : '') +
      '<div class="hero-inner">' +
        '<div class="row-between">' +
          '<div class="grow"><span class="hero-title">' + e(vm.title) + '</span><span class="hero-sub">' + e(vm.subtitle) + '</span></div>' +
          '<div class="conn-badge" data-ev="goConnect" data-catch="1"><span class="led" style="background:' + attr(d.connColor) + '"></span><span>' + e(d.connName) + '</span><span class="conn-arrow">›</span></div>' +
        '</div>' +
        '<div class="stat-panel">' +
          '<div class="stat"><span class="stat-label"><span class="stat-dot s-green"></span>运行中</span><span class="stat-num">' + e(vm.running) + '</span></div>' +
          '<div class="stat"><span class="stat-label"><span class="stat-dot s-indigo"></span>容器总数</span><span class="stat-num">' + e(vm.total) + '</span></div>' +
          '<div class="stat"><span class="stat-label"><span class="stat-dot s-teal"></span>分组</span><span class="stat-num">' + e(vm.groupCount) + '</span></div>' +
          '<div class="stat"><span class="stat-label"><span class="stat-dot s-slate"></span>宿主机</span><span class="stat-num stat-num-sm">' + e(vm.hostName) + '</span></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function searchBar(d) {
    return '<div class="search-bar">' +
      '<span class="search-icon">⌕</span>' +
      '<input class="search-input" value="' + attr(d.query) + '" placeholder="搜索容器 / 镜像 / 项目" data-k="search-input" data-input="onSearch">' +
      (d.query ? '<span class="search-clear" data-ev="clearSearch" data-catch="1">×</span>' : '') +
    '</div>';
  }

  function stateCard(icon, title, desc, buttons) {
    return '<div class="state-card"><span class="state-icon">' + icon + '</span>' +
      '<span class="state-title">' + e(title) + '</span>' +
      '<span class="state-desc">' + e(desc) + '</span>' + (buttons || '') + '</div>';
  }

  function chipsHtml(card, catchAttr) {
    return (card.chips || []).map(function (chip) {
      /* 1.0.7：端口类 chip 带 data-state，供 APP 判断容器是否已停止。
         用户手配的快捷访问不带 state（undefined → 不输出属性），始终可点。 */
      var stateAttr = chip.state ? ' data-state="' + attr(chip.state) + '"' : '';
      /* 1.0.8：区分「外网访问链接」(custom) 与「容器端口」(port)。
         两个开关的组合是否真的生效，靠这个属性在真实浏览器里逐项断言。 */
      var kind = chip.custom ? 'custom' : 'port';
      return '<div class="chip port-chip" data-kind="' + kind + '" data-k="u-' + attr(chip.url) + '" data-ev="copyLink" data-url="' + attr(chip.url) + '"' + stateAttr + ' ' + catchAttr + '>' + e(chip.label) + '</div>';
    }).join('');
  }

  function metersHtml(card) {
    return '<div class="meters">' +
      '<div class="meter"><div class="meter-label"><span>CPU</span><span class="strong">' + e(card.cpuText) + '</span></div>' +
        '<div class="bar"><div class="bar-fill ' + (card.cpuWarn ? 'warn' : '') + '" style="width:' + attr(card.cpuWidth) + '"></div></div></div>' +
      '<div class="meter"><div class="meter-label"><span>内存</span><span class="strong">' + e(card.memText) + '</span></div>' +
        '<div class="bar"><div class="bar-fill ' + (card.memWarn ? 'warn' : '') + '" style="width:' + attr(card.memWidth) + '"></div></div></div>' +
    '</div>';
  }

  function containerCard(card) {
    var bg = card.hasBg
      ? '<img class="ct-bg" src="' + attr(card.bgUrl) + '" style="filter:blur(' + n(card.bgBlur) + 'px)">' +
        '<div class="ct-mask" style="background:rgba(10,16,34,' + n(card.bgMask) + ')"></div>'
      : '';
    var icon = '<div class="ct-icon" style="background:' + attr(card.iconBg) + ';color:' + attr(card.iconColor) + '">' +
      (card.iconUrl ? '<img class="ct-icon-img' + (card.iconIsCustom ? ' icon-custom' : '') + '" src="' + attr(card.iconUrl) + '">' : '<span>' + e(card.iconText) + '</span>') + '</div>';
    var ports = card.portsVisible
      ? '<div class="ports"><span class="ports-label">访问链接</span><div class="chips">' +
          chipsHtml(card, 'data-catch="1"') +
          (!card.hasChips ? '<span class="no-port">' + e(card.noPortText) + '</span>' : '') +
        '</div></div>'
      : '';
    return '<div class="ct ' + (card.hasBg ? 'has-bg' : '') + '" data-k="ct-' + attr(card.id) + '" data-ev="openDetail" data-id="' + attr(card.id) + '">' +
      bg +
      '<div class="ct-top">' + icon +
        '<div class="grow ct-meta"><span class="ct-name">' + e(card.name) + '</span><span class="ct-image">' + e(card.imageShort) + '</span></div>' +
        '<div class="ct-state"><span class="led" style="background:' + attr(card.ledColor) + '"></span><span>' + e(card.stateText) + '</span>' +
          (card.isSelf ? '<span class="self-flag" title="运行管理面板的容器，已禁用停止/重启/升级">◆ 本体</span>' : '') +
        '</div>' +
      '</div>' +
      '<span class="ct-status">' + e(card.status) + '</span>' +
      metersHtml(card) + ports +
      '<div class="ct-ops">' +
        (card.isSelf
          ? '<div class="op-cell"><span class="op op-disabled self-tip">本体受保护</span></div>' +
            '<div class="op-cell"><button class="op" data-ev="openDetail" data-catch="1" data-id="' + attr(card.id) + '">详情</button></div>'
          : '<div class="op-cell"><button class="op ' + (card.primary.style === 'primary' ? 'op-primary' : '') + '" data-ev="doAction" data-catch="1" data-id="' + attr(card.id) + '" data-act="' + attr(card.primary.key) + '" data-name="' + attr(card.name) + '">' + e(card.primary.label) + '</button></div>' +
            '<div class="op-cell"><button class="op" data-ev="doAction" data-catch="1" data-id="' + attr(card.id) + '" data-act="restart" data-name="' + attr(card.name) + '">重启</button></div>' +
            '<div class="op-cell"><button class="op" data-ev="openDetail" data-catch="1" data-id="' + attr(card.id) + '">详情</button></div>') +
      '</div>' +
    '</div>';
  }

  function projectCard(card) {
    /* 1.0.16：项目折叠卡背景——与单容器卡完全同一套结构（ct-bg + ct-mask + has-bg），
       数据来自 model.projectCard 新增的 hasBg/bgUrl/bgMask/bgBlur（取项目第一个容器的
       卡片背景，与 Web 1.0.20 同口径）。此前项目卡模板从未输出背景标记。 */
    var bg = card.hasBg
      ? '<img class="ct-bg" src="' + attr(card.bgUrl) + '" style="filter:blur(' + n(card.bgBlur) + 'px)">' +
        '<div class="ct-mask" style="background:rgba(10,16,34,' + n(card.bgMask) + ')"></div>'
      : '';
    var icon = '<div class="ct-icon" style="background:' + attr(card.iconBg) + ';color:' + attr(card.iconColor) + '">' +
      (card.iconUrl ? '<img class="ct-icon-img' + (card.iconIsCustom ? ' icon-custom' : '') + '" src="' + attr(card.iconUrl) + '">' : '<span>' + e(card.iconText) + '</span>') + '</div>';
    var ports = card.portsVisible
      ? '<div class="ports"><span class="ports-label">访问链接</span><div class="chips">' +
          chipsHtml(card, 'data-catch="1"') + (!card.hasChips ? '<span class="no-port">无对外端口</span>' : '') +
        '</div></div>'
      : '';
    return '<div class="ct ct-project ' + (card.hasBg ? 'has-bg' : '') + '" data-k="p-' + attr(card.groupKey) + '-' + attr(card.project) + '">' +
      bg +
      '<div class="ct-top">' + icon +
        '<div class="grow ct-meta"><span class="ct-name">' + e(card.name) + '</span><span class="ct-image">Compose 项目 · ' + e(card.count) + ' 个容器</span></div>' +
        '<div class="ct-state"><span class="led" style="background:' + attr(card.stateColor) + '"></span><span>' + e(card.runningText) + '</span></div>' +
      '</div>' +
      /* 1.0.12：项目卡与单容器卡显示完全一致——CPU/内存走同一套条形图组件
         （标签固定「CPU」「内存」，值 cpu% / fmtBytes(memUsed)）。此前是一行
         「CPU x% · 内存 xxx」小字，和单容器卡的两条 meter 不一致。extraChips
         信息移到端口区下方保留，不丢功能。 */
      /* 1.0.14：项目卡状态行与 Web 同源——启动时间取 Up 最久容器（同长优先带
         (healthy)），位置在资源条上面与单容器卡一致；项目内有没启动/unhealthy
         的容器时加橙色 ⚠ 警告，避免只看最长那个误以为整个项目都健康。 */
      '<span class="ct-status' + (card.statusWarn ? ' status-warn' : '') + '">' +
        e(card.statusText || '') +
        (card.statusWarn ? '<span class="status-warn-tag">⚠ ' + e(card.statusIssues) + ' 个容器异常</span>' : '') +
        (card.extraChips ? e(card.extraChips) : '') + '</span>' +
      metersHtml(card) +
      ports +
      /* 1.0.15：项目卡也能整体启动/停止/重启其下全部容器，与 Web 端一致。
         后端按 compose depends_on 拓扑排序，避免依赖未就绪导致启动失败。 */
      '<div class="op-grid project-ops">' +
        '<div class="op-cell"><button class="op" data-ev="projectAction" data-catch="1" data-act="start" data-proj="' + attr(card.project) + '">启动</button></div>' +
        '<div class="op-cell"><button class="op" data-ev="projectAction" data-catch="1" data-act="stop" data-proj="' + attr(card.project) + '">停止</button></div>' +
        '<div class="op-cell"><button class="op" data-ev="projectAction" data-catch="1" data-act="restart" data-proj="' + attr(card.project) + '">重启</button></div>' +
      '</div>' +
      '<button class="op op-primary op-full" data-ev="toggleProject" data-catch="1" data-key="' + attr(card.groupKey) + '" data-project="' + attr(card.project) + '">' + e(card.toggleLabel) + '</button>' +
    '</div>';
  }

  /* 1.0.10：所有分组统一走「有背景」视觉（雷池分组现在的样子）——白字、玻璃卡。
     有自定义背景图的分组继续用图；没有的按分组 key 分配一个稳定主题色，
     生成暮色渐变背景，保证各组配色各异、新增分组也自动适用。 */
  var GROUP_PALETTE = ['#e0674c', '#7c6cff', '#2fa08a', '#c2568f', '#3a86c8', '#d0903a', '#6a5acd', '#4a9e5c'];
  var DEFAULT_ACCENTS = ['#6c7cff', '#7c8cff'];
  function shade(hex, factor) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-f]{6}$/i.test(h)) return '#1a2340';
    var r = parseInt(h.slice(0, 2), 16), gg = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    function c(x) { return ('0' + Math.round(Math.max(0, Math.min(255, x * factor))).toString(16)).slice(-2); }
    return '#' + c(r) + c(gg) + c(b);
  }
  /* 全局统一分配：先锁定各分组显式配的强调色，没配的再从调色板挑一个没被占用、
     且彼此不同的色。只按 key 独立取哈希会撞色（实测影音服务和雷池都分到 #e0674c）。 */
  function assignGroupThemes(groups) {
    var used = {};
    (groups || []).forEach(function (g) {
      var a = String(g.accent || '').toLowerCase();
      if (a && DEFAULT_ACCENTS.indexOf(a) < 0) used[a] = 1;
    });
    (groups || []).forEach(function (g) {
      g._theme = '';
      if (g.hasBg) return;                       /* 有自定义背景图：保留原图与原色 */
      var a = String(g.accent || '').toLowerCase();
      if (a && DEFAULT_ACCENTS.indexOf(a) < 0) { g._theme = a; return; }
      var s = String(g.key == null ? '' : g.key), h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      var chosen = '';
      for (var k = 0; k < GROUP_PALETTE.length; k++) {
        var cand = GROUP_PALETTE[(h + k) % GROUP_PALETTE.length];
        if (!used[cand]) { chosen = cand; break; }
      }
      if (!chosen) chosen = GROUP_PALETTE[h % GROUP_PALETTE.length];
      used[chosen] = 1;
      g._theme = chosen;
    });
  }
  function groupHtml(g) {
    var theme = g._theme || '';
    var bg;
    if (g.hasBg) {
      bg = '<img class="group-bg" src="' + attr(g.bgUrl) + '" style="filter:blur(' + n(g.bgBlur) + 'px)">' +
        '<div class="group-mask" style="background:rgba(10,16,34,' + n(g.bgMask) + ')"></div>';
    } else {
      /* 无图分组：暮色渐变（主题色 → 深一档 → 更深），叠同样的遮罩保证白字可读 */
      bg = '<div class="group-bg group-auto-bg" style="background:linear-gradient(135deg,' +
        theme + ' 0%,' + shade(theme, .62) + ' 46%,' + shade(theme, .32) + ' 100%)"></div>' +
        '<div class="group-mask" style="background:rgba(10,16,34,' + n(g.bgMask) + ')"></div>';
    }
    var visualBg = g.hasBg || !!theme;   /* 1.0.10：所有分组都带背景，统一走 has-bg 视觉 */
    var barColor = theme || g.accent;
    var body;
    if (g.collapsed) {
      body = '<div class="group-folded">' + e(g.hint) + '</div>';
    } else {
      body = (g.cards || []).map(function (c) { return c.isContainer ? containerCard(c) : projectCard(c); }).join('') +
        (!g.cards || g.cards.length === 0 ? '<div class="group-folded">这个分组还没有容器</div>' : '');
    }
    return '<div class="group ' + (visualBg ? 'has-bg' : '') + '" data-k="g-' + attr(g.key) + '">' + bg +
      '<div class="group-inner">' +
        '<div class="group-head" data-ev="toggleGroup" data-key="' + attr(g.key) + '" data-catch="1">' +
          '<div class="group-bar" style="background:' + attr(barColor) + '"></div>' +
          '<div class="grow"><span class="group-title">' + e(g.label) + '</span><span class="group-sub">' + e(g.count) + ' 个容器 · ' + e(g.running) + ' 运行中</span></div>' +
          (g.canFold ? '<span class="group-toggle ' + (g.collapsed ? 'is-on' : '') + '">' + e(g.toggleText) + '</span>' : '') +
        '</div>' +
        body +
      '</div>' +
    '</div>';
  }

  T.index = function (d) {
    var vm = d.vm || {};
    var head = '<div class="page index-page ' + (vm.wallpaperUrl ? 'has-wall' : '') + '">' + bgLayer(vm) + '<div class="content">';
    if (d.viewState === 'blank') return head + welcome() + '</div></div>';

    var body = hero(vm, d) + searchBar(d);
    if (d.viewState === 'loading') {
      body += stateCard('◌', '正在连接 NAS', '读取容器列表与外观配置…');
    } else if (d.viewState === 'error') {
      body += stateCard('!', '连接失败', d.errorMsg,
        '<button class="btn btn-primary" data-ev="handleRetry" data-catch="1">重新加载</button>' +
        '<div class="state-gap"></div>' +
        '<button class="btn btn-ghost" data-ev="goConnect" data-catch="1">检查访问链接</button>');
    } else if (d.viewState === 'empty') {
      body += stateCard('○', d.emptyTitle, d.emptyDesc,
        d.emptyAction === 'clear' ? '<button class="btn btn-ghost" data-ev="clearSearch" data-catch="1">清空搜索</button>' : '');
    } else {
      assignGroupThemes(vm.groups);
      body += (vm.groups || []).map(groupHtml).join('');
      body += '<div class="foot-note"><span>LiteDock · 下拉刷新</span></div>';
    }
    return head + body + '</div></div>';
  };

  /* ---------------- 详情 detail ---------------- */
  T.detail = function (d) {
    if (!d.found) {
      return '<div class="page detail-page">' + stateCard('!', '找不到这个容器',
        '容器可能已被删除或重建，请返回面板下拉刷新后再试。',
        '<button class="btn btn-primary" data-ev="goBack" data-catch="1">返回面板</button>') + '</div>';
    }
    var c = d.card || {};
    var bg = c.hasBg
      ? '<img class="detail-ov-bg" src="' + attr(c.bgUrl) + '" style="filter:blur(' + n(c.bgBlur) + 'px)">' +
        '<div class="detail-ov-mask" style="background:rgba(10,16,34,' + n(c.bgMask) + ')"></div>'
      : '';
    var icon = '<div class="ct-icon" style="background:' + attr(c.iconBg) + ';color:' + attr(c.iconColor) + '">' +
      (c.iconUrl ? '<img class="ct-icon-img' + (c.iconIsCustom ? ' icon-custom' : '') + '" src="' + attr(c.iconUrl) + '">' : '<span>' + e(c.iconText) + '</span>') + '</div>';
    var kv = function (k, v, mono) {
      return '<div class="kv"><span class="kv-k">' + e(k) + '</span><span class="kv-v ' + (mono ? 'kv-mono' : '') + '">' + e(v) + '</span></div>';
    };

    var overview = '<div class="card detail-overview ' + (c.hasBg ? 'has-bg' : '') + '">' + bg +
      '<div class="row">' + icon +
        '<div class="grow ct-meta"><span class="ct-name">' + e(c.name) + '</span><span class="ct-image">' + e(c.imageShort) + '</span></div>' +
        '<div class="ct-state"><span class="led" style="background:' + attr(c.ledColor) + '"></span><span>' + e(c.stateText) + '</span>' +
          (c.isSelf ? '<span class="self-flag" title="运行管理面板的容器，已禁用停止/重启/升级">◆ 本体</span>' : '') +
        '</div>' +
      '</div><div class="divider"></div>' +
      kv('运行状态', c.status) + kv('容器 ID', d.shortId, true) + kv('镜像', d.image) +
      kv('Compose 项目', d.projectText) + kv('网络模式', d.networkText) + '</div>';

    var res = '<div class="card"><span class="section-title">资源占用</span><div class="divider"></div>' +
      '<div class="meter-detail"><div class="meter-label"><span>CPU</span><span class="strong">' + e(c.cpuText) + '</span></div>' +
        '<div class="bar"><div class="bar-fill ' + (c.cpuWarn ? 'warn' : '') + '" style="width:' + attr(c.cpuWidth) + '"></div></div></div>' +
      '<div class="meter-detail"><div class="meter-label"><span>内存</span><span class="strong">' + e(c.memText) + '</span></div>' +
        '<div class="bar"><div class="bar-fill ' + (c.memWarn ? 'warn' : '') + '" style="width:' + attr(c.memWidth) + '"></div></div>' +
      '</div><span class="tiny">数据来自 LiteDock 后台采样，最多滞后 12 秒</span></div>';

    var portCard = '';
    if (d.showPortCard) {
      /* 1.0.6：去掉「宿主端口 → 容器端口 / tcp · 0.0.0.0」明细表。
         上方 chips 已把端口表达清楚且可直接点击，协议与监听 IP 对普通用户
         没有意义，反而让详情页显得杂乱。 */
      portCard = '<div class="card"><span class="section-title">端口与访问链接</span><div class="divider"></div>' +
        '<div class="chips">' + chipsHtml(c, 'data-catch="1"') + (!c.hasChips ? '<span class="no-port">' + e(c.noPortText) + '</span>' : '') + '</div>' +
        '<span class="tiny">点击访问链接直接打开浏览器，长按可复制地址</span></div>';
    }

    var opBtn = function (act, label, cls) {
      return '<div class="op-cell"><button class="op ' + (cls || '') + '" data-ev="doAction" data-catch="1" data-act="' + act + '">' + label + '</button></div>';
    };
    /* 1.0.17：镜像更新入口对全部容器开放（用户反馈：多容器项目成员详情也应有）。
       检查更新只读无风险；升级重建对项目成员在按钮下方保留提示——逐个重建
       可能打乱 Compose 依赖与版本，确认弹窗里也会带显著警告（detail.js）。
       isStandalone 字段保留：单容器/独立容器不显示项目提示行。 */
    var updateOps = d.canUpgrade
      ? '<div class="card"><span class="section-title">镜像更新</span><div class="divider"></div>' +
        '<div class="op-grid">' +
        '<div class="op-cell"><button class="op" data-ev="checkUpdate" data-catch="1">检查更新</button></div>' +
        (d.isSelf ? '' : '<div class="op-cell"><button class="op op-danger" data-ev="doUpgrade" data-catch="1">升级重建</button></div>') +
        '</div>' +
        (d.isSelf ? '<div class="divider"></div><span class="tiny">◆ 这是运行管理面板的容器本体，升级重建已禁用，请用 NAS 上的部署脚本升级。</span>' : '') +
        (d.inProject ? '<div class="divider"></div><span class="tiny">⚠ 该容器属于多容器项目，单独升级可能造成项目内版本不一致，建议优先用项目卡整体管理</span>' : '') +
        (d.updateText ? '<div class="divider"></div><span class="tiny">' + e(d.updateText) + '</span>' : '') +
        '</div>'
      : '';
    /* 1.0.19 自我保护：本体容器的「容器操作」区不渲染停止/重启/暂停/启动，改为受保护说明 */
    var ops = d.isSelf
      ? '<div class="card"><span class="section-title">容器操作</span><div class="divider"></div>' +
        '<span class="tiny">◆ 这是 LiteDock 本体容器。停止/重启/暂停已禁用——面板自己停掉会导致管理界面中断。如需操作请到 NAS 的容器管理界面中进行。</span></div>'
      : '<div class="card"><span class="section-title">容器操作</span><div class="divider"></div><div class="op-grid">' +
      (c.isRunning ? opBtn('stop', '停止') + opBtn('restart', '重启') + opBtn('pause', '暂停') : '') +
      (c.state === 'paused' ? opBtn('unpause', '恢复', 'op-primary') + opBtn('stop', '停止') : '') +
      (!c.isRunning && c.state !== 'paused' ? opBtn('start', '启动', 'op-primary') : '') +
      '</div></div>';

    var logs = '<div class="card"><div class="row-between"><span class="section-title">运行日志</span>' +
      '<div class="log-ops"><button class="btn btn-small btn-ghost' + (d.logAuto ? ' on' : '') + '" data-ev="toggleLogAuto" data-catch="1">' + (d.logAuto ? '自动' : '手动') + '</button>' +
      '<button class="btn btn-small btn-ghost" data-ev="loadLogs" data-catch="1">刷新</button></div></div><div class="divider"></div>' +
      (d.logsLoading ? '<div class="log-box"><span class="tiny">正在读取日志…</span></div>'
        : d.logs ? '<div class="log-box"><div class="log-text">' + e(d.logs) + '</div></div>'
          : '<div class="log-box"><span class="tiny">点「刷新日志」读取最近 100 行</span></div>') +
      '</div>';

    return '<div class="page detail-page">' + overview + res + portCard + ops + updateOps + logs + '</div>';
  };

  /* ---------------- 设置 settings ----------------
     1.0.2：原「访问链接」表单与连接管理页功能重复，且这里没有访问密码 / 鉴权头字段，
     带 ACCESS_PASSWORD 的服务端在此保存必然失败并回退成 IP 命名。改为「当前连接 +
     管理入口 + APP 行为开关」，所有编辑/测试能力统一收敛到连接管理页。 */
  T.settings = function (d) {
    var conn = null, count = 0;
    try {
      var c = LD.require('utils/connection.js');
      conn = c.getActive();
      count = c.list().length;
    } catch (err) {}
    var chooser = false;
    try { chooser = localStorage.getItem('ld_link_chooser') === '1'; } catch (err) {}
    /* 1.0.11：紧凑模式开关状态（纯显示密度，默认关；读取失败也保持关） */
    var compact = false;
    try { compact = !!(window.LD && LD.appCompact && LD.appCompact()); } catch (err) {}
    /* 1.0.8：两个独立开关，各自只管一件事；默认 A 开 / B 关，与 1.0.7 默认表现一致 */
    var wanLinks = true, portsAlways = false;
    /* A 默认开：函数缺失时也保持开，避免旧缓存 / 逻辑回放沙箱里显示成关 */
    try { if (window.LD && LD.appWanLinks) wanLinks = !!LD.appWanLinks(); } catch (err) {}
    try { portsAlways = !!(window.LD && LD.appPortsAlways && LD.appPortsAlways()); } catch (err) {}
    /* 状态行不再重复连接名；出错时仍完整保留服务端返回的提示 */
    var status = String(d.linkStatus || '');
    if (/^当前：/.test(status)) status = '● 已连接 · 点「管理连接」可切换或新增';
    /* 1.0.15：升级备份列表（APP 与 Web 同源，升级独立容器后在此回退/删除） */
    var backups = d.backups || [];
    var backupHtml = (d.backupLoaded === false)
      ? '<span class="field-hint">加载中…</span>'
      : (backups.length
        ? backups.map(function (b) {
            var isNewer = b.kind === 'newer';
            return '<div class="bk-item">' +
              '<div class="bk-line"><span class="bk-name">' + e(b.base) + '</span>' +
                '<span class="bk-kind' + (isNewer ? ' newer' : '') + '">' + (isNewer ? '被替换的新版本' : '升级前旧版本') + '</span></div>' +
              '<div class="bk-sub">' + e(b.shortId) + ' · ' + e(b.image || '') + '</div>' +
              '<div class="bk-actions">' +
                '<div class="op-cell"><button class="op op-primary" data-ev="backupRollback" data-catch="1" data-id="' + attr(b.id) + '" data-base="' + attr(b.base) + '">回退到此版本</button></div>' +
                '<div class="op-cell"><button class="op op-danger" data-ev="backupDelete" data-catch="1" data-id="' + attr(b.id) + '" data-base="' + attr(b.base) + '">彻底删除</button></div>' +
              '</div></div>';
          }).join('')
        : '<span class="field-hint">暂无升级备份。升级独立容器后，旧版本会出现在这里，可随时回退或删除。项目内容器请用项目卡的「启动 / 停止 / 重启」整体管理。</span>');

    var head = conn
      ? '<div class="conn-summary">' +
          '<div class="conn-summary-name">' + e(conn.name) +
            (d.linkType ? '<span class="type-tag ' + (conn.type === 'proxy' ? 'is-proxy' : '') + '">' + e(d.linkType) + '</span>' : '') +
          '</div>' +
          '<div class="conn-summary-url">' + e(conn.url) + '</div>' +
          '<div class="conn-summary-state ' + (d.linkOk ? 'is-ok' : '') + '">' + e(status) + '</div>' +
        '</div>'
      : '<div class="empty-inline"><span class="muted">还没有访问链接。点下方按钮添加一台 NAS，局域网地址与反向代理域名都支持。</span></div>';

    return '<div class="page settings-page">' +
      '<div class="card"><span class="section-title">当前连接</span><div class="divider"></div>' + head +
        '<div class="btn-row link-actions">' +
          '<div class="btn-cell"><button class="btn btn-ghost" data-ev="ldRefresh" data-catch="1">刷新数据</button></div>' +
          '<div class="btn-cell"><button class="btn btn-primary" data-ev="goConnect" data-catch="1">' +
            (count ? '管理连接（' + count + '）' : '添加连接') + '</button></div>' +
        '</div>' +
      '</div>' +
      /* 1.0.11：紧凑模式 —— 显示密度开关，位置按用户要求放在
         「当前连接」与「链接与打开方式」中间；规则与 Web 端一致。 */
      '<div class="card"><span class="section-title">显示</span><div class="divider"></div>' +
        '<span class="field-hint">紧凑模式下，面板卡片会隐藏状态说明、CPU / 内存资源条与快捷访问区，只保留名称、镜像、运行状态与操作按钮，一屏能看到更多容器。与 Web 端「设置 → 紧凑模式」效果一致。</span>' +
        '<div class="switch-row" data-ev="ldToggleCompact" data-catch="1">' +
          '<span>紧凑模式（隐藏状态 / 资源 / 快捷访问）</span>' +
          '<span class="ld-switch ' + (compact ? 'on' : '') + '"><i></i></span>' +
        '</div>' +
      '</div>' +
      '<div class="card"><span class="section-title">链接与打开方式</span><div class="divider"></div>' +
        '<span class="field-hint">点容器端口 / 访问链接时直接调起浏览器。默认跟随系统设置的默认浏览器；开启下方开关后，每次都会弹出「选择应用」，适合装了多个浏览器的手机。</span>' +
        '<div class="switch-row" data-ev="ldToggleChooser" data-catch="1">' +
          '<span>' + (chooser ? '每次询问使用哪个浏览器' : '使用系统默认浏览器') + '</span>' +
          '<span class="ld-switch ' + (chooser ? 'on' : '') + '"><i></i></span>' +
        '</div>' +
        '<div class="switch-row" data-ev="ldToggleWanLinks" data-catch="1">' +
          '<span>外网显示已配反代的服务</span>' +
          '<span class="ld-switch ' + (wanLinks ? 'on' : '') + '"><i></i></span>' +
        '</div>' +
        '<div class="switch-row" data-ev="ldTogglePorts" data-catch="1">' +
          '<span>外网也显示容器端口</span>' +
          '<span class="ld-switch ' + (portsAlways ? 'on' : '') + '"><i></i></span>' +
        '</div>' +
        '<span class="field-hint switch-hint">上面两项只在「反向代理 / 域名」连接下生效，局域网直连时始终显示全部链接与端口。① 只有 Web 服务端「设置 → 快捷访问」里给容器配了外网地址，开启后卡片才会出现「访问链接」，没配的容器不会凭空出现链接。② 容器端口是 NAS 内网地址，公网本就打不开；仅当手机用 WiFi / VPN / Tailscale / WireGuard / 内网穿透连回家里网络时才需开启，并把「连接管理 → 高级选项 → 容器链接主机」填成 NAS 内网 IP 或组网 IP。两项可任意组合，也可同时关闭。</span>' +
      '</div>' +
      /* 1.0.15：升级备份管理，位置与 Web「设置 → 备份」对应 */
      '<div class="card"><span class="section-title">升级备份</span><div class="divider"></div>' +
        '<span class="field-hint">升级独立容器时，旧版本会自动改名备份并从面板隐藏，不会把停止的旧容器留在项目里。这里可一键回退到旧版本，或彻底删除备份释放空间。</span>' +
        '<div class="bk-list">' + backupHtml + '</div>' +
      '</div>' +
      '<div class="hint-card"><span>外观、分组、壁纸、卡片背景等设置都在 LiteDock 的 Web 服务端页面完成，本应用会自动同步，不能在这里修改。</span></div>' +
      '<div class="foot-space"></div></div>';
  };

  /* ---------------- 连接 connect ---------------- */
  T.connect = function (d) {
    var list = (d.connections || []).map(function (c) {
      return '<div class="conn-item" data-k="c-' + attr(c.id) + '">' +
        '<div class="row-between" data-ev="setActive" data-id="' + attr(c.id) + '" data-catch="1">' +
          '<div class="grow"><div class="row"><span class="conn-name">' + e(c.name) + '</span>' +
            '<span class="type-tag ' + (c.type === 'proxy' ? 'is-proxy' : '') + '">' + e(c.typeLabel) + '</span>' +
            (c.isActive ? '<span class="active-tag">使用中</span>' : '') + '</div>' +
            '<span class="conn-url">' + e(c.url) + '</span>' + (c.note ? '<span class="conn-note">' + e(c.note) + '</span>' : '') +
          '</div><span class="conn-check">' + (c.isActive ? '✓' : '›') + '</span></div>' +
        '<div class="conn-actions">' +
          '<div class="mini-cell"><button class="mini-btn" data-ev="openEdit" data-id="' + attr(c.id) + '" data-catch="1">编辑</button></div>' +
          '<div class="mini-cell"><button class="mini-btn" data-ev="testSaved" data-id="' + attr(c.id) + '" data-catch="1">测试</button></div>' +
          '<div class="mini-cell"><button class="mini-btn mini-danger" data-ev="removeConn" data-id="' + attr(c.id) + '" data-catch="1">删除</button></div>' +
        '</div></div>';
    }).join('');

    var saved = '<div class="card"><div class="row-between"><span class="section-title">已保存的访问链接</span>' +
      '<button class="btn btn-small btn-primary" data-ev="openAdd" data-catch="1">＋ 新增</button></div><div class="divider"></div>' +
      '<span class="field-hint">可存多台 NAS，或同一台的内网 / 公网两套地址；点一下即可切换。</span>' +
      (!(d.connections || []).length ? '<div class="empty-inline"><span class="muted">还没有访问链接。填局域网地址，或你已做好的反向代理域名。</span></div>' : '') +
      list + '</div>';

    if (!d.showForm) return '<div class="page connect-page">' + saved + '<div class="foot-space"></div></div>';

    var f = d.form || {};
    var field = function (label, key, placeholder, hint, type) {
      return '<div class="field" data-k="fd-' + key + '"><span class="field-label">' + label + '</span>' +
        '<input class="field-input" type="' + (type || 'text') + '" value="' + attr(f[key]) + '" placeholder="' + attr(placeholder) + '" data-k="fi-' + key + '" data-input="onField" data-field="' + key + '">' +
        (hint ? '<span class="field-hint">' + hint + '</span>' : '') + '</div>';
    };
    var adv = d.advanced ? '<div class="divider"></div>' +
      '<span class="field-hint">为域名 / 反向代理 / VPN 组网等非常规访问准备：容器链接主机、Basic Auth 鉴权头、访问密码、备注。局域网直连 NAS 时全部留空即可。</span>' +
      field('容器链接主机（可选）', 'host', '留空自动取访问链接里的主机', '容器端口链接按 http://这个主机:端口 生成，留空则用访问链接里的主机。当访问链接是域名 / 反代地址，而容器端口只能通过 NAS 内网或组网 IP 打开时（如反向代理、VPN、Tailscale / WireGuard 组网回家、内网穿透等），在这里填那个 IP 或内网域名。') +
      field('访问密码（可选）', 'password', '部署时设了 ACCESS_PASSWORD 才需要', '若 LiteDock 服务端设了访问密码（ACCESS_PASSWORD），在这里填写；留空表示无密码。该密码会随每个 API 请求发送，与反代鉴权头互不冲突。', 'password') +
      field('鉴权请求头（可选）', 'header', 'Authorization: Basic xxxxxx', '反向代理若加了 Basic Auth / Token 鉴权，按「请求头名: 值」填写；留空表示无鉴权。所有 API 请求与连接测试都会带上它。') +
      field('备注（可选）', 'note', '给自己看的说明', '') : '';

    var form = '<div class="card"><div class="row-between"><span class="section-title">' + (d.editingId ? '编辑访问链接' : '新增访问链接') + '</span>' +
      '<span class="form-close" data-ev="closeForm" data-catch="1">×</span></div><div class="divider"></div>' +
      field('访问链接', 'url', 'http://192.168.1.100:23000', '局域网填 http://NAS地址:23000；外网填你已做好的 HTTPS 反向代理。安卓版支持任意端口，不受微信域名白名单限制。不写协议会自动补：IP 用 http，域名用 https。') +
      (d.linkType ? '<div class="detect-row" data-k="detect"><span class="detect-label">自动识别为</span><span class="detect-type">' + e(d.linkType) + '</span></div>' : '') +
      field('连接名称（可选）', 'name', '留空自动用宿主机命名（如 NAS-01）', '') +
      '<div class="adv-toggle" data-k="adv-toggle" data-ev="toggleAdvanced" data-catch="1"><span>高级选项</span><span>' + (d.advanced ? '收起 −' : '展开 ＋') + '</span></div>' +
      adv +
      '<div class="btn-row form-actions"><div class="btn-cell"><button class="btn btn-ghost" data-ev="testForm" data-catch="1">测试连接</button></div>' +
        '<div class="btn-cell"><button class="btn btn-primary" data-ev="saveForm" data-catch="1">保存并使用</button></div></div>' +
      (d.testResult ? '<span class="test-result ' + (d.testOk ? 'ok' : 'fail') + '">' + e(d.testResult) + '</span>' : '') +
    '</div>';

    return '<div class="page connect-page">' + saved + form + '<div class="foot-space"></div></div>';
  };

  /* ---------------- 关于 about ---------------- */
  T.about = function (d) {
    var rows = function (arr) {
      return (arr || []).map(function (r) {
        return '<div class="kv"><span class="kv-k">' + e(r.k) + '</span><span class="kv-v">' + e(r.v) + '</span></div>';
      }).join('');
    };
    return '<div class="page about-page">' +
      '<div class="brand-card">' +
        '<img class="brand-mark" src="assets/logo.png">' +
        '<span class="brand-name">LiteDock App</span>' +
        '<span class="brand-sub">极简容器管理面板 · 安卓版</span>' +
        '<span class="brand-ver">APP ' + e((window.LD && LD.APP_VERSION) || d.miniVersion) +
          ' · 服务端 ' + e(d.appVersion) + '</span>' +
      '</div>' +
      '<div class="card"><div class="row-between"><span class="section-title">运行环境</span>' +
        '<button class="btn btn-small btn-ghost" data-ev="refresh" data-catch="1">刷新</button></div>' +
        '<div class="divider"></div>' + rows(d.envRows) + '</div>' +
      '<div class="card"><span class="section-title">当前连接</span><div class="divider"></div>' + rows(d.connRows) + '</div>' +
      '<div class="card update-card"><div class="row-between"><span class="section-title">APP 更新</span>' +
        '<button class="btn btn-small btn-ghost" data-ev="checkAppUpdate" data-catch="1">检查更新</button></div>' +
        '<div class="divider"></div>' +
        '<span class="update-state">' + e(d.updateState || '点击检查是否有新版本') + '</span>' +
        (d.updateAvailable ? '<div class="update-actions"><button class="btn btn-small btn-primary" data-ev="installAppUpdate" data-catch="1">下载并安装</button></div>' : '') +
      '</div>' +
      '<div class="card license-card"><span class="section-title">许可与来源</span><div class="divider"></div>' +
        '<span class="license-text">LiteDock 及其移动客户端为独立编写的原创项目，前后端代码与界面均自行实现，未包含或改写任何第三方项目源码，不受第三方开源许可证约束；本项目采用 MIT 许可证，可自由使用、修改与再分发。</span>' +
        '<span class="license-text license-gap">内置容器图标来自开源项目 homarr-labs/dashboard-icons（MIT 许可，全量引入 3900+ 个），各图标商标归原厂商所有，在此感谢该项目的整理与维护。</span>' +
      '</div>' +
      '<span class="about-sign">LiteDock App · By Stark-C</span>' +
      '<div class="foot-space"></div></div>';
  };

})(window);
