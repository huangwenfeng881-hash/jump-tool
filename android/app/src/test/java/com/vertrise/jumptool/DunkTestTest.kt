package com.vertrise.jumptool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DunkTestTest {

    @Test
    fun allThreePass() {
        val r = DunkTest.evaluate(280, 75, 320)
        assertEquals(3, r.passed)
        assertEquals("随便起飞", r.verdict)
        assertTrue(r.metrics.all { it.passed })
    }

    @Test
    fun twoPassIsTakeoffLine() {
        val r = DunkTest.evaluate(255, 62, 300)
        assertEquals(2, r.passed)
        assertEquals("半步之遥", r.verdict)
        assertFalse(r.metrics.first { it.key == "run" }.passed)
        assertTrue(r.plan.contains("助跑摸高"))
    }

    @Test
    fun boundaryValues() {
        // 立定跳远刚好 250 达标，其余两项差 1
        assertEquals(1, DunkTest.evaluate(250, 59, 304).passed)
        assertEquals(0, DunkTest.evaluate(249, 59, 304).passed)
        assertEquals(1, DunkTest.evaluate(249, 60, 304).passed)
    }

    @Test
    fun weakestMetricIsChoosen() {
        // 立定跳远 250/250=100%，纵跳 30/60=50%，助跑 305/305=100% -> 短板是纵跳
        val r = DunkTest.evaluate(250, 30, 305)
        assertEquals(2, r.passed)
        assertTrue(r.plan.contains("原地纵跳"))
    }
}
