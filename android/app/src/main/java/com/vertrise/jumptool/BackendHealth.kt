package com.vertrise.jumptool

import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** 云端服务可用性探测：先走站点同源代理，失败再回退直连。 */
object BackendHealth {

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "backend-health").apply { isDaemon = true }
    }
    private val main = Handler(Looper.getMainLooper())

    fun check(callback: (Boolean) -> Unit) {
        executor.execute {
            var ok = false
            for (base in SupabaseConfig.ENDPOINTS) {
                if (probe(base)) { ok = true; break }
            }
            main.post { callback(ok) }
        }
    }

    private fun probe(base: String): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(base + "/auth/v1/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 6000
                requestMethod = "GET"
                setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
            }
            val code = conn.responseCode
            android.util.Log.i("BackendHealth", base + " http=" + code)
            code in 200..399 || code == 401
        } catch (e: Exception) {
            android.util.Log.w("BackendHealth", base + " failed " + e.javaClass.simpleName)
            false
        } finally {
            try { conn?.disconnect() } catch (e: Exception) { }
        }
    }
}
