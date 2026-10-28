package com.familyscheduler.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate

class ModelsTest {
    @Test
    fun safeKey_strips_firestore_unsafe_characters() {
        assertEquals("abc_DEF_123", safeKey("abc-DEF/123"))
    }

    @Test
    fun cleanHomeworkTitle_removes_status_prefixes() {
        assertEquals("엘리하이(영어)", cleanHomeworkTitle("✅ 📝 엘리하이(영어)"))
        assertEquals("수학 연산", cleanHomeworkTitle("숙제 완료 · 수학 연산"))
    }

    @Test
    fun daily_repeat_generates_requested_count() {
        val start = LocalDate.of(2026, 10, 27)
        val rows = repeatStarts(start, "daily", 3)
        assertEquals(listOf(start, start.plusDays(1), start.plusDays(2)), rows)
    }

    @Test
    fun weekdays_repeat_skips_weekend() {
        val friday = LocalDate.of(2026, 10, 30)
        val rows = repeatStarts(friday, "weekdays", 3)
        assertEquals(DayOfWeek.FRIDAY, rows[0].dayOfWeek)
        assertEquals(DayOfWeek.MONDAY, rows[1].dayOfWeek)
        assertEquals(DayOfWeek.TUESDAY, rows[2].dayOfWeek)
    }

    @Test
    fun monthly_repeat_preserves_anchor_day_when_possible() {
        val jan31 = LocalDate.of(2027, 1, 31)
        val rows = repeatStarts(jan31, "monthly", 3)
        assertEquals(LocalDate.of(2027, 1, 31), rows[0])
        assertEquals(LocalDate.of(2027, 2, 28), rows[1])
        assertEquals(LocalDate.of(2027, 3, 31), rows[2])
    }

    @Test
    fun familyEvent_roundtrip_preserves_google_and_homework_metadata() {
        val original = FamilyEvent(
            id = "gcal_test",
            title = "가족 외식",
            start = "2026-10-27T18:30:00",
            end = "2026-10-27T19:30:00",
            memberIds = listOf("me"),
            googleImported = true,
            googleCalendarId = "calendar",
            googleEventId = "event",
            homeworkSeriesId = "series",
            completed = true,
            completedAt = "2026-10-27T17:00:00",
        )
        val restored = FamilyEvent.fromMap(original.toMap())
        assertEquals(original.id, restored?.id)
        assertEquals(original.googleImported, restored?.googleImported)
        assertEquals(original.googleCalendarId, restored?.googleCalendarId)
        assertEquals(original.googleEventId, restored?.googleEventId)
        assertEquals(original.homeworkSeriesId, restored?.homeworkSeriesId)
        assertTrue(restored?.completed == true)
        assertFalse(restored?.completedAt.isNullOrBlank())
    }

    @Test
    fun alternate_recurrence_matches_calendar_weeks_and_months() {
        val start = LocalDate.of(2026, 10, 28)
        fun dates(mode: String, count: Int, from: LocalDate = start, until: LocalDate? = null) =
            repeatStarts(from, mode, count, until, alternate = true).map { it.toString() }
        assertEquals(listOf("2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-08"), dates("daily", 5))
        assertEquals(listOf("2026-10-28", "2026-10-29", "2026-10-30", "2026-11-09", "2026-11-10"), dates("weekdays", 5))
        assertEquals(listOf("2026-10-28", "2026-11-11", "2026-11-25"), dates("weekly", 3))
        assertEquals(listOf("2026-10-28", "2026-12-28", "2027-02-28"), dates("monthly", 3))
        assertEquals(listOf("2026-12-31", "2027-02-28", "2027-04-30"), dates("monthly", 3, LocalDate.of(2026, 12, 31)))
        assertEquals(listOf("2026-11-09", "2026-11-10"), dates("weekdays", 2, LocalDate.of(2026, 10, 31)))
        assertEquals(listOf("2026-11-02", "2026-11-03"), dates("weekdays", 2, LocalDate.of(2026, 11, 1)))
        assertEquals(4, dates("daily", 365, until = LocalDate.of(2026, 11, 7)).size)
        assertEquals(365, dates("daily", 365).size)
    }

    @Test
    fun alternate_setting_survives_storage_and_legacy_defaults() {
        val event = FamilyEvent(start = "2026-10-28T09:00:00", alternateRepeat = true)
        assertTrue(FamilyEvent.fromMap(event.toMap())?.alternateRepeat == true)
        assertFalse(FamilyEvent.fromMap(event.toMap() - "alternateRepeat")!!.alternateRepeat)
    }
}
