# -*- coding: utf-8 -*-
"""
五笔打字提示器 · 手机版 APK 构建脚本（不需要 Gradle / Android Studio）

用法（在任意目录）：
    python build.py

依赖（已在本机就位）：
    JDK      E:\\edownload\\Kimi\\runtime           （java / javac / keytool）
    SDK      D:\\deepseeklearn\\android\\sdk        （build-tools 34.0.0 + android.jar）

流程：
    1. aapt2 compile  res/ -> 中间 flat 文件
    2. aapt2 link     生成 base.apk（含 AndroidManifest、res、assets/www）
    3. javac          编译 java/ -> classes/
    4. d8             把 classes 转成 classes.dex
    5. 用 zipfile 把 classes.dex 塞进 base.apk
    6. zipalign -f 4  对齐
    7. apksigner sign 签名（首次运行会自动生成 keystore）
产物：
    E:\\5bts deepseeklearn\\phone\\五笔打字提示器.apk
"""

import os
import shutil
import subprocess
import sys
import zipfile

# 控制台按 UTF-8 输出，避免 GBK 编码报错
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PHONE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.join(PHONE, "android")
WWW = os.path.join(PHONE, "www")

JDK = r"E:\edownload\Kimi\runtime"
JAVA = os.path.join(JDK, "bin", "java.exe")
JAVAC = os.path.join(JDK, "bin", "javac.exe")
KEYTOOL = os.path.join(JDK, "bin", "keytool.exe")

SDK = r"D:\deepseeklearn\android\sdk"
BT = os.path.join(SDK, "build-tools", "34.0.0")
AAPT2 = os.path.join(BT, "aapt2.exe")
ZIPALIGN = os.path.join(BT, "zipalign.exe")
APKSIGNER_JAR = os.path.join(BT, "lib", "apksigner.jar")
D8_JAR = os.path.join(BT, "lib", "d8.jar")
ANDROID_JAR = os.path.join(SDK, "platforms", "android-34", "android.jar")

BUILD = os.path.join(PHONE, "build")
KEYSTORE = os.path.join(PHONE, "wubi-release.keystore")
KS_PASS = "wubi123456"
KS_ALIAS = "wubi"

APK_NAME = "五笔打字提示器.apk"
OUT_APK = os.path.join(PHONE, APK_NAME)

MIN_API = "21"
TARGET_API = "34"


def log(msg):
    print(msg, flush=True)


def run(cmd, cwd=None, quiet=False):
    """执行外部命令，失败就抛出并打印输出。"""
    shown = " ".join('"%s"' % c if " " in c else c for c in cmd)
    log("  $ " + shown)
    p = subprocess.run(cmd, cwd=cwd, capture_output=True)
    out = p.stdout.decode("utf-8", "replace")
    err = p.stderr.decode("utf-8", "replace")
    if not quiet:
        for line in (out + err).splitlines():
            if line.strip():
                log("    " + line)
    if p.returncode != 0:
        raise RuntimeError("命令失败 (exit %d): %s\n%s\n%s" % (p.returncode, shown, out, err))
    return out


def check_env():
    missing = []
    for path, name in [
        (JAVA, "java.exe"), (JAVAC, "javac.exe"), (KEYTOOL, "keytool.exe"),
        (AAPT2, "aapt2.exe"), (ZIPALIGN, "zipalign.exe"),
        (APKSIGNER_JAR, "apksigner.jar"), (D8_JAR, "d8.jar"),
        (ANDROID_JAR, "android.jar"),
        (os.path.join(ANDROID, "AndroidManifest.xml"), "AndroidManifest.xml"),
        (os.path.join(WWW, "index.html"), "www/index.html"),
    ]:
        if not os.path.exists(path):
            missing.append("%s (%s)" % (name, path))
    if missing:
        raise RuntimeError("缺少必要文件/工具：\n  " + "\n  ".join(missing))


def clean():
    if os.path.isdir(BUILD):
        shutil.rmtree(BUILD)
    os.makedirs(BUILD)


def collect_java():
    src_root = os.path.join(ANDROID, "java")
    files = []
    for dirpath, _dirs, names in os.walk(src_root):
        for n in names:
            if n.endswith(".java"):
                files.append(os.path.join(dirpath, n))
    return files


def ensure_keystore():
    if os.path.exists(KEYSTORE):
        return
    log("[0/7] 生成签名证书（只需一次）")
    run([
        KEYTOOL, "-genkeypair",
        "-keystore", KEYSTORE,
        "-alias", KS_ALIAS,
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-storepass", KS_PASS,
        "-keypass", KS_PASS,
        "-dname", "CN=Wubi Hint, OU=Local, O=Local, L=Local, ST=Local, C=CN",
    ])


