package com.vertrise.jumptool

import android.content.Context
import java.util.Calendar

/**
 * 本机轻量数据：记录每次 AI 弹跳分析的高度，供首页/数据页展示。
 * 与账号无关、不联网；登录后的云端记录仍在网页端（jump_records）。
 */
object LocalStore {

    private const val PREF = "vertrise_local"
    private const val K_COUNT = "analysis_count"
    private const val K_LAST_H = "last_height"
    private const val K_BEST_H = "best_height"
    private const val K_LAST_AT = "last_at"
    private const val K_WEEK = "week_key"
    private const val K_WEEK_COUNT = "week_count"

    const val WEEK_TARGET = 5

    data class Snapshot(
        val count: Int,
        val lastHeightCm: Int,
        val bestHeightCm: Int,
        val weekCount: Int,
        val lastAtMs: Long
    )

    fun recordJump(context: Context, heightCm: Int) {
        if (heightCm <= 0) return
        val p = prefs(context)
        val count = p.getInt(K_COUNT, 0) + 1
        val best = maxOf(p.getInt(K_BEST_H, 0), heightCm)
        val wk = weekKey()
        val weekCount = if (p.getString(K_WEEK, "") == wk) p.getInt(K_WEEK_COUNT, 0) + 1 else 1
        p.edit()
            .putInt(K_COUNT, count)
            .putInt(K_LAST_H, heightCm)
            .putInt(K_BEST_H, best)
            .putLong(K_LAST_AT, System.currentTimeMillis())
            .putString(K_WEEK, wk)
            .putInt(K_WEEK_COUNT, weekCount)
            .apply()
    }

    fun snapshot(context: Context): Snapshot {
        val p = prefs(context)
        val wk = weekKey()
        val weekCount = if (p.getString(K_WEEK, "") == wk) p.getInt(K_WEEK_COUNT, 0) else 0
        return Snapshot(
            count = p.getInt(K_COUNT, 0),
            lastHeightCm = p.getInt(K_LAST_H, 0),
            bestHeightCm = p.getInt(K_BEST_H, 0),
            weekCount = weekCount,
            lastAtMs = p.getLong(K_LAST_AT, 0L)
        )
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    private fun weekKey(): String {
        val c = Calendar.getInstance()
        return c.get(Calendar.YEAR).toString() + "-" + c.get(Calendar.WEEK_OF_YEAR)
    }
}
