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

    @Test
    fun registration_skips_two_of_one_hundred_including_distant_future() {
        listOf("event", "homework").forEach { kind ->
            val rows = (0 until 100).map { index -> FamilyEvent(
                id = "new-$index", title = "엘리하이(영어)", kind = kind,
                start = "${LocalDate.of(2026, 11, 4).plusWeeks(index.toLong())}T18:00",
                memberIds = listOf("son"), homeworkId = if (kind == "homework") "english" else null,
            ) }
            val existing = listOf(rows[2].copy(id = "old-2"), rows[98].copy(id = "old-98"))
            val accepted = uniqueRegistrations(rows, existing)
            assertEquals(98, accepted.size)
            assertFalse(accepted.contains(rows[2]))
            assertFalse(accepted.contains(rows[98]))
            assertEquals(100, uniqueRegistrations(rows, emptyList()).size)
            assertEquals(0, uniqueRegistrations(rows, rows).size)
            assertEquals("100건 중 2건은 중복으로 제외하고 98건 등록했습니다.", RegistrationResult(100, accepted).summary())
        }
    }

    @Test
    fun registration_preserves_different_times_people_and_school_details() {
        val event = FamilyEvent(title = "수영", start = "2026-11-11T18:00", memberIds = listOf("son"))
        assertTrue(sameRegistration(event, event.copy(start = "2026-11-11T18:00:00")))
        assertFalse(sameRegistration(event, event.copy(start = "2026-11-11T19:00")))
        assertFalse(sameRegistration(event, event.copy(memberIds = listOf("me"))))
        assertFalse(sameRegistration(event, event.copy(allDay = true)))
        assertFalse(sameRegistration(event, event.copy(kind = "approval-alert")))
        assertFalse(sameRegistration(event, event.copy(title = "축구")))
        assertTrue(sameRegistration(event.copy(memberIds = listOf("me", "son")), event.copy(memberIds = listOf("son", "me"))))
        assertTrue(sameRegistration(event.copy(allDay = true), event.copy(allDay = true, start = "2026-11-11T00:00")))
        val homework = event.copy(kind = "homework", homeworkId = "english", title = "📝 영어")
        assertTrue(sameRegistration(homework, homework.copy(title = "✅ 영어", kind = "homework-complete")))
        assertTrue(sameRegistration(homework, homework.copy(title = "영어 학습")))
        assertFalse(sameRegistration(homework.copy(homeworkId = "school-other", title = "학교숙제 · 수학 20쪽"),
            homework.copy(homeworkId = "school-other", title = "학교숙제 · 과학 조사")))
    }

    @Test
    fun registration_rechecks_concurrent_inserts_and_overlapping_blocks() {
        val row = FamilyEvent(title = "영어", kind = "homework", start = "2026-11-11T00:00", homeworkId = "english")
        val preflight = uniqueRegistrations(listOf(row, row.copy(id = "overlap")), emptyList())
        assertEquals(1, preflight.size)
        assertEquals(0, uniqueRegistrations(preflight, listOf(row.copy(id = "concurrent"))).size)
    }
}

