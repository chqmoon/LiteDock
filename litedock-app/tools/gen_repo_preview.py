"""生成本地 GitHub 仓库首页预览（上传前最后模板）。

严格按当前工作区真实文件 + .gitignore 规则渲染：
- 只显示实际会 git add 的顶层条目
- README.md 现场渲染
- 语言占比按真实会入库文件字节统计
输出：.workbuddy/repo-preview.html（已在 gitignore，不污染仓库）
"""
import os, re, fnmatch, html, collections

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(BASE, '.workbuddy', 'repo-preview.html')

SKIP_DIRS = {'node_modules', '.workbuddy', '.git', '__pycache__',
             'build', '.gradle', 'screenshots'}


def ignored(rel):
    n = rel.replace('\\', '/')
    parts = n.split('/')
    if any(p in SKIP_DIRS for p in parts):
        return True
    b = os.path.basename(n)
    if b in ('.nas_env', 'qnap_ssh.py', 'local.properties', '.DS_Store', 'Thumbs.db'):
        return True
    if fnmatch.fnmatch(b, 'deploy_web_*.py'):
        return True
    if b in ('ContainerStation.yml', 'ContainerStation-免构建版.yml'):
        return True
    if n in ('litedock/操作教程.md', 'litedock-app/使用说明.md'):
        return True
    if b.endswith('.genie') or b.startswith('mini-fresh-'):
        return True
    if b.endswith(('.apk', '.zip', '.md5', '.pyc', '.pyo', '.log', '.tmp')):
        return True
    return False


BINARY_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
              '.woff', '.woff2', '.ttf', '.eot', '.otf', '.pdf'}


def collect():
    entries = []
    for n in sorted(os.listdir(BASE)):
        p = os.path.join(BASE, n)
        if ignored(n):
            continue
        # git 不跟踪空目录：目录内若无任何会入库文件，则不显示
        if os.path.isdir(p):
            has = False
            for dp, dns, fns in os.walk(p):
                dns[:] = [d for d in dns if d not in SKIP_DIRS]
                if any(not ignored(os.path.relpath(os.path.join(dp, f), BASE)) for f in fns):
                    has = True
                    break
            if not has:
                continue
        entries.append((n, os.path.isdir(p)))
    lang_bytes = collections.Counter()
    file_count = 0
    for dp, dns, fns in os.walk(BASE):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, BASE)
            if ignored(rel):
                continue
            file_count += 1
            ext = os.path.splitext(fn)[1].lower()
            if ext in BINARY_EXT:
                continue
            lang_bytes[ext] += os.path.getsize(full)
    return entries, lang_bytes, file_count


LANG_NAME = {
    '.js': 'JavaScript', '.py': 'Python', '.html': 'HTML', '.css': 'CSS',
    '.json': 'JSON', '.md': 'Markdown', '.yml': 'YAML', '.yaml': 'YAML',
    '.wxml': 'WXML', '.wxss': 'WXSS', '.xml': 'XML', '.sh': 'Shell',
    '.svg': 'SVG', '.java': 'Java', '.gradle': 'Gradle',
}
LANG_COLOR = {
    'JavaScript': '#f1e05a', 'Python': '#3572A5', 'HTML': '#e34c26',
    'CSS': '#563d7c', 'JSON': '#292929', 'Markdown': '#083fa1',
    'YAML': '#cb171e', 'WXML': '#e34c26', 'WXSS': '#563d7c',
    'XML': '#0060ac', 'Shell': '#89e051', 'SVG': '#ff9900',
    'Java': '#b07219', 'Gradle': '#02303a', 'Other': '#ededed',
}


def inline(text):
    s = html.escape(text, quote=False)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    # 图片优先于链接：徽章是 [![alt](img)](link) 结构，先转成 img 再包 a
    s = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'<img src="\2" alt="\1">', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    return s


