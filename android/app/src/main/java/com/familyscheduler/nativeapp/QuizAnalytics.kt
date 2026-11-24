package com.familyscheduler.nativeapp

import java.text.Normalizer
import kotlin.math.roundToInt

internal object QuizAnalytics {
    data class WrongQuestion(val key: String, val subject: String, val question: Map<*, *>, val prompt: String,
        var attempts: Int = 0, var wrong: Int = 0, var lastWrongDate: String = "", var lastWrongAnswer: String = "")
    data class Stats(val answered: Int, val correct: Int, val questions: List<WrongQuestion>) {
        val wrong get() = answered - correct
        val accuracy get() = if (answered == 0) null else (correct * 100.0 / answered).roundToInt()
    }
    fun analyze(days: List<Map<String, Any>>, member: String, subject: String = "total",
        promptFor: (String, Map<*, *>) -> String = { _, q -> q["prompt"] as? String ?: "" }): Stats {
        val groups = linkedMapOf<String, WrongQuestion>()
        var answered = 0
        var correct = 0
        days.associateBy { it["date"] }.values.forEach { day ->
            val date = day["date"] as? String ?: return@forEach
            listOf("spelling", "english").forEach courseLoop@ { course ->
                if (subject != "total" && subject != course) return@courseLoop
                val quiz = day[course + "Quiz"] as? Map<*, *> ?: return@courseLoop
                val submission = (quiz["submissions"] as? Map<*, *>)?.get(member) as? Map<*, *> ?: return@courseLoop
                val answers = submission["answers"] as? List<*> ?: return@courseLoop
                (quiz["questions"] as? List<*>)?.forEachIndexed { index, raw ->
                    val q = raw as? Map<*, *> ?: return@forEachIndexed
                    val answer = answers.getOrNull(index) as? String ?: return@forEachIndexed
                    if (answer.isBlank()) return@forEachIndexed
                    val expected = q["answer"] as? String ?: return@forEachIndexed
                    val prompt = promptFor(course, q)
                    val key = listOf(course, normalized(prompt).replace(Regex("\\s+"), " "), normalized(expected)).joinToString("\u0000")
                    val row = groups.getOrPut(key) { WrongQuestion(key, course, q, prompt) }
                    row.attempts++; answered++
                    if (SpellingContent.correct(answer, expected)) correct++ else {
                        row.wrong++
                        if (date >= row.lastWrongDate) { row.lastWrongDate = date; row.lastWrongAnswer = answer }
                    }
                }
            }
        }
        return Stats(answered, correct, groups.values.filter { it.wrong > 0 }.sortedWith(
            compareByDescending<WrongQuestion> { it.wrong }.thenByDescending { it.wrong.toDouble() / it.attempts }
                .thenByDescending { it.lastWrongDate }.thenBy { it.key }))
    }
    private fun normalized(value: String) = Normalizer.normalize(value, Normalizer.Form.NFC).trim()
}
