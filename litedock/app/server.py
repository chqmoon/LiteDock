#!/usr/bin/env python3
"""
LiteDock - 极简本地容器管理面板
零第三方依赖：Python 标准库直连 Docker Engine Unix Socket。

API:
  GET  /api/state                     容器列表 + Docker 概况 + 外观配置
  GET  /api/info                      Docker 概况
  POST /api/container/<id>/<action>  start | stop | restart | pause | unpause
  GET  /api/container/<id>/logs      最近日志
  POST /api/container/<id>/check     检查镜像更新（只 pull + 比对，不重建）
  POST /api/container/<id>/upgrade   升级镜像并重建容器（保留旧容器备份，失败回滚）
  POST /api/project/<proj>/<action>  批量启停 Compose 项目 start | stop | restart（依赖拓扑排序）
  GET  /api/backups                  列出升级备份容器（已从主列表隐藏）
  POST /api/backup/<id>/rollback     用备份回退（当前版本改名 newer 保留）
  POST /api/backup/<id>/delete       永久删除一个升级备份容器
  GET  /api/config                   读取外观配置
  POST /api/config                   保存外观配置
  POST /api/upload?kind=...          上传壁纸/图标/卡片背景图
  GET  /api/assets                   列出内置 + 已上传的图标与壁纸
  GET  /media/<kind>/<file>          上传的静态资源
  GET  /                             前端页面
"""
import base64
import hmac
import io
import json
import mimetypes
import os
import re
import socket
import http.client
import threading
import time
import traceback
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DOCKER_SOCK = os.environ.get("DOCKER_SOCK", "/var/run/docker.sock")
API = "/v1.41"
DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
PORT = int(os.environ.get("PORT", "8000"))
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
APP_VERSION = "1.0.31"

# 访问密码（部署时通过环境变量设定）。留空 = 不启用门禁（兼容现状）。
# 启用后，所有 /api/* 请求必须带正确的 X-LiteDock-Token 头，否则返回 401。
ACCESS_PASSWORD = (os.environ.get("ACCESS_PASSWORD") or "").strip()
AUTH_HEADER = "X-LiteDock-Token"
# 1.0.27：可选的对外主机名，仅用于启动日志打印完整访问地址（http://<host>:<hostPort>）。
# 容器内无法可靠得知 NAS 局域网 IP，故允许部署者在 compose 里写死这个值；留空则显示占位提示。
PUBLIC_HOST = (os.environ.get("LITEDOCK_PUBLIC_HOST") or "").strip()

DEFAULT_CONFIG = {
    "title": "LiteDock",
    "subtitle": "NAS容器管理",
    "wallpaper": "/assets/wallpapers/aurora.jpg",
    "wallpaperBlur": 0,
    "wallpaperMask": 0.18,
    "wallpaperBrightness": 1.0,
    "cardOpacity": 0.68,
    "cardRadius": 20,
    "accent": "#7c8cff",
    "columns": 3,
    "compact": False,
    # 1.0.3：新部署默认把全部容器集中到「常用服务」；groupMode=project 恢复旧行为
    "groups": {"tools": {"label": "常用服务", "accent": "#7c8cff", "blur": 6,
                        "mask": 0.12, "image": "", "order": 0}},
    "groupMode": "single",     # single=集中 / project=按 Compose 项目自动分组
    "collapseProjects": True,  # 同一项目 >=2 容器时合并为一张卡片
    "expandedProjects": [],    # ["<groupKey>::<project>"]
    "collapsedGroups": [],     # 1.0.7 整组收起的分组 key（收起后只留标题栏）
    "containerGroups": {}, # containerName -> groupKey
    "icons": {},           # containerName -> url
    "hidden": [],          # 隐藏的容器名
    "cardBackgrounds": {}, # containerName -> {image, blur, mask}（1.0.1 单卡片背景）
    "topbar": {"image": "", "blur": 6, "mask": 0.3},  # 1.0.5 顶部状态栏背景
    "links": {},           # containerName -> 内网自定义快捷访问 URL（1.0.1）
    "linksWan": {},        # containerName -> 外网（反代）快捷访问 URL（1.0.14）
    # 1.0.15 起不再暴露到设置界面（对多数人无用且易填错），保留默认值兼容旧配置
    "httpsPorts": [443, 5001, 8443, 9443],  # 这些宿主端口自动用 https:// 打开
    "configVersion": 3,        # 配置结构版本，用于默认值迁移（非外观项）
}

for _d in (DATA_DIR, UPLOAD_DIR, os.path.join(UPLOAD_DIR, "wallpaper"),
           os.path.join(UPLOAD_DIR, "icon"), os.path.join(UPLOAD_DIR, "card")):
    os.makedirs(_d, exist_ok=True)

_config_lock = threading.Lock()


# ---------------------------------------------------------------- Docker API
class DockerHTTP(http.client.HTTPConnection):
    def __init__(self, sock_path, timeout=30):
        super().__init__("localhost", timeout=timeout)
        self.sock_path = sock_path

    def connect(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self.sock_path)
        self.sock = s


def dkr(method, path, body=None, timeout=30, headers=None, versioned=True):
    conn = DockerHTTP(DOCKER_SOCK, timeout)
    hdr = dict(headers or {})
    payload = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        hdr["Content-Type"] = "application/json"
    try:
        conn.request(method, (API if versioned else "") + path, body=payload, headers=hdr)
        resp = conn.getresponse()
        raw = resp.read()
        return resp.status, raw
    finally:
        conn.close()


def dkr_json(method, path, body=None, timeout=30, headers=None, versioned=True):
    st, raw = dkr(method, path, body, timeout, headers, versioned)
    try:
        return st, json.loads(raw.decode("utf-8", "replace")) if raw else None
    except Exception:
        return st, {"raw": raw.decode("utf-8", "replace")[:2000]}


def negotiate_api():
    """跨 NAS 兼容：新版 Docker 会提高最低 API 版本，固定 v1.41 可能被拒绝。

    先用 v1.41 探活；若被拒，则读不带版本前缀的 /version（所有 daemon 都支持），
    改用 daemon 自己声明的 ApiVersion。老设备/QTS 上 v1.41 可用 ⇒ 行为零变化。
    """
    global API
    try:
        st, _ = dkr_json("GET", "/version", timeout=5)
        if st == 200:
            return
        st2, info = dkr_json("GET", "/version", timeout=5, versioned=False)
        av = str((info or {}).get("ApiVersion", "")) if st2 == 200 else ""
        if re.match(r"^[0-9]+\.[0-9]+$", av):
            API = "/v" + av
            print("Docker API 版本协商：v1.41 不受支持，已切换到 %s" % API, flush=True)
    except Exception as e:
        print("Docker API 版本协商跳过：%s" % e, flush=True)


def split_image(image):
    """'ghcr.io/foo/bar:1.2' -> ('ghcr.io/foo/bar', '1.2')"""
    if "@sha256:" in image:
        return image.split("@sha256:", 1)[0], "latest"
    last = image.rsplit("/", 1)[-1]
    if ":" in last:
        repo, tag = image.rsplit(":", 1)
        return repo, tag
    return image, "latest"


def short_image(image):
    name = image.rsplit("/", 1)[-1]
    return name.split("@sha256:")[0]