def main():
    log("=" * 66)
    log("五笔打字提示器 · 手机版 APK 构建")
    log("=" * 66)
    check_env()
    clean()
    ensure_keystore()

    # ---------- 1. aapt2 compile ----------
    log("[1/7] aapt2 compile：编译资源")
    flat_dir = os.path.join(BUILD, "res-flat")
    os.makedirs(flat_dir)
    res_dir = os.path.join(ANDROID, "res")
    run([AAPT2, "compile", "--dir", res_dir, "-o", flat_dir])

    flat_files = []
    for dirpath, _d, names in os.walk(flat_dir):
        for n in names:
            if n.endswith(".flat"):
                flat_files.append(os.path.join(dirpath, n))
    log("    编译出 %d 个资源文件" % len(flat_files))

    # ---------- 2. aapt2 link ----------
    log("[2/7] aapt2 link：打包资源 + assets")
    # aapt2 的 -A 会把目录内容直接放到 assets/ 根下，
    # 所以先中转一层，让 APK 里保持 assets/www/... 的结构
    assets_stage = os.path.join(BUILD, "assets-stage")
    shutil.copytree(WWW, os.path.join(assets_stage, "www"))

    base_apk = os.path.join(BUILD, "base.apk")
    gen_dir = os.path.join(BUILD, "gen")
    os.makedirs(gen_dir)
    cmd = [
        AAPT2, "link",
        "-o", base_apk,
        "-I", ANDROID_JAR,
        "--manifest", os.path.join(ANDROID, "AndroidManifest.xml"),
        "-A", assets_stage,
        "--java", gen_dir,
        "--min-sdk-version", MIN_API,
        "--target-sdk-version", TARGET_API,
        "--version-code", "5",
        "--version-name", "1.4",
        "--no-version-vectors",
    ] + flat_files
    run(cmd)
    log("    base.apk = %.2f MB" % (os.path.getsize(base_apk) / 1048576.0))

    # ---------- 3. javac ----------
    log("[3/7] javac：编译 Java 源码")
    classes_dir = os.path.join(BUILD, "classes")
    os.makedirs(classes_dir)
    java_files = collect_java() + [
        os.path.join(dp, n)
        for dp, _d, ns in os.walk(gen_dir)
        for n in ns if n.endswith(".java")
    ]
    log("    源文件 %d 个" % len(java_files))
    run([
        JAVAC,
        "-source", "8", "-target", "8",
        "-encoding", "UTF-8",
        "-bootclasspath", ANDROID_JAR,
        "-classpath", ANDROID_JAR,
        "-nowarn",
        "-d", classes_dir,
    ] + java_files)

    # ---------- 4. d8 ----------
    log("[4/7] d8：转换 dex")
    dex_dir = os.path.join(BUILD, "dex")
    os.makedirs(dex_dir)
    class_files = []
    for dp, _d, ns in os.walk(classes_dir):
        for n in ns:
            if n.endswith(".class"):
                class_files.append(os.path.join(dp, n))
    run([
        JAVA, "-cp", D8_JAR, "com.android.tools.r8.D8",
        "--release",
        "--min-api", MIN_API,
        "--lib", ANDROID_JAR,
        "--output", dex_dir,
    ] + class_files)
    dex = os.path.join(dex_dir, "classes.dex")
    if not os.path.exists(dex):
        raise RuntimeError("d8 没有产出 classes.dex")
    log("    classes.dex = %d 字节" % os.path.getsize(dex))

    # ---------- 5. 把 dex 塞进 apk ----------
    log("[5/7] 把 classes.dex 写入 APK")
    unsigned = os.path.join(BUILD, "unsigned.apk")
    shutil.copy2(base_apk, unsigned)
    with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(dex, "classes.dex")
    log("    unsigned.apk = %.2f MB" % (os.path.getsize(unsigned) / 1048576.0))

    # ---------- 6. zipalign ----------
    log("[6/7] zipalign：4 字节对齐")
    aligned = os.path.join(BUILD, "aligned.apk")
    run([ZIPALIGN, "-f", "4", unsigned, aligned])

    # ---------- 7. 签名 ----------
    log("[7/7] apksigner：签名")
    if os.path.exists(OUT_APK):
        os.remove(OUT_APK)
    shutil.copy2(aligned, OUT_APK)
    run([
        JAVA, "-jar", APKSIGNER_JAR, "sign",
        "--ks", KEYSTORE,
        "--ks-key-alias", KS_ALIAS,
        "--ks-pass", "pass:" + KS_PASS,
        "--key-pass", "pass:" + KS_PASS,
        "--min-sdk-version", MIN_API,
        OUT_APK,
    ])

    # 校验
    log("")
    log("验证签名：")
    run([JAVA, "-jar", APKSIGNER_JAR, "verify", "--verbose", OUT_APK])

    size = os.path.getsize(OUT_APK)
    log("")
    log("=" * 66)
    log("构建成功")
    log("  文件：%s" % OUT_APK)
    log("  大小：%.2f MB (%d 字节)" % (size / 1048576.0, size))
    log("=" * 66)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("")
        log("!!! 构建失败 !!!")
        log(str(e))
        sys.exit(1)
