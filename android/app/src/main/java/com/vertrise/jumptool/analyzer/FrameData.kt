package com.vertrise.jumptool.analyzer

/**
 * JS Math.round 语义（.5 向上取整，与 Kotlin 银行家舍入不同）：
 * JS Math.round(10.5)=11；Kotlin round(10.5)=10。所有移植取整点必须用本函数。
 */
internal fun jsRound(x: Double): Double = Math.floor(x + 0.5)

/**
 * 单帧姿态数据（与网页版 js/pose.js 的 poseData 元素逐字段对齐，保证移植结果一致）
 * 字段含义：
 *  t        相对剪辑起点的秒数（对齐到帧）
 *  lost     该帧姿态识别失败（几何字段沿用上一帧或为 null）
 *  kneeL/R  左/右膝角（°）
 *  hipL/R   左/右髋角（°）
 *  comH     髋部中心高度 = (1 - hipMidY) * 100
 *  comX     髋部中心 X（归一化坐标 * 100）
 *  feetY    脚部最低点 Y（归一化，1=底部）
 *  leftFeetY / rightFeetY  左右脚各自最低点 Y
 *  hipX/hipY/ankleX/ankleY/shX/shY/wrX/wrY  髋/踝/肩/腕中点归一化坐标
 */
data class FrameData(
    val t: Double,
    val lost: Boolean,
    val kneeL: Double?,
    val kneeR: Double?,
    val hipL: Double?,
    val hipR: Double?,
    val comH: Double?,
    val comX: Double?,
    val feetY: Double?,
    val leftFeetY: Double?,
    val rightFeetY: Double?,
    val hipX: Double?,
    val hipY: Double?,
    val ankleX: Double?,
    val ankleY: Double?,
    val shX: Double?,
    val shY: Double?,
    val wrX: Double?,
    val wrY: Double?
)

/** 一次识别出的弹跳（时间单位秒） */
data class Jump(
    val liftoffTime: Double,
    val landingTime: Double,
    val flightTime: Double,
    val heightCm: Double,
    val source: String,
    val contactTime: Double? = null,
    val rsi: Double? = null
)

/** 最后两步节奏 */
data class StepsResult(
    val found: Int,
    val lastContact: Double? = null,
    val penultimateContact: Double? = null,
    val gap: Double? = null,
    val ratio: Double? = null
)

/** 落地稳定性 */
data class LandingInfo(
    val landingKnee: Double? = null,
    val swayPct: Double? = null,
    val settleTime: Double? = null
)

/** 起跳方式 */
data class TakeoffInfo(
    val type: String,
    val gapMax: Double? = null,
    val lastGap: Double? = null,
    val bothGround: Int = 0
)

/** 单次弹跳的六项指标 */
data class JumpMetrics(
    val jump: Jump,
    val kneeMin: Double? = null,
    val kneeMinTime: Double? = null,
    val hipMin: Double? = null,
    val hipMinTime: Double? = null,
    val leanAngle: Double? = null,
    val torsoLean: Double? = null,
    val trajAngle: Double? = null,
    val armSwingDegS: Double = 0.0,
    val armSwingAmp: Double = 0.0,
    val steps: StepsResult = StepsResult(0),
    val landing: LandingInfo = LandingInfo(),
    val takeoff: TakeoffInfo = TakeoffInfo("unknown"),
    val jumpCount: Int = 1,
    val rsiMax: Double? = null,
    val contactTime: Double? = null,
    val usedHipFallback: Boolean = false,
    val bestLift: Double? = null
)

/** 统计 */
data class Stats(
    val valid: Int,
    val total: Int,
    val lost: Int,
    val minKnee: Double?,
    val avgKnee: Double?,
    val maxCom: Double?,
    val minCom: Double?
)

/** computeJumpMetrics 返回值 */
data class MetricsResult(
    val ok: Boolean,
    val msg: String,
    val jumps: List<Jump>,
    val best: JumpMetrics?,
    val debug: Map<String, Any?>
)