_image_id_map_cache = {"ts": 0, "map": {}, "repo_map": {}}
_IMAGE_MAP_TTL = 15  # 秒；镜像列表不常变，容许短暂陈旧


def _image_id_map():
    """两组映射（带 TTL 缓存，容器列表只需一次 /images/json）：
    map:      镜像 ID -> 可读 repo:tag（RepoTags 只取非 <none> 的）
    repo_map: 镜像 ID -> repo 名（即使 tag 是 <none> 也记录，供反查兜底）"""
    import time as _t
    now = _t.time()
    if _image_id_map_cache["map"] and now - _image_id_map_cache["ts"] < _IMAGE_MAP_TTL:
        return _image_id_map_cache["map"], _image_id_map_cache["repo_map"]
    m, rm = {}, {}
    try:
        st, imgs = dkr_json("GET", "/images/json", timeout=10)
        if st == 200 and isinstance(imgs, list):
            for im in imgs:
                if not isinstance(im, dict):
                    continue
                iid = im.get("Id") or ""
                if not iid:
                    continue
                tags = [t for t in (im.get("RepoTags") or []) if t and "<none>" not in t]
                if tags:
                    m[iid] = tags[0]
                # <none> tag 的镜像：从 RepoDigests 取 repo 名（repo@sha256:...）
                if not tags:
                    for dg in (im.get("RepoDigests") or []):
                        if "@sha256:" in dg:
                            rm[iid] = dg.split("@sha256:", 1)[0]
                            break
    except Exception:
        pass
    if m or rm:
        _image_id_map_cache.update({"ts": now, "map": m, "repo_map": rm})
    return m, rm


def resolve_image_ref(image):
    """把容器引用的真实镜像名解析出来。

    Compose 部署的容器 Config.Image 常被 Docker 替换成 sha256: 摘要
    （重建容器后尤其常见），面板第二行与「检查更新」就会只显示一长串 hash。
    做法：拿引用去 ID->RepoTags 映射（TTL 缓存）反查；查不到带 tag 的，
    再从 RepoDigests 还原 repo 名（典型场景：本地已 pull 过同名新镜像，
    旧镜像 tag 变 <none> 悬空——此时容器恰恰是「有新镜像」状态，用
    repo 名 + 容器原 tag 才能给出可读引用）。都失败再原样返回。
    """
    if image and not image.startswith("sha256:"):
        return image
    ref = image or ""
    if not ref:
        return ref
    m, rm = _image_id_map()
    if ref in m:
        return m[ref]
    short = ref[7:19] if ref.startswith("sha256:") else ref[:12]
    for iid, tag in m.items():
        if iid and iid[7:].startswith(short):
            return tag
    # 悬空 tag：用 repo 名 + latest 兜底（Compose 容器原引用可从 labels 反查，
    # 但容器列表场景拿不到 labels 的 tag，latest 是保守可读的选择）
    for iid, repo in rm.items():
        if iid and iid[7:].startswith(short):
            return repo + ":latest"
    return ref


def get_stats(cid):
    try:
        st, d = dkr_json("GET", "/containers/%s/stats?stream=false" % cid, timeout=8)
        if st != 200 or not isinstance(d, dict):
            return None
        cpu = d.get("cpu_stats", {})
        pre = d.get("precpu_stats", {})
        cu = cpu.get("cpu_usage", {}).get("total_usage", 0)
        pu = pre.get("cpu_usage", {}).get("total_usage", 0)
        cs = cpu.get("system_cpu_usage", 0)
        ps = pre.get("system_cpu_usage", 0)
        ncpu = cpu.get("online_cpus") or len(cpu.get("percpu_usage") or [1]) or 1
        cpct = 0.0
        if cs and cs > ps and cu >= pu:
            cpct = round((cu - pu) / (cs - ps) * ncpu * 100, 1)
        mem = d.get("memory_stats", {})
        used = mem.get("usage", 0) or 0
        limit = mem.get("limit", 0) or 0
        # 减去 cache，更贴近实际占用
        cache = (mem.get("stats") or {}).get("cache", 0) or 0
        used = max(0, used - cache)
        return {
            "cpu": max(0.0, min(100.0, cpct)),
            "memUsed": used,
            "memLimit": limit,
            "mem": round(used / limit * 100, 1) if limit else 0,
        }
    except Exception:
        return None


def container_extra(cid):
    """取网络模式与镜像声明的暴露端口。

    host 网络容器没有 PortBindings / PublicPort，/containers/json 也拿不到
    NetworkMode 与 ExposedPorts，必须单独 inspect 才能给前端兜底显示端口。
    """
    try:
        st, ins = dkr_json("GET", "/containers/%s/json" % cid, timeout=8)
        if st != 200 or not isinstance(ins, dict):
            return "", []
        mode = (ins.get("HostConfig") or {}).get("NetworkMode") or ""
        exposed = []
        for key in ((ins.get("Config") or {}).get("ExposedPorts") or {}):
            m = re.match(r"^(\d+)/", str(key))
            if m:
                p = int(m.group(1))
                if p not in exposed:
                    exposed.append(p)
        return mode, sorted(exposed)
    except Exception:
        return "", []


# ---------------------------------------------------------------- stats 缓存（1.0.4）
# Docker 的 /containers/<id>/stats?stream=false 每次要等一个约 1 秒的采样周期，
# 11 个容器分两批并发会把 /api/state 拖到 4 秒。采样移到后台线程，请求只读缓存；
# 容器状态、端口、网络模式仍然每次实时查 Docker，功能完全不变。
STATS_TTL = 12.0
_stats_lock = threading.Lock()
_stats_cache = {}       # cid -> stats dict
_stats_ts = 0.0         # 上次刷新完成时间
_stats_busy = False
_stats_ready = False


def _stats_snapshot():
    with _stats_lock:
        return dict(_stats_cache), _stats_ts, _stats_busy


def refresh_stats(rows):
    """后台刷新运行中容器的 CPU / 内存。采样失败保留上一轮数值，避免闪成 0。"""
    global _stats_ts, _stats_busy, _stats_ready
    with _stats_lock:
        if _stats_busy:
            return False
        _stats_busy = True
    try:
        running = [r for r in rows if (r.get("State") or "").lower() == "running"]
        fresh = {}
        if running:
            with ThreadPoolExecutor(max_workers=min(16, len(running))) as ex:
                for r, v in zip(running, ex.map(lambda x: get_stats(x.get("Id", "")), running)):
                    if v is not None:
                        fresh[r.get("Id", "")] = v
        alive = set(r.get("Id", "") for r in rows)
        with _stats_lock:
            for k, v in fresh.items():
                _stats_cache[k] = v
            for k in list(_stats_cache):
                if k not in alive:
                    del _stats_cache[k]
            _stats_ts = time.time()
            _stats_ready = True
        return True
    finally:
        with _stats_lock:
            _stats_busy = False


def invalidate_stats():
    """容器启停 / 升级后让缓存立即过期，下一次请求触发后台刷新。"""
    global _stats_ts
    with _stats_lock:
        _stats_ts = 0.0


# ---------------------------------------------------------------- 内置图标库
ICON_DIR = os.path.join(WEB_DIR, "assets", "icons")
_icon_keys = None
_icon_keyset = None
_icon_lock = threading.Lock()


