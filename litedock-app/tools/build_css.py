"""把小程序的 WXSS 1:1 转成网页 CSS。

rpx 与 vw 的换算：750rpx = 100vw  =>  1rpx = 100/750 vw
（小程序 rpx 本身就是按屏幕宽度线性缩放，vw 是它的精确等价物，保真度最高）
页面级 WXSS 统一加作用域前缀，避免同名类（.ct-icon / .kv / .op ...）跨页互相污染。
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.normpath(os.path.join(ROOT, "..", "litedock-miniprogram"))
OUT = os.path.join(ROOT, "www", "css", "litedock.css")

GLOBAL = "app.wxss"
PAGES = [
    ("index", "pages/index/index.wxss"),
    ("detail", "pages/detail/detail.wxss"),
    ("settings", "pages/settings/settings.wxss"),
    ("connect", "pages/connect/connect.wxss"),
    ("about", "pages/about/about.wxss"),
]

COMMENT = re.compile(r"/\*.*?\*/", re.S)
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)
# 负向后视排除字母/数字/下划线/点；但需单独允许 ".5rpx" 这类省略前导 0 的写法。
# 旧版 (?![\w.]) 会把 ".5rpx" 的点拦住导致 0.5rpx 漏转（app.wxss .title letter-spacing）。
RPX = re.compile(r"(?<![A-Za-z0-9_])(-?\d+(?:\.\d+)?|\.\d+)rpx\b")


def convert_unit(css):
    def sub(m):
        val = float(m.group(1))
        if abs(val) <= 1.0:          # 1rpx 边框在 WebView 里太细，保底 1px
            return "1px" if val > 0 else "-1px"
        return ("%.4f" % (val / 7.5)).rstrip("0").rstrip(".") + "vw"
    return RPX.sub(sub, css)


def scope(css, prefix):
    """给每条规则的选择器加作用域前缀（跳过 @规则 / 注释）。"""
    def rule_sub(m):
        sels, body = m.group(1), m.group(2)
        sels = sels.strip()
        if not sels or sels.startswith("@"):
            return m.group(0)
        parts = []
        for s in sels.split(","):
            s = s.strip()
            if not s:
                continue
            if s == "page":
                parts.append(prefix + " .page")   # 页面根容器
                continue
            parts.append(prefix + " " + s)
        return ", ".join(parts) + " {" + body + "}"

    return RULE.sub(rule_sub, css)


def main():
    chunks = []
    with open(os.path.join(MP, GLOBAL), encoding="utf-8") as f:
        g = COMMENT.sub("", f.read())
    # 全局：只把「裸 page {」落到 .ld-root；不能误伤 .page {（正文容器）
    g = re.sub(r"(?m)^page\s*\{", ".ld-root {", g)
    chunks.append("/* ===== 全局 app.wxss（1:1 转换） ===== */\n" + convert_unit(g).strip())

    for name, rel in PAGES:
        with open(os.path.join(MP, rel), encoding="utf-8") as f:
            css = COMMENT.sub("", f.read())
        css = scope(css, ".scope-" + name)
        chunks.append("\n/* ===== %s.wxss（作用域 .scope-%s） ===== */\n%s"
                      % (name, name, convert_unit(css).strip()))

    out = "\n\n".join(chunks) + "\n"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print("wrote", OUT, len(out), "bytes")
    print("rpx remaining:", len(RPX.findall(out)))


if __name__ == "__main__":
    main()
