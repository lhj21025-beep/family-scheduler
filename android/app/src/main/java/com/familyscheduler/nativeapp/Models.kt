package com.familyscheduler.nativeapp

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

data class FamilyEvent(
    val id: String = newId(),
    val title: String = "",
    val start: String = "",
    val end: String? = null,
    val allDay: Boolean = false,
    val memberIds: List<String> = listOf("me"),
    val kind: String = "event",
    val homeworkId: String? = null,
    val homeworkSeriesId: String? = null,
    val homeworkStartDate: String? = null,
    val homeworkEndDate: String? = null,
    val completed: Boolean = false,
    val completedAt: String? = null,
    val location: String? = null,
    val memo: String? = null,
    val repeat: String = "none",
    val repeatCount: Int = 1,
    val createdBy: String? = null,
    val familyId: String = "family-main",
) {
    val date: String get() = start.take(10)

    fun toMap(): Map<String, Any> = buildMap {
        put("id", id); put("title", title); put("start", start)
        end?.let { put("end", it) }
        put("allDay", allDay); put("memberIds", memberIds); put("kind", kind)
        homeworkId?.let { put("homeworkId", it) }
        homeworkSeriesId?.let { put("homeworkSeriesId", it) }
        homeworkStartDate?.let { put("homeworkStartDate", it) }
        homeworkEndDate?.let { put("homeworkEndDate", it) }
        put("completed", completed)
        completedAt?.let { put("completedAt", it) }
        location?.takeIf { it.isNotBlank() }?.let { put("location", it) }
        memo?.takeIf { it.isNotBlank() }?.let { put("memo", it) }
        put("repeat", repeat); put("repeatCount", repeatCount)
        createdBy?.let { put("createdBy", it) }
        put("familyId", familyId)
    }

    companion object {
        fun fromMap(data: Map<*, *>): FamilyEvent? {
            val id = data["id"] as? String ?: return null
            val start = data["start"] as? String ?: return null
            return FamilyEvent(
                id = id,
                title = data["title"] as? String ?: "",
                start = start,
                end = data["end"] as? String,
                allDay = data["allDay"] as? Boolean ?: false,
                memberIds = (data["memberIds"] as? List<*>)?.mapNotNull { it as? String } ?: listOf("me"),
                kind = data["kind"] as? String ?: "event",
                homeworkId = data["homeworkId"] as? String,
                homeworkSeriesId = data["homeworkSeriesId"] as? String,
                homeworkStartDate = data["homeworkStartDate"] as? String,
                homeworkEndDate = data["homeworkEndDate"] as? String,
                completed = data["completed"] as? Boolean ?: false,
                completedAt = data["completedAt"] as? String,
                location = data["location"] as? String,
                memo = data["memo"] as? String,
                repeat = data["repeat"] as? String ?: "none",
                repeatCount = (data["repeatCount"] as? Number)?.toInt() ?: 1,
                createdBy = data["createdBy"] as? String,
                familyId = data["familyId"] as? String ?: "family-main",
            )
        }
    }
}

data class Homework(val id: String, val name: String) {
    companion object {
        fun fromMap(data: Map<*, *>) = Homework(data["id"] as? String ?: newId(), data["name"] as? String ?: "숙제")
    }
}

data class Member(val id: String, val label: String, val icon: String, val color: Int)

val members = listOf(
    Member("me", "아빠", "👨", 0xFF4285F4.toInt()),
    Member("wife", "엄마", "👩", 0xFF9C6ADE.toInt()),
    Member("son", "강천", "👦", 0xFF34A853.toInt()),
)

val defaultHomeworks = listOf(
    Homework("eli-english", "엘리하이(영어)"), Homework("eli-math", "엘리하이(수학)"),
    Homework("eli-science", "엘리하이(과학)"), Homework("eli-social", "엘리하이(사회)"),
    Homework("eli-korean", "엘리하이(국어)"), Homework("hanja", "한자"),
    Homework("math-calc", "수학 연산"), Homework("pretty-writing", "예쁜 글씨 쓰기"),
    Homework("art", "미술학원 숙제")
)

fun newId(): String = UUID.randomUUID().toString().replace("-", "")
fun safeKey(id: String): String = id.replace(Regex("[^A-Za-z0-9_]"), "_")
fun dateTime(date: LocalDate, hour: Int = 0, minute: Int = 0): String =
    date.atTime(hour, minute).format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"))
fun cleanHomeworkTitle(title: String): String = title
    .replace(Regex("^(?:(?:📝|✅|☑️|☑|✔️|✔)\\s*)+"), "")
    .replace(Regex("^숙제 완료\\s*·\\s*"), "").trim()
fun datesBetween(start: LocalDate, end: LocalDate): List<LocalDate> =
    generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.take(366).toList()

fun repeatStarts(start: LocalDate, repeat: String, count: Int): List<LocalDate> {
    if (repeat == "none") return listOf(start)
    val result = mutableListOf(start)
    var date = start
    while (result.size < count.coerceIn(1, 365)) {
        date = when (repeat) {
            "daily" -> date.plusDays(1)
            "weekdays" -> generateSequence(date.plusDays(1)) { it.plusDays(1) }
                .first { it.dayOfWeek.value in 1..5 }
            "weekly" -> date.plusWeeks(1)
            "monthly" -> date.plusMonths(1)
            else -> date
        }
        result += date
    }
    return result
}

fun nowIso(): String = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"))