def _load_icon_keys():
    """扫描内置图标目录（assets/icons/*.png），文件名即关键字，长词优先。

    图标随镜像打包（来自 homarr-labs/dashboard-icons，MIT），运行时往目录里
    再放 xxx.png 也能被自动识别（需重启容器重建扫描缓存）。"""
    global _icon_keys, _icon_keyset
    with _icon_lock:
        if _icon_keys is None:
            keys = []
            try:
                for f in os.listdir(ICON_DIR):
                    if f.lower().endswith(".png") and not f.startswith("."):
                        keys.append(f[:-4])
            except Exception:
                keys = []
            keys.sort(key=lambda k: (-len(k), k))  # 长词优先，等长按字典序（结果确定性）
            _icon_keys = keys
            _icon_keyset = set(keys)
    return _icon_keys


def _image_basename(image):
    """ghcr.io/linuxserver/qbittorrent:5.0 -> qbittorrent"""
    base = str(image or "").split("@")[0].split(":")[0]
    return base.split("/")[-1].lower()


def icon_auto(name, image):
    """按镜像名 / 容器名在内置图标库里自动匹配，返回站内路径或空串。

    三级匹配：① 镜像 basename / 容器名精确命中文件名；② 文件名（去连字符）
    是镜像名的一部分（embyserver -> emby）；③ 镜像名是文件名的前缀
    （mongo -> mongodb）。都不中返回空，由前端回退到分类 SVG 图标。"""
    keys = _load_icon_keys()
    if not keys:
        return ""
    cands = []
    b = _image_basename(image)
    if b:
        cands.append(b)
    n = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")
    if n and n not in cands:
        cands.append(n)
    for src in cands:  # ① 精确
        if src in _icon_keyset:
            return "/assets/icons/" + src + ".png"
    for src in cands:  # ② 图标名是镜像名的边界子串（前缀，或紧跟在 -_. 之后）
        # 1.0.10：库扩到 3900+ 后裸子串会误命中（itch⊂proxy-switch、tor⊂vector），
        # 改为边界感知；去连字符形式只允许从头开始的前缀匹配（adguardhome -> adguard-home）。
        flat = src.replace("-", "")
        if len(flat) < 3:
            continue
        for k in keys:
            if len(k) < 3:
                continue
            i = src.find(k)
            if i == 0 or (i > 0 and src[i - 1] in "-_."):
                return "/assets/icons/" + k + ".png"
            kf = k.replace("-", "")
            if kf != k and len(kf) >= 3 and flat.startswith(kf):
                return "/assets/icons/" + k + ".png"
    for src in cands:  # ③ 镜像名是图标名前缀（mongo -> mongodb）
        # 1.0.10：取「最短」的匹配图标（mongo -> mongodb，而非 mongo-express），
        # 避免全量库下被同前缀的衍生应用抢走。
        flat = src.replace("-", "")
        if len(flat) < 4:
            continue
        best = ""
        for k in keys:
            if k.replace("-", "").startswith(flat) and (not best or len(k) < len(best)):
                best = k
        if best:
            return "/assets/icons/" + best + ".png"
    return ""


# ------------------------------------------------- 升级备份容器识别（1.0.24）
# upgrade() 把旧容器改名为 <name>-backup-<ts>，rollback 又把被替换的新容器改名为
# <name>-newer-<ts>。两者都保留了 Compose 标签，若不隐藏会被前端当成项目成员显示
# 成「停止的残留」。Docker 容器 label 创建后不可改、rename 只改名字，所以只能靠
# 名字正则识别；时间戳 10 位起，避免误伤普通容器。
BACKUP_NAME_RE = re.compile(r"^(.+)-(?:backup|newer)-(\d{10,})$")


def backup_base(name):
    """是升级备份容器则返回其原始容器名，否则返回空串。"""
    m = BACKUP_NAME_RE.match(name or "")
    return m.group(1) if m else ""


# ------------------------------------------------- 自我保护：识别面板自己（1.0.26）
# LiteDock 通过挂载 docker.sock 拥有宿主 Docker 的完全控制权；它也把自己当普通容器
# 列出来。若用户点「停止/重启/升级」自己，管理界面会立刻断开，而 restart:unless-stopped
# 在手动 stop 后不会自动拉起——面板失联且 SSH 才能救回。为此：
#   ① /api/state 给自己的容器打 isSelf=true（前端显示「本体」徽标 + 禁用危险操作）
#   ② 服务端兜底拦截 stop/restart/pause/upgrade，防止绕过前端直接调 API 自断。
# 识别手段（按健壮度取并集）：cgroup 完整 ID → /proc 挂载 ID → hostname 短 ID（Docker
# 默认把容器短 ID 设为 hostname）→ 容器名精确等于 SELF_NAME。全部失败时降级为不保护，
# 不影响既有功能。
SELF_NAME = (os.environ.get("LITEDOCK_SELF_NAME") or "litedock").strip()


def _detect_self_id():
    """尽力探测本容器的 Docker ID，返回 (完整ID, 短ID)；探测不到返回 ('','')。"""
    full = ""
    try:
        with open("/proc/self/cgroup", "r", encoding="utf-8", errors="replace") as f:
            txt = f.read()
        m = re.search(r"(?:docker[-/])([0-9a-f]{64})(?:\.scope)?", txt)
        if m:
            full = m.group(1)
    except Exception:
        pass
    if not full:
        try:
            with open("/proc/self/mountinfo", "r", encoding="utf-8", errors="replace") as f:
                txt = f.read()
            m = re.search(r"/containers/([0-9a-f]{64})", txt)
            if m:
                full = m.group(1)
        except Exception:
            pass
    short = full[:12] if full else ""
    if not short:
        try:
            h = socket.gethostname().strip()
            if re.fullmatch(r"[0-9a-f]{12,64}", h):
                short = h[:12]
                if not full:
                    full = h
        except Exception:
            pass
    return full, short


SELF_ID, SELF_SHORT = _detect_self_id()


def is_self(cid, name=""):
    """cid 为容器完整 ID，name 为容器名（无前导 /）。是否就是运行本面板的容器。"""
    if SELF_ID and cid == SELF_ID:
        return True
    if SELF_SHORT and cid and cid.startswith(SELF_SHORT):
        return True
    if SELF_NAME and name and name.lstrip("/") == SELF_NAME:
        return True
    return False


def list_backups():
    """列出所有升级备份容器（backup/newer），供「备份管理」面板使用。"""
    st, rows = dkr_json("GET", "/containers/json?all=1")
    if st != 200 or not isinstance(rows, list):
        return []
    out = []
    for c in rows:
        names = c.get("Names") or []
        name = (names[0] if names else c.get("Id", "")[:12]).lstrip("/")
        base = backup_base(name)
        if not base:
            continue
        labels = c.get("Labels") or {}
        out.append({
            "id": c.get("Id", ""),
            "shortId": c.get("Id", "")[:12],
            "name": name,
            "base": base,
            "kind": "newer" if "-newer-" in name else "backup",
            "image": resolve_image_ref(c.get("Image", "")),
            "state": c.get("State", ""),
            "status": c.get("Status", ""),
            "project": labels.get("com.docker.compose.project", ""),
            "created": c.get("Created", 0),
        })
    out.sort(key=lambda x: (x["base"], -x["created"]))
    return out


