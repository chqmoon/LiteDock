package cn.starkc.litedock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.FileProvider;

/**
 * LiteDock 原生 HTTP 插件。
 *
 * 存在意义：安卓 WebView 的 fetch/XHR 受 CORS 限制，且系统证书校验会拒绝
 * 家庭 NAS 常见的自签证书。本插件用原生 HttpURLConnection 发请求，
 * 允许自签证书 + 任意端口 + 任意域名 + 明文 http，并把响应交回 JS。
 *
 * 这是「个人 NAS 客户端」的取舍：信任用户自己填写的地址。
 * 仅供连接用户自己部署的 LiteDock 服务使用，不做通用浏览器。
 */
@CapacitorPlugin(name = "LiteDockHttp")
public class LiteDockHttp extends Plugin {

    /** 信任所有证书的 TrustManager（仅用于本插件的连接，不改全局默认 SSLContext） */
    private static final TrustManager[] TRUST_ALL = new TrustManager[]{
        new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] chain, String authType) {}
            public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }
    };

    private static final HostnameVerifier ALLOW_ALL_HOSTS = new HostnameVerifier() {
        public boolean verify(String hostname, SSLSession session) { return true; }
    };

    private static SSLSocketFactory buildSocketFactory() {
        try {
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, TRUST_ALL, new java.security.SecureRandom());
            return ctx.getSocketFactory();
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final int timeout = call.getInt("timeout", 15000);
        if (url == null || url.isEmpty()) {
            call.reject("missing url");
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    URL u = new URL(url);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setRequestMethod(method);
                    conn.setConnectTimeout(timeout);
                    conn.setReadTimeout(timeout);
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("Accept", "application/json, text/plain, */*");
                    conn.setRequestProperty("User-Agent", "LiteDockApp/1.0.0");

                    if (conn instanceof HttpsURLConnection) {
                        HttpsURLConnection https = (HttpsURLConnection) conn;
                        SSLSocketFactory sf = buildSocketFactory();
                        if (sf != null) https.setSSLSocketFactory(sf);
                        https.setHostnameVerifier(ALLOW_ALL_HOSTS);
                    }

                    /* 自定义请求头：访问密码 X-LiteDock-Token / 反代 BasicAuth 等 */
                    JSObject headers = call.getObject("headers", new JSObject());
                    Iterator<String> hk = headers.keys();
                    while (hk.hasNext()) {
                        String k = hk.next();
                        String v = headers.getString(k);
                        if (k != null && v != null) conn.setRequestProperty(k, v);
                    }

                    /* 请求体（POST /api/login 等） */
                    String body = call.getString("data", null);
                    if (body != null && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                        conn.setDoOutput(true);
                        if (!headers.has("Content-Type") && !headers.has("content-type")) {
                            conn.setRequestProperty("Content-Type", "application/json");
                        }
                        OutputStream os = conn.getOutputStream();
                        os.write(body.getBytes("UTF-8"));
                        os.flush();
                        os.close();
                    }

                    int status = conn.getResponseCode();
                    InputStream is = (status >= 200 && status < 400)
                            ? conn.getInputStream() : conn.getErrorStream();
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    if (is != null) {
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
                        is.close();
                    }
                    byte[] raw = bos.toByteArray();

                    String contentType = conn.getContentType() == null ? "" : conn.getContentType();
                    boolean binary = call.getBoolean("binary", Boolean.FALSE);
                    JSObject ret = new JSObject();
                    ret.put("status", status);
                    if (binary) {
                        /* 图片：转 base64 data URL，避免 <img> 无法携带鉴权头 */
                        String mime = contentType.split(";")[0].trim();
                        if (mime.isEmpty()) mime = "image/png";
                        ret.put("data", "data:" + mime + ";base64," +
                                Base64.encodeToString(raw, Base64.NO_WRAP));
                    } else {
                        ret.put("data", new String(raw, "UTF-8"));
                    }
                    ret.put("contentType", contentType);
                    call.resolve(ret);
                } catch (Exception ex) {
                    call.reject("request failed: " + ex.getMessage(), ex);
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }, "litedock-http").start();
    }

    /** JS 侧的 chooser 开关：兼容 boolean / "true" / 1 三种表示，
        避免 Capacitor 桥接把布尔值序列化成字符串时开关被误判为关闭。 */
    private boolean readChooser(PluginCall call) {
        try {
            Object raw = call.getData().opt("chooser");
            if (raw instanceof Boolean) return (Boolean) raw;
            if (raw instanceof String) return "true".equalsIgnoreCase((String) raw) || "1".equals(raw);
            if (raw instanceof Number) return ((Number) raw).intValue() != 0;
        } catch (Exception ignored) {}
        return Boolean.TRUE.equals(call.getBoolean("chooser", Boolean.FALSE));
    }

    /** APP 增强：直接调起浏览器打开容器访问链接，省掉「复制 → 手动粘贴」。 */
    @PluginMethod
    public void openUrl(PluginCall call) {
        final String url = call.getString("url");
        final boolean chooser = readChooser(call);
        if (url == null || url.isEmpty()) {
            call.reject("missing url");
            return;
        }
        try {
            final Uri uri = Uri.parse(url);
            final Intent view = new Intent(Intent.ACTION_VIEW, uri);
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (chooser) {
                /* 1.0.3：不再依赖系统 Intent.createChooser —— 部分 ROM 在用户设过
                   「默认浏览器」后会直接跳过选择器，导致「每次询问」形同虚设。
                   这里自己枚举能处理该 URL 的浏览器，用原生对话框列出，每次都真正
                   询问；用户选哪个就按精确 Component 启动哪个，绕开系统默认应用。 */
                final PackageManager pm = getContext().getPackageManager();
                List<ResolveInfo> resolved = pm.queryIntentActivities(
                        new Intent(Intent.ACTION_VIEW, uri),
                        PackageManager.MATCH_DEFAULT_ONLY | PackageManager.MATCH_ALL);
                LinkedHashMap<String, ResolveInfo> byPkg = new LinkedHashMap<String, ResolveInfo>();
                if (resolved != null) {
                    String self = getContext().getPackageName();
                    for (ResolveInfo ri : resolved) {
                        if (ri == null || ri.activityInfo == null) continue;
                        String pkg = ri.activityInfo.packageName;
                        if (self.equals(pkg) || byPkg.containsKey(pkg)) continue;
                        byPkg.put(pkg, ri);
                    }
                }
                final ArrayList<ResolveInfo> apps = new ArrayList<ResolveInfo>(byPkg.values());
                if (apps.size() > 1) {
                    final CharSequence[] labels = new CharSequence[apps.size()];
                    for (int i = 0; i < apps.size(); i++) labels[i] = apps.get(i).loadLabel(pm);
                    final Activity act = getActivity();
                    if (act != null) {
                        act.runOnUiThread(new Runnable() {
                            @Override public void run() {
                                new AlertDialog.Builder(act)
                                    .setTitle("选择浏览器打开")
                                    .setItems(labels, new DialogInterface.OnClickListener() {
                                        @Override public void onClick(DialogInterface dlg, int which) {
                                            ResolveInfo picked = apps.get(which);
                                            Intent pick = new Intent(Intent.ACTION_VIEW, uri);
                                            pick.setComponent(new ComponentName(
                                                picked.activityInfo.packageName,
                                                picked.activityInfo.name));
                                            pick.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                            try { getContext().startActivity(pick); }
                                            catch (Exception e) { getContext().startActivity(view); }
                                        }
                                    })
                                    .setNegativeButton("取消", null)
                                    .show();
                            }
                        });
                        JSObject ret = new JSObject();
                        ret.put("opened", true);
                        ret.put("chooser", true);
                        ret.put("mode", "app-picker");
                        ret.put("candidates", apps.size());
                        call.resolve(ret);
                        return;
                    }
                }
            }

            /* 默认 / 枚举不到多个浏览器：交给系统解析（有默认则直接用，无默认弹「打开方式」） */
            Intent toStart = chooser ? Intent.createChooser(view, "选择打开方式") : view;
            if (chooser) toStart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(toStart);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            ret.put("chooser", chooser);
            ret.put("mode", chooser ? "system-chooser" : "default");
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("open failed: " + ex.getMessage(), ex);
        }
    }

    /* ==================== 1.0.26 APP 自更新 ====================
       安全原则：
       ① 自更新 API 与 APK 下载**绝不使用 TRUST_ALL**（那是给自签 NAS 用的）；
          这里走系统默认证书链 + 默认域名校验，防止中间人替换安装包。
       ② 域名白名单精确到 api.github.com / github.com / objects.githubusercontent.com，
          拒绝重定向到白名单外地址。
       ③ APK 下载完成后强制 SHA-256 比对（摘要来自同一份 API 响应），不一致立即删除。
       ④ 安装走 FileProvider content:// Uri，不依赖公开目录。 */

    private static final String TAG = "LiteDockUpdate";
    private static final String API_HOST = "api.github.com";
    private static final String API_PATH = "/repos/chqmoon/LiteDock/releases/latest";
    private static final String APK_HOST = "github.com";
    private static final String APK_PATH_PREFIX = "/chqmoon/LiteDock/releases/download/";
    private static final String CDN_HOST = "objects.githubusercontent.com";

    private static boolean isSafeUpdateApi(String url) {
        try {
            URL u = new URL(url);
            return "https".equalsIgnoreCase(u.getProtocol())
                    && API_HOST.equalsIgnoreCase(u.getHost())
                    && API_PATH.equals(u.getPath());
        } catch (Exception e) { return false; }
    }

    private static boolean isSafeApkUrl(String url) {
        try {
            URL u = new URL(url);
            String host = u.getHost();
            if (!"https".equalsIgnoreCase(u.getProtocol())) return false;
            if (CDN_HOST.equalsIgnoreCase(host)) return true;
            return APK_HOST.equalsIgnoreCase(host)
                    && (u.getPath() + "").startsWith(APK_PATH_PREFIX);
        } catch (Exception e) { return false; }
    }

    /** 查最新版本：严格 TLS，不走 TRUST_ALL，不跟随白名单外重定向 */
    @PluginMethod
    public void fetchLatestRelease(PluginCall call) {
        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection conn = null;
                try {
                    String url = "https://" + API_HOST + API_PATH;
                    URL u = new URL(url);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(12000);
                    conn.setReadTimeout(12000);
                    conn.setRequestProperty("Accept", "application/vnd.github+json");
                    conn.setRequestProperty("User-Agent", "LiteDock-App-Updater");
                    conn.setInstanceFollowRedirects(false);
                    int status = conn.getResponseCode();
                    if (status != 200) { call.reject("GitHub API HTTP " + status); return; }
                    InputStream is = conn.getInputStream();
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
                    is.close();
                    JSObject ret = new JSObject();
                    ret.put("status", status);
                    ret.put("data", new String(bos.toByteArray(), "UTF-8"));
                    call.resolve(ret);
                } catch (Exception ex) {
                    call.reject("fetch release failed: " + ex.getMessage(), ex);
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }, "litedock-update").start();
    }

    /** 下载 APK 到应用私有缓存目录；白名单 + 严格 TLS + SHA-256 校验 */
    @PluginMethod
    public void downloadApk(PluginCall call) {
        final String url = call.getString("url");
        final String expectHex = call.getString("sha256");
        if (!isSafeApkUrl(url == null ? "" : url)) {
            call.reject("unsafe download url");
            return;
        }
        if (expectHex == null || !expectHex.matches("(?i)^[0-9a-f]{64}$")) {
            call.reject("missing sha256");
            return;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection conn = null;
                File tmp = null;
                try {
                    String current = url;
                    File dir = new File(getContext().getCacheDir(), "updates");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create update dir");
                    tmp = new File(dir, "litedock-update.apk");
                    long total = 0;
                    String actual = "";

                    /* 流式下载 + 流式摘要：不把 4MB APK 整体读进内存，避免低端机 OOM */
                    for (int hop = 0; hop < 5; hop++) {
                        URL u = new URL(current);
                        conn = (HttpURLConnection) u.openConnection();
                        conn.setRequestMethod("GET");
                        conn.setConnectTimeout(20000);
                        conn.setReadTimeout(30000);
                        conn.setRequestProperty("User-Agent", "LiteDock-App-Updater");
                        conn.setInstanceFollowRedirects(false);
                        int st = conn.getResponseCode();
                        if (st >= 300 && st < 400) {
                            String loc = conn.getHeaderField("Location");
                            conn.disconnect();
                            conn = null;
                            if (tmp.exists() && !tmp.delete()) throw new Exception("cannot reset temp");
                            if (loc == null || !isSafeApkUrl(loc)) throw new Exception("unsafe redirect");
                            current = new URL(new URL(current), loc).toString();
                            if (!isSafeApkUrl(current)) throw new Exception("unsafe redirect target");
                            continue;
                        }
                        if (st != 200) throw new Exception("HTTP " + st);
                        MessageDigest md = MessageDigest.getInstance("SHA-256");
                        InputStream is = conn.getInputStream();
                        FileOutputStream fos = new FileOutputStream(tmp, false);
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = is.read(buf)) != -1) {
                            fos.write(buf, 0, n);
                            md.update(buf, 0, n);
                            total += n;
                        }
                        fos.flush();
                        fos.close();
                        is.close();
                        byte[] digest = md.digest();
                        StringBuilder sb = new StringBuilder();
                        for (byte b : digest) sb.append(String.format("%02x", b & 0xff));
                        actual = sb.toString();
                        break;
                    }
                    if (total == 0) throw new Exception("empty download");
                    if (!actual.equalsIgnoreCase(expectHex)) {
                        throw new Exception("sha256 mismatch: expected=" + expectHex + " actual=" + actual);
                    }

                    JSObject ret = new JSObject();
                    ret.put("path", tmp.getAbsolutePath());
                    ret.put("size", total);
                    ret.put("sha256", actual);
                    call.resolve(ret);
                } catch (Exception ex) {
                    if (tmp != null && tmp.exists() && !tmp.delete()) Log.w(TAG, "cannot delete bad apk");
                    call.reject("download failed: " + ex.getMessage(), ex);
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }, "litedock-download").start();
    }

    /** 用 FileProvider 拉起系统安装器；返回 need_permission 让 JS 引导用户开启 */
    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        File dir = new File(getContext().getCacheDir(), "updates");
        File apk = path == null ? null : new File(path);
        if (apk == null || !apk.isFile()
                || !apk.getAbsolutePath().startsWith(dir.getAbsolutePath())) {
            call.reject("invalid apk path");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject ret = new JSObject();
            ret.put("need_permission", true);
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                ret.put("opened_settings", true);
            } catch (Exception e) {
                ret.put("opened_settings", false);
            }
            call.resolve(ret);
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("install failed: " + ex.getMessage(), ex);
        }
    }
}
