package com.familyscheduler.nativeapp

import android.content.Context
import org.json.JSONArray
import java.time.LocalDate
import java.time.temporal.ChronoUnit

internal object EnglishContent {
    const val VERSION = 1
    val START_DAY: LocalDate = LocalDate.of(2026, 11, 17)

    fun bank(context: Context): List<Map<String, Any>> {
        val json = context.assets.open("english-bank.json").bufferedReader().use { it.readText() }
        val array = JSONArray(json)
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            mapOf(
                "id" to item.getString("id"), "grade" to 4, "kind" to "choice",
                "prompt" to item.getString("prompt"),
                "options" to item.getJSONArray("options").let { options ->
                    (0 until options.length()).map(options::getString)
                },
                "answer" to item.getString("answer"),
                "explanation" to item.getString("explanation"),
            )
        }
    }

    fun needsUpgrade(quiz: Map<*, *>?): Boolean {
        if (quiz == null) return true
        val version = (quiz["bankVersion"] as? Number)?.toInt() ?: 0
        val submissions = quiz["submissions"] as? Map<*, *> ?: emptyMap<Any, Any>()
        return version < VERSION && submissions.isEmpty()
    }

    fun select(day: LocalDate, history: Map<String, Map<*, *>>, bank: List<Map<String, Any>>): List<Map<String, Any>> {
        val recentIds = history.entries.filter { (date, _) ->
            val parsed = runCatching { LocalDate.parse(date) }.getOrNull()
            parsed != null && parsed.isBefore(day) && ChronoUnit.DAYS.between(parsed, day) <= 30
        }.flatMap { (_, quiz) ->
            (quiz["questions"] as? List<*>)?.mapNotNull { (it as? Map<*, *>)?.get("id") as? String }.orEmpty()
        }.toSet()
        val ordered = bank.sortedBy { stableHash(it["id"] as String) }
        val offset = Math.floorMod(day.toEpochDay().toInt() * 3, ordered.size)
        val rotated = ordered.drop(offset) + ordered.take(offset)
        val selected = rotated.filter { it["id"] !in recentIds }.take(3)
        check(selected.size == 3) { "새 영어 문제를 충분히 찾지 못했습니다." }
        return selected.map { question ->
            val options = (question["options"] as List<*>).mapNotNull { it as? String }
            question + ("options" to if (stableHash(day.toString() + question["id"] + "options") % 2L == 0L) options.reversed() else options)
        }
    }

    private fun stableHash(value: String): Long {
        var hash = 2166136261L
        value.forEach { char -> hash = ((hash xor char.code.toLong()) * 16777619L) and 0xffffffffL }
        return hash
    }
}