def project_members(project):
    """返回某 Compose 项目下的「正式成员」（排除升级备份），含依赖信息。"""
    st, rows = dkr_json("GET", "/containers/json?all=1")
    if st != 200 or not isinstance(rows, list):
        return []
    out = []
    for c in rows:
        names = c.get("Names") or []
        name = (names[0] if names else c.get("Id", "")[:12]).lstrip("/")
        if backup_base(name):
            continue
        labels = c.get("Labels") or {}
        if labels.get("com.docker.compose.project", "") != project:
            continue
        depends = []
        for part in (labels.get("com.docker.compose.depends_on", "") or "").split(","):
            part = part.strip()
            if part:
                depends.append(part.split(":")[0])
        out.append({"id": c.get("Id", ""), "name": name,
                    "service": labels.get("com.docker.compose.service", ""),
                    "depends": depends, "state": c.get("State", "")})
    return out


def project_topo(members):
    """按 com.docker.compose.depends_on 做拓扑排序，依赖优先；有环时降级保序。"""
    services = set(m["service"] for m in members if m["service"])
    by_id = {}
    for m in members:
        deps = set(d for d in m["depends"] if d and d in services and d != m["service"])
        by_id[m["id"]] = deps
    ordered, remaining = [], list(members)
    while remaining:
        done_services = set(x["service"] for x in ordered)
        # ready = 该节点的所有依赖都已完成（依赖优先，被依赖者先启动）
        ready = [m for m in remaining if by_id[m["id"]] <= done_services]
        if not ready:            # 依赖成环：剩余全部按顺序追加，绝不死循环
            ordered.extend(remaining)
            break
        for m in ready:
            ordered.append(m)
            remaining.remove(m)
    return ordered


def project_action(project, action):
    """对一个 Compose 项目的全部容器批量 start/stop/restart。
    start：依赖优先；stop：依赖方先停（逆序）；restart：先逆序停、再正序起。"""
    if action not in ("start", "stop", "restart"):
        return {"ok": False, "error": "未知操作：" + str(action)}
    members = project_members(project)
    if not members:
        return {"ok": False, "error": "项目「%s」下没有可操作的容器" % project}
    # 1.0.26 自我保护：批量项目操作不得包含面板本体（会导致管理界面中断）
    if action in ("stop", "restart") and any(is_self(m["id"], m["name"]) for m in members):
        return {"ok": False, "code": "SELF_PROTECTED",
                "error": "该批量操作包含 LiteDock 本体容器，已整体拒绝，避免管理界面中断。"}
    topo = project_topo(members)
    if action == "start":
        seq = [(m, "start") for m in topo]
    elif action == "stop":
        seq = [(m, "stop?t=10") for m in reversed(topo)]
    else:
        seq = ([(m, "stop?t=10") for m in reversed(topo)] +
               [(m, "start") for m in topo])

    def call(m, sub):
        st, body = dkr("POST", "/containers/%s/%s" % (m["id"], sub), timeout=60)
        return st in (200, 204, 304), st

    results, failed = [], 0
    for m, sub in seq:
        succ, st = call(m, sub)
        if not succ:
            failed += 1
        results.append({"name": m["name"], "op": sub.split("?")[0], "ok": succ, "status": st})
    invalidate_stats()
    label = {"start": "启动", "stop": "停止", "restart": "重启"}[action]
    return {
        "ok": failed == 0, "action": action, "project": project,
        "total": len(members), "failed": failed,
        "results": results,
        "message": ("项目「%s」%s完成，共 %d 个容器" % (project, label, len(members))) if failed == 0
                   else ("项目「%s」%s：%d 个容器失败" % (project, label, failed)),
    }


def rollback_backup(bid):
    """用某个升级备份恢复项目：停当前同名容器并改名 newer 保留，再把备份改回原名启动。"""
    st, ins = dkr_json("GET", "/containers/%s/json" % bid, timeout=15)
    if st != 200 or not isinstance(ins, dict):
        return {"ok": False, "error": "找不到该备份容器"}
    bname = (ins.get("Name") or "").lstrip("/")
    base = backup_base(bname)
    if not base:
        return {"ok": False, "error": "该容器不是升级备份，拒绝回退"}
    ts = int(time.time())
    newer_name = "%s-newer-%d" % (base, ts)

    # 1. 找到当前占用原名的容器
    st2, cur = dkr_json("GET", "/containers/%s/json" % urllib.parse.quote(base), timeout=15)
    cur_id = ""
    if st2 == 200 and isinstance(cur, dict):
        cur_id = cur.get("Id", "")
        if (cur.get("State") or {}).get("Running"):
            s, _ = dkr("POST", "/containers/%s/stop?t=15" % cur_id, timeout=60)
            if s not in (200, 204, 304):
                return {"ok": False, "error": "停止当前容器失败 HTTP %d，未做任何更改" % s}
        s, _ = dkr("POST", "/containers/%s/rename?name=%s" %
                   (cur_id, urllib.parse.quote(newer_name)), timeout=20)
        if s != 204:
            return {"ok": False, "error": "当前容器改名失败 HTTP %d，未做更改" % s}

    def undo_current():
        if cur_id:
            dkr("POST", "/containers/%s/rename?name=%s" %
                (newer_name, urllib.parse.quote(base)), timeout=20)
            dkr("POST", "/containers/%s/start" % cur_id, timeout=30)

    # 2. 备份改名回原名
    s, _ = dkr("POST", "/containers/%s/rename?name=%s" %
               (bid, urllib.parse.quote(base)), timeout=20)
    if s != 204:
        undo_current()
        return {"ok": False, "error": "备份容器改名失败 HTTP %d，已尝试还原" % s}
    # 3. 启动恢复后的容器
    s, _ = dkr("POST", "/containers/%s/start" % bid, timeout=60)
    if s not in (200, 204, 304):
        dkr("POST", "/containers/%s/rename?name=%s" %
            (bid, urllib.parse.quote(bname)), timeout=20)
        undo_current()
        return {"ok": False, "error": "启动恢复容器失败 HTTP %d，已尝试还原" % s}
    invalidate_stats()
    return {"ok": True, "message": "已回退到 %s，当前版本保留为 %s（停止状态）" % (base, newer_name),
            "base": base, "newer": newer_name}


def delete_backup(bid):
    """永久删除一个升级备份容器（安全校验：必须是 backup/newer 命名）。"""
    st, ins = dkr_json("GET", "/containers/%s/json" % bid, timeout=15)
    if st != 200 or not isinstance(ins, dict):
        return {"ok": False, "error": "找不到该容器"}
    name = (ins.get("Name") or "").lstrip("/")
    if not backup_base(name):
        return {"ok": False, "error": "拒绝删除：该容器不是升级备份"}
    if (ins.get("State") or {}).get("Running"):
        return {"ok": False, "error": "该备份容器正在运行，请先停止"}
    s, body = dkr("DELETE", "/containers/%s?force=1" % bid, timeout=30)
    if s not in (200, 204):
        return {"ok": False, "error": "删除失败 HTTP %d" % s}
    invalidate_stats()
    return {"ok": True, "message": "已删除备份容器 %s" % name}


