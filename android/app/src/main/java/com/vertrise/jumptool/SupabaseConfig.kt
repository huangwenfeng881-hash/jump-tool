package com.vertrise.jumptool

/**
 * 后端地址与公开 anon key 的唯一来源。
 *
 * 部分网络（尤其国内移动网络）会重置到 supabase.co 的直连，导致登录和云端记录失败。
 * 站点已用 Netlify 的 _redirects 做同源反向代理（/sb/ 转发到 Supabase），App 优先走代理，
 * 代理不通时回退直连，两条路任意一条能通即可正常使用。
 */
object SupabaseConfig {
    /** 站点同源代理（推荐路径） */
    const val PROXY = "https://jumptool.netlify.app/sb"

    /** 直连 Supabase（备用） */
    const val DIRECT = "https://iszxoejqhjpucczfsdfo.supabase.co"

    /** 依次尝试的地址 */
    val ENDPOINTS = listOf(PROXY, DIRECT)

    /** 默认地址（健康检查 / 反馈上传默认先走代理） */
    const val URL = PROXY

    const val ANON_KEY = "sb_publishable_34izFFx3h1vs_NnJkfBsEw_7rWbpawp"
}
