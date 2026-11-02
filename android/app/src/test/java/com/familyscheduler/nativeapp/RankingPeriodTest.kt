package com.familyscheduler.nativeapp

import java.time.LocalDate
import java.time.YearMonth
import org.junit.Assert.*
import org.junit.Test

class RankingPeriodTest {
    @Test fun allMonthsRemainAvailableBeyondOneYear() {
        val first = YearMonth.of(2026, 10)
        assertEquals(listOf(YearMonth.of(2026, 11), first), RankingPeriod.months(first, YearMonth.of(2026, 11)))
        val months = RankingPeriod.months(first, YearMonth.of(2028, 1))
        assertEquals(16, months.size)
        assertEquals(first, months.last())
        assertEquals(YearMonth.of(2027, 12), months[1])
    }
    @Test fun monthBoundariesAndLeapYears() {
        val today = LocalDate.of(2026, 11, 2)
        assertEquals(LocalDate.of(2026, 10, 1) to LocalDate.of(2026, 10, 31), RankingPeriod.range(YearMonth.of(2026, 10), today))
        assertEquals(LocalDate.of(2026, 11, 1) to today, RankingPeriod.range(YearMonth.of(2026, 11), today))
        assertEquals(LocalDate.of(2028, 2, 29), RankingPeriod.range(YearMonth.of(2028, 2), LocalDate.of(2028, 3, 1)).second)
        assertEquals(LocalDate.of(2027, 2, 28), RankingPeriod.range(YearMonth.of(2027, 2), LocalDate.of(2027, 3, 1)).second)
        assertEquals(LocalDate.of(2026, 12, 31), RankingPeriod.range(YearMonth.of(2026, 12), LocalDate.of(2027, 1, 1)).second)
    }
}
