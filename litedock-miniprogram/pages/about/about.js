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

  /* 1.0.26 APP 自更新：小程序端只提示不支持；APP 构建补丁会整体替换下面两个方法 */
  checkAppUpdate() {
    this.setData({ updateState: '小程序版本不支持自动更新，请使用安卓 APP' });
  },

  installAppUpdate() {
    wx.showToast({ title: '请使用安卓 APP 更新', icon: 'none' });
  }
});
