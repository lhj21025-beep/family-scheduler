package com.familyscheduler.nativeapp

import com.github.usingsky.calendar.KoreanLunarCalendar
import java.time.LocalDate

data class LunarDateInfo(val year: Int, val month: Int, val day: Int, val leap: Boolean)

fun solarToLunar(date: LocalDate): LunarDateInfo? {
    val calendar = KoreanLunarCalendar.getInstance()
    if (!calendar.setSolarDate(date.year, date.monthValue, date.dayOfMonth)) return null
    return LunarDateInfo(calendar.lunarYear, calendar.lunarMonth, calendar.lunarDay, calendar.isIntercalation)
}

fun lunarToSolar(year: Int, month: Int, day: Int, leap: Boolean): LocalDate? {
    val calendar = KoreanLunarCalendar.getInstance()
    var ok = calendar.setLunarDate(year, month, day, leap)
    if (!ok && leap) ok = calendar.setLunarDate(year, month, day, false)
    if (!ok && day == 30) ok = calendar.setLunarDate(year, month, 29, false)
    return if (ok) LocalDate.of(calendar.solarYear, calendar.solarMonth, calendar.solarDay) else null
}

fun lunarRepeatStarts(start: LocalDate, lunar: LunarDateInfo, count: Int, until: LocalDate?): List<LocalDate> {
    val result = mutableListOf<LocalDate>()
    for (year in lunar.year..2050) {
        val solar = lunarToSolar(year, lunar.month, lunar.day, lunar.leap) ?: continue
        if (solar.isBefore(start)) continue
        if (until != null && solar.isAfter(until)) break
        result += solar
        if (until == null && result.size >= count.coerceIn(1, 365)) break
    }
    return result
}
