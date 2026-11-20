/* LiteDock HTTP 客户端：只读取状态 / 日志，加容器操作，不写 config.json */
const connection = require('./connection.js');

/* 错误提示按连接类型分流：
   局域网 IP 走微信官方豁免（基础库 2.4.0+，同网段即可），不需要白名单 / HTTPS / 调试模式，
   绝不能用公网域名的那套说辞误导用户。 */
function friendly(err, kind) {
  const msg = String((err && err.errMsg) || err || '');
  const lan = kind === 'lan';
  if (/^request:fail\s*$/i.test(msg.trim())) {
    return lan
      ? '连不上局域网：请确认手机与 NAS 在同一 WiFi，且 IP、端口（23000）填写正确。'
      : '当前无法联网，请检查手机网络后重试。';
  }
  if (/domain|url not in|invalid url|不在以下.*域名|fail.*domain/i.test(msg)) {
    return lan
      ? '连不上局域网：微信只允许同网段的局域网 IP 直连。请确认手机和 NAS 在同一 WiFi（不能开流量），地址填 NAS 的内网 IP。'
      : '域名被拒绝：正式版只认已备案 + 已加入后台 request 白名单的 HTTPS 域名，端口建议 443；体验版/开发版可在开发者工具勾「不校验合法域名」临时联调。';
  }
  if (/ssl|certificate|证书/i.test(msg)) {
    return lan
      ? '局域网直连不需要 HTTPS 证书，请确认地址填的是 http://NAS内网IP:23000。'
      : 'HTTPS 证书校验失败，请检查反向代理证书是否可信、未过期、域名一致。';
  }
  if (/timeout|超时/i.test(msg)) {
    return lan
      ? '局域网连接超时：确认手机与 NAS 同 WiFi、LiteDock 服务在线、端口 23000 正确。'
      : '连接超时，请确认域名解析、反代服务与 LiteDock 均在线。';
  }
  if (/ refused|ECONNREFUSED|connect/i.test(msg)) {
    return lan
      ? '无法连接 NAS：检查内网 IP、端口 23000 是否正确，服务是否运行。'
      : '无法建立连接，请检查地址、端口与防火墙。';
  }
  return '网络请求失败：' + (msg || '未知错误');
}

/* LiteDock 访问密码：走独立的 X-LiteDock-Token 头，不与反代 BasicAuth 的 Authorization 冲突 */
function authHeader(active, rawPassword) {
  const header = {};
  const pw = rawPassword !== undefined ? rawPassword : (active && active.password);
  if (pw) header['X-LiteDock-Token'] = pw;
  return header;
}

function request(method, path, payload, timeout) {
  return new Promise((resolve) => {
    const active = connection.getActive();
    if (!active) {
      resolve({ ok: false, code: 'NO_CONNECTION', error: '尚未配置 NAS 连接' });
      return;
    }
    const header = authHeader(active);
    const custom = connection.parseHeader(active.header);
    if (custom) header[custom.key] = custom.value;
    let data = payload;
    if (method === 'POST') {
      header['content-type'] = 'application/json';
      data = payload === undefined || payload === null ? '' : JSON.stringify(payload);
    }
    wx.request({
      url: active.url + path,
      method,
      data,
      header,
      timeout: timeout || 10000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let body = res.data;
          if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { /* 保留原始文本 */ }
          }
          resolve({ ok: true, data: body, status: res.statusCode });
        } else if (res.statusCode === 401) {
          resolve({ ok: false, code: 'NEED_AUTH', error: '需要访问密码，请在「管理多套连接」里填写' });
        } else {
          resolve({ ok: false, code: 'HTTP', error: '服务返回 HTTP ' + res.statusCode });
        }
      },
      fail(err) {
        resolve({ ok: false, code: 'NETWORK', error: friendly(err, connection.inferType(active.url)) });
      }
    });
  });
}

/* 测试一个还没保存的「访问链接」：先 /api/health，再顺带取宿主机名 */
function probe(base, rawHeader, password) {
  return new Promise((resolve) => {
    const root = String(base || '').replace(/\/+$/, '');
    const header = authHeader(null, password);
    const custom = connection.parseHeader(rawHeader);
    if (custom) header[custom.key] = custom.value;
    wx.request({
      url: root + '/api/health',
      method: 'GET',
      header,
      timeout: 8000,
      success(res) {
        let body = res.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) { body = null; }
        }
        if (res.statusCode === 401) {
          resolve({ ok: false, message: '需要访问密码，请在高级选项里填写' });
          return;
        }
        if (res.statusCode !== 200 || !body || !body.ok) {
          resolve({ ok: false, message: '服务返回 HTTP ' + res.statusCode + '，请检查反代路径是否指向 LiteDock' });
          return;
        }
        wx.request({
          url: root + '/api/info',
          method: 'GET',
          header,
          timeout: 8000,
          success(r2) {
            const info = (typeof r2.data === 'object' && r2.data) ? r2.data : {};
            resolve({ ok: true, message: '连接成功' + (info.name ? ' · 宿主机 ' + info.name : '') });
          },
          fail() { resolve({ ok: true, message: '连接成功' }); }
        });
      },
      fail(err) { resolve({ ok: false, message: friendly(err, connection.inferType(root)) }); }
    });
  });
}

/* 取宿主机信息（用于连接默认以宿主机命名）：返回 /api/info 的对象或 null */
function fetchInfo(base, rawHeader, password) {
  const root = String(base || '').replace(/\/+$/, '');
  const header = authHeader(null, password);
  const custom = connection.parseHeader(rawHeader);
  if (custom) header[custom.key] = custom.value;
  return new Promise((resolve) => {
    wx.request({
      url: root + '/api/info',
      method: 'GET',
      header,
      timeout: 8000,
      success(res) {
        let body = res.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) { body = null; }
        }
        if (res.statusCode === 200 && body && body.ok && body.name) resolve(body);
        else resolve(null);
      },
      fail() { resolve(null); }
    });
  });
}

module.exports = {
  request,
  friendly,
  probe,
  fetchInfo,
  getState: () => request('GET', '/api/state', undefined, 15000),
  getLogs: (id, tail) => request('GET', '/api/container/' + encodeURIComponent(id) + '/logs?tail=' + (tail || 100), undefined, 10000),
  /* 微信 request 超时上限 60s；升级/拉镜像可能更久，服务端仍会继续执行完，
     因此调用方对超时要提示「稍后下拉刷新确认结果」，不要说操作必然失败。 */
  action: (id, act) => request('POST', '/api/container/' + encodeURIComponent(id) + '/' + act, undefined, 60000),
  checkUpdate: (id) => request('POST', '/api/container/' + encodeURIComponent(id) + '/check', undefined, 60000),
  upgrade: (id) => request('POST', '/api/container/' + encodeURIComponent(id) + '/upgrade', undefined, 60000),
  /* 1.0.15：Compose 项目整体启停（后端按 depends_on 拓扑排序） */
  projectAction: (project, act) => request('POST', '/api/project/' + encodeURIComponent(project) + '/' + act, undefined, 60000),
  /* 1.0.15：升级备份管理（已从主列表隐藏的 backup/newer 容器） */
  getBackups: () => request('GET', '/api/backups', undefined, 15000),
  backupRollback: (id) => request('POST', '/api/backup/' + encodeURIComponent(id) + '/rollback', undefined, 60000),
  backupDelete: (id) => request('POST', '/api/backup/' + encodeURIComponent(id) + '/delete', undefined, 60000)
};
