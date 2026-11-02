package com.familyscheduler.nativeapp

import java.time.LocalDate
import java.time.YearMonth

internal object RankingPeriod {
    fun months(first: YearMonth, current: YearMonth): List<YearMonth> =
        generateSequence(current) { it.minusMonths(1) }.takeWhile { it >= first }.toList()
    fun range(month: YearMonth, today: LocalDate): Pair<LocalDate, LocalDate> =
        month.atDay(1) to minOf(month.atEndOfMonth(), today)
}
