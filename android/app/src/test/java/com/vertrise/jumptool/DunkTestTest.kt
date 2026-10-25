package com.vertrise.jumptool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DunkTestTest {

    @Test
    fun allThreePass() {
        // 立定跳远 270 / 站摸 225 / 原地 290 / 助跑 310 -> 差 20
        val r = DunkTest.evaluate(270, 225, 290, 310)
        assertEquals(3, r.passed)
        assertEquals("随便起飞", r.verdict)
        assertEquals(20, r.reachGap)
        assertTrue(r.metrics.all { it.passed })
    }

    @Test
    fun twoPassIsTakeoffLine() {
        // 跳远 270 达标；站摸 225 达标；助跑 300 - 原地 292 = 8 < 15 不达标
        val r = DunkTest.evaluate(270, 225, 292, 300)
        assertEquals(2, r.passed)
        assertEquals("半步之遥", r.verdict)
        assertEquals(8, r.reachGap)
        assertFalse(r.metrics.first { it.key == "gap" }.passed)
        assertTrue(r.plan.contains("摸高差"))
    }

    @Test
    fun boundaryValues() {
        // 立定跳远 260 刚好达标，站摸 219 差 1，助跑差 15 刚好达标
        assertEquals(2, DunkTest.evaluate(260, 219, 280, 295).passed)
        // 站摸 220 刚好达标
        assertEquals(3, DunkTest.evaluate(260, 220, 280, 295).passed)
        // 跳远 259、差 14 -> 只中站摸
        assertEquals(1, DunkTest.evaluate(259, 220, 280, 294).passed)
    }

    @Test
    fun weakestMetricIsChosen() {
        // 跳远 260 达标，站摸 225 达标，差 5（5/15 最弱）-> 短板是摸高差
        val r = DunkTest.evaluate(260, 225, 290, 295)
        assertEquals(2, r.passed)
        assertTrue(r.plan.contains("摸高差"))
    }
}
