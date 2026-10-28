package com.familyscheduler.nativeapp

import android.content.ContentUris
import android.content.Context
import android.provider.CalendarContract
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.google.firebase.messaging.FirebaseMessaging
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.YearMonth
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.Duration
import java.time.temporal.ChronoUnit
import java.security.MessageDigest

data class GoogleCalendarSyncResult(
    val added: Int,
    val updated: Int,
    val removed: Int,
    val unchanged: Int,
    val calendars: Int,
)

private data class GoogleCalendarSyncRow(
    val day: String,
    val fingerprint: String,
    val event: FamilyEvent,
)

private data class GoogleCalendarSyncAction(
    val day: String,
    val id: String,
    val value: FamilyEvent? = null,
)

private const val GOOGLE_CALENDAR_OWNER = "lhj21025@gmail.com"
private const val GOOGLE_CALENDAR_KEYWORD = "[가족]"

class FamilyRepository {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    private var monthListener: ListenerRegistration? = null
    private var homeworkListener: ListenerRegistration? = null
    private var noticeListener: ListenerRegistration? = null
    private var approvalListener: ListenerRegistration? = null

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
        val start = month.minusMonths(1).atDay(1).toString()
        val end = month.plusMonths(2).atDay(1).toString()
        monthListener = db.collection("scheduleDays")
            .whereGreaterThanOrEqualTo("date", start).whereLessThan("date", end)
            .addSnapshotListener { snapshots, e ->
                if (e != null) return@addSnapshotListener error(e)
                val events = snapshots?.documents.orEmpty().flatMap { parseEvents(it) }
                    .filter { it.kind != "approval-alert" }
                    .sortedBy { it.start }
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

    fun listenNotices(update: (List<FamilyNotice>) -> Unit) {
        noticeListener?.remove()
        noticeListener = db.collection("familyData").document("family-main")
            .addSnapshotListener { snapshot, _ ->
                val raw = snapshot?.get("notices") as? List<*>
                val items = raw?.mapNotNull { value ->
                    (value as? Map<*, *>)?.let { FamilyNotice.fromMap(it) }
                }.orEmpty()
                update(items.sortedByDescending { it.createdAt })
            }
    }

    fun listenApprovals(update: (List<HomeworkApproval>) -> Unit) {
        approvalListener?.remove()
        approvalListener = db.collection("familyData").document("family-main")
            .addSnapshotListener { snapshot, _ ->
                val raw = snapshot?.get("approvalRequests") as? Map<*, *>
                val items = raw?.values?.mapNotNull { value ->
                    (value as? Map<*, *>)?.let { HomeworkApproval.fromMap(it) }
                }.orEmpty()
                update(items.sortedByDescending { it.requestedAt })
            }
    }

    fun registerPushToken() {
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
            val key = MessageDigest.getInstance("SHA-256")
                .digest(token.toByteArray())
                .joinToString("") { "%02x".format(it) }
            val value = mapOf(
                "token" to token,
                "memberId" to signedMember(),
                "platform" to "android",
                "updatedAt" to nowIso(),
            )
            db.collection("familyData").document("family-main")
                .set(mapOf("pushTokens" to mapOf(key to value)), SetOptions.merge())
        }
    }

