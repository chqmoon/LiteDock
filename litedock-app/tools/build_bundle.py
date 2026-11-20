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

APP_PATCHES = {
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


def main():
    parts = ["/* LiteDock App — 由 tools/build_bundle.py 从小程序源码自动生成，请勿手改 */\n",
             "/* 源：litedock-miniprogram 的 utils 模块、app.js 与 pages 各页 JS，业务逻辑零改动 */\n\n"]

    for rel in MODULES:
        with open(os.path.join(MP, rel), encoding="utf-8") as f:
            code = apply_app_patches(rel, f.read())
        parts.append("LD.define(%r, function(require, module, exports) {\n%s\n});\n\n" % (rel, code))

    # App() 全局对象
    with open(os.path.join(MP, "app.js"), encoding="utf-8") as f:
        appcode = f.read()
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
