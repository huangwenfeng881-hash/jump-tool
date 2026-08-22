package com.vertrise.jumptool.analyzer

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min


/**
 * 弹跳检测与指标分析——由 js/pose.js 逐行等价移植（Kotlin/JVM 纯计算，无 Android 依赖）。
 * 数值约定与 JS 完全一致：jsRound(x*1000)/1000 三级取整、中位数滤波、双阈值判据等。
 */
object JumpAnalyzer {

    /** 检测中间候选（内部使用） */
    internal class Cand(var a: Int, var b: Int, var ft: Double, var heightCm: Double, var source: String)

    // ---------------- 基础工具 ----------------

    /** 中值滤波（窗口 ±2，忽略 null），与 JS medianFilter 一致 */
    fun medianFilter(raw: Array<Double?>, n: Int): Array<Double?> {
        val s = arrayOfNulls<Double>(n)
        for (i in 0 until n) {
            val win = ArrayList<Double>()
            for (k in max(0, i - 2)..min(n - 1, i + 2)) {
                val v = raw[k]
                if (v != null) win.add(v)
            }
            if (win.isNotEmpty()) {
                win.sort()
                s[i] = win[floor(win.size / 2.0).toInt()]
            } else s[i] = null
        }
        return s
    }

    fun jumpHeightFromTime(ft: Double): Double = (9.81 * ft * ft / 8) * 100

    fun idxNear(data: List<FrameData>, t: Double): Int {
        var best = 0
        var bd = Double.POSITIVE_INFINITY
        for (i in data.indices) {
            val d = abs(data[i].t - t)
            if (d < bd) { bd = d; best = i }
        }
        return best
    }

    /** 连线与垂直方向夹角（dy 向下为正；0°=竖直），JS angleFromVertical */
    private fun angleFromVertical(dx: Double?, dy: Double?): Double? {
        if (dx == null || dy == null || (dx == 0.0 && dy == 0.0)) return null
        return jsRound(abs(atan2(abs(dx), abs(dy)) * 180 / Math.PI * 10)) / 10
    }

    /** 人体尺度：髋→脚中位距离（clamp 后返回），JS 中多处内联重复 */
    private fun bodyScale(data: List<FrameData>, from: Int, to: Int, rawF: (Int) -> Double?, rawH: (Int) -> Double?): Double {
        val hf = ArrayList<Double>()
        for (i in from..to) {
            val f = rawF(i)
            val h = rawH(i)
            if (f != null && h != null) {
                val dist = f - (1 - h / 100)
                if (dist > 0.02 && dist < 0.8) hf.add(dist)
            }
        }
        var scale = 0.12
        if (hf.isNotEmpty()) { hf.sort(); scale = hf[floor(hf.size / 2.0).toInt()] }
        return max(0.04, min(0.35, scale))
    }

    fun computeStats(data: List<FrameData>): Stats {
        var valid = 0
        var lost = 0
        val kneeVals = ArrayList<Double>()
        val comVals = ArrayList<Double>()
        for (d in data) {
            if (d.lost) lost++
            if (!d.lost && (d.kneeL != null || d.kneeR != null)) valid++
            if (d.kneeL != null) kneeVals.add(d.kneeL)
            if (d.kneeR != null) kneeVals.add(d.kneeR)
            if (d.comH != null) comVals.add(d.comH)
        }
        var minKnee: Double? = null
        var sum = 0.0
        for (v in kneeVals) { if (minKnee == null || v < minKnee) minKnee = v; sum += v }
        val avgKnee = if (kneeVals.isNotEmpty()) sum / kneeVals.size else null
        var maxCom: Double? = null
        var minCom: Double? = null
        for (v in comVals) {
            if (maxCom == null || v > maxCom) maxCom = v
            if (minCom == null || v < minCom) minCom = v
        }
        return Stats(valid, data.size, lost, minKnee, avgKnee, maxCom, minCom)
    }

    // ---------------- detectJump ----------------

