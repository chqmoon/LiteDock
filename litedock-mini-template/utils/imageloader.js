/* 图片落地（1.0.8 新增）：<image> 标签发请求不能携带自定义鉴权头，
   反代加 BasicAuth 时远程图会 401 一片空白；且真机上 http 远程图也可能被拦。
   统一用 wx.downloadFile（支持 header）把图换成本地临时路径再显示；
   失败时保留远程 URL 兜底（行为与旧版一致），会话内按 URL 缓存避免重复下载。 */
const connection = require('./connection.js');

function authHeader() {
  const c = connection.getActive();
  if (!c || !c.header) return null;
  const h = connection.parseHeader(c.header);
  if (!h) return null;
  const o = {};
  o[h.key] = h.value;
  return o;
}

function store() {
  const app = getApp();
  if (!app.globalData.imgCache) app.globalData.imgCache = {};
  return app.globalData.imgCache;
}

/* items: [{ path, url }]。path 是 setData 路径（如 'vm.groups[0].bgUrl'）。
   已缓存 → 校验本地文件仍在（微信可能清理临时文件）后再用，否则重新下载；
   未缓存 → 后台下载成功后覆盖，失败不动（保留远程 URL 兜底）。 */
function localize(page, items) {
  if (!page || !items || !items.length) return;
  const header = authHeader();
  const cache = store();

  function apply(path, localPath) {
    const d = {};
    d[path] = localPath;
    page.setData(d);
  }

  function fetchInto(path, url) {
    wx.downloadFile({
      url: url,
      header: header || {},
      success: (r) => {
        if (r.statusCode === 200 && r.tempFilePath) {
          cache[url] = r.tempFilePath;
          apply(path, r.tempFilePath);
        }
      },
      fail: () => {}
    });
  }

  function useCached(path, url) {
    const localPath = cache[url];
    let fs = null;
    try {
      fs = wx.getFileSystemManager && wx.getFileSystemManager();
    } catch (e) {
      fs = null;
    }
    if (!fs || !fs.access) {
      apply(path, localPath);
      return;
    }
    fs.access({
      path: localPath,
      success: () => apply(path, localPath),
      fail: () => {
        delete cache[url];
        fetchInto(path, url);
      }
    });
  }

  items.forEach((it) => {
    if (!it || !it.url) return;
    if (cache[it.url]) useCached(it.path, it.url);
    else fetchInto(it.path, it.url);
  });
}

/* 面板页 vm → 待落地清单 */
function fromIndexVm(vm) {
  const items = [];
  if (!vm) return items;
  /* 整页壁纸：和顶栏图一样必须落地（反代 BasicAuth 下 <image> 直接 401），
     否则「项目总背景」在反代连接里整片空白（1.0.11 修） */
  if (vm.wallpaperUrl) items.push({ path: 'vm.wallpaperUrl', url: vm.wallpaperUrl });
  if (vm.heroBgUrl) items.push({ path: 'vm.heroBgUrl', url: vm.heroBgUrl });
  (vm.groups || []).forEach((g, gi) => {
    if (g.bgUrl) items.push({ path: 'vm.groups[' + gi + '].bgUrl', url: g.bgUrl });
    (g.cards || []).forEach((c, ci) => {
      const base = 'vm.groups[' + gi + '].cards[' + ci + ']';
      if (c.bgUrl) items.push({ path: base + '.bgUrl', url: c.bgUrl });
      if (c.iconUrl) items.push({ path: base + '.iconUrl', url: c.iconUrl });
    });
  });
  return items;
}

/* 详情页 card → 待落地清单 */
function fromDetailCard(card) {
  const items = [];
  if (!card) return items;
  if (card.bgUrl) items.push({ path: 'card.bgUrl', url: card.bgUrl });
  if (card.iconUrl) items.push({ path: 'card.iconUrl', url: card.iconUrl });
  return items;
}

module.exports = { localize, fromIndexVm, fromDetailCard };
