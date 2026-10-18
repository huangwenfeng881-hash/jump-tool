package com.vertrise.jumptool

import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * 云端服务可用性探测。
 *
 * 登录 / 排行榜 / 训练记录同步都依赖 Supabase。免费版项目长时间没人用会被平台自动暂停，
 * 暂停后项目域名直接 NXDOMAIN，网页端只会报「网络异常，无法连接服务器」——
 * 用户很难判断到底是自己断网还是服务停了。这里在首页做一次轻量健康检查，
 * 异常时给出准确提示，避免误导。
 */
object BackendHealth {

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "backend-health").apply { isDaemon = true }
    }
    private val main = Handler(Looper.getMainLooper())

    /** 异步检查，结果回到主线程。true = 服务可达 */
    fun check(callback: (Boolean) -> Unit) {
        executor.execute {
            val ok = probe()
            main.post { callback(ok) }
        }
    }

    private fun probe(): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(SupabaseConfig.URL + "/auth/v1/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 6000
                requestMethod = "GET"
                setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
            }
            val code = conn.responseCode
            android.util.Log.i("BackendHealth", "probe http=" + code)
            // 200 = 正常；401 = 网关在但缺鉴权，同样说明服务活着
            code in 200..399 || code == 401
        } catch (e: Exception) {
            android.util.Log.w("BackendHealth", "probe failed: " + e.javaClass.simpleName + " " + e.message)
            false
        } finally {
            try { conn?.disconnect() } catch (e: Exception) { }
        }
    }
}