    /**
     * 识别全部弹跳（与 JS detectJump 等价）。
     * debugOut 非空时写入诊断字段（flightSegs/rejected/hipFallback）。
     */
    fun detectJump(data: List<FrameData>, optsFps: Double, debugOut: MutableMap<String, Any?>? = null): List<Jump> {
        val minAir = 0.15
        val maxAir = 1.5
        val n = data.size
        if (n < 10) return emptyList()

        val rawF = arrayOfNulls<Double>(n)
        val rawH = arrayOfNulls<Double>(n)
        for (i in 0 until n) {
            val d = data[i]
            rawF[i] = if (!d.lost && d.feetY != null) d.feetY else null
            rawH[i] = if (!d.lost && d.comH != null) d.comH else null
        }
        val sF = medianFilter(rawF, n)
        val sH = medianFilter(rawH, n)

        val scale = bodyScale(data, 0, n - 1, { i -> rawF[i] }, { i -> rawH[i] })
        val riseTh = max(scale * 12, 3.0)

        // ① 落地检测：脚部持续下落段
        val descs = ArrayList<Int>()
        for (i in 0 until n - 3) {
            val a = rawF[i]; val b = rawF[i + 1]; val c = rawF[i + 2]; val d = rawF[i + 3]
            if (a == null || b == null || c == null || d == null) continue
            val d1 = b - a; val d2 = c - b; val d3 = d - c
            if (d1 >= 0.005 && d2 >= 0.005 && d3 >= 0.005) descs.add(i)
        }
        data class DescSeg(var start: Int, var end: Int)
        val descSegs = ArrayList<DescSeg>()
        for (s0 in descs) {
            val last = if (descSegs.isNotEmpty()) descSegs[descSegs.size - 1] else null
            if (last != null && s0 <= last.end + 1) {
                last.start = min(last.start, s0)
                last.end = max(last.end, s0 + 3)
            } else {
                descSegs.add(DescSeg(s0, s0 + 3))
            }
        }

        var rejected = 0
        var hipFallbackCount = 0
        var hipArch = false
        val cands = ArrayList<Cand>()

        for (seg in descSegs) {
            val s0 = seg.start
            var landing = -1
            val deltas = ArrayList<Double>()
            var j = s0
            while (j < n - 1) {
                val f0 = rawF[j]; val f1 = rawF[j + 1]
                if (f0 == null || f1 == null) break
                val dv = f1 - f0
                if (deltas.size >= 3) {
                    val sorted = deltas.sorted()
                    val med = sorted[floor(sorted.size / 2.0).toInt()]
                    // 触地确认扩展到后续 4 帧保持低速（排除空中减速段误判，与 JS 一致）
                    if ((dv <= med * 0.5 || dv <= 0.006) && j + 5 < n && rawF[j + 2] != null && rawF[j + 3] != null && rawF[j + 4] != null && rawF[j + 5] != null) {
                        val d2 = rawF[j + 2]!! - f1
                        val d3 = rawF[j + 3]!! - rawF[j + 2]!!
                        val d4 = rawF[j + 4]!! - rawF[j + 3]!!
                        val d5 = rawF[j + 5]!! - rawF[j + 4]!!
                        if (d2 < med * 0.7 && d3 < med * 0.7 && d4 < med * 0.7 && d5 < med * 0.7) {
                            landing = if (dv < 0.002) j + 1 else j
                            break
                        }
                    }
                }
                if (dv >= 0.004) deltas.add(dv)
                j++
            }
            if (landing < 0 || landing >= n) {
                for (hc in s0 + 3 until n - 1) {
                    val a = rawH[hc]; val b = rawH[hc + 1]; val c = rawH[hc - 1]
                    if (a == null || b == null || c == null) continue
                    val dc1 = b - a
                    if (dc1 <= -2.5) { landing = hc; break }
                }
                if (landing < 0 || landing >= n) { rejected++; continue }
            }

            // ② 起跳：落地前窗口内髋部最低点之后持续抬升
            val tLo = data[landing].t - 1.2
            val tHi = data[landing].t - 0.05
            var m0 = -1
            var mVal = Double.POSITIVE_INFINITY
            for (p in 0 until n) {
                if (data[p].t < tLo) continue
                if (data[p].t > tHi) break
                val v = sH[p]
                if (v != null && v < mVal) { mVal = v; m0 = p }
            }
            if (m0 < 0) { rejected++; continue }
            var lo = -1
            // 起跳检测：阈值 1.2→1.0 / 0.8→0.6（更早触发，修正单脚起跳晚 ~3 帧，与 JS 一致）
            for (q in m0 + 1 until n - 1) {
                val v = sH[q]
                if (v == null) continue
                if (v > mVal + 1.0 && sH[q + 1] != null && sH[q + 1]!! >= mVal + 0.6) { lo = q; break }
            }
            if (lo < 0 || lo >= landing) { rejected++; continue }
            // 脚法精修：分离 ≥4 帧才采用（分离 3 帧时脚法反而不如髋法，与 JS 一致）
            var fDrop = -1
            val fdEnd = min(n - 1, lo + 8)
            for (fd in lo until fdEnd) {
                if (fd < 1 || sF[fd - 1] == null || sF[fd] == null || sF[fd + 1] == null) continue
                if (sF[fd]!! - sF[fd - 1]!! <= -0.003 && sF[fd + 1]!! - sF[fd]!! <= -0.003) { fDrop = fd; break }
            }
            if (fDrop >= lo + 4) lo = fDrop

            var ft = data[landing].t - data[lo].t
            if (ft < minAir || ft > maxAir) { rejected++; continue }

            // ③ 髋部单峰拱形校验
            var maxIdx = -1
            var maxVal = Double.NEGATIVE_INFINITY
            for (r in lo..landing) {
                val v = sH[r]
                if (v != null && v > maxVal) { maxVal = v; maxIdx = r }
            }
            if (maxIdx < 0) { rejected++; continue }
            val lh = sH[landing]
            if (lh == null || lh > maxVal - 1.0) { rejected++; continue }
            var valleyIdx = -1
            var valleyVal = Double.POSITIVE_INFINITY
            for (u in maxIdx + 1..landing) {
                val v = sH[u]
                if (v != null && v < valleyVal) { valleyVal = v; valleyIdx = u }
            }
            if (valleyIdx >= 0 && valleyIdx > maxIdx) {
                var rebounded = false
                val wEnd = min(n - 1, landing + 2)
                for (w in valleyIdx + 1..wEnd) {
                    val v = sH[w]
                    if (v != null && v >= valleyVal + 1.0) { rebounded = true; break }
                }
                if (rebounded) { rejected++; continue }
            }

            // ④ 髋部抬升确认
            val rise = hipRiseIn(sH, data, lo, landing)
            if (rise == null || rise < riseTh) { rejected++; continue }

            cands.add(Cand(lo, landing, ft, jumpHeightFromTime(ft), "feet"))
        }

        // ⑤ 兜底 A：髋抛物线
        if (cands.isEmpty() && descSegs.isEmpty()) {
            var upStart = -1
            for (u in 1 until n - 5) {
                val a = sH[u - 1]; val b = sH[u]; val c = sH[u + 1]; val d = sH[u + 2]; val e = sH[u + 3]; val f = sH[u + 4]
                if (a == null || b == null || c == null || d == null || e == null || f == null) continue
                if (b - a > 0.3 && c - b > 0.3 && d - c > 0.3 && e - d > 0.3 && f - e > 0.3) { upStart = u; break }
            }
            if (upStart >= 0) {
                var pk = upStart + 4
                var pkV = sH[pk]!!
                for (p in upStart + 5 until n) {
                    val v = sH[p] ?: break
                    if (v > pkV) { pkV = v; pk = p }
                    else if (v < pkV - 0.5) break
                }
                var dnStart = -1
                for (d in pk + 1 until n - 4) {
                    val a = sH[d]; val b = sH[d + 1]; val c = sH[d + 2]; val e = sH[d + 3]
                    if (a == null || b == null || c == null || e == null) continue
                    if (b - a < -0.15 && c - b < -0.15 && e - c < -0.15) { dnStart = d; break }
                }
                if (dnStart >= 0) {
                    var la2 = dnStart + 3
                    for (d in dnStart + 4 until n - 1) {
                        val a = sH[d]; val b = sH[d + 1]
                        if (a == null || b == null) break
                        val dcv = b - a
                        if (dcv > -0.15) { la2 = d; break }
                    }
                    val lo2 = upStart + 1
                    val ft2 = data[la2].t - data[lo2].t
                    if (ft2 >= minAir && ft2 <= maxAir) {
                        val rise2 = pkV - (if (sH[upStart - 1] != null) sH[upStart - 1]!! else sH[upStart]!!)
                        if (rise2 >= riseTh) {
                            cands.add(Cand(lo2, la2, ft2, jumpHeightFromTime(ft2), "hip-arch"))
                            hipArch = true
                        }
                    }
                }
            }
        }

        // ⑥ 兜底 B：髋部峰值
        if (cands.isEmpty()) {
            val hipJumps = hipOnlyJumps(sH, data, max(scale * 18, 5.0), 0.2, 1.2)
            hipFallbackCount = hipJumps.size
            for (hj in hipJumps) cands.add(hj)
        }

        // 合并
        cands.sortBy { data[it.a].t }
        val merged = ArrayList<Cand>()
        for (c in cands) {
            val last = if (merged.isNotEmpty()) merged[merged.size - 1] else null
            if (last != null && data[c.a].t == data[last.a].t && data[c.b].t == data[last.b].t) continue
            if (last != null && data[c.a].t == data[last.a].t) {
                if (data[c.b].t > data[last.b].t) {
                    last.b = c.b
                    last.ft = jsRound((data[last.b].t - data[last.a].t) * 1000) / 1000
                    last.heightCm = jumpHeightFromTime(last.ft)
                }
                continue
            }
            if (last != null && abs(data[c.a].t - data[last.a].t) < 0.35 && abs(data[c.b].t - data[last.b].t) < 0.6) {
                if (data[c.a].t > data[last.a].t) last.a = c.a
                if (data[c.b].t > data[last.b].t) last.b = c.b
                last.ft = jsRound((data[last.b].t - data[last.a].t) * 1000) / 1000
                last.heightCm = jumpHeightFromTime(last.ft)
                continue
            }
            if (last != null && data[c.a].t >= data[last.b].t && data[c.a].t - data[last.b].t < 0.06) {
                last.b = c.b
                last.ft = jsRound((data[last.b].t - data[last.a].t) * 1000) / 1000
                last.heightCm = jumpHeightFromTime(last.ft)
            } else {
                merged.add(c)
            }
        }

        val jumps = ArrayList<Jump>()
        for (c in merged) {
            jumps.add(
                Jump(
                    liftoffTime = jsRound(data[c.a].t * 1000) / 1000,
                    landingTime = jsRound(data[c.b].t * 1000) / 1000,
                    flightTime = jsRound(c.ft * 1000) / 1000,
                    heightCm = jsRound(c.heightCm * 10) / 10,
                    source = c.source
                )
            )
        }
        for (m in 1 until jumps.size) {
            val contact = jumps[m].liftoffTime - jumps[m - 1].landingTime
            if (contact > 0 && contact < 2) {
                jumps[m] = jumps[m].copy(
                    contactTime = jsRound(contact * 1000) / 1000,
                    rsi = jsRound(((jumps[m].heightCm / 100) / contact) * 100) / 100
                )
            }
        }
        jumps.sortByDescending { it.heightCm }

        if (debugOut != null) {
            debugOut["flightSegs"] = descSegs.size
            debugOut["rejected"] = rejected
            debugOut["hipFallback"] = hipFallbackCount
            debugOut["hipArch"] = hipArch
        }
        return jumps
    }

