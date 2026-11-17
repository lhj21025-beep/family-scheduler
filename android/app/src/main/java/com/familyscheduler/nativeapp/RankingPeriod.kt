package com.familyscheduler.nativeapp

import java.time.LocalDate
import java.time.YearMonth
import java.time.DayOfWeek
import java.time.temporal.TemporalAdjusters

internal object RankingPeriod {
    fun months(first: YearMonth, current: YearMonth): List<YearMonth> =
        generateSequence(current) { it.minusMonths(1) }.takeWhile { it >= first }.toList()
    fun range(month: YearMonth, today: LocalDate): Pair<LocalDate, LocalDate> =
        month.atDay(1) to minOf(month.atEndOfMonth(), today)
    fun weekRange(anchor: LocalDate, today: LocalDate): Pair<LocalDate, LocalDate> {
        val start = anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        return start to minOf(start.plusDays(6), today)
    }
    fun weeks(first: LocalDate, today: LocalDate): List<LocalDate> {
        val firstMonday = first.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val currentMonday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        return generateSequence(currentMonday) { it.minusWeeks(1) }.takeWhile { !it.isBefore(firstMonday) }.toList()
    }
}
