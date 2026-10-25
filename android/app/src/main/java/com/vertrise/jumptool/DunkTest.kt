package com.vertrise.jumptool

/**
 * 扣篮潜力自测：3 个指标，中 2 个就算随便起飞。
 * 1) 立定跳远 >= 250cm  —— 下肢爆发力
 * 2) 原地纵跳 >= 60cm   —— 垂直弹跳
 * 3) 助跑摸高 >= 305cm  —— 助跑转化（标准篮筐 305cm）
 */
object DunkTest {

    const val STAND_JUMP_TARGET = 250
    const val VERTICAL_TARGET = 60
    const val RUN_REACH_TARGET = 305
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
        val plan: String
    )

    fun evaluate(standJump: Int, vertical: Int, runReach: Int): Result {
        val metrics = listOf(
            Metric("stand", "立定跳远", "下肢爆发力", standJump, STAND_JUMP_TARGET, "cm",
                standJump >= STAND_JUMP_TARGET,
                "深蹲跳 4x6、立定跳远 4x5、弓步跳 3x12"),
            Metric("vertical", "原地纵跳", "垂直弹跳", vertical, VERTICAL_TARGET, "cm",
                vertical >= VERTICAL_TARGET,
                "跳箱 4x5、深蹲跳 4x6、摆臂起跳 4x5"),
            Metric("run", "助跑摸高", "助跑转化", runReach, RUN_REACH_TARGET, "cm",
                runReach >= RUN_REACH_TARGET,
                "助跑节奏 4x6、单脚起跳 4x5、摸高练习 4x5")
        )
        val passed = metrics.count { it.passed }
        val verdict = when {
            passed >= 3 -> "随便起飞"
            passed == 2 -> "半步之遥"
            passed == 1 -> "潜力待挖"
            else -> "从基础开始"
        }
        val detail = when {
            passed >= 3 -> "三项全中，扣篮只是时间问题。接下来重点练起跳时机和上篮手型。"
            passed == 2 -> "三项中了两项，正好卡在起飞线。补上唯一短板，8 到 12 周就能摸到篮筐以上。"
            passed == 1 -> "中了一项，底子在但短板明显。先把最弱一项练到达标，再谈扣篮。"
            else -> "三项都没达标，别急，从下肢力量和弹跳基础开始，进步会很快。"
        }
        val weakest = metrics.filter { !it.passed }.minByOrNull { it.value.toFloat() / it.target }
        val plan = if (weakest == null) {
            "保持每周 2 次起跳训练，并录视频用 AI 分析起跳角度与摆臂。"
        } else {
            "最该补的是" + weakest.name + "：" + weakest.advice + "。每周 2 到 3 次，动作质量优先。"
        }
        return Result(metrics, passed, verdict, detail, plan)
    }
}