    /** 腾空段髋部抬升：峰值 − 起跳前 0.3s 髋基准中位数 */
    private fun hipRiseIn(sH: Array<Double?>, data: List<FrameData>, a: Int, b: Int): Double? {
        var peak: Double? = null
        for (i in a..b) {
            val v = sH[i] ?: continue
            if (peak == null || v > peak) peak = v
        }
        if (peak == null) return null
        val baseVals = ArrayList<Double>()
        val t0 = data[a].t - 0.3
        var j = a - 1
        while (j >= 0) {
            if (data[j].t < t0) break
            val v = sH[j]
            if (v != null) baseVals.add(v)
            j--
        }
        if (baseVals.isEmpty()) return null
        baseVals.sort()
        return peak - baseVals[floor(baseVals.size / 2.0).toInt()]
    }

    /** 髋部峰值兜底（JS hipOnlyJumps） */
    private fun hipOnlyJumps(sH: Array<Double?>, data: List<FrameData>, riseTh: Double, minAir: Double, maxAir: Double): List<Cand> {
        val n = sH.size
        val vals = ArrayList<Double>()
        for (i in 0 until n) { val v = sH[i]; if (v != null) vals.add(v) }
        if (vals.size < 5) return emptyList()
        vals.sort()
        val base = vals[floor(vals.size * 0.5).toInt()]
        val out = ArrayList<Cand>()
        var i = 1
        while (i < n - 1) {
            val v0 = sH[i - 1]; val v1 = sH[i]; val v2 = sH[i + 1]
            if (v0 == null || v1 == null || v2 == null) { i++; continue }
            if (v1 >= v0 && v1 > v2 && (v1 - base) >= riseTh) {
                var lo = -1
                var la = -1
                var k = i - 1
                while (k >= 0) {
                    val v = sH[k] ?: break
                    if (v <= base) { lo = k; break }
                    k--
                }
                var k2 = i + 1
                while (k2 < n) {
                    val v = sH[k2] ?: break
                    if (v <= base) { la = k2; break }
                    k2++
                }
                if (lo >= 0 && la > lo) {
                    val ft = data[la].t - data[lo].t
                    if (ft >= minAir && ft <= maxAir) {
                        out.add(Cand(lo, la, ft, jumpHeightFromTime(ft), "hip"))
                    }
                }
                i = if (la > 0) la else i + 1
                continue
            }
            i++
        }
        return out
    }