def render_md(md):
    lines = md.splitlines()
    out, i = [], 0
    in_code = False
    code_buf = []
    para = []
    list_buf = []
    ol_buf = []
    table_buf = []

    def flush_para():
        if para:
            out.append('<p>' + inline(' '.join(para)) + '</p>')
            para.clear()

    def flush_list():
        if list_buf:
            out.append('<ul>' + ''.join('<li>' + inline(x) + '</li>' for x in list_buf) + '</ul>')
            list_buf.clear()

    def flush_ol():
        if ol_buf:
            out.append('<ol>' + ''.join('<li>' + inline(x) + '</li>' for x in ol_buf) + '</ol>')
            ol_buf.clear()

    def flush_table():
        if table_buf:
            rows = []
            for ln in table_buf:
                cells = [c.strip() for c in ln.strip().strip('|').split('|')]
                rows.append(cells)
            if len(rows) >= 2 and all(re.fullmatch(r':?-{3,}:?', c or '') for c in rows[1]):
                head, body = rows[0], rows[2:]
                t = '<table><thead><tr>' + ''.join('<th>' + inline(c) + '</th>' for c in head) + '</tr></thead><tbody>'
                for r in body:
                    t += '<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in r) + '</tr>'
                out.append(t + '</tbody></table>')
            table_buf.clear()

    def flush_all():
        flush_para(); flush_list(); flush_ol(); flush_table()

    while i < len(lines):
        ln = lines[i]
        if ln.startswith('```'):
            if in_code:
                out.append('<pre><code>' + html.escape('\n'.join(code_buf)) + '</code></pre>')
                code_buf = []
                in_code = False
            else:
                flush_all()
                in_code = True
            i += 1
            continue
        if in_code:
            code_buf.append(ln)
            i += 1
            continue
        if ln.startswith('|') and ln.rstrip().endswith('|'):
            flush_para(); flush_list(); flush_ol()
            table_buf.append(ln)
            i += 1
            continue
        flush_table()
        m = re.match(r'^(#{1,4})\s+(.*)$', ln)
        if m:
            flush_para(); flush_list(); flush_ol()
            lvl = len(m.group(1))
            out.append('<h%d>%s</h%d>' % (lvl, inline(m.group(2)), lvl))
            i += 1
            continue
        if ln.strip() == '---':
            flush_all()
            out.append('<hr>')
            i += 1
            continue
        if ln.startswith('> '):
            flush_para(); flush_list(); flush_ol()
            out.append('<blockquote>' + inline(ln[2:]) + '</blockquote>')
            i += 1
            continue
        # 原始 HTML 块直通：README 用 <p align>/<img>/<details>/<summary> 做排版，
        # 这些行原样输出才能真实反映 GitHub 渲染效果（实测渲染器会 escape 掉它们）。
        if re.match(r'^\s*<(/?)(p|img|details|summary|div|a|br|h1)\b', ln):
            flush_all()
            out.append(ln)
            i += 1
            continue
        if re.match(r'^\s*[-*]\s+', ln):
            flush_para(); flush_ol()
            list_buf.append(re.sub(r'^\s*[-*]\s+', '', ln))
            i += 1
            continue
        m_ol = re.match(r'^\s*\d+\.\s+(.*)$', ln)
        if m_ol:
            flush_para(); flush_list()
            ol_buf.append(m_ol.group(1))
            i += 1
            continue
        if not ln.strip():
            flush_all()
            i += 1
            continue
        para.append(ln)
        i += 1
    flush_all()
    if in_code and code_buf:
        out.append('<pre><code>' + html.escape('\n'.join(code_buf)) + '</code></pre>')
    return '\n'.join(out)


