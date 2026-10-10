package com.vertrise.jumptool

/**
 * 站点功能页清单：App 内嵌网页承载的功能页与线上站点一一对应。
 * 站点为纯静态部署，页面路径与仓库根目录一致，便于与网页端保持同一版本。
 */
object SitePages {
    /** 线上站点根地址（与 android/README.md 记录一致） */
    const val BASE = "https://jumptool.netlify.app/"

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

    fun url(page: String): String = if (page.startsWith("http")) page else BASE + page
}