    // ---------------- detectLastSteps ----------------

    /** 最后两步节奏（JS detectLastSteps） */
    fun detectLastSteps(data: List<FrameData>, liftoffTime: Double, dbg: MutableMap<String, Any?>? = null): StepsResult {
        val n = data.size
        if (n < 10) { if (dbg != null) dbg["fail"] = "n<10"; return StepsResult(0) }
        val rawF = arrayOfNulls<Double>(n)
        val rawH = arrayOfNulls<Double>(n)
        for (i in 0 until n) {
            val d = data[i]
            rawF[i] = if (!d.lost && d.feetY != null) d.feetY else null
            rawH[i] = if (!d.lost && d.comH != null) d.comH else null
        }
        val scale = bodyScale(data, 0, n - 1, { i -> rawF[i] }, { i -> rawH[i] })

        val win = ArrayList<Double>()
        for (i in 0 until n) {
            val f = rawF[i] ?: continue
            if (data[i].t < liftoffTime - 0.35 || data[i].t >= liftoffTime - 0.02) continue
            win.add(f)
        }
        if (win.size < 4) { if (dbg != null) dbg["fail"] = "win<4"; return StepsResult(0) }
        win.sort()
        val ground = win[floor(win.size * 0.85).toInt()]
        val th = ground - 0.02

        val contact = BooleanArray(n)
        for (j in 0 until n) {
            val f = rawF[j]
            if (f == null) { contact[j] = false; continue }
            var c = 0
            if (j > 0 && rawF[j - 1] != null && rawF[j - 1]!! >= th) c++
            if (f >= th) c++
            if (j < n - 1 && rawF[j + 1] != null && rawF[j + 1]!! >= th) c++
            contact[j] = c >= 2
        }
        val segs = ArrayList<IntArray>()
        var st = -1
        for (k in 0 until n) {
            if (contact[k] && st < 0) st = k
            else if (!contact[k] && st >= 0) { segs.add(intArrayOf(st, k - 1)); st = -1 }
        }
        if (st >= 0) segs.add(intArrayOf(st, n - 1))

        var lastSeg: IntArray? = null
        for (s in segs.indices.reversed()) {
            val seg = segs[s]
            if (data[seg[0]].t >= liftoffTime - 0.7 && data[seg[0]].t < liftoffTime - 0.02) { lastSeg = seg; break }
        }
        if (dbg != null) {
            dbg["ground"] = jsRound(ground * 1000) / 1000
            dbg["th"] = jsRound(th * 1000) / 1000
            dbg["segs"] = segs.map { listOf(it[0], it[1]) }
            dbg["lastSeg"] = lastSeg?.let { listOf(it[0], it[1]) }
        }
        if (lastSeg == null) { if (dbg != null) dbg["fail"] = "no-lastSeg"; return StepsResult(0) }
        val TLast = data[lastSeg[0]].t
        val lastContact = jsRound((liftoffTime - TLast) * 1000) / 1000
        var out = StepsResult(0)
        if (!(lastContact > 0.04 && lastContact < 0.9)) return out

        var penSeg: IntArray? = null
        var idxLast = -1
        for (si in segs.indices) if (segs[si] === lastSeg) { idxLast = si; break }
        if (idxLast > 0) {
            val gapA = segs[idxLast - 1][1] + 1
            val gapB = lastSeg[0] - 1
            val gapTh = ground - max(scale * 0.4, 0.045)
            var deep = 0
            for (g in gapA..gapB) {
                val f = rawF[g]
                if (f != null && f <= gapTh) deep++
            }
            if (deep >= 2) penSeg = segs[idxLast - 1]
        }

        if (penSeg != null) {
            val penContact = jsRound((TLast - data[penSeg[0]].t) * 1000) / 1000
            if (penContact > 0.04 && penContact < 1.5) {
                out = StepsResult(
                    found = 2,
                    lastContact = lastContact,
                    penultimateContact = penContact,
                    gap = jsRound((data[lastSeg[0]].t - data[penSeg[1]].t) * 1000) / 1000,
                    ratio = jsRound((lastContact / penContact) * 100) / 100
                )
            } else {
                out = StepsResult(found = 1, lastContact = lastContact)
            }
        } else {
            var kneeMin: Double? = null
            var kneeIdx = -1
            for (km in 0 until n) {
                if (data[km].lost) continue
                if (data[km].t < liftoffTime - 0.95 || data[km].t > liftoffTime - 0.1) continue
                val kv = min(data[km].kneeL ?: 999.0, data[km].kneeR ?: 999.0)
                if (kv < 999 && (kneeMin == null || kv < kneeMin)) { kneeMin = kv; kneeIdx = km }
            }
            if (kneeIdx >= 0) {
                val kneeAll = ArrayList<Double>()
                for (ka in 0 until n) {
                    if (data[ka].lost) continue
                    val kav = min(data[ka].kneeL ?: 999.0, data[ka].kneeR ?: 999.0)
                    if (kav < 999) kneeAll.add(kav)
                }
                kneeAll.sort()
                val kneeMed = if (kneeAll.isNotEmpty()) kneeAll[floor(kneeAll.size / 2.0).toInt()] else 170.0
                if (kneeMed - kneeMin!! >= 30) {
                    val penContact2 = jsRound((liftoffTime - data[kneeIdx].t) * 1000) / 1000
                    if (penContact2 > 0.04 && penContact2 < 1.2) {
                        out = StepsResult(
                            found = 2,
                            lastContact = lastContact,
                            penultimateContact = penContact2,
                            gap = null,
                            ratio = jsRound((lastContact / penContact2) * 100) / 100
                        )
                    } else {
                        out = StepsResult(found = 1, lastContact = lastContact)
                    }
                } else {
                    out = StepsResult(found = 1, lastContact = lastContact)
                }
            } else {
                out = StepsResult(found = 1, lastContact = lastContact)
            }
        }
        return out
    }

