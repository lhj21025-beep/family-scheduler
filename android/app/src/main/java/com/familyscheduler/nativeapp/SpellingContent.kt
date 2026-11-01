package com.familyscheduler.nativeapp

import java.text.Normalizer
import java.time.LocalDate

/** Pure policy shared with web/server; no Android/Firebase dependencies. */
internal object SpellingContent {
    const val VERSION = 2
    private val aliases = mapOf("어이없다" to "어이없는", "갈게" to "할게", "가리켰다" to "가르쳤다",
        "잊어버려서" to "잃어버려", "잊어버려" to "잃어버려", "낫다" to "낮다")
    private fun key(s: String) = Normalizer.normalize(s, Normalizer.Form.NFC)
        .replace(Regex("[\\s.,!?'\"‘’“”()_]"), "").lowercase()
    private fun words(q: Map<*, *>) = (q["options"] as? List<*>)?.filterIsInstance<String>().orEmpty()
    fun keys(q: Map<*, *>): Set<String> {
        val answer = q["answer"] as? String ?: ""
        val values = (listOf(answer) + words(q)).map { key(aliases[it] ?: it) }
        val topics = expandedSpellingBank.filter { b -> words(b).any { key(it) in values } }
        return buildSet {
            add("answer:" + key(aliases[answer] ?: answer))
            add("prompt:" + key(q["prompt"] as? String ?: ""))
            topics.forEach { add("topic:" + it["id"]) }
            if (words(q).isNotEmpty()) add("pair:" + words(q).map(::key).sorted().joinToString("|"))
        }
    }
    fun hash(s: String): Long {
        var h = 2166136261L
        s.forEach { h = ((h xor it.code.toLong()) * 16777619L) and 0xffffffffL }
        return h
    }
    fun needsUpgrade(quiz: Map<*, *>?): Boolean = quiz == null ||
        (((quiz["bankVersion"] as? Number)?.toInt() ?: 0) < VERSION && (quiz["submissions"] as? Map<*, *>).isNullOrEmpty())
    fun select(day: LocalDate, history: Map<String, Map<*, *>>): List<Map<String, Any>> {
        val seen = history.filterKeys { it < day.toString() && it >= day.minusDays(30).toString() }
            .values.flatMap { (it["questions"] as? List<*>)?.filterIsInstance<Map<*, *>>().orEmpty() }
            .flatMap(::keys).toSet()
        val ordered = expandedSpellingBank.sortedBy { hash(it["id"] as String) }
        val offset = Math.floorMod(day.toEpochDay() * 3, ordered.size.toLong()).toInt()
        val rotated = ordered.drop(offset) + ordered.take(offset)
        val chosen = mutableSetOf<String>()
        val selected = mutableListOf<Map<String, Any>>()
        for (q in rotated) {
            val content = keys(q)
            if (content.any { it in seen || it in chosen }) continue
            val options = if (hash(day.toString() + q["id"] + "options") % 2L == 0L) words(q).reversed() else words(q)
            selected.add(q + ("options" to options))
            chosen.addAll(content)
            if (selected.size == 3) break
        }
        check(selected.size == 3) { "새 맞춤법 문제를 충분히 찾지 못했습니다." }
        return selected
    }
    fun explanation(answer: String, original: String): String =
        expandedSpellingBank.firstOrNull { it["answer"] == answer }?.get("explanation") as? String ?: original
    fun correct(actual: String, expected: String): Boolean {
        fun clean(s: String) = Normalizer.normalize(s, Normalizer.Form.NFC).trim()
            .replace(Regex("[.,!?'\"‘’“”]"), "").replace(Regex("\\s+"), " ").lowercase()
        return clean(actual) == clean(expected)
    }
}