def build_containers():
    st, rows = dkr_json("GET", "/containers/json?all=1")
    if st != 200 or not isinstance(rows, list):
        raise RuntimeError("Docker API 返回 %s：%s" % (st, str(rows)[:300]))
    out = []
    for c in rows:
        cid = c.get("Id", "")
        names = c.get("Names") or []
        name = (names[0] if names else cid[:12]).lstrip("/")
        # 1.0.24：升级产生的 backup/newer 容器从主列表隐藏，不再混入项目卡
        if backup_base(name):
            continue
        labels = c.get("Labels") or {}
        # Docker 的 /containers/json 会按「绑定 IP」逐条返回端口：双栈 NAS
        # （同时监听 0.0.0.0 与 ::）上，同一个 宿主端口→容器端口 会出现两条
        # 完全相同的记录，只是 IP 不同。面板按宿主端口生成访问链接，重复记录
        # 会让卡片「快捷访问」把同一个端口画两遍（部分 NAS 上尤其明显）。
        # 这里按 (宿主端口, 容器端口, 协议) 去重，并优先保留 IPv4 记录。
        ports = []
        port_index = {}
        for p in c.get("Ports") or []:
            if not p.get("PublicPort"):
                continue
            key = (p.get("PublicPort"), p.get("PrivatePort"), p.get("Type", "tcp"))
            ip = p.get("IP", "0.0.0.0")
            item = {
                "host": p.get("PublicPort"),
                "container": p.get("PrivatePort"),
                "proto": p.get("Type", "tcp"),
                "ip": ip,
            }
            if key not in port_index:
                port_index[key] = len(ports)
                ports.append(item)
            elif ":" in str(ports[port_index[key]]["ip"]) and ":" not in str(ip):
                ports[port_index[key]] = item
        out.append({
            "id": cid,
            "shortId": cid[:12],
            "name": name,
            # 1.0.20：Compose 重建过的容器 Image 会变成 sha256: 摘要，卡片第二行与
            # 「检查更新」就只剩一串 hash。先经 resolve_image_ref 反查 RepoTags 还原
            # 可读的 repo:tag；本地缓存 tag 也一并给出，前端优先显示可读名。
            "image": resolve_image_ref(c.get("Image", "")),
            "imageShort": short_image(resolve_image_ref(c.get("Image", ""))),
            "state": c.get("State", "unknown"),
            "status": c.get("Status", ""),
            "created": c.get("Created", 0),
            "ports": ports,
            "networkMode": "",
            "exposedPorts": [],
            "project": labels.get("com.docker.compose.project", ""),
            "service": labels.get("com.docker.compose.service", ""),
            "labels": labels,
            # 1.0.9：内置图标库自动匹配（自定义图标 config.icons 优先级更高）
            "iconAuto": icon_auto(name, c.get("Image", "")),
            # 1.0.26：标记「运行本面板的容器自己」，前端据此显示本体徽标 + 禁用危险操作
            "isSelf": is_self(cid, name),
        })
    # 并发补采网络模式与 ExposedPorts（host 网络容器靠它显示端口）
    if out:
        with ThreadPoolExecutor(max_workers=min(16, len(out))) as ex:
            for c, extra in zip(out, ex.map(lambda x: container_extra(x["id"]), out)):
                c["networkMode"], c["exposedPorts"] = extra
    # CPU / 内存改读后台缓存：进程内第一次同步预热保证首屏就有数据，
    # 之后按 TTL 由后台线程刷新，请求线程永不等待 1 秒采样周期。
    snap, ts, busy = _stats_snapshot()
    if not _stats_ready and not busy:
        refresh_stats(rows)
        snap, ts, busy = _stats_snapshot()
    elif time.time() - ts >= STATS_TTL and not busy:
        threading.Thread(target=refresh_stats, args=(rows,), daemon=True).start()
    for c in out:
        c["stats"] = snap.get(c["id"])
    for c in out:
        c.setdefault("stats", None)
    out.sort(key=lambda x: (x["project"] or "zzz", x["name"].lower()))
    return out


def get_info():
    """全部字段实时取自本机 Docker Engine，不含任何写死的机型/系统信息。"""
    st, d = dkr_json("GET", "/info", timeout=10)
    if st != 200 or not isinstance(d, dict):
        return {"ok": False, "socket": DOCKER_SOCK, "apiPath": API}
    st2, ver = dkr_json("GET", "/version", timeout=10)
    ver = ver if isinstance(ver, dict) else {}
    return {
        "ok": True,
        "name": d.get("Name") or "Docker 主机",
        "version": ver.get("Version", "") if st2 == 200 else "",
        "apiVersion": ver.get("ApiVersion", "") if st2 == 200 else "",
        "os": d.get("OperatingSystem", ""),
        "arch": d.get("Architecture", ""),
        "kernel": d.get("KernelVersion", ""),
        "socket": DOCKER_SOCK,
        "apiPath": API,
        "containers": d.get("Containers", 0),
        "running": d.get("ContainersRunning", 0),
        "stopped": d.get("ContainersStopped", 0),
        "paused": d.get("ContainersPaused", 0),
        "images": d.get("Images", 0),
    }


def get_logs(cid, tail=150):
    st, raw = dkr("GET", "/containers/%s/logs?stdout=1&stderr=1&tail=%d&timestamps=0" % (cid, tail), timeout=15)
    if st != 200:
        return {"ok": False, "error": "HTTP %d" % st}
    # Docker 多路复用流：8 字节头 [stream,0,0,0,len(4)]
    text = bytearray()
    buf = raw
    i = 0
    if len(buf) >= 8 and buf[0] in (1, 2) and buf[1:4] == b"\x00\x00\x00":
        while i + 8 <= len(buf):
            ln = int.from_bytes(buf[i + 4:i + 8], "big")
            i += 8
            if ln <= 0 or i + ln > len(buf):
                break
            text += buf[i:i + ln]
            i += ln
    else:
        text = bytearray(buf)
    return {"ok": True, "text": text.decode("utf-8", "replace")[-16000:]}


def pull_if_possible(image):
    """尽力拉取镜像；仓库不可达不视为致命错误（离线环境也要能升级）。"""
    repo, tag = split_image(image)
    auth = base64.b64encode(b"{}").decode()
    try:
        pst, praw = dkr("POST", "/images/create?fromImage=%s&tag=%s" %
                        (urllib.parse.quote(repo, safe=""), urllib.parse.quote(tag, safe="")),
                        timeout=180, headers={"X-Registry-Auth": auth})
        if pst == 200:
            return True, ""
        return False, "HTTP %d %s" % (pst, praw.decode("utf-8", "replace")[:120])
    except Exception as e:
        return False, str(e)[:160]


def local_image_id(image):
    ist, idata = dkr_json("GET", "/images/%s/json" % urllib.parse.quote(image, safe=""), timeout=15)
    return (idata or {}).get("Id", "") if ist == 200 else ""