    // ---------------- analyzeLanding / detectTakeoffType / analyzeJump ----------------

    /** 落地稳定性（JS analyzeLanding） */
    fun analyzeLanding(data: List<FrameData>, iLa: Int, fps: Double): LandingInfo {
        val winEnd = min(data.size - 1, iLa + jsRound(0.8 * fps).toInt())
        var kneeMin: Double? = null
        val hipXs = ArrayList<Pair<Double, Double>>() // t, x
        for (i in iLa..winEnd) {
            val d = data[i] ?: continue
            if (d.lost) continue
            if ((d.kneeL != null || d.kneeR != null) && i - iLa <= jsRound(0.35 * fps).toInt()) {
                val k = min(d.kneeL ?: 999.0, d.kneeR ?: 999.0)
                if (k < 999 && (kneeMin == null || k < kneeMin)) kneeMin = k
            }
            if (d.hipX != null) hipXs.add(Pair(d.t, d.hipX))
        }
        var leg = 0.0
        var legN = 0
        for (j in iLa..winEnd) {
            val e = data[j] ?: continue
            if (!e.lost && e.hipY != null && e.ankleY != null && e.ankleY > e.hipY) {
                leg += e.ankleY - e.hipY
                legN++
            }
        }
        val legLen = if (legN > 0) leg / legN else 0.25
        var swayPct: Double? = null
        var settleTime: Double? = null
        if (hipXs.size >= 3) {
            val xs = hipXs.map { it.second }
            val range = xs.max() - xs.min()
            swayPct = if (legLen > 0.001) jsRound((range / legLen) * 1000) / 10 else null
            val sorted = xs.sorted()
            val med = sorted[floor(sorted.size / 2.0).toInt()]
            var stableAt: Double? = null
            for (m in hipXs.indices.reversed()) {
                if (abs(hipXs[m].second - med) > 0.02) { stableAt = hipXs[m].first; break }
            }
            settleTime = if (stableAt == null) 0.0 else jsRound((stableAt - data[iLa].t) * 1000) / 1000
        }
        return LandingInfo(kneeMin, swayPct, settleTime)
    }

