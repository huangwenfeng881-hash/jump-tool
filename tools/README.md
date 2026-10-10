# 姿态批量提取 + 自动校准工具

解决"不能批量跑、上百个视频无法一个个测"的问题。用 **Python 原生 MediaPipe**（比网页 wasm 快几十倍）批量提取姿态，再用 **Node** 跑与网页/安卓同一套 `js/pose.js` 检测算法自动对比标注真值。

## 环境

```powershell
# 建 python3.10 venv 并安装（MediaPipe 支持到 3.12；3.13 可能装不上）
py -3.10 -m venv _mp_venv
_mp_venv\Scripts\python.exe -m pip install mediapipe opencv-contrib-python
```

模型：`mediapipe/tasks-vision/pose_landmarker_lite.task`（5.7MB，与网页版同源，已在本仓库）。

## 1) 批量提取姿态（extract_poses.py）

```powershell
# 跑 test video/ 全部 .mp4（默认输出 _mp_poses/）
_mp_venv\Scripts\python.exe tools\extract_poses.py

# 指定目录 / 分辨率 / 输出
_mp_venv\Scripts\python.exe tools\extract_poses.py --input "my videos" --dim 320 --output _mp_poses

# 指定具体视频
_mp_venv\Scripts\python.exe tools\extract_poses.py "a.mp4" "b.mp4"
```

输出每个视频一个 JSON：`{ video, fps, frames, poseData:[...] }`。
`poseData` 每帧字段与网页版 `js/pose.js` `computeFrame` **完全一致**（`feetY/comH/kneeL/kneeR/hipL/hipR/leftFeetY/rightFeetY/hipX/hipY/ankleX/ankleY/shX/shY/wrX/wrY/lost/t`）。

- `--dim` 默认 480（与网页抽帧一致）；越小越快，精度略降。
- 内部用全局递增时间戳（MediaPipe VIDEO 模式要求跨视频严格递增），可顺序处理任意多视频。

## 2) 自动校准 + 对比标注（calibrate.js）

标注真值来源：文件名里的 `离地时刻X`、`落地时刻Y`（1-based），例如
`双脚，倒数第二步触地21-31...离地时刻32，落地时刻60.mp4`。

```powershell
# 评估当前算法：每个视频 检测 vs 标注，输出命中率
node tools\calibrate.js

# 只用目录 / 关键词
node tools\calibrate.js --poses _mp_poses --only "44-53"

# 扫描阈值组合，找命中最多
node tools\calibrate.js --scan
```

`--scan` 会遍历 `[落地med, 落绝对, 起跳主, 确认, confirm]` 组合，给出 best 参数，你可把这些值写回 `js/pose.js`（并同步 `android/.../JumpAnalyzer.kt`，用 `node _gen-synth-fixtures.cjs` 重生成夹具 + 跑 `gradlew :app:testReleaseUnitTest` 验证一致性）。

## 工作流程（上百个视频）

1. 把视频放进一个目录（文件名尽量带 `离地时刻X，落地时刻Y` 标注，自动校准才可比对；否则人工在报告里核对）。
2. `python tools/extract_poses.py --input <目录>` 批量提取（20 个 ≈ 1 分钟）。
3. `node tools/calibrate.js --poses _mp_poses` 看命中率；`--scan` 找更好参数。
4. 参数写回 `js/pose.js` + Kotlin 同步 + `_gen-synth-fixtures.cjs` + JVM 回归。
5. 网页/安卓用户刷新/重装即生效。

> 注意：`calibrate.js` 用的是项目里当前 `js/pose.js` 的算法（含你最近的调参）。每次改算法后重跑它即可在全集上核对不回归。
