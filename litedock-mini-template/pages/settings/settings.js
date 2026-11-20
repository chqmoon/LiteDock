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
    api.probe(u, c ? c.header : '').then((r) => {
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
      api.fetchInfo(connection.normalizeUrl(raw), draft.header).then((info) => {
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