    /** 起跳方式（JS detectTakeoffType） */
    fun detectTakeoffType(data: List<FrameData>, iLo: Int, fps: Double): TakeoffInfo {
        val w0 = max(0, iLo - jsRound(0.2 * fps).toInt())
        val hf = ArrayList<Double>()
        val hfEnd = min(data.size - 1, iLo + jsRound(0.3 * fps).toInt())
        for (s in w0..hfEnd) {
            val e = data[s] ?: continue
            if (!e.lost && e.feetY != null && e.comH != null) {
                val dist = e.feetY - (1 - e.comH / 100)
                if (dist > 0.02 && dist < 0.8) hf.add(dist)
            }
        }
        var scale = 0.12
        if (hf.isNotEmpty()) { hf.sort(); scale = hf[floor(hf.size / 2.0).toInt()] }
        scale = max(0.04, min(0.35, scale))

        val gs = ArrayList<Double>()
        for (g in w0..iLo) {
            val dg = data[g] ?: continue
            if (!dg.lost && dg.feetY != null) gs.add(dg.feetY)
        }
        if (gs.size < 3) return TakeoffInfo("unknown")
        gs.sort()
        val ground = gs[floor(gs.size * 0.9).toInt()]

        data class Gap(val t: Double, val gap: Double)
        val gaps = ArrayList<Gap>()
        var bothGround = 0
        for (i in w0..iLo) {
            val d = data[i] ?: continue
            if (d.lost) continue
            if (d.leftFeetY != null && d.rightFeetY != null) {
                gaps.add(Gap(d.t, abs(d.leftFeetY - d.rightFeetY)))
                if (d.leftFeetY >= ground - 0.04 && d.rightFeetY >= ground - 0.04) bothGround++
            }
        }
        if (gaps.size < 2) return TakeoffInfo("unknown")
        val gapSorted = gaps.map { it.gap }.sorted()
        val gap90 = gapSorted[floor(gapSorted.size * 0.9).toInt()]

        // 起跳瞬间（最后 0.07s 内 + 起跳后 2 帧）两脚高度差最大值（与 JS 一致：
        // 单脚起跳摆动腿在离地后 1~2 帧才明显抬起，窗口必须含起跳后帧）
        val lastWin = max(w0, iLo - jsRound(0.07 * fps).toInt())
        val lastEnd = min(data.size - 1, iLo + 2)
        var lastGapMax = 0.0
        for (i in lastWin..lastEnd) {
            val e = data[i] ?: continue
            if (!e.lost && e.leftFeetY != null && e.rightFeetY != null) {
                val gg = abs(e.leftFeetY - e.rightFeetY)
                if (gg > lastGapMax) lastGapMax = gg
            }
        }
        val singleTh = max(scale * 0.28, 0.05)
        val type = when {
            lastGapMax > singleTh -> "single"
            bothGround >= 2 -> "double"
            gap90 > singleTh -> "single"
            else -> "double"
        }
        return TakeoffInfo(type, jsRound(gap90 * 1000) / 1000, jsRound(lastGapMax * 1000) / 1000, bothGround)
    }

