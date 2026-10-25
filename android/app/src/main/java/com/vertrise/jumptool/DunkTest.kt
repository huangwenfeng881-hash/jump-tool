package com.vertrise.jumptool

/**
 * 扣篮潜力自测：3 个指标，中 2 个就算「随便起飞」。
 * 指标口径对齐 B站《3个指标自测扣篮潜力，中2个你就随便起飞！》（越动体育）：
 *  1) 立定跳远：低于 2.3m 基础爆发力偏弱，突破 3m 顶级 —— 达标线取 2.6m
 *  2) 原地与助跑摸高的差值：小于 15cm 说明助跑发力逻辑有问题（隐形短板）
 *  3) 站立摸高：2.20m 以上才跨进扣篮门槛，2.40m 以上属硬件出众
 */
object DunkTest {

    /** 立定跳远达标线（cm） */
    const val STAND_JUMP_TARGET = 260
    /** 助跑摸高 + 原地摸高 差值达标线（cm） */
    const val REACH_GAP_TARGET = 15
    /** 站立摸高达标线（cm） */
    const val STANDING_REACH_TARGET = 220

    const val PASS_NEEDED = 2

    data class Metric(
        val key: String,
        val name: String,
        val hint: String,
        val value: Int,
        val target: Int,
        val unit: String,
        val passed: Boolean,
        val advice: String
    )

    data class Result(
        val metrics: List<Metric>,
        val passed: Int,
        val verdict: String,
        val detail: String,
        val plan: String,
        val reachGap: Int
    )

    fun evaluate(standJump: Int, standingReach: Int, standReach: Int, runReach: Int): Result {
        val gap = runReach - standReach
        val metrics = listOf(
            Metric("jump", "立定跳远", "瞬时爆发力", standJump, STAND_JUMP_TARGET, "cm",
                standJump >= STAND_JUMP_TARGET,
                "深蹲跳 4x6、弓步跳 3x12、负重跳 4x5"),
            Metric("gap", "摸高差", "助跑转化", gap, REACH_GAP_TARGET, "cm",
                gap >= REACH_GAP_TARGET,
                "助跑节奏 4x6、单脚起跳 4x5、全力摸高 4x5"),
            Metric("reach", "站立摸高", "先天硬件", standingReach, STANDING_REACH_TARGET, "cm",
                standingReach >= STANDING_REACH_TARGET,
                "站摸偏矮不是没救，把弹跳补上去：深蹲跳 4x6、跳箱 4x5")
        )
        val passed = metrics.count { it.passed }
        val verdict = when {
            passed >= 3 -> "随便起飞"
            passed == 2 -> "半步之遥"
            passed == 1 -> "潜力待挖"
            else -> "从基础开始"
        }
        val detail = when {
            passed >= 3 -> "三项全中，扣篮只是时间问题。接下来练起跳时机和上篮手型。"
            passed == 2 -> "三项中了两项，正好卡在起飞线。补上唯一短板，8 到 12 周就能摸到篮筐以上。"
            passed == 1 -> "中了一项，底子在但短板明显。先把最弱一项练到达标。"
            else -> "三项都没达标，别急，从下肢力量和弹跳基础开始，进步会很快。"
        }
        val weakest = metrics.filter { !it.passed }.minByOrNull { it.value.toFloat() / it.target }
        val plan = if (weakest == null) {
            "保持每周 2 次起跳训练，并录视频用 AI 分析起跳角度与摆臂。"
        } else {
            "最该补的是" + weakest.name + "：" + weakest.advice + "。每周 2 到 3 次，动作质量优先。"
        }
        return Result(metrics, passed, verdict, detail, plan, gap)
    }
}
