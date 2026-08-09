# Vertrise 跃升 · Android APK

将 Vertrise 网页打包为安卓可安装应用的 WebView 壳工程。

## 功能
- WebView 加载线上站点 `https://jumptool.netlify.app`（始终最新版，无需随包更新）
- 支持 JS / DOM Storage / 视频播放 / 摄像头授权（视频分析用）
- 站内链接在应用内打开；站外链接（如支付收银台）用系统浏览器打开
- 返回键页面内后退，再按一次退出
- 顶部/底部系统栏自动避让（状态栏不遮挡导航）

## 环境要求
- JDK 17+（构建用 21 已验证）
- Android SDK（compileSdk 35 / build-tools 34+）
- 无 Gradle 依赖安装要求（自带 wrapper）

## 构建 APK
```powershell
$env:ANDROID_HOME = "C:\Users\86134\AppData\Local\Android\Sdk"
.\gradlew.bat assembleRelease
# 输出: app\build\outputs\apk\release\app-release.apk
```

## 签名
- 密钥库：`vertrise-release.keystore`（alias `vertrise`，口令见 app/build.gradle.kts）
- **务必妥善备份密钥库**——丢失后无法对已发布版本升级安装
- 更换密钥库口令后同步修改 `app/build.gradle.kts` 中 signingConfigs

## 应用信息
- 包名：`com.vertrise.jumptool`
- 版本：1.0.0（versionCode 1）
- minSdk 24（Android 7.0+）/ targetSdk 35
- 图标：使用站点 logo 生成（mipmap-mdpi ~ xxxhdpi + 自适应图标）
