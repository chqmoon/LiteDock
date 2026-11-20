"""本地预览服务器：托管 www/，注入 mock 的 LiteDockHttp 插件返回真实 NAS 数据。

用途：在桌面浏览器里验证网页端界面（无需安卓真机）。
启动：python3 tools/serve_preview.py  然后访问 http://127.0.0.1:8777
"""
import http.server, socketserver, json, os, re

# LD_WWW 可指向另一份 www 副本（例如 1.0.2 的前端），用于新旧版本性能对比
ROOT = os.environ.get("LD_WWW") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "www")
FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "state.json")
# 允许 LD_FIXTURE 指向另一份 /api/state 快照（例如 29 容器的快照数据），
# 用于大列表性能回放；默认仍是已归档的 11 容器样本。
FIXTURE = os.environ.get("LD_FIXTURE") or FIXTURE
PORT = int(os.environ.get("LD_PORT") or 8777)

STATE = json.load(open(FIXTURE, encoding="utf-8"))

# 注入到 index.html：模拟 Capacitor 原生 HTTP 插件
MOCK = r"""
<script>
(function () {
  var STATE = __STATE__;
  window.__mockHost = STATE.info.name;   // 供交互回放断言「默认连接名 = 宿主机名」
  window.Capacitor = { Plugins: { LiteDockHttp: {
    request: function (o) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          var u = String(o.url || '');
          var p = u.split('?')[0];
          if (p.indexOf('/api/health') >= 0) return resolve({ status: 200, data: '{"ok":true}' });
          if (p.indexOf('/api/info') >= 0) {
            // 测试桩：模拟服务端设置了 ACCESS_PASSWORD。没带访问密码就 401，
            // 用来真实回放「先填网址、再填密码」导致宿主机命名回退成 IP 的缺陷。
            var h = o.headers || {};
            if (!h['X-LiteDock-Token']) return resolve({ status: 401, data: '{"code":"NEED_AUTH"}' });
            return resolve({ status: 200, data: JSON.stringify({ ok: true, name: STATE.info.name }) });
          }
          if (p.indexOf('/api/state') >= 0) return resolve({ status: 200, data: JSON.stringify(STATE) });
          if (p.indexOf('/api/backups') >= 0) return resolve({ status: 200, data: JSON.stringify({ ok: true, backups: window.__ldBackups || [] }) });
          // 1.0.17：/api/container/<id>/check 结果可注入（学 __ldBackups 惯例）——
          // verify_117 用它回放「已是最新 / 发现新镜像」两分支；不注入时默认已是最新
          if (p.indexOf('/check') >= 0) return resolve({ status: 200, data: JSON.stringify(window.__ldCheckResult || { ok: true, hasUpdate: false, message: '已是最新版本' }) });
          if (p.indexOf('/api/container/') >= 0 && p.indexOf('/upgrade') >= 0) return resolve({ status: 200, data: JSON.stringify(window.__ldUpgradeResult || { ok: true, changed: true }) });
          if (p.indexOf('/logs') >= 0) return resolve({ status: 200, data: JSON.stringify({ ok: true, text: '2026-11-14 20:00:01 litedock started\n2026-11-14 20:00:02 listening on :8000' }) });
          if (o.method === 'POST') return resolve({ status: 200, data: '{"ok":true}' });
          if (o.binary) return resolve({ status: 200, data: 'data:image/png;base64,' });
          return resolve({ status: 404, data: '{"error":"not found"}' });
        }, 60);
      });
    },
    openUrl: function (o) {
      (window.__openedNative = window.__openedNative || []).push(o);
      return Promise.resolve({ opened: true, chooser: !!o.chooser });
    }
  }, Clipboard: {
    write: function (o) {
      (window.__clipboardWrites = window.__clipboardWrites || []).push(o);
      return Promise.resolve();
    }
  } } };
  // 预置一条连接，直接进面板
  try {
    var c = { id: 'preview', name: STATE.info.name || 'NAS', type: 'proxy',
              url: 'https://nas.example.com:16666', host: '192.168.1.10',
              header: '', password: '', note: '预览', created: Date.now() };
    localStorage.setItem('fd_connections', JSON.stringify([c]));
    localStorage.setItem('fd_active_id', JSON.stringify('preview'));
  } catch (e) {}

  // 同步探针：确认 localStorage 预置与 mock 插件是否生效
  var probe = document.createElement('div');
  probe.id = '__probe';
  // 诊断文本含长 JSON，会撑大 body 的 scrollWidth；脱离文档流避免污染布局测量
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
  probe.textContent = 'PROBE_BEGIN\n' +
    'fd_connections=' + localStorage.getItem('fd_connections') + '\n' +
    'fd_active_id=' + localStorage.getItem('fd_active_id') + '\n' +
    'CapacitorPlugin=' + !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LiteDockHttp) +
    '\nPROBE_END';
  document.body.appendChild(probe);

  // ?diag=1 时输出布局诊断，供 --dump-dom 抓取
  if (location.search.indexOf('diag') >= 0) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        var sels = ['.ld-root', '.ld-scroll', '#ld-page', '.page', '.content',
                    '.hero', '.stat-panel', '.welcome', '.ld-tabbar', '.ld-tab',
                    '.welcome-btn', '.group', '.ct', '.search-bar'];
        var out = ['clientWidth=' + document.documentElement.clientWidth,
                   'bodyScrollW=' + document.body.scrollWidth,
                   'viewState=' + (window.LD && LD.renderCurrent ? 'ready' : '?'),
                   'activeConn=' + localStorage.getItem('fd_active_id')];
        sels.forEach(function (s) {
          var el = document.querySelector(s);
          if (!el) { out.push(s + ' = MISSING'); return; }
          var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          out.push(s + ' = w:' + Math.round(r.width) + ' x:' + Math.round(r.left) +
                   ' display:' + cs.display + ' fontSize:' + cs.fontSize +
                   ' pad:' + cs.paddingLeft + '/' + cs.paddingRight);
        });
        var page = document.getElementById('ld-page');
        out.push('pageHTMLlen=' + (page ? page.innerHTML.length : -1));
        var cw = document.documentElement.clientWidth;
        var wide = [];
        Array.prototype.forEach.call(document.querySelectorAll('*'), function (el) {
          var r = el.getBoundingClientRect();
          if (r.right > cw + 3 || r.left < -3) {
            wide.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 40) +
                      ' L' + Math.round(r.left) + ' R' + Math.round(r.right) + ' W' + Math.round(r.width));
          }
        });
        out.push('OVERFLOW(' + wide.length + '): ' + wide.slice(0, 14).join(' | '));
        var pre = document.createElement('pre');
        pre.id = '__diag';
        pre.textContent = 'DIAG_BEGIN\n' + out.join('\n') + '\nDIAG_END';
        document.body.appendChild(pre);
      }, 600);
    });
  }
})();
</script>
""".replace("__STATE__", json.dumps(STATE, ensure_ascii=False))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
            # 必须在业务脚本之前注入，否则 LD.start() 早于 localStorage 预置
            html = html.replace('<script src="js/wx-shim.js"></script>',
                                MOCK + '\n  <script src="js/wx-shim.js"></script>')
            data = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print("preview at http://127.0.0.1:%d" % PORT, flush=True)
        httpd.serve_forever()
