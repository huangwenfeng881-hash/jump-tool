package com.vertrise.jumptool

/**
 * 站点功能页清单。
 *
 * 重要：这些页面**已打进 APK**（android/app/build.gradle.kts 里的 syncSiteAssets 任务
 * 会把仓库根目录的 *.html / css / js / img / mediapipe 同步到 assets/site/），
 * 所以 App 内通过 WebViewAssetLoader 用 appassets 域名加载，断网也能用。
 *
 * BASE 仅用于「用系统浏览器打开官网」等站外场景。
 */
object SitePages {
    /** 线上站点根地址（站外打开用） */
    const val BASE = "https://jumptool.netlify.app/"

    /** 包内资源域名（WebViewAssetLoader 固定用这个 https 域名，满足 MediaPipe 的 wasm 要求） */
    const val ASSET_BASE = "https://appassets.androidplatform.net/assets/site/"

    const val AI_JUMP = "ai-jump.html"
    const val JUMP = "jump.html"
    const val POSE = "pose.html"
    const val BARBELL = "barbell.html"
    const val BARBELL_CHART = "barbell-chart.html"
    const val TRAINER = "trainer.html"
    const val PROGRESS = "progress.html"
    const val LEADERBOARD = "leaderboard.html"
    const val CHECKIN = "checkin.html"
    const val PLANS = "plans.html"
    const val PROFILE = "profile.html"
    const val HISTORY = "history.html"
    const val FEEDBACK = "feedback.html"
    const val MEMBERSHIP = "membership.html"
    const val LOGIN = "login.html"

    /** App 内加载用：一律走包内资源 */
    fun url(page: String): String =
        if (page.startsWith("http")) page else ASSET_BASE + page

    /** 站外打开用：走线上站点 */
    fun webUrl(page: String): String =
        if (page.startsWith("http")) page else BASE + page
}
