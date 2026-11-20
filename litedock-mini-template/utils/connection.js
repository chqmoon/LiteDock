/* 连接配置：本地只保存 NAS 的「访问链接」和少量高级项。
   局域网 http://IP:端口，外网填已做好的 HTTPS 反向代理地址；类型自动识别，不缓存容器数据。 */
const KEY_LIST = 'fd_connections';
const KEY_ACTIVE = 'fd_active_id';

function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function put(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  return m ? m[1] : '';
}

function hostnameOf(url) {
  return hostOf(url).replace(/:\d+$/, '');
}

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^localhost$/i.test(host);
}

/* 没写协议时：IP / localhost 自动补 http，域名自动补 https；已写协议则原样保留 */
function normalizeUrl(raw, type) {
  let u = String(raw || '').trim().replace(/\s+/g, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    const bare = u.split('/')[0].replace(/:\d+$/, '');
    if (type === 'proxy') u = 'https://' + u;
    else if (type === 'lan') u = 'http://' + u;
    else u = (isIp(bare) ? 'http://' : 'https://') + u;
  }
  return u.replace(/\/+$/, '');
}

/* 列表标签用：https + 非 IP 视为反向代理，其余都是局域网 / 内网 */
function inferType(url) {
  const s = String(url || '');
  if (!/^https:\/\//i.test(s)) return 'lan';
  return isIp(hostnameOf(s)) ? 'lan' : 'proxy';
}

function makeId() {
  return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 10000).toString(36);
}

function ensureDefaults() {
  const all = get(KEY_LIST, null);
  if (!Array.isArray(all)) put(KEY_LIST, []);
}

function list() {
  const l = get(KEY_LIST, []);
  return Array.isArray(l) ? l : [];
}

function validate(input) {
  const src = input || {};
  const url = normalizeUrl(src.url, src.type);
  if (!/^https?:\/\/[^/?#]+/i.test(url)) return { ok: false, error: '请填写正确的访问链接' };
  /* 主机名含非 ASCII 字符（如整段中文）说明不是有效地址：本地直接拦截，
     不再对必然失败的地址发网络请求（用户会看到干净的提示而不是超时错误） */
  const hostName = hostnameOf(url);
  if (!hostName || /[^\x20-\x7e]/.test(hostName)) return { ok: false, error: '请填写正确的访问链接' };
  const type = inferType(url);
  const defaultName = hostnameOf(url);
  const name = String(src.name || '').trim() || defaultName;
  const hostInput = String(src.host || '').trim();
  const host = (hostInput || defaultName).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return {
    ok: true,
    value: {
      id: src.id || makeId(),
      name: name.slice(0, 24),
      type,
      url,
      host,
      header: String(src.header || '').trim().slice(0, 300),
      password: String(src.password || '').trim().slice(0, 200),
      note: String(src.note || '').trim().slice(0, 60),
      created: src.created || Date.now()
    }
  };
}

function save(input) {
  const r = validate(input);
  if (!r.ok) return r;
  const all = list();
  const idx = all.findIndex((x) => x.id === r.value.id);
  if (idx >= 0) all[idx] = r.value;
  else all.push(r.value);
  if (!put(KEY_LIST, all)) return { ok: false, error: '本地存储写入失败' };
  if (!get(KEY_ACTIVE, '')) put(KEY_ACTIVE, r.value.id);
  return { ok: true, value: r.value };
}

function remove(id) {
  const all = list().filter((x) => x.id !== id);
  put(KEY_LIST, all);
  if (get(KEY_ACTIVE, '') === id) put(KEY_ACTIVE, all.length ? all[0].id : '');
  return all;
}

function setActive(id) {
  put(KEY_ACTIVE, id);
  return getActive();
}

function getActive() {
  const id = get(KEY_ACTIVE, '');
  const all = list();
  return all.find((x) => x.id === id) || all[0] || null;
}

function typeLabel(type) {
  return type === 'proxy' ? '反向代理' : '局域网';
}

/* 反代加鉴权时可用：把 "Authorization: Basic xxxx" 拆成请求头键值 */
function parseHeader(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const key = s.slice(0, i).trim();
  const value = s.slice(i + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

module.exports = {
  list, save, remove, setActive, getActive,
  ensureDefaults, validate,
  normalizeUrl, hostnameOf, inferType, typeLabel, parseHeader,
  KEY_LIST, KEY_ACTIVE
};