    /** 单次弹跳六项指标（JS analyzeJump） */
    fun analyzeJump(data: List<FrameData>, jump: Jump, fps: Double): JumpMetrics {
        val lo = jump.liftoffTime
        val iLo = idxNear(data, lo)
        val iLa = idxNear(data, jump.landingTime)

        // ① 屈膝/屈髋深度
        val iStart = max(0, iLo - jsRound(0.7 * fps).toInt())
        data class Deep(val k: Double, val i: Int)
        var deepest: Deep? = null
        var hipDeepest: Deep? = null
        for (i in iStart..iLo) {
            val d = data[i] ?: continue
            if (d.lost) continue
            if (d.kneeL != null && d.kneeR != null) {
                val k = min(d.kneeL, d.kneeR)
                if (deepest == null || k < deepest.k) deepest = Deep(k, i)
            }
            if (d.hipL != null && d.hipR != null) {
                val h = min(d.hipL, d.hipR)
                if (hipDeepest == null || h < hipDeepest.k) hipDeepest = Deep(h, i)
            }
        }
        var kneeMin: Double? = null
        var kneeMinTime: Double? = null
        var hipMin: Double? = null
        var hipMinTime: Double? = null
        if (deepest != null) {
            kneeMin = deepest.k
            kneeMinTime = jsRound((data[deepest.i].t - lo) * 1000) / 1000
        }
        if (hipDeepest != null) {
            hipMin = hipDeepest.k
            hipMinTime = jsRound((data[hipDeepest.i].t - lo) * 1000) / 1000
        }

        // ② 起跳角度 + 轨迹角
        val fl = data[iLo]
        var leanAngle: Double? = null
        var torsoLean: Double? = null
        var trajAngle: Double? = null
        if (fl != null && !fl.lost) {
            // JS 语义：null 参与减法按 0 处理（null - null = 0，数 - null = 数）
            fun num(v: Double?): Double = v ?: 0.0
            leanAngle = angleFromVertical(num(fl.ankleX) - num(fl.hipX), num(fl.ankleY) - num(fl.hipY))
            torsoLean = angleFromVertical(num(fl.shX) - num(fl.hipX), num(fl.shY) - num(fl.hipY))
        }
        var later: FrameData? = null
        for (j in min(data.size - 1, iLo + 4) downTo iLo + 1) {
            val d = data[j] ?: continue
            if (!d.lost && d.hipX != null && d.hipY != null) { later = d; break }
        }
        if (fl != null && later != null && !fl.lost) {
            val fhx = fl.hipX
            val fhy = fl.hipY
            val lhx = later.hipX
            val lhy = later.hipY
            if (fhx != null && fhy != null && lhx != null && lhy != null) {
                val dx = lhx - fhx
                val dy = -(lhy - fhy)
                trajAngle = jsRound(atan2(dy, abs(dx)) * 180 / Math.PI * 10) / 10
            }
        }

        // ③ 摆臂速度（带 unwrap）
        data class Arm(val i: Int, val ang: Double)
        val armWin = ArrayList<Arm>()
        val armStart = max(0, iLo - jsRound(0.45 * fps).toInt())
        for (a in armStart..iLo) {
            val d = data[a] ?: continue
            if (d.lost || d.shX == null || d.shY == null || d.wrX == null || d.wrY == null) continue
            var ang = atan2(d.wrX - d.shX, -(d.wrY - d.shY)) * 180 / Math.PI
            if (armWin.isNotEmpty()) {
                val prevAng = armWin[armWin.size - 1].ang
                while (ang - prevAng > 180) ang -= 360
                while (ang - prevAng < -180) ang += 360
            }
            armWin.add(Arm(a, ang))
        }
        var maxSwing = 0.0
        var amp = 0.0
        if (armWin.size >= 2) {
            val angs = armWin.map { it.ang }
            amp = angs.max() - angs.min()
            for (m in 1 until armWin.size) {
                val dt = (data[armWin[m].i].t - data[armWin[m - 1].i].t).takeIf { it != 0.0 } ?: (1 / fps)
                val v = abs(armWin[m].ang - armWin[m - 1].ang) / dt
                if (v > maxSwing) maxSwing = v
            }
        }

        // ④ 最后两步 ⑤ 落地 ⑥ 起跳方式
        val steps = detectLastSteps(data, lo)
        val landing = analyzeLanding(data, iLa, fps)
        val takeoff = detectTakeoffType(data, iLo, fps)

        return JumpMetrics(
            jump = jump,
            kneeMin = kneeMin,
            kneeMinTime = kneeMinTime,
            hipMin = hipMin,
            hipMinTime = hipMinTime,
            leanAngle = leanAngle,
            torsoLean = torsoLean,
            trajAngle = trajAngle,
            armSwingDegS = jsRound(maxSwing),
            armSwingAmp = jsRound(amp * 10) / 10,
            steps = steps,
            landing = landing,
            takeoff = takeoff
        )
    }

