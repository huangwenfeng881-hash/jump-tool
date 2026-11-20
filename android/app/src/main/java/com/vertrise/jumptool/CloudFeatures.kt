package com.vertrise.jumptool

/**
 * 云端功能开关。
 *
 * 现状（2026-11）：原 Supabase 项目已下线，网站侧改为「本机账号」降级方案
 * （js/auth.js 里自动探测云端，不可用就切到本地账号，数据存本机）。
 *
 * 所以：
 *  - 登录 / 注册 / 我的资料 / 训练记录 / 打卡 / 反馈   → 可用（本机账号）
 *  - 会员购买 / 排行榜 / 进步曲线（需服务端聚合）      → 仍隐藏
 * 等云端恢复（重新建 Supabase 项目并把地址写回 js/supabase-config.js），
 * 把 CLOUD_SYNC 改回 true 即可全部恢复。
 */
object CloudFeatures {

    /** 本机账号功能是否开启 */
    const val ENABLED = true

    /** 云端同步 / 会员 / 榜单是否可用 */
    const val CLOUD_SYNC = false

    /** 必须依赖云端、当前仍要隐藏的页面 */
    private val CLOUD_ONLY_PAGES = setOf(
        SitePages.MEMBERSHIP,
        SitePages.LEADERBOARD,
        SitePages.PROGRESS
    )

    fun isCloudPage(page: String): Boolean {
        if (!ENABLED) return true
        val p = page.substringBefore('?').substringBefore('#')
        return !CLOUD_SYNC && p in CLOUD_ONLY_PAGES
    }
}
