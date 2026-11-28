"""cap add android 之后：注入原生插件、权限、图标、版本号、签名配置。

在纯 ASCII 路径 C:\\ldbuild\\app 下执行（避免 Gradle 处理中文/空格路径出错）。
"""
import os, sys, re, shutil

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_VERSION = "1.0.26"
VERSION_CODE = 27
SRC_CFG = os.path.join(APP, "android-config")
ANDROID = os.path.join(APP, "android")
PKG_DIR = os.path.join(ANDROID, "app", "src", "main", "java", "cn", "starkc", "litedock")
RES = os.path.join(ANDROID, "app", "src", "main", "res")
MANIFEST = os.path.join(ANDROID, "app", "src", "main", "AndroidManifest.xml")


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def ensure(cond, msg):
    if not cond:
        print("FAIL:", msg, flush=True)
        sys.exit(1)


def main():
    ensure(os.path.isdir(ANDROID), "android/ 不存在，请先 npx cap add android")

    # --- 1. 复制原生插件并注册 ---
    os.makedirs(PKG_DIR, exist_ok=True)
    shutil.copy(os.path.join(SRC_CFG, "LiteDockHttp.java"),
                os.path.join(PKG_DIR, "LiteDockHttp.java"))
    main_java = os.path.join(PKG_DIR, "MainActivity.java")
    write(main_java,
          "package cn.starkc.litedock;\n\n"
          "import android.os.Bundle;\n"
          "import com.getcapacitor.BridgeActivity;\n\n"
          "public class MainActivity extends BridgeActivity {\n"
          "    @Override\n"
          "    public void onCreate(Bundle savedInstanceState) {\n"
          "        registerPlugin(LiteDockHttp.class);\n"
          "        super.onCreate(savedInstanceState);\n"
          "    }\n"
          "}\n")
    print("wrote MainActivity.java", flush=True)

    # --- 2. AndroidManifest：INTERNET / 明文流量 / 网络安全配置 ---
    m = read(MANIFEST)
    missing = [p for p in ("android.permission.INTERNET",
                           "android.permission.ACCESS_NETWORK_STATE",
                           # 1.0.26：APP 自更新需要请求安装未知来源 APK（用户仍需在系统弹窗确认）
                           "android.permission.REQUEST_INSTALL_PACKAGES") if p not in m]
    if missing:
        if 'xmlns:android' not in m:
            m = m.replace("<manifest", '<manifest xmlns:android="http://schemas.android.com/apk/res/android"', 1)
        perms = "".join('\n    <uses-permission android:name="%s" />' % p for p in missing)
        idx = m.find(">", m.find("<manifest"))
        m = m[:idx + 1] + perms + "\n" + m[idx + 1:]
    if "usesCleartextTraffic" not in m:
        m = m.replace("<application", '<application\n        android:usesCleartextTraffic="true"\n'
                      '        android:networkSecurityConfig="@xml/network_security_config"', 1)
    # Android 11+ 包可见性：声明后 ACTION_VIEW 才能稳定找到系统浏览器
    if "<queries>" not in m:
        q = ('\n    <queries>\n'
             '        <intent>\n'
             '            <action android:name="android.intent.action.VIEW" />\n'
             '            <data android:scheme="http" />\n'
             '        </intent>\n'
             '        <intent>\n'
             '            <action android:name="android.intent.action.VIEW" />\n'
             '            <data android:scheme="https" />\n'
             '        </intent>\n'
             '    </queries>\n')
        end = m.rfind("</manifest>")
        if end > 0:
            m = m[:end] + q + m[end:]
    # 1.0.26：安装 APK 的 Intent 可见性（Android 11+ package visibility）
    # 必须合并进同一个 <queries>：多个 queries 块会在 manifest merger 阶段报错
    if "application/vnd.android.package-archive" not in m:
        install_intent = ('        <intent>\n'
                          '            <action android:name="android.intent.action.VIEW" />\n'
                          '            <data android:mimeType="application/vnd.android.package-archive" />\n'
                          '        </intent>\n')
        if "</queries>" in m:
            m = m.replace("</queries>", install_intent + "    </queries>", 1)
        else:
            m = m.replace("</manifest>",
                          "    <queries>\n" + install_intent + "    </queries>\n</manifest>", 1)
    write(MANIFEST, m)
    print("patched AndroidManifest.xml", flush=True)

    # --- 3. network_security_config.xml（允许 http 明文 + 用户自签 CA）---
    xml_dir = os.path.join(RES, "xml")
    os.makedirs(xml_dir, exist_ok=True)
    write(os.path.join(xml_dir, "network_security_config.xml"),
          '<?xml version="1.0" encoding="utf-8"?>\n'
          '<network-security-config>\n'
          '    <base-config cleartextTrafficPermitted="true">\n'
          '        <trust-anchors>\n'
          '            <certificates src="system" />\n'
          '            <certificates src="user" />\n'
          '        </trust-anchors>\n'
          '    </base-config>\n'
          '</network-security-config>\n')

    # --- 4. 应用图标：legacy PNG + 标准 adaptive icon ---
    # 坑：Capacitor 模板的 @color/ic_launcher_background 是 #FFFFFF，而 1.0.0 的
    # foreground 是「缩小的完整蓝色方块」，系统遮罩后在桌面上露出一圈白边。
    # 正解 = 蓝色背景 + 透明底白色船形 foreground（图形落在中间 66dp 安全区）。
    try:
        from PIL import Image, ImageDraw
        logo = Image.open(os.path.join(APP, "www", "assets", "logo.png")).convert("RGBA")
        sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

        # 4a. legacy（API < 26）：完整蓝色圆角方块 + 圆形版
        for dpi, px in sizes.items():
            d = os.path.join(RES, "mipmap-" + dpi)
            os.makedirs(d, exist_ok=True)
            im = logo.resize((px, px), Image.LANCZOS)
            im.save(os.path.join(d, "ic_launcher.png"))
            mask = Image.new("L", (px, px), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, px - 1, px - 1), fill=255)
            round_im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
            round_im.paste(im, (0, 0), mask)
            round_im.save(os.path.join(d, "ic_launcher_round.png"))

        # 4b. 抠出白色船 / 集装箱 / 浅蓝波浪，蓝色渐变背景转透明
        fg_src = logo.copy()
        src = fg_src.load()
        for y in range(fg_src.height):
            for x in range(fg_src.width):
                r, g, b, a = src[x, y]
                # 背景蓝的 R 通道很低，船体/波浪的 R 明显更高 —— 用 R 做柔和抠图
                t = max(0.0, min(1.0, (r - 88) / 120.0))
                src[x, y] = (r, g, b, int(a * t)) if (a and t > 0) else (r, g, b, 0)
        box = fg_src.getchannel("A").getbbox()
        if box:
            fg_src = fg_src.crop(box)
        for dpi, px in sizes.items():
            canvas = int(px * 108 / 48)                  # 108dp 画布
            target = int(canvas * 0.58)                  # 图形宽度在 66dp 安全区内
            ratio = min(target / fg_src.width, target / fg_src.height)
            nw, nh = max(1, int(fg_src.width * ratio)), max(1, int(fg_src.height * ratio))
            glyph = fg_src.resize((nw, nh), Image.LANCZOS)
            layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
            layer.paste(glyph, ((canvas - nw) // 2, (canvas - nh) // 2), glyph)
            layer.save(os.path.join(RES, "mipmap-" + dpi, "ic_launcher_foreground.png"))
        print("generated launcher icons (adaptive, no white ring)", flush=True)
    except ImportError:
        print("WARN Pillow unavailable, keeping default icons", flush=True)

    # 4c. adaptive 背景色：模板默认白色正是白边来源
    values_dir = os.path.join(RES, "values")
    os.makedirs(values_dir, exist_ok=True)
    write(os.path.join(values_dir, "ic_launcher_background.xml"),
          '<?xml version="1.0" encoding="utf-8"?>\n'
          '<resources>\n'
          '    <color name="ic_launcher_background">#1657CC</color>\n'
          '</resources>\n')
    print("patched adaptive icon background", flush=True)

    # --- 5. 版本号 ---
    gradle = os.path.join(ANDROID, "app", "build.gradle")
    if os.path.exists(gradle):
        g = read(gradle)
        g = re.sub(r"versionCode\s+\d+", "versionCode %d" % VERSION_CODE, g)
        g = re.sub(r'versionName\s+"[^"]*"', 'versionName "%s"' % APP_VERSION, g)
        write(gradle, g)
        print("patched build.gradle version", flush=True)

    # --- 6. strings.xml 应用名 ---
    strings = os.path.join(RES, "values", "strings.xml")
    if os.path.exists(strings):
        s = read(strings)
        s = re.sub(r'<string name="app_name">[^<]*</string>',
                   '<string name="app_name">LiteDock</string>', s)
        s = re.sub(r'<string name="title_activity_main">[^<]*</string>',
                   '<string name="title_activity_main">LiteDock</string>', s)
        write(strings, s)

    print("CONFIGURE_OK", flush=True)


if __name__ == "__main__":
    main()
