"""在 ASCII 构建目录里执行 gradlew assembleDebug，并把 APK 拷回交付目录。"""
import os, sys, subprocess, shutil, hashlib

BUILD = r"C:\ldbuild\app"
ANDROID = os.path.join(BUILD, "android")
JDK = r"C:\ldbuild\jdk"
SDK = r"C:\ldbuild\sdk"
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELEASES = os.path.normpath(os.path.join(PROJECT, "..", "releases"))

env = dict(os.environ)
env["JAVA_HOME"] = JDK
env["ANDROID_HOME"] = SDK
env["ANDROID_SDK_ROOT"] = SDK
env["PATH"] = os.path.join(JDK, "bin") + os.pathsep + env.get("PATH", "")


def run(args, cwd, timeout=1800):
    print("RUN:", " ".join(args), flush=True)
    p = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True,
                         encoding="utf-8", errors="replace")
    lines = []
    try:
        for line in p.stdout:
            line = line.rstrip()
            lines.append(line)
            # 只打印 Gradle 关键行，避免刷屏
            if any(k in line for k in ("BUILD ", "FAILURE", "error:", "Error", "Exception",
                                       "Task :", "Warning", "warning", "> ", "Download")):
                print(line, flush=True)
    except Exception as ex:
        print("READ ERROR", ex, flush=True)
    p.wait(timeout=timeout)
    tail = "\n".join(lines[-60:])
    print("=== TAIL ===\n" + tail + "\n=== RC =", p.returncode, flush=True)
    return p.returncode, lines


def main():
    rc, lines = run(["cmd.exe", "/c", "gradlew.bat", "assembleDebug", "--no-daemon"],
                    ANDROID)
    if rc != 0:
        print("GRADLE_FAILED", flush=True)
        sys.exit(1)

    apk = os.path.join(ANDROID, "app", "build", "outputs", "apk", "debug", "app-debug.apk")
    if not os.path.exists(apk):
        print("APK NOT FOUND at", apk, flush=True)
        sys.exit(1)

    os.makedirs(RELEASES, exist_ok=True)
    dst = os.path.join(RELEASES, "LiteDock-App-1.0.25.apk")
    shutil.copy2(apk, dst)
    h = hashlib.md5(open(dst, "rb").read()).hexdigest()
    print("APK:", dst)
    print("SIZE:", os.path.getsize(dst))
    print("MD5:", h)
    print("BUILD_OK", flush=True)


if __name__ == "__main__":
    main()