def check_update(cid):
    """只检查、绝不重建。仓库不可达时仍会比较本地同名 tag 的镜像 ID，
    因此用镜像加速源手动 pull + tag 后，这里一样能识别出「有新镜像」。
    1.0.20：image 经 resolve_image_ref 还原为 repo:tag（Compose 重建过的容器
    Config.Image 是 sha256: 摘要，直接 pull 会失败且前端显示不出版本号），
    并返回当前/最新的 repo:tag + 提取出的版本号 tag，前端据此显示具体版本。"""
    st, ins = dkr_json("GET", "/containers/%s/json" % cid, timeout=15)
    if st != 200 or not isinstance(ins, dict):
        return {"ok": False, "error": "无法读取容器信息 (HTTP %d)" % st}
    raw_image = ins.get("Config", {}).get("Image", "")
    old_id = ins.get("Image", "")
    image = resolve_image_ref(raw_image) or raw_image
    repo, tag = split_image(image)
    online, pull_err = pull_if_possible(image)
    new_id = local_image_id(image)
    has = bool(new_id and old_id and new_id != old_id)
    if has:
        msg = "发现新镜像，可点「升级」重建"
    elif online:
        msg = "已是最新版本"
    else:
        msg = "镜像仓库不可达，本地也无新版本（可手动从加速源 pull 同名 tag）"
    return {
        "ok": True, "image": image,
        "repo": repo, "tag": tag,
        "oldId": old_id[:19], "newId": new_id[:19],
        "hasUpdate": has, "online": online, "pullError": pull_err,
        "message": msg,
    }


def upgrade(cid):
    """手动触发：pull 新镜像 -> 备份配置 -> 停旧容器 -> 用原配置建同名新容器 -> 启动。
    旧容器重命名为 <name>-backup-<ts> 并保留（停止状态），失败自动回滚。
    1.0.20：image 的 Config.Image 若是 sha256: 摘要（Compose 重建常见），
    先经 resolve_image_ref 还原 repo:tag 再 pull，否则 /images/create 会 404。"""
    st, ins = dkr_json("GET", "/containers/%s/json" % cid, timeout=15)
    if st != 200 or not isinstance(ins, dict):
        return {"ok": False, "error": "无法读取容器信息"}
    name = (ins.get("Name") or "").lstrip("/")
    raw_image = ins.get("Config", {}).get("Image", "")
    old_id = ins.get("Image", "")
    image = resolve_image_ref(raw_image) or raw_image
    repo, tag = split_image(image)

    online, pull_err = pull_if_possible(image)
    new_id = local_image_id(image)
    if not new_id:
        return {"ok": False, "error": "本地找不到镜像 " + image}
    if old_id and new_id == old_id:
        return {
            "ok": True, "changed": False,
            "message": ("镜像已是最新，无需重建" if online else
                        "镜像仓库不可达且本地无新版本，未做任何更改。可先用加速源 pull 同名 tag 再点升级"),
        }

    # 备份原配置，便于人工回滚
    backup_file = os.path.join(DATA_DIR, "backup-%s-%d.json" % (re.sub(r"[^\w.-]", "_", name), int(time.time())))
    with open(backup_file, "w", encoding="utf-8") as f:
        json.dump(ins, f, ensure_ascii=False, indent=1)

    cfg = ins.get("Config") or {}
    host = dict(ins.get("HostConfig") or {})
    create = {
        "Image": image,
        "Hostname": cfg.get("Hostname", ""),
        "Domainname": cfg.get("Domainname", ""),
        "User": cfg.get("User", ""),
        "Env": cfg.get("Env"),
        "Cmd": cfg.get("Cmd"),
        "Entrypoint": cfg.get("Entrypoint"),
        "WorkingDir": cfg.get("WorkingDir", ""),
        "Labels": cfg.get("Labels") or {},
        "ExposedPorts": cfg.get("ExposedPorts") or {},
        "Healthcheck": cfg.get("Healthcheck"),
        "StopSignal": cfg.get("StopSignal"),
        "Volumes": cfg.get("Volumes"),
        "Tty": cfg.get("Tty", False),
        "OpenStdin": cfg.get("OpenStdin", False),
        "StdinOnce": cfg.get("StdinOnce", False),
        "AttachStdin": False, "AttachStdout": False, "AttachStderr": False,
        "HostConfig": host,
    }
    nets = (ins.get("NetworkSettings") or {}).get("Networks") or {}
    if nets:
        create["NetworkingConfig"] = {"EndpointsConfig": nets}
    # 这些字段 create 不接受
    for k in ("AutoRemove", "Links", "VolumeDriver"):
        host.pop(k, None)

    was_running = (ins.get("State") or {}).get("Running", False)
    backup_name = "%s-backup-%d" % (name, int(time.time()))

    def rollback(msg):
        # 尽力把旧容器名字与状态还原
        try:
            dkr("POST", "/containers/%s/rename?name=%s" % (backup_name, urllib.parse.quote(name)))
            if was_running:
                dkr("POST", "/containers/%s/start" % cid, timeout=30)
        except Exception:
            pass
        return {"ok": False, "error": msg + "（已尝试回滚，旧容器保留）"}

    # 1. 停旧 + 改名让出容器名
    if was_running:
        s1, _ = dkr("POST", "/containers/%s/stop?t=15" % cid, timeout=60)
        if s1 not in (204, 304):
            return {"ok": False, "error": "停止旧容器失败 HTTP %d，未做任何更改" % s1}
    s2, r2 = dkr("POST", "/containers/%s/rename?name=%s" % (cid, urllib.parse.quote(backup_name)), timeout=20)
    if s2 != 204:
        return rollback("旧容器改名失败 HTTP %d" % s2)

    # 2. 创建新容器
    s3, r3 = dkr_json("POST", "/containers/create?name=%s" % urllib.parse.quote(name),
                      body=create, timeout=60)
    if s3 not in (201, 200) or not isinstance(r3, dict) or not r3.get("Id"):
        return rollback("创建新容器失败 HTTP %d：%s" % (s3, str(r3)[:220]))
    new_cid = r3["Id"]

    # 3. 启动并做健康检查
    s4, _ = dkr("POST", "/containers/%s/start" % new_cid, timeout=60)
    if s4 not in (204, 304):
        try:
            dkr("DELETE", "/containers/%s?force=1" % new_cid)
        except Exception:
            pass
        return rollback("新容器启动失败 HTTP %d" % s4)

    return {
        "ok": True, "changed": True,
        "message": "升级完成，旧容器已保留为 %s（停止状态）" % backup_name,
        "newId": new_cid[:12], "backup": backup_name, "configBackup": os.path.basename(backup_file),
    }


# ---------------------------------------------------------------- config
def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        with _config_lock:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    user = json.load(f)
                if isinstance(user, dict):
                    # 1.0.1 → 1.0.2：把旧默认副标题升级为新默认值，用户自定义值不动
                    old_ver = user.get("configVersion", 1)
                    v2 = not isinstance(old_ver, int) or old_ver < 2
                    v3 = not isinstance(old_ver, int) or old_ver < 3
                    legacy = v2 and user.get("subtitle") in (None, "", "容器管理")
                    cfg.update(user)
                    if legacy:
                        cfg["subtitle"] = DEFAULT_CONFIG["subtitle"]
                    # 旧配置升级：没自定义过分组的机器（刚部署完的）直接享受
                    # 「全部集中到常用服务」；已有自定义分组的保持按项目分组，不打乱布局
                    if v3 and "groupMode" not in user:
                        custom_groups = bool(user.get("groups")) or bool(user.get("containerGroups"))
                        cfg["groupMode"] = "project" if custom_groups else "single"
                    cfg["configVersion"] = DEFAULT_CONFIG["configVersion"]
    except Exception:
        pass
    return cfg


