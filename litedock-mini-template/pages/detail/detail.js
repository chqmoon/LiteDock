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
    if (!isProxy) {
      /* 反代连接下端口映射打不开，直接不显示；局域网模式保持端口表 */
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
