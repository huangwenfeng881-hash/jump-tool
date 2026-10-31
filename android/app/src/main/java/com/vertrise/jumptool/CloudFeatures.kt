package com.vertrise.jumptool

/**
 * 云端功能开关。
 *
 * 当前后端（Supabase 项目）已不可用，上架版本关闭所有依赖云端的入口：
 * 登录/注册、会员、个人资料、排行榜、进步曲线、训练记录、训练打卡、意见反馈。
 * 这些入口在界面上直接隐藏，本机功能（AI 分析、扣篮自测、弹跳测量、训练计划、AI 教练）不受影响。
 *
 * 后端恢复后把 ENABLED 改为 true，重新打包即可全部恢复。
 */
object CloudFeatures {

    const val ENABLED = false

    private val CLOUD_PAGES = setOf(
        SitePages.LOGIN,
        SitePages.PROFILE,
        SitePages.MEMBERSHIP,
        SitePages.LEADERBOARD,
        SitePages.PROGRESS,
        SitePages.HISTORY,
        SitePages.CHECKIN,
        SitePages.FEEDBACK
    )

    fun isCloudPage(page: String): Boolean =
        !ENABLED && page.substringBefore('?').substringBefore('#') in CLOUD_PAGES
}