    // ---------------- computeJumpMetrics ----------------

    /** 弹跳专项指标总入口（JS computeJumpMetrics） */
    fun computeJumpMetrics(data: List<FrameData>, fps: Double): MetricsResult {
        val dbg = HashMap<String, Any?>()
        val jumps = detectJump(data, fps, dbg)
        val st = computeStats(data)
        val lostPct = if (st.total > 0) jsRound(st.lost.toDouble() / st.total * 100).toInt() else 0
        if (jumps.isEmpty()) {
            return MetricsResult(
                ok = false,
                msg = "未识别到弹跳",
                jumps = emptyList(),
                best = null,
                debug = mapOf(
                    "flightSegs" to (dbg["flightSegs"] ?: 0),
                    "rejected" to (dbg["rejected"] ?: 0),
                    "hipFallback" to (dbg["hipFallback"] ?: 0),
                    "lostPct" to lostPct,
                    "total" to st.total
                )
            )
        }
        var bestIdx = 0
        var bestLift = -1.0
        for ((idx, j) in jumps.withIndex()) {
            val iLo = idxNear(data, j.liftoffTime)
            val iLa = idxNear(data, j.landingTime)
            val base = ArrayList<Double>()
            val baseStart = max(0, iLo - jsRound(0.3 * fps).toInt())
            for (b in baseStart until iLo) {
                if (!data[b].lost && data[b].feetY != null) base.add(data[b].feetY!!)
            }
            if (base.size < 2) continue
            base.sort()
            val ground = base[floor(base.size / 2.0).toInt()]
            var minF = Double.POSITIVE_INFINITY
            for (m in iLo..min(iLa, data.size - 1)) {
                if (!data[m].lost && data[m].feetY != null && data[m].feetY!! < minF) minF = data[m].feetY!!
            }
            val lift = ground - minF
            if (lift > bestLift) { bestLift = lift; bestIdx = idx }
        }
        val best = analyzeJump(data, jumps[bestIdx], fps)
        var rsiMax = 0.0
        for (j in jumps) if (j.rsi != null && j.rsi > rsiMax) rsiMax = j.rsi
        return MetricsResult(
            ok = true,
            msg = "ok",
            jumps = jumps,
            best = best.copy(
                jumpCount = jumps.size,
                rsiMax = if (rsiMax > 0) rsiMax else null,
                contactTime = jumps[bestIdx].contactTime,
                usedHipFallback = jumps[bestIdx].source == "hip",
                bestLift = jsRound(bestLift * 1000) / 1000
            ),
            debug = mapOf("lostPct" to lostPct, "hipFallback" to (dbg["hipFallback"] ?: 0))
        )
    }
}
