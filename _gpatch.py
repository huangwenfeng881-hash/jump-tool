# -*- coding: utf-8 -*-
import pathlib
G = pathlib.Path(r"D:/jump app/android/app/build.gradle.kts")
g = G.read_text(encoding="utf-8")
patch = pathlib.Path(r"D:/jump app/_gradle_patch.txt").read_text(encoding="utf-8")
marker = "android {"
assert marker in g
g = g.replace(marker, patch + "\n" + marker, 1)
# assets 源目录指向生成目录
g = g.replace("    buildFeatures {", "    sourceSets[\"main\"].assets.srcDir(layout.buildDirectory.dir(\"generated/siteAssets\"))\n\n    buildFeatures {", 1)
G.write_text(g, encoding="utf-8")
print("gradle patched")