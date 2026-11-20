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
