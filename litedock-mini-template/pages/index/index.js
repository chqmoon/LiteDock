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