def save_config(cfg):
    clean = {}
    for k, v in cfg.items():
        if k in DEFAULT_CONFIG:
            clean[k] = v
    with _config_lock:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(clean, f, ensure_ascii=False, indent=2)
    return clean


def list_assets():
    result = {"wallpaper": [], "icon": [], "card": []}
    for kind in result:
        d = os.path.join(UPLOAD_DIR, kind)
        if os.path.isdir(d):
            for fn in sorted(os.listdir(d)):
                result[kind].append({"name": fn, "url": "/media/%s/%s" % (kind, urllib.parse.quote(fn))})
    return result


SAFE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".avif"}


def handle_upload(kind, filename, data):
    if kind not in ("wallpaper", "icon", "card"):
        return None, "kind 只能是 wallpaper / icon / card"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in SAFE_EXT:
        return None, "只支持图片格式：%s" % ", ".join(sorted(SAFE_EXT))
    if len(data) > 30 * 1024 * 1024:
        return None, "文件超过 30MB"
    safe = "%s-%d-%s%s" % (kind, int(time.time() * 1000),
                           base64.b16encode(os.urandom(3)).decode().lower(), ext)
    path = os.path.join(UPLOAD_DIR, kind, safe)
    with open(path, "wb") as f:
        f.write(data)
    return {"name": filename, "url": "/media/%s/%s" % (kind, urllib.parse.quote(safe))}, None


# ---------------------------------------------------------------- 安全辅助
def _inside(base, target):
    """按路径分量判断包含关系，避免 /app/web_evil 之类字符串前缀绕过 /app/web。"""
    base, target = os.path.abspath(base), os.path.abspath(target)
    try:
        return os.path.commonpath([base, target]) == base
    except ValueError:
        return False


