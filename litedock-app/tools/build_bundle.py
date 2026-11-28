"""把小程序的 CommonJS 模块与页面 JS 原样打包成浏览器 bundle。

设计目标：小程序 utils/*.js 与 pages/*/*.js 的业务逻辑**一行不改**即可运行。
做法：每个文件包进 LD.define(name, fn)，由运行时提供 require / module / exports；
wx.* / App() / getApp() / Page() 全部由 wx-shim.js 提供。

APP 专用补丁：只在生成 APP 的 bundle 时以精确字符串替换注入，不写回小程序源码，
因此 litedock-miniprogram/ 与其发布归档保持零改动。每条替换必须命中，否则构建失败。
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.normpath(os.path.join(ROOT, "..", "litedock-miniprogram"))
OUT = os.path.join(ROOT, "www", "js", "bundle.js")

MODULES = [
    "utils/connection.js",
    "utils/api.js",
    "utils/model.js",
    "utils/imageloader.js",
    "utils/toast.js",
]
PAGES = ["index", "detail", "settings", "connect", "about"]

# ---- APP 补丁 ---------------------------------------------------------------
# 缺陷：新增连接时，tryPrefillName 只在「输入 URL 的那一刻」触发。用户先填网址、
# 再到高级选项填访问密码（ACCESS_PASSWORD），首次请求必然 401，name 保持为空，
# connection.validate() 于是回退 hostnameOf(url) → 连接名变成 IP。
# 修复：密码填写后重试预填；保存前再做一次兜底（3s 超时不影响保存）。
_APP_SAVE_OLD = """  saveForm() {
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
  },"""

_APP_SAVE_NEW = """  saveForm() {
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
  },"""

# 1.0.8：反代连接下的两个独立开关，由 utils/model.js 的 chipsOf 统一裁决。
# 旧实现靠把 isProxy 整体覆盖成 false 来「显示端口」，会连带把外网 linksWan
# 换成内网 links，导致「访问链接 + 端口」永远无法同时显示。现在 isProxy 只表示
# 连接类型，由 LD.appLinkPrefs() 的 {wan, ports} 分别控制两类 chip；
# 小程序源码仍然零改动，此函数由构建期补丁整体替换。
_APP_CHIPS_OLD = """function chipsOf(list, cfg, nasHost, isProxy) {
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
}"""

_APP_CHIPS_NEW = """function chipsOf(list, cfg, nasHost, isProxy) {
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
}"""

# 1.0.26 APP 自更新：把小程序端的两个占位方法替换为原生实现。
# 小程序权威源保持通用（不依赖原生插件），APP 端由构建期精确替换。
_APP_UPDATE_OLD = """  /* 1.0.26 APP 自更新：小程序端只提示不支持；APP 构建补丁会整体替换下面两个方法 */
  checkAppUpdate() {
    this.setData({ updateState: '小程序版本不支持自动更新，请使用安卓 APP' });
  },

  installAppUpdate() {
    wx.showToast({ title: '请使用安卓 APP 更新', icon: 'none' });
  }
});"""

_APP_UPDATE_NEW = """  /* APP 1.0.26：GitHub Release 自更新（原生严格 TLS + SHA-256 校验） */
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
        /\\.apk$/i.test(a.name || '') && /^sha256:[0-9a-f]{64}$/i.test(a.digest || ''));
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
});"""

APP_PATCHES = {
    # 1.0.26：关于页 APP 自更新
    "pages/about/about.js": [
        ("  onShow() {\n    this.load();\n  },",
         "  onShow() {\n    this.load();\n    if (this._showSilentHint) this._showSilentHint();\n  },"),
        (_APP_UPDATE_OLD, _APP_UPDATE_NEW),
    ],
    # 1.0.8：详情页端口表跟随 B 开关（组网回家时反代连接也要能看到端口）。
    # isProxy 不再被覆盖，保持「连接是不是反代」的纯粹含义。
    "pages/detail/detail.js": [
        ("    if (!isProxy) {\n      /* 反代连接下端口映射打不开，直接不显示；局域网模式保持端口表 */",
         "    /* APP 1.0.8：B 开关开启时反代连接也显示端口表，与卡片保持一致 */\n"
         "    const showPortRows = !isProxy || (typeof window !== 'undefined' && window.LD && LD.appPortsAlways && LD.appPortsAlways());\n"
         "    if (showPortRows) {"),
    ],
    "pages/connect/connect.js": [
        ("    } else if (field === 'name') {\n      this.setData({ nameTouched: true });\n    }\n    this.setData(patch);",
         "    } else if (field === 'name') {\n"
         "      this.setData({ nameTouched: true });\n"
         "    } else if (field === 'password' && v) {\n"
         "      /* APP 补丁：密码填完后重试宿主机命名（首次 URL 预填时密码还没填 → 401） */\n"
         "      const u2 = connection.normalizeUrl(this.data.form.url);\n"
         "      if (u2 && !this.data.nameTouched) {\n"
         "        const self = this;\n"
         "        setTimeout(function () { self.tryPrefillName(u2); }, 0);\n"
         "      }\n"
         "    }\n"
         "    this.setData(patch);"),
        (_APP_SAVE_OLD, _APP_SAVE_NEW),
    ],
    # 设置页的 probe / fetchInfo 原先漏传访问密码；页面精简后入口已移除，
    # 但保留修复以防将来恢复表单，也保证任何调用路径都能拿到宿主机名。
    "pages/settings/settings.js": [
        ("api.probe(u, c ? c.header : '')", "api.probe(u, c ? c.header : '', c ? c.password : '')"),
        ("api.fetchInfo(connection.normalizeUrl(raw), draft.header)",
         "api.fetchInfo(connection.normalizeUrl(raw), draft.header, draft.password)"),
    ],
    # 一次替换整个 chipsOf：含 1.0.5 内外双地址、1.0.7 端口 chip 带 state、
    # 1.0.8 两个独立开关。集中在一处判断，避免多处 isProxy 覆盖互相打架。
    "utils/model.js": [
        (_APP_CHIPS_OLD, _APP_CHIPS_NEW),
    ],
}


def apply_app_patches(rel, code):
    for old, new in APP_PATCHES.get(rel, []):
        if old not in code:
            raise SystemExit("APP patch MISSED in %s: %r" % (rel, old[:90]))
        code = code.replace(old, new, 1)
    return code


def patch_app_global(code):
    """APP 启动静默检查：延迟 8s，每天一次；只写标记，不弹窗、不阻塞。"""
    old = """  onLaunch() {
    connection.ensureDefaults();
    this.globalData.connectionKey = this.currentKey();
  },"""
    new = """  onLaunch() {
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
  },"""
    if old not in code:
        raise SystemExit("APP global patch MISSED in app.js onLaunch")
    return code.replace(old, new, 1)


def main():
    parts = ["/* LiteDock App — 由 tools/build_bundle.py 从小程序源码自动生成，请勿手改 */\n",
             "/* 源：litedock-miniprogram 的 utils 模块、app.js 与 pages 各页 JS，业务逻辑零改动 */\n\n"]

    for rel in MODULES:
        with open(os.path.join(MP, rel), encoding="utf-8") as f:
            code = apply_app_patches(rel, f.read())
        parts.append("LD.define(%r, function(require, module, exports) {\n%s\n});\n\n" % (rel, code))

    # App() 全局对象
    with open(os.path.join(MP, "app.js"), encoding="utf-8") as f:
        appcode = patch_app_global(f.read())
    parts.append("/* ===== app.js ===== */\n(function(require, module, exports) {\n%s\n})(LD.makeRequire('app.js'), {exports:{}}, {});\n\n" % appcode)

    for p in PAGES:
        rel = "pages/%s/%s.js" % (p, p)
        with open(os.path.join(MP, rel), encoding="utf-8") as f:
            code = apply_app_patches(rel, f.read())
        parts.append("/* ===== %s ===== */\nLD.pageModule(%r, function(require, module, exports) {\n%s\n});\n\n"
                     % (rel, p, code))

    out = "".join(parts)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print("wrote", OUT, len(out), "bytes;", len(MODULES), "modules +", len(PAGES), "pages")


if __name__ == "__main__":
    main()