CSS = """
:root{--fg:#1f2328;--muted:#59636e;--border:#d0d7de;--accent:#0969da;--btn:#f6f8fa;--green:#1a7f37}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--fg);background:#fff}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.topbar{background:#fff;border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:16px}
.topbar .gh{font-weight:700;font-size:18px}
.topbar .search{margin-left:auto;border:1px solid var(--border);border-radius:6px;padding:5px 12px;color:var(--muted);width:240px}
.banner{background:#ddf4ff;border-bottom:1px solid #b6e3ff;color:#0550ae;padding:9px 32px;font-size:13px}
.wrap{max-width:1280px;margin:0 auto;padding:16px 32px}
.repohead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.repohead .path{font-size:20px}.repohead .path b{color:var(--accent)}
.badge{border:1px solid var(--border);border-radius:2em;padding:0 7px;font-size:12px;color:var(--muted)}
.actions{margin-left:auto;display:flex;gap:6px}
.btn{border:1px solid var(--border);background:var(--btn);border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;cursor:default}
.tabs{margin-top:14px;border-bottom:1px solid var(--border);display:flex;gap:20px;font-size:14px}
.tabs span{padding:8px 0;color:var(--muted)}.tabs .on{color:var(--fg);font-weight:600;border-bottom:2px solid #fd8c73}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 296px;gap:24px;margin-top:20px}
.branch{border:1px solid var(--border);border-radius:6px;padding:6px 12px;display:flex;justify-content:space-between;background:var(--btn);font-size:13px}
.filelist{border:1px solid var(--border);border-radius:6px;margin-top:12px;overflow:hidden}
.filelist .frow{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border)}
.filelist .frow:last-child{border-bottom:0}
.filelist .ic{width:16px;color:#54aeff;flex:none}.filelist .ic.file{color:#59636e}
.filelist .name{flex:1}.filelist .msg{color:var(--muted);font-size:12px;width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.filelist .time{color:var(--muted);font-size:12px;width:80px;text-align:right}
.readme{border:1px solid var(--border);border-radius:6px;margin-top:16px;padding:24px 28px;max-width:100%}
.readme h1{font-size:24px;border-bottom:1px solid var(--border);padding-bottom:8px;margin:0 0 16px}
.readme h2{font-size:19px;border-bottom:1px solid var(--border);padding-bottom:6px;margin:24px 0 12px}
.readme h3{font-size:15px;margin:20px 0 8px}
.readme p{margin:0 0 12px}.readme ul{padding-left:24px;margin:0 0 12px}.readme li{margin:3px 0}
.readme code{background:rgba(175,184,193,.2);border-radius:4px;padding:2px 5px;font-size:85%}
.readme pre{background:var(--btn);border-radius:6px;padding:14px;overflow:auto;font-size:12px}
.readme pre code{background:none;padding:0}
.readme blockquote{border-left:4px solid var(--border);color:var(--muted);margin:0 0 12px;padding:2px 14px}
.readme table{border-collapse:collapse;margin:0 0 14px;font-size:13px;display:block;overflow:auto}
.readme th,.readme td{border:1px solid var(--border);padding:6px 12px;text-align:left}
.readme th{background:var(--btn)}
.readme hr{border:0;border-top:1px solid var(--border);margin:20px 0}
.readme img{height:20px;vertical-align:middle}
.readme img[width="128"]{height:auto}
.readme td img{height:auto;width:100%;max-width:100%;vertical-align:top}
.readme details{border:1px solid var(--border);border-radius:6px;margin:0 0 8px;padding:8px 14px}
.readme summary{cursor:pointer;font-weight:600}
.readme summary::marker{color:var(--muted)}
.readme .mermaid-note{color:var(--muted);font-size:12px}
.side h2{font-size:16px;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.side .desc{font-size:13px;margin:0 0 12px}
.side .meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin:8px 0}
.side .stats{display:flex;gap:16px;font-size:12px;margin:12px 0;color:var(--muted)}
.side .stats b{color:var(--fg)}
.bar{display:flex;height:8px;border-radius:5px;overflow:hidden;margin:8px 0}
.bar i{display:block;height:100%}
.langs{font-size:11px;display:flex;flex-wrap:wrap;gap:8px;color:var(--muted)}
.langs span{display:flex;align-items:center;gap:4px}.langs dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.note{font-size:11px;color:var(--muted);margin-top:10px}
"""


