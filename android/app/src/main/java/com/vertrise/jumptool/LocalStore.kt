package com.vertrise.jumptool

import android.content.Context
import java.util.Calendar

/**
 * 本机轻量数据：AI 弹跳分析结果、扣篮潜力自测结果。
 * 与账号无关、不联网；登录后的云端记录仍在网页端 jump_records。
 */
object LocalStore {

    private const val PREF = "vertrise_local"
    private const val K_COUNT = "analysis_count"
    private const val K_LAST_H = "last_height"
    private const val K_BEST_H = "best_height"
    private const val K_LAST_AT = "last_at"
    private const val K_WEEK = "week_key"
    private const val K_WEEK_COUNT = "week_count"

    private const val K_STAND_JUMP = "dunk_stand_jump"
    private const val K_STANDING_REACH = "dunk_standing_reach"
    private const val K_STAND_REACH = "dunk_stand_reach"
    private const val K_RUN_REACH = "dunk_run_reach"
    private const val K_SCORE = "dunk_score"
    private const val K_SCORE_AT = "dunk_score_at"

    const val WEEK_TARGET = 5

    data class Snapshot(
        val count: Int,
        val lastHeightCm: Int,
        val bestHeightCm: Int,
        val weekCount: Int,
        val lastAtMs: Long
    )

    data class Dunk(
        val standJump: Int,
        val standingReach: Int,
        val standReach: Int,
        val runReach: Int,
        val score: Int,
        val atMs: Long
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

    fun saveDunkTest(
        context: Context,
        standJump: Int,
        standingReach: Int,
        standReach: Int,
        runReach: Int,
        score: Int
    ) {
        prefs(context).edit()
            .putInt(K_STAND_JUMP, standJump)
            .putInt(K_STANDING_REACH, standingReach)
            .putInt(K_STAND_REACH, standReach)
            .putInt(K_RUN_REACH, runReach)
            .putInt(K_SCORE, score)
            .putLong(K_SCORE_AT, System.currentTimeMillis())
            .apply()
    }

    fun dunk(context: Context): Dunk {
        val p = prefs(context)
        return Dunk(
            standJump = p.getInt(K_STAND_JUMP, 0),
            standingReach = p.getInt(K_STANDING_REACH, 0),
            standReach = p.getInt(K_STAND_REACH, 0),
            runReach = p.getInt(K_RUN_REACH, 0),
            score = p.getInt(K_SCORE, -1),
            atMs = p.getLong(K_SCORE_AT, 0L)
        )
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)

    private fun weekKey(): String {
        val c = Calendar.getInstance()
        return c.get(Calendar.YEAR).toString() + "-" + c.get(Calendar.WEEK_OF_YEAR)
    }
}
