# -*- coding: utf-8 -*-
"""检查 APK 内容：assets 是否完整、manifest 是否正确、dex 是否存在。"""
import sys
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

APK = r"E:\5bts deepseeklearn\phone\wubi-dazi-tishiqi.apk"

EXPECT = [
    "AndroidManifest.xml",
    "classes.dex",
    "resources.arsc",
    "assets/www/index.html",
    "assets/www/assets/app.css",
    "assets/www/assets/app.js",
    "assets/www/assets/mobile.css",
    "assets/www/assets/mobile.js",
    "assets/www/resources/wubi/wubi86.js",
    "assets/www/resources/chinese/common1000.js",
    "assets/www/resources/english/ecdict_en2cn.js",
    "assets/www/resources/english/ecdict_cn2en.js",
    "assets/www/resources/articles/articles.js",
]

with zipfile.ZipFile(APK) as z:
    names = z.namelist()
    print("APK 条目总数:", len(names))
    total = 0
    for i in z.infolist():
        total += i.file_size
    print("解压后总大小: %.2f MB" % (total / 1048576.0))
    print()
    print("关键条目检查:")
    ok = True
    for e in EXPECT:
        hit = e in names
        if not hit:
            ok = False
        print("  %-45s %s" % (e, "OK" if hit else "缺失!"))
    print()
    print("assets/www 下全部条目:")
    for n in sorted(x for x in names if x.startswith("assets/")):
        info = z.getinfo(n)
        print("  %-52s %8d" % (n, info.file_size))
    print()
    print("结论:", "全部通过" if ok else "有缺失")
    sys.exit(0 if ok else 1)
