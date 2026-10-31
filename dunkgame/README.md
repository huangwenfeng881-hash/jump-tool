# DunkSim · 扣篮模拟器

一个人的扣篮模拟器：输入身体数据 → 3D 虚拟球场 → 助跑起跳 → 判定能不能扣进。

## 现在能玩什么（v0.2）

- 输入：身高 / 臂展 / 体重 / 弹跳 / 站立摸高
- 判定：摸高 = 站摸 + 弹跳 × 起跳时机质量，对比 320cm（篮筐 305 + 球过框 15）
- 玩法：点「助跑」→ 白线进绿区时点「起跳」→ 抛物线腾空 → 判定「扣进 / 差 X cm」
- 画面：木地板球场（程序化贴图）+ 篮架/篮板/篮筐/球网 + 看台 + 聚光灯
- 角色：带骨骼的 3D 人物（Mixamo 系），跑步动画 / 待机动画 / 空中扣篮姿态
- 反馈：扣进白闪 + 镜头震动 + 慢动作；失败显示差距

## 运行

```powershell
# 在 web 目录起本地服务（ES module + glb 需要 http，不能直接双击 html）
cd "D:\jump app\dunkgame\web"
python -m http.server 8777
# 浏览器打开 http://127.0.0.1:8777/index.html
```

手机/App 内使用：把 `web/` 目录整体放到站点根（例如 `/dunk-sim/`），App 用 WebView 打开即可。

## 目录

| 路径 | 说明 |
|---|---|
| `web/index.html` | 可玩原型（Three.js，单文件，约 500 行） |
| `web/lib/` | three.js r160 + GLTFLoader |
| `web/models/` | 角色模型（Xbot / Soldier，来自 three.js 官方示例，Mixamo 系素材） |
| `project.godot` `scenes/` `scripts/` | Godot 4.3 工程（正式 3D 版用，暂时只有基础骨架） |
| `DESIGN.md` | 机制拆解与路线图 |

## 版本

- v0.1 方块人原型：数值判定 + 时机机制
- **v0.2（当前）** 骨骼角色 + 动画 + 球跟随手部 + 球场美术 + 镜头调度
- v0.3 计划：扣篮动作库（单手/风车/胯下）、球的物理、训练成长系统、手机触屏、导出 APK