def main():
    entries, lang_bytes, file_count = collect()
    readme = open(os.path.join(BASE, 'README.md'), encoding='utf-8').read()
    readme_html = render_md(readme)
    # 预览页存于 .workbuddy/，README 里的仓库根相对路径（含点击大图链接）需上溯一级
    readme_html = readme_html.replace('src="docs/', 'src="../docs/')
    readme_html = readme_html.replace('href="docs/', 'href="../docs/')

    ICON_DIR = ('<svg class="ic" viewBox="0 0 16 16" width="16" height="16" fill="#54aeff">'
                '<path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5l-1.2-1.2A1.75 1.75 0 0 0 5.25 1H1.75Z"/></svg>')
    ICON_FILE = ('<svg class="ic file" viewBox="0 0 16 16" width="16" height="16" fill="#59636e">'
                 '<path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5H3.75Zm6 .283V4.25a.25.25 0 0 0 .25.25h2.467L10.75 1.783Z"/></svg>')

    rows = []
    for name, isdir in entries:
        icon = ICON_DIR if isdir else ICON_FILE
        nm = name + ('/' if isdir else '')
        rows.append('<div class="frow">%s<span class="name">%s</span><span class="msg">上传前预览 · 基于当前工作区真实文件</span><span class="time">刚刚</span></div>'
                    % (icon, html.escape(nm)))

    langs = []
    for ext, b in lang_bytes.items():
        name = LANG_NAME.get(ext, ext.lstrip('.').upper() or 'Other')
        if name not in ('SVG',):
            langs.append((name, b))
    merged = collections.Counter()
    for n, b in langs:
        merged[n] += b
    total = sum(merged.values()) or 1
    segs = []
    lang_labels = []
    for n, b in merged.most_common():
        pct = b * 100.0 / total
        if pct < 0.4:
            continue
        segs.append('<i style="width:%.2f%%;background:%s" title="%s %.1f%%"></i>'
                    % (pct, LANG_COLOR.get(n, LANG_COLOR['Other']), n, pct))
        lang_labels.append('<span><dot style="background:%s"></dot><b>%s</b> %.1f%%</span>'
                           % (LANG_COLOR.get(n, LANG_COLOR['Other']), n, pct))

    parts = []
    parts.append('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">')
    parts.append('<meta name="viewport" content="width=device-width,initial-scale=1">')
    parts.append('<title>LiteDock · GitHub 上传前预览</title><style>' + CSS + '</style></head><body>')
    parts.append('<div class="topbar"><span class="gh">◉ GitHub</span><span class="search">Type / to search</span></div>')
    parts.append('<div class="banner">⚠️ 这是<b>上传前本地预览</b>，不是线上页面。内容按当前工作区真实文件与 .gitignore 规则渲染，用于上传前审阅。</div>')
    parts.append('<div class="wrap">')
    parts.append('<div class="repohead"><span class="path"><a href="#">Stark-C</a> / <b>LiteDock</b></span>'
                 '<span class="badge">Public</span><span class="actions">'
                 '<span class="btn">👁 Watch</span><span class="btn">⑂ Fork 0</span><span class="btn">★ Star 0</span>'
                 '</span></div>')
    parts.append('<div class="tabs"><span class="on">◇ Code</span><span>Issues 0</span><span>Pull requests 0</span>'
                 '<span>Actions</span><span>Projects</span><span>Wiki</span><span>Security</span><span>Insights</span></div>')
    parts.append('<div class="grid"><div><div class="branch"><span>⑂ main</span><span>%d files · 1 branch</span></div>' % file_count)
    parts.append('<div class="filelist">' + ''.join(rows) + '</div>')
    parts.append('<div class="readme">' + readme_html + '</div>')
    parts.append('</div><aside class="side">')
    parts.append('<h2>About</h2><p class="desc">为 NAS 而生的轻量 Docker 容器面板 —— Web 与 Android 双端同源，一个 Python 文件直连 Docker Socket。</p>')
    parts.append('<div class="meta">🔗 nas.example.com:23000（示例）</div>')
    parts.append('<div class="meta">📘 Readme　⚖️ MIT license　📊 Activity</div>')
    parts.append('<div class="meta">🏷️ docker · nas · self-hosted · dashboard · python · android · capacitor · homelab</div>')
    parts.append('<div class="stats"><span><b>0</b> stars</span><span><b>0</b> watching</span><span><b>0</b> forks</span></div>')
    parts.append('<h2>Languages</h2><div class="bar">' + ''.join(segs) + '</div>')
    parts.append('<div class="langs">' + ''.join(lang_labels) + '</div>')
    parts.append('<div class="note">语言占比按实际会入库文件的字节数统计；图标等二进制资源不计入。</div>')
    parts.append('</aside></div></div></body></html>')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(parts))
    print('generated:', OUT)
    print('top-level entries:', [n for n, _ in entries])
    print('tracked files:', file_count)
    print('languages:', [(n, round(b * 100.0 / total, 1)) for n, b in merged.most_common()])


if __name__ == '__main__':
    main()
