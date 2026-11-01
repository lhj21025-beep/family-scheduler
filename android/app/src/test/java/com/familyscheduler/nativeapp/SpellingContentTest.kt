package com.familyscheduler.nativeapp

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class SpellingContentTest {
    @Test fun bankHasDistinctCompleteQuestions() {
        assertEquals(128, expandedSpellingBank.size)
        for (field in listOf("id", "answer", "prompt")) assertEquals(128, expandedSpellingBank.map { it[field] }.toSet().size)
        expandedSpellingBank.forEach { q ->
            val options = q["options"] as List<*>
            assertEquals(2, options.toSet().size)
            assertTrue(options.contains(q["answer"]))
            assertTrue((q["explanation"] as String).contains("완성 문장:"))
            assertFalse(SpellingContent.correct(options.first { it != q["answer"] } as String, q["answer"] as String))
        }
    }
    @Test fun yearOfQuizzesHasNoDailyOrThirtyDayRepeats() {
        val history = mutableMapOf<String, Map<*, *>>()
        repeat(365) { offset ->
            val day = LocalDate.of(2026, 11, 2).plusDays(offset.toLong())
            val selected = SpellingContent.select(day, history)
            assertEquals(3, selected.size)
            val recent = history.filterKeys { it >= day.minusDays(30).toString() }.values
                .flatMap { (it["questions"] as List<*>).filterIsInstance<Map<*, *>>() }.flatMap(SpellingContent::keys).toSet()
            val daily = mutableSetOf<String>()
            selected.forEach { q -> SpellingContent.keys(q).forEach { key ->
                assertFalse("recent $day $key", key in recent)
                assertTrue("daily $day $key", daily.add(key))
            } }
            history[day.toString()] = mapOf("questions" to selected)
        }
    }
    @Test fun matchesWebFixtureAndIgnoresLegacyIds() {
        val day = LocalDate.of(2026, 11, 2)
        val first = SpellingContent.select(day, emptyMap())
        assertEquals(listOf("bank2-110", "bank2-095", "bank2-111"), first.map { it["id"] })
        val old = first.map { (it - "options") + mapOf("id" to "old", "kind" to "write") }
        val selected = SpellingContent.select(day.plusDays(1), mapOf(day.toString() to mapOf("questions" to old)))
        val used = first.flatMap(SpellingContent::keys).toSet()
        assertTrue(selected.all { q -> SpellingContent.keys(q).none { it in used } })
    }
    @Test fun protectsSubmittedQuizzesAndMeaningfulSpaces() {
        assertTrue(SpellingContent.needsUpgrade(null))
        assertTrue(SpellingContent.needsUpgrade(mapOf("submissions" to emptyMap<String, Any>())))
        assertFalse(SpellingContent.needsUpgrade(mapOf("submissions" to mapOf("son" to mapOf("score" to 0)))))
        assertFalse(SpellingContent.needsUpgrade(mapOf("bankVersion" to 2)))
        assertTrue(SpellingContent.correct(" 할 수 ", "할 수"))
        assertFalse(SpellingContent.correct("할수", "할 수"))
    }
}
