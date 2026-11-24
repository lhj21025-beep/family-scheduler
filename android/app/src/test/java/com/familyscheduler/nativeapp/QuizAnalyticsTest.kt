package com.familyscheduler.nativeapp

import org.junit.Assert.*
import org.junit.Test

class QuizAnalyticsTest {
    private val question = mapOf("id" to "q1", "prompt" to "She (____) happy.", "answer" to "is", "explanation" to "She uses is.")
    private fun day(date: String, answers: List<String>, questions: List<Map<String, String>> = listOf(question)): Map<String, Any> = mapOf(
        "date" to date, "englishQuiz" to mapOf("questions" to questions, "submissions" to mapOf(
            "son" to mapOf("answers" to answers), "me" to mapOf("answers" to questions.map { it["answer"] }))))
    @Test fun isolatesPeopleAndSubjectsAndCountsActualAnswers() {
        val days = listOf(day("2026-11-20", listOf("am")), day("2026-11-21", listOf("are"), listOf(question + ("id" to "new-id"))),
            day("2026-11-22", listOf("is", "are"), listOf(question, question + ("prompt" to "He (____) tall."))))
        val result = QuizAnalytics.analyze(days + days[0], "son")
        assertEquals(4, result.answered); assertEquals(1, result.correct); assertEquals(3, result.wrong)
        assertEquals(25, result.accuracy); assertEquals(2, result.questions.size)
        assertEquals(2, result.questions[0].wrong); assertEquals(3, result.questions[0].attempts)
        assertEquals("2026-11-21", result.questions[0].lastWrongDate)
        assertEquals("are", result.questions[0].lastWrongAnswer)
        assertTrue(QuizAnalytics.analyze(days, "me").questions.isEmpty())
        assertNull(QuizAnalytics.analyze(days, "wife").accuracy)
        assertEquals(0, QuizAnalytics.analyze(days, "son", "spelling").answered)
        assertEquals(0, QuizAnalytics.analyze(listOf(day("2026-11-24", listOf(""))), "son").answered)
    }
}
