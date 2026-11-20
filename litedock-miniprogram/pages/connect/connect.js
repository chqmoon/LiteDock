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