    fun saveNotices(notices: List<FamilyNotice>, done: (Result<Unit>) -> Unit) {
        db.collection("familyData").document("family-main")
            .set(mapOf("notices" to notices.take(50).map(FamilyNotice::toMap)), SetOptions.merge())
            .addOnSuccessListener { done(Result.success(Unit)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun saveHomeworks(homeworks: List<Homework>, done: (Result<Unit>) -> Unit) {
        val values = homeworks.map { mapOf("id" to it.id, "name" to it.name, "familyId" to "family-main") }
        db.collection("familyData").document("family-main")
            .set(mapOf("homeworks" to values), SetOptions.merge())
            .addOnSuccessListener { done(Result.success(Unit)) }
            .addOnFailureListener { done(Result.failure(it)) }
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
        val groups = events.groupBy { it.date }.entries.toList()

        fun commitChunk(startIndex: Int) {
            if (startIndex >= groups.size) {
                refreshWidgets()
                done(Result.success(events.size))
                return
            }
            val batch = db.batch()
            groups.drop(startIndex).take(400).forEach { (date, dayEvents) ->
                val values = dayEvents.associate { event ->
                    safeKey(event.id) to event.copy(createdBy = event.createdBy ?: auth.currentUser?.uid).toMap()
                }
                batch.set(
                    db.collection("scheduleDays").document(date),
                    mapOf("date" to date, "events" to values),
                    SetOptions.merge(),
                )
            }
            batch.commit()
                .addOnSuccessListener { commitChunk(startIndex + 400) }
                .addOnFailureListener { done(Result.failure(it)) }
        }

        commitChunk(0)
    }

    fun moveOrSaveEvent(old: FamilyEvent?, next: FamilyEvent, done: (Result<Unit>) -> Unit) {
        if (old == null) return saveEvent(next, done)
        val value = next.copy(createdBy = next.createdBy ?: old.createdBy ?: auth.currentUser?.uid)
        val oldRef = db.collection("scheduleDays").document(old.date)
        val nextRef = db.collection("scheduleDays").document(value.date)

        if (old.date == value.date && old.id == value.id) {
            oldRef.update("events.${safeKey(old.id)}", value.toMap())
                .addOnSuccessListener { refreshWidgets(); done(Result.success(Unit)) }
                .addOnFailureListener { done(Result.failure(it)) }
            return
        }

        val batch = db.batch()
        batch.update(oldRef, "events.${safeKey(old.id)}", FieldValue.delete())
        batch.set(
            nextRef,
            mapOf("date" to value.date, "events" to mapOf(safeKey(value.id) to value.toMap())),
            SetOptions.merge()
        )
        batch.commit()
            .addOnSuccessListener { refreshWidgets(); done(Result.success(Unit)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun deleteEvent(event: FamilyEvent, done: (Result<Unit>) -> Unit) {
        db.collection("scheduleDays").document(event.date)
            .update("events.${safeKey(event.id)}", FieldValue.delete())
            .addOnSuccessListener { refreshWidgets(); done(Result.success(Unit)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    private fun sameEventSeries(candidate: FamilyEvent, target: FamilyEvent): Boolean {
        if (candidate.kind != "event" || target.kind != "event") return false
        if (!target.eventSeriesId.isNullOrBlank()) return candidate.eventSeriesId == target.eventSeriesId
        if (!candidate.eventSeriesId.isNullOrBlank()) return false

        val targetTime = target.start.drop(11).take(5)
        val candidateTime = candidate.start.drop(11).take(5)
        return candidate.title.trim() == target.title.trim() &&
            candidateTime == targetTime &&
            candidate.allDay == target.allDay &&
            candidate.memberIds.toSet() == target.memberIds.toSet() &&
            candidate.location.orEmpty().trim() == target.location.orEmpty().trim() &&
            candidate.memo.orEmpty().trim() == target.memo.orEmpty().trim()
    }

    fun eventSeriesCount(event: FamilyEvent, done: (Result<Int>) -> Unit) {
        if (event.kind != "event") return done(Result.success(1))
        db.collection("scheduleDays").get()
            .addOnSuccessListener { snapshots ->
                val all = snapshots.documents.flatMap { parseEvents(it) }
                val count = if (!event.eventSeriesId.isNullOrBlank()) {
                    all.count { it.kind == "event" && it.eventSeriesId == event.eventSeriesId }
                } else {
                    val legacyMatches = all.filter { sameEventSeries(it, event) }
                    val hasRepeatAnchor = legacyMatches.any {
                        it.repeat != "none" || !it.seriesRepeat.isNullOrBlank()
                    }
                    if (hasRepeatAnchor) legacyMatches.size else 1
                }
                done(Result.success(count.coerceAtLeast(1)))
            }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun deleteEventSeries(event: FamilyEvent, mode: String, done: (Result<Int>) -> Unit) {
        if (mode == "one") {
            deleteEvent(event) { result ->
                if (result.isSuccess) done(Result.success(1))
                else done(Result.failure(result.exceptionOrNull() ?: IllegalStateException("삭제 실패")))
            }
            return
        }
        db.collection("scheduleDays").get()
            .addOnSuccessListener { snapshots ->
                val deletions = snapshots.documents.flatMap { snapshot ->
                    parseEvents(snapshot).filter { candidate ->
                        sameEventSeries(candidate, event) &&
                            (mode != "future" || candidate.date >= event.date)
                    }.map { candidate -> snapshot.reference to safeKey(candidate.id) }
                }
                if (deletions.isEmpty()) {
                    done(Result.failure(IllegalStateException("삭제할 반복 일정을 찾지 못했습니다.")))
                    return@addOnSuccessListener
                }

                fun commitChunk(startIndex: Int) {
                    if (startIndex >= deletions.size) {
                        refreshWidgets()
                        done(Result.success(deletions.size))
                        return
                    }
                    val batch = db.batch()
                    deletions.drop(startIndex).take(400).forEach { (ref, key) ->
                        batch.update(ref, "events.$key", FieldValue.delete())
                    }
                    batch.commit()
                        .addOnSuccessListener { commitChunk(startIndex + 400) }
                        .addOnFailureListener { done(Result.failure(it)) }
                }

                commitChunk(0)
            }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun updateEventSeries(
        original: FamilyEvent,
        edited: FamilyEvent,
        mode: String,
        done: (Result<Int>) -> Unit
    ) {
        if (mode == "one") {
            moveOrSaveEvent(original, edited) { result ->
                if (result.isSuccess) done(Result.success(1))
                else done(Result.failure(result.exceptionOrNull() ?: IllegalStateException("수정 실패")))
            }
            return
        }

        db.collection("scheduleDays").get()
            .addOnSuccessListener { snapshots ->
                val candidates = snapshots.documents.flatMap { snap ->
                    parseEvents(snap).filter { candidate ->
                        sameEventSeries(candidate, original) &&
                            (mode != "future" || candidate.date >= original.date)
                    }.map { snap to it }
                }
                if (candidates.isEmpty()) return@addOnSuccessListener done(Result.failure(IllegalStateException("수정할 반복 일정을 찾지 못했습니다.")))

                val oldStart = runCatching { LocalDateTime.parse(original.start) }.getOrNull()
                val newStart = runCatching { LocalDateTime.parse(edited.start) }.getOrNull()
                val oldEnd = original.end?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
                val newEnd = edited.end?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
                val dayShift = if (oldStart != null && newStart != null) ChronoUnit.DAYS.between(oldStart.toLocalDate(), newStart.toLocalDate()) else 0L
                val targetStartTime = newStart?.toLocalTime()
                val targetDuration = if (newStart != null && newEnd != null) Duration.between(newStart, newEnd).toMinutes().coerceAtLeast(1) else null

                val updates = candidates.map { (snapshot, candidate) ->
                    val candidateStart = runCatching { LocalDateTime.parse(candidate.start) }.getOrNull()
                    val candidateDate = candidateStart?.toLocalDate()
                        ?: runCatching { LocalDate.parse(candidate.date) }.getOrNull()
                    val shiftedDate = candidateDate?.plusDays(dayShift) ?: candidateDate
                    val shiftedStart =
                        if (shiftedDate != null && targetStartTime != null) shiftedDate.atTime(targetStartTime)
                        else candidateStart
                    val shiftedEnd =
                        if (shiftedStart != null && targetDuration != null) shiftedStart.plusMinutes(targetDuration)
                        else candidate.end?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }

                    val next = candidate.copy(
                        title = edited.title,
                        start = shiftedStart?.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"))
                            ?: candidate.start,
                        end = shiftedEnd?.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"))
                            ?: candidate.end,
                        allDay = edited.allDay,
                        memberIds = edited.memberIds,
                        location = edited.location,
                        memo = edited.memo,
                        alarmMinutes = edited.alarmMinutes,
                        eventSeriesId = candidate.eventSeriesId ?: original.eventSeriesId,
                        seriesRepeat = edited.seriesRepeat ?: original.seriesRepeat ?: original.repeat.takeIf { it != "none" },
                        seriesRepeatCount = edited.seriesRepeatCount ?: original.seriesRepeatCount ?: original.repeatCount,
                        seriesRepeatUntil = edited.seriesRepeatUntil ?: original.seriesRepeatUntil ?: original.repeatUntil,
                        createdBy = candidate.createdBy ?: auth.currentUser?.uid,
                    )
                    Triple(snapshot.reference, candidate, next)
                }

                fun commitChunk(startIndex: Int) {
                    if (startIndex >= updates.size) {
                        refreshWidgets()
                        done(Result.success(updates.size))
                        return
                    }
                    val batch = db.batch()
                    updates.drop(startIndex).take(200).forEach { (oldRef, candidate, next) ->
                        val key = safeKey(candidate.id)
                        if (oldRef.id == next.date) {
                            batch.update(oldRef, "events.$key", next.toMap())
                        } else {
                            batch.update(oldRef, "events.$key", FieldValue.delete())
                            val nextRef = db.collection("scheduleDays").document(next.date)
                            batch.set(
                                nextRef,
                                mapOf("date" to next.date, "events" to mapOf(safeKey(next.id) to next.toMap())),
                                SetOptions.merge(),
                            )
                        }
                    }
                    batch.commit()
                        .addOnSuccessListener { commitChunk(startIndex + 200) }
                        .addOnFailureListener { done(Result.failure(it)) }
                }

                commitChunk(0)
            }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun cleanupEliTeacherPhone(done: (Result<Int>) -> Unit) {
        val markerRef = db.collection("familyData").document("family-main")
        markerRef.get().addOnSuccessListener { marker ->
            if (marker.getBoolean("removedEliTeacherPhone20261015") == true) {
                done(Result.success(0))
                return@addOnSuccessListener
            }
            db.collection("scheduleDays").get()
                .addOnSuccessListener { snapshots ->
                    val batch = db.batch()
                    var count = 0
                    snapshots.documents.forEach { snapshot ->
                        parseEvents(snapshot).forEach { candidate ->
                            if (candidate.kind == "event" && candidate.title.trim() == "엘리하이 담임선생님 전화") {
                                batch.update(snapshot.reference, "events.${safeKey(candidate.id)}", FieldValue.delete())
                                count++
                            }
                        }
                    }
                    batch.set(markerRef, mapOf("removedEliTeacherPhone20261015" to true), SetOptions.merge())
                    batch.commit()
                        .addOnSuccessListener { refreshWidgets(); done(Result.success(count)) }
                        .addOnFailureListener { done(Result.failure(it)) }
                }
                .addOnFailureListener { done(Result.failure(it)) }
        }.addOnFailureListener { done(Result.failure(it)) }
    }

    fun checkHomeworkDuplicates(
        selected: List<Homework>, start: LocalDate, end: LocalDate,
        repeat: String, repeatCount: Int, done: (Result<List<Pair<String, String>>>) -> Unit
    ) {
        val blockLength = java.time.temporal.ChronoUnit.DAYS.between(start, end)
        val proposed = selected.flatMap { homework ->
            repeatStarts(start, repeat, if (repeat == "none") 1 else repeatCount).flatMap { occurrenceStart ->
                val occurrenceEnd = occurrenceStart.plusDays(blockLength)
                datesBetween(occurrenceStart, occurrenceEnd).map { day ->
                    Triple(day.toString(), homework.id, homework.name.trim())
                }
            }
        }
        if (proposed.isEmpty()) return done(Result.success(emptyList()))

        val dates = proposed.map { it.first }.distinct()
        val refs = dates.map { db.collection("scheduleDays").document(it) }
        val reads = refs.map { it.get(com.google.firebase.firestore.Source.SERVER) }

        com.google.android.gms.tasks.Tasks.whenAllSuccess<DocumentSnapshot>(reads)
            .addOnSuccessListener { snapshots ->
                val byDate = snapshots.associate { snap ->
                    snap.id to parseEvents(snap).filter { it.kind == "homework" }
                }
                val duplicates = proposed.filter { (date, homeworkId, name) ->
                    byDate[date].orEmpty().any { old ->
                        old.homeworkId == homeworkId ||
                            cleanHomeworkTitle(old.title).trim() == name
                    }
                }.map { it.first to it.third }.distinct()
                done(Result.success(duplicates))
            }
            .addOnFailureListener {
                // 서버 조회가 일시적으로 실패하면 캐시 조회로 한 번 더 확인한다.
                com.google.android.gms.tasks.Tasks.whenAllSuccess<DocumentSnapshot>(refs.map { ref -> ref.get() })
                    .addOnSuccessListener { snapshots ->
                        val byDate = snapshots.associate { snap ->
                            snap.id to parseEvents(snap).filter { it.kind == "homework" }
                        }
                        val duplicates = proposed.filter { (date, homeworkId, name) ->
                            byDate[date].orEmpty().any { old ->
                                old.homeworkId == homeworkId ||
                                    cleanHomeworkTitle(old.title).trim() == name
                            }
                        }.map { it.first to it.third }.distinct()
                        done(Result.success(duplicates))
                    }
                    .addOnFailureListener { fallbackError -> done(Result.failure(fallbackError)) }
            }
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
        val groups = events.groupBy { it.date }.entries.toList()

        fun commitChunk(startIndex: Int) {
            if (startIndex >= groups.size) {
                refreshWidgets()
                done(Result.success(events.size))
                return
            }
            val batch = db.batch()
            groups.drop(startIndex).take(400).forEach { (date, dayEvents) ->
                val values = dayEvents.associate {
                    safeKey(it.id) to it.copy(createdBy = auth.currentUser?.uid).toMap()
                }
                batch.set(
                    db.collection("scheduleDays").document(date),
                    mapOf("date" to date, "events" to values),
                    SetOptions.merge(),
                )
            }
            batch.commit()
                .addOnSuccessListener { commitChunk(startIndex + 400) }
                .addOnFailureListener { done(Result.failure(it)) }
        }

        commitChunk(0)
    }

    fun requestHomeworkApproval(event: FamilyEvent, done: (Result<Unit>) -> Unit) {
        val familyRef = db.collection("familyData").document("family-main")
        val request = HomeworkApproval(
            eventId = event.id,
            homeworkId = event.homeworkId,
            homeworkSeriesId = event.homeworkSeriesId,
            homeworkStartDate = event.homeworkStartDate,
            homeworkEndDate = event.homeworkEndDate,
            title = cleanHomeworkTitle(event.title),
            targetDate = event.date,
            requestedBy = signedMember(),
        )
        val pushAt = LocalDateTime.now().plusMinutes(1)
        val alert = FamilyEvent(
            id = "approval_alert_${request.id}",
            title = "✅ 부모 확인 필요 · ${request.title}",
            start = pushAt.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")),
            end = pushAt.plusMinutes(5).format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")),
            memberIds = listOf("me", "wife"),
            kind = "approval-alert",
            memo = "강천이 ${request.targetDate} 숙제를 미리 완료하려고 합니다. 앱에서 승인 또는 거절해 주세요.",
            alarmMinutes = listOf(0),
            createdBy = auth.currentUser?.uid,
        )
        val alertRef = db.collection("scheduleDays").document(alert.date)

        db.runTransaction { transaction ->
            val snapshot = transaction.get(familyRef)
            val approvals = snapshot.get("approvalRequests") as? Map<*, *>
            val duplicatePending = approvals?.values?.any { value ->
                val map = value as? Map<*, *> ?: return@any false
                if (map["status"] != "pending") return@any false
                val sameEvent = map["eventId"] == event.id
                val sameBlock =
                    !event.homeworkSeriesId.isNullOrBlank() &&
                        map["homeworkSeriesId"] == event.homeworkSeriesId &&
                        map["homeworkId"] == event.homeworkId &&
                        map["homeworkStartDate"] == event.homeworkStartDate &&
                        map["homeworkEndDate"] == event.homeworkEndDate
                sameEvent || sameBlock
            } == true
            if (duplicatePending) error("이미 부모 확인을 요청한 숙제입니다.")

            transaction.set(
                familyRef,
                mapOf("approvalRequests" to mapOf(request.id to request.toMap())),
                SetOptions.merge(),
            )
            transaction.set(
                alertRef,
                mapOf("date" to alert.date, "events" to mapOf(safeKey(alert.id) to alert.toMap())),
                SetOptions.merge(),
            )
            Unit
        }.addOnSuccessListener {
            refreshWidgets()
            done(Result.success(Unit))
        }.addOnFailureListener { done(Result.failure(it)) }
    }

    fun decideHomeworkApproval(request: HomeworkApproval, approve: Boolean, done: (Result<Int>) -> Unit) {
        val familyRef = db.collection("familyData").document("family-main")
        val start = LocalDate.parse(request.homeworkStartDate ?: request.targetDate)
        val end = LocalDate.parse(request.homeworkEndDate ?: request.targetDate)
        val refs = datesBetween(start, end).map { db.collection("scheduleDays").document(it.toString()) }
        db.runTransaction { transaction ->
            val familySnap = transaction.get(familyRef)
            val approvals = familySnap.get("approvalRequests") as? Map<*, *>
            val raw = approvals?.get(request.id) as? Map<*, *>
                ?: error("부모 확인 요청을 찾지 못했습니다.")
            val current = HomeworkApproval.fromMap(raw) ?: error("부모 확인 요청을 읽지 못했습니다.")
            if (current.status != "pending") error("이미 다른 보호자가 처리한 요청입니다.")

            val snapshots = refs.map { transaction.get(it) }
            var changed = 0
            if (approve) {
                snapshots.forEachIndexed { index, snap ->
                    parseEvents(snap).filter { candidate ->
                        candidate.kind == "homework" &&
                            candidate.homeworkId == current.homeworkId &&
                            if (!current.homeworkSeriesId.isNullOrBlank()) {
                                candidate.homeworkSeriesId == current.homeworkSeriesId &&
                                    candidate.homeworkStartDate == (current.homeworkStartDate ?: current.targetDate) &&
                                    candidate.homeworkEndDate == (current.homeworkEndDate ?: current.targetDate)
                            } else candidate.id == current.eventId
                    }.forEach { candidate ->
                        if (!candidate.completed) {
                            val next = candidate.copy(
                                title = "✅ ${cleanHomeworkTitle(candidate.title)}",
                                completed = true,
                                completedAt = current.requestedAt,
                                completedBy = current.requestedBy,
                                approvedAt = nowIso(),
                                approvedBy = signedMember(),
                                createdBy = candidate.createdBy ?: auth.currentUser?.uid,
                            )
                            transaction.update(refs[index], "events.${safeKey(candidate.id)}", next.toMap())
                            changed++
                        }
                    }
                }
                if (changed == 0) error("승인할 숙제 데이터를 찾지 못했습니다.")
            }

            val decided = current.copy(
                status = if (approve) "approved" else "rejected",
                decidedAt = nowIso(),
                decidedBy = signedMember(),
            )
            transaction.update(familyRef, "approvalRequests.${request.id}", decided.toMap())
            val alertDate = runCatching {
                LocalDateTime.parse(current.requestedAt).plusMinutes(1).toLocalDate().toString()
            }.getOrElse { LocalDate.now().toString() }
            transaction.update(
                db.collection("scheduleDays").document(alertDate),
                "events.${safeKey("approval_alert_${request.id}")}",
                FieldValue.delete()
            )
            changed
        }.addOnSuccessListener { refreshWidgets(); done(Result.success(it)) }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun deleteHomeworkEvents(event: FamilyEvent, mode: String, done: (Result<Int>) -> Unit) {
        db.collection("scheduleDays").get()
            .addOnSuccessListener { snapshots ->
                val deletions = snapshots.documents.flatMap { snapshot ->
                    parseEvents(snapshot).filter { candidate ->
                        val sameSeries = candidate.kind == "homework" &&
                            candidate.homeworkId == event.homeworkId &&
                            if (!event.homeworkSeriesId.isNullOrBlank()) {
                                candidate.homeworkSeriesId == event.homeworkSeriesId
                            } else {
                                candidate.homeworkStartDate == event.homeworkStartDate &&
                                    candidate.homeworkEndDate == event.homeworkEndDate
                            }
                        sameSeries && when (mode) {
                            "one" -> candidate.id == event.id
                            "future" -> candidate.date >= event.date
                            else -> true
                        }
                    }.map { candidate -> snapshot.reference to safeKey(candidate.id) }
                }
                if (deletions.isEmpty()) {
                    done(Result.failure(IllegalStateException("삭제할 숙제 데이터를 찾지 못했습니다.")))
                    return@addOnSuccessListener
                }

                fun commitChunk(startIndex: Int) {
                    if (startIndex >= deletions.size) {
                        refreshWidgets()
                        done(Result.success(deletions.size))
                        return
                    }
                    val batch = db.batch()
                    deletions.drop(startIndex).take(400).forEach { (ref, key) ->
                        batch.update(ref, "events.$key", FieldValue.delete())
                    }
                    batch.commit()
                        .addOnSuccessListener { commitChunk(startIndex + 400) }
                        .addOnFailureListener { done(Result.failure(it)) }
                }

                commitChunk(0)
            }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun setHomeworkCompleted(event: FamilyEvent, completed: Boolean, done: (Result<Int>) -> Unit) {
        val start = LocalDate.parse(event.homeworkStartDate ?: event.date)
        val end = LocalDate.parse(event.homeworkEndDate ?: event.date)
        val dates = (datesBetween(start, end) + LocalDate.parse(event.date)).distinct()
        val refs = dates.map { db.collection("scheduleDays").document(it.toString()) }
        com.google.android.gms.tasks.Tasks.whenAllSuccess<DocumentSnapshot>(refs.map { it.get() })
            .addOnSuccessListener { snapshots ->
                val batch = db.batch()
                var changed = 0
                val completionTime = nowIso()
                snapshots.forEachIndexed { index, snapshot ->
                    parseEvents(snapshot).filter { candidate ->
                        val sameSeriesBlock =
                            !event.homeworkSeriesId.isNullOrBlank() &&
                                candidate.homeworkSeriesId == event.homeworkSeriesId &&
                                candidate.homeworkId == event.homeworkId &&
                                candidate.homeworkStartDate == event.homeworkStartDate &&
                                candidate.homeworkEndDate == event.homeworkEndDate
                        val sameLegacyBlock =
                            event.homeworkSeriesId.isNullOrBlank() &&
                                candidate.homeworkSeriesId.isNullOrBlank() &&
                                !event.homeworkStartDate.isNullOrBlank() &&
                                candidate.homeworkId == event.homeworkId &&
                                candidate.homeworkStartDate == event.homeworkStartDate &&
                                candidate.homeworkEndDate == event.homeworkEndDate
                        candidate.kind == "homework" &&
                            (candidate.id == event.id || sameSeriesBlock || sameLegacyBlock)
                    }.forEach { candidate ->
                        val next = candidate.copy(
                            title = (if (completed) "✅ " else "📝 ") + cleanHomeworkTitle(candidate.title),
                            completed = completed,
                            completedAt = if (completed) completionTime else null,
                            completedBy = if (completed) signedMember() else null,
                            approvedAt = null,
                            approvedBy = null,
                            createdBy = candidate.createdBy ?: auth.currentUser?.uid
                        )
                        batch.update(refs[index], "events.${safeKey(candidate.id)}", next.toMap())
                        changed++
                    }
                }
                if (changed == 0) {
                    done(Result.failure(IllegalStateException("변경할 숙제 데이터를 찾지 못했습니다.")))
                } else {
                    batch.commit()
                        .addOnSuccessListener { refreshWidgets(); done(Result.success(changed)) }
                        .addOnFailureListener { done(Result.failure(it)) }
                }
            }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun loadToday(done: (List<FamilyEvent>) -> Unit) {
        val today = LocalDate.now().toString()
        db.collection("scheduleDays").document(today).get()
            .addOnSuccessListener { done(parseEvents(it).filter { e -> e.kind != "approval-alert" }.sortedBy(FamilyEvent::start)) }
            .addOnFailureListener { done(emptyList()) }
    }

    fun loadAllEvents(done: (Result<List<FamilyEvent>>) -> Unit) {
        db.collection("scheduleDays").get()
            .addOnSuccessListener { snapshots ->
                val rows = snapshots.documents.flatMap { parseEvents(it) }
                    .filter { it.kind != "approval-alert" }
                    .sortedBy(FamilyEvent::start)
                done(Result.success(rows))
            }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun searchEvents(term: String, done: (Result<List<FamilyEvent>>) -> Unit) {
        val needle = term.trim().lowercase()
        if (needle.isBlank()) return done(Result.success(emptyList()))
        db.collection("scheduleDays").get()
            .addOnSuccessListener { snapshots ->
                val rows = snapshots.documents.flatMap { parseEvents(it) }
                    .filter { it.kind != "approval-alert" }
                    .filter { event ->
                    val family = event.memberIds.mapNotNull { id -> members.firstOrNull { it.id == id }?.label }.joinToString(" ")
                    "${event.date} ${event.title} ${event.location.orEmpty()} ${event.memo.orEmpty()} $family".lowercase().contains(needle)
                }.sortedBy { it.start }
                done(Result.success(rows))
            }
            .addOnFailureListener { done(Result.failure(it)) }
    }

    fun syncGoogleCalendarFromDevice(
        context: Context,
        done: (Result<GoogleCalendarSyncResult>) -> Unit,
    ) {
        if (auth.currentUser?.email?.lowercase() != "dad@family-scheduler.app") {
            done(Result.failure(IllegalStateException("가족 스케줄러의 아빠 계정으로 로그인해주세요.")))
            return
        }

        Thread {
            try {
                val freshResult = readGoogleCalendarRows(context)
                val fresh = freshResult.first
                val calendarCount = freshResult.second
                val fromDay = LocalDate.now().minusYears(1).toString()
                val toDay = LocalDate.now().plusYears(2).toString()
                val stateRef = db.collection("googleCalendarSync").document("dad")

                stateRef.get()
                    .addOnSuccessListener { stateSnap ->
                        val previousRaw = stateSnap.get("items") as? Map<*, *> ?: emptyMap<Any, Any>()
                        val previous = previousRaw.mapNotNull { (key, value) ->
                            val id = key as? String ?: return@mapNotNull null
                            val row = value as? Map<*, *> ?: return@mapNotNull null
                            val day = row["day"] as? String ?: return@mapNotNull null
                            val fingerprint = row["fingerprint"] as? String ?: ""
                            id to (day to fingerprint)
                        }.toMap()

                        var added = 0
                        var updated = 0
                        var removed = 0
                        var unchanged = 0
                        val actions = mutableListOf<GoogleCalendarSyncAction>()
                        val nextIndex = linkedMapOf<String, Map<String, String>>()

                        fresh.forEach { (id, row) ->
                            nextIndex[id] = mapOf("day" to row.day, "fingerprint" to row.fingerprint)
                            val old = previous[id]
                            when {
                                old == null -> {
                                    added++
                                    actions += GoogleCalendarSyncAction(row.day, id, row.event)
                                }
                                old.first != row.day || old.second != row.fingerprint -> {
                                    updated++
                                    if (old.first != row.day) actions += GoogleCalendarSyncAction(old.first, id)
                                    actions += GoogleCalendarSyncAction(row.day, id, row.event)
                                }
                                else -> unchanged++
                            }
                        }

                        previous.forEach { (id, old) ->
                            if (!fresh.containsKey(id)) {
                                if (old.first >= fromDay && old.first <= toDay) {
                                    removed++
                                    actions += GoogleCalendarSyncAction(old.first, id)
                                } else {
                                    nextIndex[id] = mapOf("day" to old.first, "fingerprint" to old.second)
                                }
                            }
                        }

                        val deleteDays = actions.filter { it.value == null }.map { it.day }.distinct()
                        val loadExistingAndCommit: (Set<String>) -> Unit = { existingDays ->
                            commitGoogleCalendarActions(
                                actions = actions,
                                existingDeleteDays = existingDays,
                                startIndex = 0,
                                onSuccess = {
                                    stateRef.set(
                                        mapOf(
                                            "items" to nextIndex,
                                            "lastSyncedAt" to nowIso(),
                                            "ownerEmail" to GOOGLE_CALENDAR_OWNER,
                                            "keyword" to GOOGLE_CALENDAR_KEYWORD,
                                            "allowedVisibility" to listOf("default", "public"),
                                            "source" to "android-device-calendar",
                                        )
                                    ).addOnSuccessListener {
                                        refreshWidgets()
                                        done(
                                            Result.success(
                                                GoogleCalendarSyncResult(
                                                    added = added,
                                                    updated = updated,
                                                    removed = removed,
                                                    unchanged = unchanged,
                                                    calendars = calendarCount,
                                                )
                                            )
                                        )
                                    }.addOnFailureListener { done(Result.failure(it)) }
                                },
                                onFailure = { done(Result.failure(it)) },
                            )
                        }

                        if (deleteDays.isEmpty()) {
                            loadExistingAndCommit(emptySet())
                        } else {
                            val reads = deleteDays.map { day ->
                                db.collection("scheduleDays").document(day).get()
                            }
                            com.google.android.gms.tasks.Tasks.whenAllSuccess<DocumentSnapshot>(reads)
                                .addOnSuccessListener { snapshots ->
                                    loadExistingAndCommit(snapshots.filter { it.exists() }.map { it.id }.toSet())
                                }
                                .addOnFailureListener { done(Result.failure(it)) }
                        }
                    }
                    .addOnFailureListener { done(Result.failure(it)) }
            } catch (error: Exception) {
                done(Result.failure(error))
            }
        }.start()
    }

    private fun readGoogleCalendarRows(context: Context): Pair<Map<String, GoogleCalendarSyncRow>, Int> {
        val resolver = context.contentResolver
        val calendarIds = mutableListOf<Long>()
        val calendarProjection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE,
        )
        resolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            calendarProjection,
            "${CalendarContract.Calendars.ACCOUNT_NAME} = ?",
            arrayOf(GOOGLE_CALENDAR_OWNER),
            null,
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(CalendarContract.Calendars._ID)
            val typeIndex = cursor.getColumnIndexOrThrow(CalendarContract.Calendars.ACCOUNT_TYPE)
            while (cursor.moveToNext()) {
                val accountType = cursor.getString(typeIndex).orEmpty()
                if (accountType == "com.google" || accountType.isBlank()) {
                    calendarIds += cursor.getLong(idIndex)
                }
            }
        }

        if (calendarIds.isEmpty()) {
            throw IllegalStateException(
                "${GOOGLE_CALENDAR_OWNER} 계정의 캘린더를 휴대폰에서 찾지 못했습니다. 휴대폰 Google 계정과 캘린더 동기화를 확인해주세요."
            )
        }

        val fromMillis = LocalDate.now().minusYears(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val toMillis = LocalDate.now().plusYears(2).plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val uriBuilder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        ContentUris.appendId(uriBuilder, fromMillis)
        ContentUris.appendId(uriBuilder, toMillis)

        val projection = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Events.CALENDAR_ID,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Events.ALL_DAY,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.EVENT_LOCATION,
            CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.ACCESS_LEVEL,
            CalendarContract.Events.STATUS,
        )
        val placeholders = calendarIds.joinToString(",") { "?" }
        val selection = "${CalendarContract.Events.CALENDAR_ID} IN ($placeholders)"
        val args = calendarIds.map(Long::toString).toTypedArray()
        val fresh = linkedMapOf<String, GoogleCalendarSyncRow>()

        resolver.query(
            uriBuilder.build(),
            projection,
            selection,
            args,
            CalendarContract.Instances.BEGIN + " ASC",
        )?.use { cursor ->
            val eventIdIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_ID)
            val calendarIdIndex = cursor.getColumnIndexOrThrow(CalendarContract.Events.CALENDAR_ID)
            val beginIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.BEGIN)
            val endIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.END)
            val allDayIndex = cursor.getColumnIndexOrThrow(CalendarContract.Events.ALL_DAY)
            val titleIndex = cursor.getColumnIndexOrThrow(CalendarContract.Events.TITLE)
            val locationIndex = cursor.getColumnIndexOrThrow(CalendarContract.Events.EVENT_LOCATION)
            val descriptionIndex = cursor.getColumnIndexOrThrow(CalendarContract.Events.DESCRIPTION)
            val accessIndex = cursor.getColumnIndexOrThrow(CalendarContract.Events.ACCESS_LEVEL)
            val statusIndex = cursor.getColumnIndexOrThrow(CalendarContract.Events.STATUS)

            while (cursor.moveToNext()) {
                val rawTitle = cursor.getString(titleIndex).orEmpty()
                if (!rawTitle.contains(GOOGLE_CALENDAR_KEYWORD)) continue
                val title = rawTitle.replace(GOOGLE_CALENDAR_KEYWORD, "").trim()
                if (!cursor.isNull(statusIndex) && cursor.getInt(statusIndex) == CalendarContract.Events.STATUS_CANCELED) continue

                val access = if (cursor.isNull(accessIndex)) CalendarContract.Events.ACCESS_DEFAULT else cursor.getInt(accessIndex)
                if (access != CalendarContract.Events.ACCESS_DEFAULT && access != CalendarContract.Events.ACCESS_PUBLIC) continue

                val calendarId = cursor.getLong(calendarIdIndex)
                val providerEventId = cursor.getLong(eventIdIndex)
                val beginMillis = cursor.getLong(beginIndex)
                val endMillis = cursor.getLong(endIndex)
                val allDay = cursor.getInt(allDayIndex) != 0
                val start = providerDateTime(beginMillis, allDay)
                val end = endMillis.takeIf { it > 0L }?.let { providerDateTime(it, allDay) }
                val location = cursor.getString(locationIndex)?.takeIf { it.isNotBlank() }
                val memo = cursor.getString(descriptionIndex)?.takeIf { it.isNotBlank() }
                val stableFields = listOf(
                    title,
                    start,
                    end.orEmpty(),
                    allDay.toString(),
                    location.orEmpty(),
                    memo.orEmpty(),
                ).joinToString("\u001f")
                val importedId = "gcal_" + googleSyncDigest(stableFields)

                val event = FamilyEvent(
                    id = importedId,
                    title = title,
                    start = start,
                    end = end,
                    allDay = allDay,
                    memberIds = listOf("me"),
                    kind = "event",
                    repeat = "none",
                    location = location,
                    memo = memo,
                    googleImported = true,
                    googleCalendarId = calendarId.toString(),
                    googleEventId = "$providerEventId:$beginMillis",
                    createdBy = auth.currentUser?.uid,
                )
                val fingerprint = googleSyncDigest(stableFields)
                fresh[importedId] = GoogleCalendarSyncRow(
                    day = event.date,
                    fingerprint = fingerprint,
                    event = event,
                )
            }
        }
        return fresh to calendarIds.size
    }

    private fun providerDateTime(epochMillis: Long, allDay: Boolean): String {
        val zone = if (allDay) ZoneOffset.UTC else ZoneId.systemDefault()
        return Instant.ofEpochMilli(epochMillis)
            .atZone(zone)
            .toLocalDateTime()
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm"))
    }

    private fun googleSyncDigest(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .take(20)
            .joinToString("") { "%02x".format(it) }

    private fun commitGoogleCalendarActions(
        actions: List<GoogleCalendarSyncAction>,
        existingDeleteDays: Set<String>,
        startIndex: Int,
        onSuccess: () -> Unit,
        onFailure: (Exception) -> Unit,
    ) {
        if (startIndex >= actions.size) {
            onSuccess()
            return
        }
        val batch = db.batch()
        actions.drop(startIndex).take(300).forEach { action ->
            val ref = db.collection("scheduleDays").document(action.day)
            val key = safeKey(action.id)
            if (action.value != null) {
                batch.set(
                    ref,
                    mapOf("date" to action.day, "events" to mapOf(key to action.value.toMap())),
                    SetOptions.merge(),
                )
            } else if (action.day in existingDeleteDays) {
                batch.update(ref, "events.$key", FieldValue.delete())
            }
        }
        batch.commit()
            .addOnSuccessListener {
                commitGoogleCalendarActions(
                    actions,
                    existingDeleteDays,
                    startIndex + 300,
                    onSuccess,
                    onFailure,
                )
            }
            .addOnFailureListener { onFailure(it) }
    }

    fun close() { monthListener?.remove(); homeworkListener?.remove(); noticeListener?.remove(); approvalListener?.remove() }

    private fun parseEvents(snapshot: DocumentSnapshot): List<FamilyEvent> {
        val events = snapshot.get("events") as? Map<*, *> ?: return emptyList()
        return events.values.mapNotNull { value -> (value as? Map<*, *>)?.let { FamilyEvent.fromMap(it) } }
    }

    private fun refreshWidgets() = TodayWidgetProvider.requestRefresh()
}
