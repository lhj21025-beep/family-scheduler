package com.familyscheduler.nativeapp

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import java.time.LocalDate
import java.time.YearMonth

class FamilyRepository {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private var monthListener: ListenerRegistration? = null
    private var homeworkListener: ListenerRegistration? = null

    fun login(email: String, password: String, done: (Result<Unit>) -> Unit) {
        auth.signInWithEmailAndPassword(email, password)
            .addOnSuccessListener { done(Result.success(Unit)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun logout() = auth.signOut()
    fun isLoggedIn() = auth.currentUser != null
    fun signedMember(): String = when (auth.currentUser?.email) {
        "mom@family-scheduler.app" -> "wife"
        "son@family-scheduler.app" -> "son"
        else -> "me"
    }

    fun listenMonth(month: YearMonth, update: (List<FamilyEvent>) -> Unit, error: (Exception) -> Unit) {
        monthListener?.remove()
        val start = month.atDay(1).toString()
        val end = month.plusMonths(1).atDay(1).toString()
        monthListener = db.collection("scheduleDays")
            .whereGreaterThanOrEqualTo("date", start).whereLessThan("date", end)
            .addSnapshotListener { snapshots, e ->
                if (e != null) return@addSnapshotListener error(e)
                val events = snapshots?.documents.orEmpty().flatMap { parseEvents(it) }.sortedBy { it.start }
                update(events)
            }
    }

    fun listenHomeworks(update: (List<Homework>) -> Unit) {
        homeworkListener?.remove()
        homeworkListener = db.collection("familyData").document("family-main")
            .addSnapshotListener { snapshot, _ ->
                val raw = snapshot?.get("homeworks") as? List<*>
                val items = raw?.mapNotNull { value -> (value as? Map<*, *>)?.let { Homework.fromMap(it) } }.orEmpty()
                update((items.ifEmpty { defaultHomeworks }).sortedBy { it.name })
            }
    }

    fun saveEvent(event: FamilyEvent, done: (Result<Unit>) -> Unit) {
        val value = event.copy(createdBy = event.createdBy ?: auth.currentUser?.uid)
        db.collection("scheduleDays").document(value.date)
            .set(mapOf("date" to value.date, "events" to mapOf(safeKey(value.id) to value.toMap())), SetOptions.merge())
            .addOnSuccessListener { refreshWidgets(); done(Result.success(Unit)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun saveEvents(events: List<FamilyEvent>, done: (Result<Int>) -> Unit) {
        if (events.isEmpty()) return done(Result.success(0))
        val batch = db.batch()
        events.groupBy { it.date }.forEach { (date, dayEvents) ->
            val values = dayEvents.associate { event ->
                safeKey(event.id) to event.copy(createdBy = event.createdBy ?: auth.currentUser?.uid).toMap()
            }
            batch.set(db.collection("scheduleDays").document(date), mapOf("date" to date, "events" to values), SetOptions.merge())
        }
        batch.commit().addOnSuccessListener { refreshWidgets(); done(Result.success(events.size)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun moveOrSaveEvent(old: FamilyEvent?, next: FamilyEvent, done: (Result<Unit>) -> Unit) {
        if (old == null || old.date == next.date) return saveEvent(next, done)
        deleteEvent(old) { deleted ->
            if (deleted.isFailure) done(deleted) else saveEvent(next, done)
        }
    }

    fun deleteEvent(event: FamilyEvent, done: (Result<Unit>) -> Unit) {
        db.collection("scheduleDays").document(event.date)
            .update("events.${safeKey(event.id)}", FieldValue.delete())
            .addOnSuccessListener { refreshWidgets(); done(Result.success(Unit)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun registerHomework(
        selected: List<Homework>, start: LocalDate, end: LocalDate,
        repeat: String, repeatCount: Int, done: (Result<Int>) -> Unit
    ) {
        val blockLength = java.time.temporal.ChronoUnit.DAYS.between(start, end)
        val events = selected.flatMap { homework ->
            val seriesId = newId()
            repeatStarts(start, repeat, if (repeat == "none") 1 else repeatCount).flatMap { occurrenceStart ->
                val occurrenceEnd = occurrenceStart.plusDays(blockLength)
                datesBetween(occurrenceStart, occurrenceEnd).map { day ->
                    FamilyEvent(
                        title = "📝 ${homework.name}", start = dateTime(day), end = dateTime(day, 23, 59),
                        allDay = true, memberIds = listOf("son"), kind = "homework",
                        homeworkId = homework.id, homeworkSeriesId = seriesId,
                        homeworkStartDate = occurrenceStart.toString(), homeworkEndDate = occurrenceEnd.toString(),
                        repeat = repeat, repeatCount = repeatCount
                    )
                }
            }
        }
        if (events.isEmpty()) return done(Result.success(0))
        val batch = db.batch()
        events.groupBy { it.date }.forEach { (date, dayEvents) ->
            val values = dayEvents.associate { safeKey(it.id) to it.copy(createdBy = auth.currentUser?.uid).toMap() }
            batch.set(db.collection("scheduleDays").document(date), mapOf("date" to date, "events" to values), SetOptions.merge())
        }
        batch.commit().addOnSuccessListener { refreshWidgets(); done(Result.success(events.size)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun setHomeworkCompleted(event: FamilyEvent, completed: Boolean, done: (Result<Int>) -> Unit) {
        val start = LocalDate.parse(event.homeworkStartDate ?: event.date)
        val end = LocalDate.parse(event.homeworkEndDate ?: event.date)
        val dates = (datesBetween(start, end) + LocalDate.parse(event.date)).distinct()
        val refs = dates.map { db.collection("scheduleDays").document(it.toString()) }
        db.runTransaction { transaction ->
            var changed = 0
            refs.forEach { ref ->
                val snapshot = transaction.get(ref)
                val current = parseEvents(snapshot)
                current.filter { candidate ->
                    candidate.kind == "homework" && candidate.homeworkId == event.homeworkId &&
                        (candidate.id == event.id || (
                            candidate.homeworkSeriesId == event.homeworkSeriesId &&
                            candidate.homeworkStartDate == event.homeworkStartDate &&
                            candidate.homeworkEndDate == event.homeworkEndDate
                        ))
                }.forEach { candidate ->
                    val next = candidate.copy(
                        title = (if (completed) "✅ " else "📝 ") + cleanHomeworkTitle(candidate.title),
                        completed = completed, completedAt = if (completed) nowIso() else null,
                        createdBy = candidate.createdBy ?: auth.currentUser?.uid
                    )
                    transaction.update(ref, "events.${safeKey(candidate.id)}", next.toMap())
                    changed++
                }
            }
            if (changed == 0) error("변경할 숙제 데이터를 찾지 못했습니다.")
            changed
        }.addOnSuccessListener { refreshWidgets(); done(Result.success(it)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun loadToday(done: (List<FamilyEvent>) -> Unit) {
        val today = LocalDate.now().toString()
        db.collection("scheduleDays").document(today).get()
            .addOnSuccessListener { done(parseEvents(it).sortedBy(FamilyEvent::start)) }
            .addOnFailureListener { done(emptyList()) }
    }

    fun close() { monthListener?.remove(); homeworkListener?.remove() }

    private fun parseEvents(snapshot: DocumentSnapshot): List<FamilyEvent> {
        val events = snapshot.get("events") as? Map<*, *> ?: return emptyList()
        return events.values.mapNotNull { value -> (value as? Map<*, *>)?.let { FamilyEvent.fromMap(it) } }
    }

    private fun refreshWidgets() = TodayWidgetProvider.requestRefresh()
}