# 登录失败限速：纯内存计数，成功即清零；正常输错 1~2 次完全无感。
_login_fails = {}   # client ip -> (连续失败次数, 解锁时间戳)
_login_lock = threading.Lock()
LOGIN_MAX_FAILS = 5
LOGIN_LOCK_SECONDS = 30


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    # HTTP Server 头也曾硬编码 1.0.14 漏改过 —— 改为动态引用，杜绝再漏
    server_version = "LiteDock/" + APP_VERSION

    def log_message(self, fmt, *args):
        print("[%s] %s" % (time.strftime("%H:%M:%S"), fmt % args), flush=True)

    def _check_auth(self):
        """访问密码门禁：恒定时间比对，防时序侧信道；中文密码按 UTF-8 编码后比对。"""
        if not ACCESS_PASSWORD:
            return True
        return hmac.compare_digest(
            (self.headers.get(AUTH_HEADER, "") or "").encode("utf-8"),
            ACCESS_PASSWORD.encode("utf-8"))

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj, code=200):
        self._send(code, obj)

    def _file(self, path):
        if not os.path.isfile(path):
            return self._send(404, "Not Found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        with open(path, "rb") as f:
            data = f.read()
        extra = {"Cache-Control": "public, max-age=300"}
        # 上传资源禁止 MIME 嗅探；SVG 即使被直接打开也不执行脚本。
        if _inside(UPLOAD_DIR, path):
            extra["X-Content-Type-Options"] = "nosniff"
            if ctype.startswith("image/svg+xml"):
                extra["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
        self._send(200, data, ctype, extra)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        p = urllib.parse.unquote(u.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            # 静态资源（页面 / 资源）始终放行；只有 /api/* 受访问密码保护。
            # 1.0.27：/api/health 例外放行——Docker HEALTHCHECK 与 APP「测试连接」探针不带
            # token，若被门禁拦成 401，容器会被判 unhealthy（部分 NAS 项目页显示「非正常」）。
            if p.startswith("/api/") and p != "/api/health" and not self._check_auth():
                return self._send(401, {"ok": False, "error": "需要密码访问", "code": "NEED_AUTH"},
                                  "application/json; charset=utf-8")
            if p == "/" or p == "/index.html":
                return self._file(os.path.join(WEB_DIR, "index.html"))

            if p.startswith("/media/"):
                parts = p.split("/")
                if len(parts) != 4 or parts[2] not in ("wallpaper", "icon", "card"):
                    return self._send(403, "Forbidden", "text/plain")
                target = os.path.normpath(os.path.join(UPLOAD_DIR, parts[2], parts[3]))
                if not _inside(os.path.join(UPLOAD_DIR, parts[2]), target):
                    return self._send(403, "Forbidden", "text/plain")
                return self._file(target)

            if p.startswith("/assets/"):
                target = os.path.normpath(os.path.join(WEB_DIR, p.lstrip("/")))
                if not _inside(WEB_DIR, target):
                    return self._send(403, "Forbidden", "text/plain")
                return self._file(target)

            if p == "/api/state":
                info = get_info()
                containers = build_containers()
                return self._json({"ok": True, "appVersion": APP_VERSION,
                                   "info": info, "containers": containers,
                                   "config": load_config(), "assets": list_assets()})

            if p == "/api/info":
                return self._json(get_info())

            if p == "/api/config":
                return self._json(load_config())

            if p == "/api/assets":
                return self._json(list_assets())

            if p == "/api/backups":
                return self._json({"ok": True, "backups": list_backups()})

            m = re.match(r"^/api/container/([^/]+)/logs$", p)
            if m:
                return self._json(get_logs(m.group(1), int(q.get("tail", ["150"])[0])))

            if p == "/api/health":
                # 1.0.27：健康探针保持轻量且与密码解耦。用 2s 短超时探测 docker.sock，
                # 无论 socket 是否就绪都回 200（ok 字段反映 socket 状态）——避免 NAS 上
                # socket 抖动/慢响应把整个容器拖成 unhealthy（外层 HEALTHCHECK 仅 3s）。
                try:
                    st, _ = dkr_json("GET", "/version", timeout=2)
                    socket_ok = (st == 200)
                except Exception:
                    socket_ok = False
                return self._json({"ok": socket_ok, "socket": DOCKER_SOCK, "api": API,
                                   "version": APP_VERSION})

            return self._send(404, "Not Found", "text/plain")
        except Exception as e:
            traceback.print_exc()
            return self._json({"ok": False, "error": str(e)}, 500)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        p = urllib.parse.unquote(u.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length) if length else b""

            # 登录接口始终开放：用于校验访问密码并返回是否启用。
            if p == "/api/login":
                ip = self.client_address[0]
                now = time.time()
                with _login_lock:
                    cnt, until = _login_fails.get(ip, (0, 0))
                    if now >= until and cnt >= LOGIN_MAX_FAILS:
                        cnt, until = 0, 0
                        _login_fails.pop(ip, None)
                    if now < until:
                        return self._json({"ok": False, "error": "尝试次数过多，请稍后再试"}, 429)
                try:
                    d = json.loads(raw.decode("utf-8")) if raw else {}
                except Exception:
                    return self._json({"ok": False, "error": "JSON 格式错误"}, 400)
                pw = (d or {}).get("password", "")
                if not ACCESS_PASSWORD:
                    return self._json({"ok": True, "enabled": False})
                if hmac.compare_digest(str(pw).encode("utf-8"), ACCESS_PASSWORD.encode("utf-8")):
                    with _login_lock:
                        _login_fails.pop(ip, None)
                    return self._json({"ok": True, "enabled": True})
                with _login_lock:
                    cnt, _ = _login_fails.get(ip, (0, 0))
                    cnt += 1
                    until = now + LOGIN_LOCK_SECONDS if cnt >= LOGIN_MAX_FAILS else 0
                    _login_fails[ip] = (cnt, until)
                if cnt >= LOGIN_MAX_FAILS:
                    return self._json({"ok": False, "error": "尝试次数过多，请稍后再试"}, 429)
                return self._json({"ok": False, "error": "密码错误"}, 401)

            if p.startswith("/api/") and not self._check_auth():
                return self._json({"ok": False, "error": "需要密码访问", "code": "NEED_AUTH"}, 401)

            if p == "/api/config":
                try:
                    cfg = json.loads(raw.decode("utf-8"))
                except Exception:
                    return self._json({"ok": False, "error": "JSON 格式错误"}, 400)
                return self._json({"ok": True, "config": save_config(cfg)})

            if p == "/api/upload":
                kind = q.get("kind", ["wallpaper"])[0]
                filename = q.get("name", ["upload.png"])[0]
                res, err = handle_upload(kind, filename, raw)
                if err:
                    return self._json({"ok": False, "error": err}, 400)
                return self._json({"ok": True, **res})

            m = re.match(r"^/api/container/([^/]+)/(start|stop|restart|pause|unpause)$", p)
            if m:
                cid, action = m.group(1), m.group(2)
                # 1.0.26 自我保护：禁止通过面板停止/重启/暂停自己，否则管理界面自断，
                # restart:unless-stopped 不会拉起手动 stop，只能 SSH 救回。
                if action in ("stop", "restart", "pause") and is_self(cid):
                    return self._json({"ok": False, "code": "SELF_PROTECTED",
                                       "error": "这是 LiteDock 本体容器，禁止在面板内停止/重启/暂停自己（会导致管理界面中断）。请在 NAS 的容器管理界面中操作。"}, 403)
                path = "/containers/%s/%s" % (cid, action)
                if action in ("stop", "restart"):
                    path += "?t=10"
                st, body = dkr("POST", path, timeout=60)
                if st in (204, 200, 304):
                    invalidate_stats()
                    return self._json({"ok": True, "action": action, "status": st})
                return self._json({"ok": False, "error": "HTTP %d %s" %
                                   (st, body.decode("utf-8", "replace")[:200])}, 500)

            m = re.match(r"^/api/container/([^/]+)/check$", p)
            if m:
                return self._json(check_update(m.group(1)))

            m = re.match(r"^/api/container/([^/]+)/upgrade$", p)
            if m:
                cid = m.group(1)
                # 1.0.26 自我保护：升级自己会停旧建新，中途面板失联且回滚依赖自身进程，
                # 风险极高，禁止通过面板操作本体（用部署脚本升级 Web 才是正确路径）。
                if is_self(cid):
                    return self._json({"ok": False, "code": "SELF_PROTECTED",
                                       "error": "这是 LiteDock 本体容器，禁止在面板内升级重建自己。请用 NAS 上的部署脚本升级。"}, 403)
                res = upgrade(cid)
                invalidate_stats()
                return self._json(res)

            # 1.0.24：Compose 项目批量启停 / 升级备份回退与清理
            m = re.match(r"^/api/project/([^/]+)/(start|stop|restart)$", p)
            if m:
                return self._json(project_action(m.group(1), m.group(2)))

            m = re.match(r"^/api/backup/([^/]+)/rollback$", p)
            if m:
                return self._json(rollback_backup(m.group(1)))

            m = re.match(r"^/api/backup/([^/]+)/delete$", p)
            if m:
                return self._json(delete_backup(m.group(1)))

            return self._send(404, "Not Found", "text/plain")
        except Exception as e:
            traceback.print_exc()
            return self._json({"ok": False, "error": str(e)}, 500)


def advertised_url():
    """1.0.27：拼出对外访问地址。
    宿主端口从「自身容器」的端口映射读取（各 NAS 映射的宿主端口可能不同，不能写死）；
    宿主 IP 容器内无法可靠得知，用可选的 LITEDOCK_PUBLIC_HOST 环境变量，留空显示占位提示。
    """
    host = PUBLIC_HOST or "<NAS的IP>"
    host_port = str(PORT)
    cid = SELF_ID or SELF_NAME
    if cid:
        try:
            st, ins = dkr_json("GET", "/containers/%s/json" % urllib.parse.quote(cid), timeout=3)
            if st == 200 and ins:
                pm = (((ins.get("NetworkSettings") or {}).get("Ports") or {})
                      .get(str(PORT) + "/tcp") or [])
                if pm and pm[0].get("HostPort"):
                    host_port = str(pm[0]["HostPort"])
        except Exception:
            pass
    return "http://%s:%s" % (host, host_port)


def main():
    # 通用版安全底线：未设置访问密码时拒绝启动，杜绝 docker.sock≈root 的容器裸奔。
    # 需要临时本地调试可显式设 LITEDOCK_ALLOW_NOAUTH=1 绕过（仅限受信任的隔离环境）。
    if not ACCESS_PASSWORD and os.environ.get("LITEDOCK_ALLOW_NOAUTH") != "1":
        print("=" * 56, flush=True)
        print("  [ refusing to start ] ACCESS_PASSWORD is empty.", flush=True)
        print("  LiteDock mounts docker.sock (≈ host root). A public/通用 deployment", flush=True)
        print("  must set a password. Add to your compose environment:", flush=True)
        print("    - ACCESS_PASSWORD=<your-strong-password>", flush=True)
        print("  For isolated local debugging only: LITEDOCK_ALLOW_NOAUTH=1", flush=True)
        print("=" * 56, flush=True)
        raise SystemExit(1)
    os.chdir(WEB_DIR)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print("LiteDock listening on :%d | docker.sock=%s | data=%s" %
          (PORT, DOCKER_SOCK, DATA_DIR), flush=True)
    negotiate_api()
    try:
        st, _ = dkr_json("GET", "/version", timeout=5)
        print("Docker API %s:" % API, "OK" if st == 200 else "HTTP %d (检查 socket 挂载)" % st, flush=True)
    except Exception as e:
        print("Docker API 连接失败:", e, flush=True)
    # 1.0.27：启动完成后打印访问地址；设置了访问密码才打印密码行（敏感信息不落空日志）。
    print("=" * 56, flush=True)
    print("  LiteDock %s 已就绪" % APP_VERSION, flush=True)
    print("  访问地址: %s" % advertised_url(), flush=True)
    if not PUBLIC_HOST:
        print("  (如需显示完整地址，在 compose 环境变量加 LITEDOCK_PUBLIC_HOST=<NAS的IP>)", flush=True)
    if ACCESS_PASSWORD:
        print("  访问密码: %s" % ACCESS_PASSWORD, flush=True)
    print("=" * 56, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
