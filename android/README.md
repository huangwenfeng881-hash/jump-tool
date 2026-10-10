# Vertrise 跃升 · Android App

原生 Android 应用：全新卡片式 UI（底部 5 Tab）+ 网页端全部功能迁入 App。

## 界面结构

底部导航 5 个 Tab：

| Tab | 内容 |
| --- | --- |
| 首页 | 问候栏、本周训练进度环、最新/最佳弹跳、快捷入口、推荐训练 |
| 训练 | 本周打卡进度、今日训练、训练计划模板、训练记录、进步曲线 |
| 分析 | AI 弹跳分析（原生）、弹跳测量、动作分析、杠铃测速、速度-力量曲线 |
| 数据 | 本机统计、进步曲线、排行榜、训练记录、杠铃图表 |
| 我的 | 账号（登录/资料/会员）、训练（记录/计划/打卡/AI 教练）、反馈、设置 |

## 功能实现方式

**原生实现（本机运行，视频不上传）**
- AI 弹跳分析：MediaPipe Tasks（本机 CPU 推理）+ Kotlin 算法移植（`analyzer/JumpAnalyzer.kt`）
- 首页/训练/数据/我的仪表盘：读取本机记录（`LocalStore`，SharedPreferences）
- 分析纠错反馈：Supabase `analysis_feedback`（`FeedbackUploader.kt`）
- 设置页、主题（跟随系统深色/浅色）

**内嵌网页承载（与网页端同一版本，纯静态页面）**
- 弹跳测量 `jump.html`、动作分析 `pose.html`、杠铃测速 `barbell.html`
- 杠铃速度曲线 `barbell-chart.html`、进步曲线 `progress.html`、排行榜 `leaderboard.html`
- 训练打卡 `checkin.html`、训练计划 `plans.html`、训练记录 `history.html`
- 我的资料 `profile.html`、问题反馈 `feedback.html`、会员中心 `membership.html`
- 登录注册 `login.html`、AI 教练 `trainer.html`

承载页 `WebPageFragment` 统一提供：原生顶栏（返回/刷新）、加载进度、失败兜底与重试、
`<input type="file">` 视频选择（Android 文件选择器）、站外链接（支付/邮件）转系统浏览器、
站点主色与 App 主色对齐。

站点地址与页面清单见 `SitePages.kt`（默认 `https://jumptool.netlify.app/`）。

## 环境要求
- JDK 17+（构建用 21 已验证）
- Android SDK（compileSdk 35 / build-tools 34+）
- 无额外 Gradle 依赖安装要求（自带 wrapper，依赖已缓存）

## 构建 APK
```powershell
$env:ANDROID_HOME = "C:\Users\86134\AppData\Local\Android\Sdk"
.\gradlew.bat assembleRelease
# 输出: app\build\outputs\apk\release\app-release.apk
```

## 签名
- 密钥库：`vertrise-release.keystore`（alias `vertrise`，口令见 app/build.gradle.kts）
- **务必妥善备份密钥库**——丢失后无法对已发布版本升级安装

## 应用信息
- 包名：`com.vertrise.jumptool`
- 版本：1.3.0（versionCode 4）
- minSdk 24（Android 7.0+）/ targetSdk 35
- 图标：使用站点 logo 生成（mipmap-mdpi ~ xxxhdpi + 自适应图标）
