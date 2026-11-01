package com.familyscheduler.nativeapp

import android.app.Activity
import android.graphics.Typeface
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

// Entirely native Android screen. Uses the identical scheduleDays/{KST date}
// spellingQuiz document and member IDs as the web scheduler.
class SpellingQuizDialog(
    private val activity: Activity,
    private val member: String,
    private val onClosed: () -> Unit = {},
) {
    private val db = FirebaseFirestore.getInstance()
    private val today = LocalDate.now(ZoneId.of("Asia/Seoul"))
    private val spellingStartDay = LocalDate.of(2026, 10, 22)
    private var selectedDay = today
    private val dayId: String get() = selectedDay.toString()
    private val box = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(18, 16, 18, 18) }
    private val members = listOf("me" to "아빠", "wife" to "엄마", "son" to "강천")
    private lateinit var dialog: AlertDialog

    private data class HistoryRow(val date: String, val score: Int?, val quiz: Map<*, *>)

    private data class Item(val id: String, val grade: Int, val kind: String, val prompt: String,
                            val options: List<String>, val answer: String, val explanation: String) {
        fun toMap(): Map<String, Any> = buildMap {
            put("id", id); put("grade", grade); put("kind", kind)
            put("prompt", prompt); put("answer", answer); put("explanation", explanation)
            if (options.isNotEmpty()) put("options", options)
        }
        companion object {
            fun fromMap(m: Map<*, *>) = Item(
                m["id"] as? String ?: "", (m["grade"] as? Number)?.toInt() ?: 4,
                m["kind"] as? String ?: "choice", m["prompt"] as? String ?: "",
                (m["options"] as? List<*>)?.mapNotNull { it as? String }.orEmpty(),
                m["answer"] as? String ?: "", m["explanation"] as? String ?: ""
            )
        }
    }

    private val bank = expandedSpellingBank.map(Item::fromMap)

    // AI exams are already multiple choice. Earlier writing questions are
    // shown as two-choice questions without changing their saved answer/score.
    private fun optionsFor(question: Item): List<String> {
        if (question.options.size == 2 && question.answer in question.options) return question.options
        val known = bank.firstOrNull {
            it.kind == "choice" && it.answer == question.answer && it.options.size == 2
        }?.options?.firstOrNull { it != question.answer }
        val typo = mapOf(
            "웬일" to "왠일", "며칠" to "몇일", "돼" to "되",
            "떡볶이" to "떡복이", "베개" to "배게", "설거지" to "설겆이",
            "오랜만에" to "오랫만에", "금세" to "금새",
            "어이없다" to "어의없다", "낫다" to "낮다", "함께" to "함깨",
            "안" to "않", "할게" to "할께", "갈게" to "갈께",
            "뵙겠습니다" to "봽겠습니다", "문득" to "문뜩",
            "깨끗이" to "깨끗히", "가리켰다" to "가르켰다",
            "가르쳤다" to "가르쳣다", "부딪쳐" to "부딫쳐",
            "잊어버려서" to "잊어버려써", "안팎" to "않팎",
            "대가" to "댓가", "곰곰이" to "곰곰히",
            "눈곱" to "눈꼽", "무릅쓰고" to "무릎쓰고",
            "훗날" to "후날", "뒤처지지" to "뒤쳐지지",
            "닦달했다" to "닥달했다"
        )[question.answer]
        val wrong = known ?: typo ?: return emptyList()
        return if (question.id.hashCode() % 2 == 0) listOf(wrong, question.answer)
               else listOf(question.answer, wrong)
    }

    // Vetted contexts fix previously saved, context-free questions immediately.
    // Firestore submissions/leaderboard remain untouched.
    private val exampleByAnswer = mapOf(
        "웬일" to "네가 먼저 숙제를 하다니, 이게 무슨 (____)이야?",
        "며칠" to "우리는 여행을 (____) 동안 다녀올까?",
        "돼" to "숙제를 다 했으니 이제 놀아도 (____).",
        "안" to "오늘은 몸이 아파서 학교에 (____) 가.",
        "낫다" to "동생은 어제까지 아팠지만 이제 감기가 (____).",
        "낮다" to "나는 너보다 시험 점수가 (____).",
        "어이없는" to "아무 말 없이 약속을 취소하다니 정말 (____) 일이야.",
        "어이없다" to "그런 이유로 화를 내다니 정말 (____).",
        "금세" to "달리기를 시작하자마자 (____) 결승선에 도착했다.",
        "함께" to "우리 가족은 주말마다 (____) 산책한다.",
        "떡볶이" to "나는 매콤한 (____)를 먹는 것을 좋아한다.",
        "설거지" to "저녁을 먹고 나서 내가 (____)를 했다.",
        "베개" to "잠잘 때 머리 아래에 (____)를 놓았다.",
        "오랜만에" to "전학 간 친구를 (____) 만났다.",
        "어떡해" to "숙제를 실수로 지워 버렸어. 이제 (____)?",
        "할게" to "내가 내일 꼭 전화(____).",
        "갈게" to "내가 내일 꼭 (____).",
        "뵙겠습니다" to "선생님, 내일 다시 (____).",
        "부딪쳐" to "공에 머리를 (____) 다쳤다.",
        "문득" to "길을 걷다가 (____) 친구가 생각났다.",
        "깨끗이" to "나는 책상을 걸레로 (____) 닦았다.",
        "가르쳤다" to "선생님은 우리에게 수학을 (____).",
        "가리켰다" to "선생님은 손가락으로 칠판을 (____).",
        "잃어버려" to "열쇠를 (____) 집에 들어가지 못했다.",
        "잊어버려서" to "친구와의 약속을 (____) 미안했다.",
        "안팎" to "우리 가족은 집 (____)을 청소했다.",
        "대가" to "열심히 일한 (____)를 받았다.",
        "곰곰이" to "나는 어려운 문제를 (____) 생각했다.",
        "빈틈없이" to "경비원은 문단속을 (____) 했다.",
        "닦달했다" to "엄마는 숙제를 하지 않은 동생을 (____).",
        "뒤처지지" to "친구들보다 (____) 않으려고 노력했다.",
        "훗날" to "나는 (____) 훌륭한 의사가 되고 싶다.",
        "눈곱" to "아침에 일어나니 눈에 (____)이 끼었다.",
        "무릅쓰고" to "소방관은 위험을 (____) 사람들을 구했다.",
        "꼼꼼히" to "선생님은 시험지를 (____) 살펴보셨다."
    )

    private fun choicePrompt(question: Item): String {
        val original = question.prompt
        val generic = original.contains("다음 중") || original.contains("틀린 낱말을") ||
            original.contains("올바른 맞춤법을 고르세요")
        val contextual = Regex("_{3,}").containsMatchIn(original) &&
            original.replace(Regex("_{3,}"), "").trim().length >= 12 && !generic
        return if (contextual) original else (exampleByAnswer[question.answer] ?: original)
    }

    private fun grade(day: LocalDate = selectedDay) =
        (4 + day.year - 2026 - if (day.monthValue < 3) 1 else 0).coerceIn(1, 6)
    private fun text(value: String, size: Float = 15f, bold: Boolean = false): TextView =
        TextView(activity).apply {
            this.text = value
            textSize = size
            setTextColor(Color.rgb(32,33,36))
            setPadding(8, 14, 8, 14)
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }
    private fun correct(actual: String, expected: String) = SpellingContent.correct(actual, expected)

    fun show() {
        box.addView(text("오늘의 맞춤법 문제를 불러오는 중…"))
        dialog = AlertDialog.Builder(activity).setTitle("맞춤법 시험 · 하루 3문제")
            .setView(ScrollView(activity).apply { addView(box) })
            .setNegativeButton("닫기", null).create()
        dialog.setOnDismissListener { onClosed() }
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        load()
    }

    private fun load(day: LocalDate = selectedDay) {
        selectedDay = day
        val target = db.collection("scheduleDays").document(day.toString())
        box.removeAllViews()
        box.addView(text("문제를 준비하고 있습니다…"))
        target.get().addOnSuccessListener { snap ->
            if (selectedDay != day) return@addOnSuccessListener
            val quiz = snap.get("spellingQuiz") as? Map<*, *>
            if (SpellingContent.needsUpgrade(quiz)) {
                ensurePastQuizzes(
                    done = { if (selectedDay == day) createFallback(day) },
                    fail = { e -> if (selectedDay == day) showError("지난 문제 준비에 실패했습니다: " + e.message) },
                )
            }
            else if (quiz != null) render(quiz)
        }.addOnFailureListener { error -> if (selectedDay == day) showError("시험을 불러오지 못했습니다: " + error.message) }
    }

    private fun createFallback(day: LocalDate) {
        val target = db.collection("scheduleDays").document(day.toString())
        db.collection("scheduleDays").whereGreaterThanOrEqualTo("date", day.minusDays(30).toString())
            .whereLessThan("date", day.toString()).get().addOnSuccessListener { snapshots ->
                val history = snapshots.documents.mapNotNull { snap ->
                    (snap.get("spellingQuiz") as? Map<*, *>)?.let { snap.id to it }
                }.toMap()
                val payload = try { fallbackPayload(day, history) } catch (e: Exception) {
                    if (selectedDay == day) showError(e.message ?: "문제 생성 실패")
                    return@addOnSuccessListener
                }
                db.runTransaction { tx ->
                    val existing = tx.get(target).get("spellingQuiz") as? Map<*, *>
                    if (SpellingContent.needsUpgrade(existing)) {
                        tx.set(target, mapOf("date" to day.toString(), "spellingQuiz" to payload), SetOptions.merge())
                        payload
                    } else existing
                }.addOnSuccessListener { quiz -> if (selectedDay == day && quiz != null) render(quiz) }
                    .addOnFailureListener { e -> if (selectedDay == day) showError("문제를 만들지 못했습니다: " + e.message) }
            }.addOnFailureListener { error -> if (selectedDay == day) showError("최근 출제 기록 확인에 실패했습니다: " + error.message) }
    }

    private fun showError(message: String) {
        box.removeAllViews()
        box.addView(text(message))
        box.addView(Button(activity).apply { text = "다시 시도"; setOnClickListener { load() } })
    }

    private fun render(quiz: Map<*, *>) {
        box.removeAllViews()
        val questions = (quiz["questions"] as? List<*>)?.mapNotNull {
            (it as? Map<*, *>)?.let(Item::fromMap)
        }.orEmpty()
        if (questions.size != 3) { showError("문제가 3개가 아닙니다. 다시 확인이 필요합니다."); return }
        val submissions = quiz["submissions"] as? Map<*, *> ?: emptyMap<String, Any>()
        val mine = submissions[member] as? Map<*, *>
        val oldAnswers = (mine?.get("answers") as? List<*>)?.map { it as? String ?: "" }
        val picks = MutableList(3) { "" }
        val sourceDescription = if (quiz["source"] == "ai") {
            "Gemini AI 자동 출제"
        } else {
            "검토된 맞춤법 문제은행 · 128문항"
        }
        addHistoryControls()
        box.addView(text(dayId + " · 초등 " + (quiz["grade"] ?: grade()).toString() +
            "학년\n" + sourceDescription + " · 가족 공통 3문제", 14f))
        if (mine != null) {
            box.addView(text((if (selectedDay == today) "오늘 완료 · " else dayId + " 완료 · ") +
                (mine["score"] ?: 0).toString() + "/3점", 17f, true))
        } else if (selectedDay.isBefore(today)) {
            box.addView(text("미응시 · 지금 풀 수 있습니다.", 15f, true))
        }
        questions.forEachIndexed { index, item ->
            box.addView(text((index + 1).toString() + "번 · 빈칸에 들어갈 알맞은 단어를 고르세요.\n" + choicePrompt(item), 16f, true))
            val previous = oldAnswers?.getOrNull(index).orEmpty()
            val choices = optionsFor(item)
            if (choices.size != 2) {
                showError("이전 문제의 보기 정보를 복구하지 못했습니다.")
                return
            }
            val group = RadioGroup(activity)
            choices.forEach { option ->
                group.addView(RadioButton(activity).apply {
                    text = option
                    setPadding(16, 7, 8, 7)
                    isChecked = previous == option
                    isEnabled = mine == null
                    setOnClickListener { picks[index] = option }
                })
            }
            box.addView(group)
            if (mine != null) {
                val success = correct(previous, item.answer)
                box.addView(text((if (success) "정답" else "오답") + " · " + item.answer + "\n" + SpellingContent.explanation(item.answer, item.explanation), 13f))
            }
        }
        if (mine == null) {
            box.addView(Button(activity).apply {
                text = if (selectedDay == today) "오늘 3문제 채점하고 제출" else dayId + " 밀린 3문제 채점하고 제출"
                setOnClickListener {
                    if (picks.any { it.isBlank() }) {
                        Toast.makeText(activity, "3문제 모두 답해 주세요.", Toast.LENGTH_SHORT).show()
                        return@setOnClickListener
                    }
                    isEnabled = false
                    save(questions, picks)
                }
            })
        } else {
            box.addView(text("제출한 문제는 언제든 다시 확인할 수 있습니다.\n내가 고른 답·정답·해설을 함께 볼 수 있고, 새 시험은 최근 30일의 출제 내용을 피합니다.", 12f))
        }
        box.addView(text("가족 주간·월간 순위", 17f, true))
        val toggles = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        val ranks = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        listOf("주간", "월간").forEach { mode ->
            toggles.addView(Button(activity).apply {
                text = mode
                setOnClickListener { loadRanking(mode, ranks) }
            })
        }
        box.addView(toggles); box.addView(ranks)
        box.addView(Button(activity).apply {
            text = "점수 순위 새로고침"
            setOnClickListener { loadRanking("주간", ranks) }
        })
        loadRanking("주간", ranks)
    }

    private fun addHistoryControls() {
        val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(Button(activity).apply {
            text = "오늘"
            isEnabled = selectedDay != today
            setOnClickListener { load(today) }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(Button(activity).apply {
            text = "밀린 문제"
            setOnClickListener { showQuizHistory(true) }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(Button(activity).apply {
            text = "지난 문제"
            setOnClickListener { showQuizHistory(false) }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        box.addView(row)
    }

    private fun showQuizHistory(missedOnly: Boolean) {
        ensurePastQuizzes(
            done = { loadQuizHistoryList(missedOnly) },
            fail = { error ->
                Toast.makeText(activity, "밀린 문제 준비에 실패했습니다: " + error.message, Toast.LENGTH_LONG).show()
            },
        )
    }

    private fun loadQuizHistoryList(missedOnly: Boolean) {
        val from = maxOf(spellingStartDay, today.minusYears(1)).toString()
        db.collection("scheduleDays")
            .whereGreaterThanOrEqualTo("date", from)
            .whereLessThanOrEqualTo("date", today.toString())
            .get()
            .addOnSuccessListener { snapshots ->
                val rows = snapshots.documents.mapNotNull { snap ->
                    val quiz = snap.get("spellingQuiz") as? Map<*, *> ?: return@mapNotNull null
                    val submissions = quiz["submissions"] as? Map<*, *> ?: emptyMap<String, Any>()
                    val mine = submissions[member] as? Map<*, *>
                    if (missedOnly && (snap.id >= today.toString() || mine != null)) return@mapNotNull null
                    HistoryRow(
                        date = snap.id,
                        score = (mine?.get("score") as? Number)?.toInt(),
                        quiz = quiz,
                    )
                }.sortedByDescending { it.date }

                if (rows.isEmpty()) {
                    Toast.makeText(
                        activity,
                        if (missedOnly) "밀린 맞춤법 문제가 없습니다." else "지난 맞춤법 문제가 없습니다.",
                        Toast.LENGTH_SHORT,
                    ).show()
                    return@addOnSuccessListener
                }

                val labels = rows.map { row ->
                    row.date + " · " + (row.score?.let { "$it/3점" } ?: "미응시")
                }.toTypedArray()
                AlertDialog.Builder(activity)
                    .setTitle(if (missedOnly) "밀린 문제" else "지난 문제")
                    .setItems(labels) { _, which ->
                        load(LocalDate.parse(rows[which].date))
                    }
                    .setNegativeButton("취소", null)
                    .show()
            }
            .addOnFailureListener { error ->
                Toast.makeText(activity, "지난 문제를 불러오지 못했습니다: " + error.message, Toast.LENGTH_LONG).show()
            }
    }

    private fun ensurePastQuizzes(done: () -> Unit, fail: (Exception) -> Unit) {
        val start = maxOf(spellingStartDay, today.minusYears(1))
        val end = today.minusDays(1)
        if (end.isBefore(start)) {
            done()
            return
        }

        db.collection("scheduleDays")
            .whereGreaterThanOrEqualTo("date", start.toString())
            .whereLessThanOrEqualTo("date", end.toString())
            .get()
            .addOnSuccessListener { snapshots ->
                val history = snapshots.documents.mapNotNull { snap ->
                    (snap.get("spellingQuiz") as? Map<*, *>)?.let { snap.id to it }
                }.toMap().toMutableMap()
                val dates = generateSequence(start) { it.plusDays(1) }
                    .takeWhile { !it.isAfter(end) }
                    .toList()

                fun createAt(index: Int) {
                    if (index >= dates.size) {
                        done()
                        return
                    }
                    val day = dates[index]
                    if (!SpellingContent.needsUpgrade(history[day.toString()])) {
                        createAt(index + 1)
                        return
                    }
                    val target = db.collection("scheduleDays").document(day.toString())
                    val payload = fallbackPayload(day, history)
                    db.runTransaction { tx ->
                        val snap = tx.get(target)
                        val live = snap.get("spellingQuiz") as? Map<*, *>
                        if (SpellingContent.needsUpgrade(live)) {
                            tx.set(
                                target,
                                mapOf("date" to day.toString(), "spellingQuiz" to payload),
                                SetOptions.merge(),
                            )
                            payload
                        } else live
                    }.addOnSuccessListener { live ->
                        if (live != null) history[day.toString()] = live
                        createAt(index + 1)
                    }
                        .addOnFailureListener { fail(it) }
                }
                createAt(0)
            }
            .addOnFailureListener { fail(it) }
    }

    private fun fallbackPayload(day: LocalDate, history: Map<String, Map<*, *>>): Map<String, Any> = mapOf(
        "date" to day.toString(), "grade" to grade(day), "bankVersion" to SpellingContent.VERSION,
        "source" to "curated", "questions" to SpellingContent.select(day, history),
        "submissions" to emptyMap<String, Any>(),
    )

    private fun save(questions: List<Item>, picks: List<String>) {
        val targetDay = selectedDay
        val target = db.collection("scheduleDays").document(targetDay.toString())
        db.runTransaction { tx ->
            val snap = tx.get(target)
            val live = snap.get("spellingQuiz") as? Map<*, *> ?: error("오늘 시험이 없습니다.")
            val currentQuestions = (live["questions"] as? List<*>)?.mapNotNull {
                (it as? Map<*, *>)?.let(Item::fromMap)
            }.orEmpty()
            if (currentQuestions.map { it.id } != questions.map { it.id }) error("문제가 변경되었습니다.")
            val submissions = live["submissions"] as? Map<*, *> ?: emptyMap<String, Any>()
            if (submissions[member] != null) error("이미 제출한 시험입니다.")
            val score = questions.indices.count { correct(picks[it], questions[it].answer) }
            tx.update(target, "spellingQuiz.submissions." + member, mapOf(
                "answers" to picks, "score" to score, "submittedAt" to java.time.Instant.now().toString(),
            ))
            score
        }.addOnSuccessListener { if (selectedDay == targetDay) load(targetDay) }
            .addOnFailureListener { e -> showError("제출에 실패했습니다: " + e.message) }
    }

    private fun loadRanking(mode: String, ranks: LinearLayout) {
        ranks.removeAllViews()
        ranks.addView(text("순위를 불러오는 중…", 12f))
        val start = if (mode == "주간") today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                    else today.withDayOfMonth(1)
        db.collection("scheduleDays")
            .whereGreaterThanOrEqualTo("date", start.toString())
            .whereLessThanOrEqualTo("date", dayId)
            .get()
            .addOnSuccessListener { snapshots ->
                ranks.removeAllViews()
                val table = members.map { (id, name) ->
                    val attempts = snapshots.documents.mapNotNull { snap ->
                        val quiz = snap.get("spellingQuiz") as? Map<*, *>
                        val submissions = quiz?.get("submissions") as? Map<*, *>
                        submissions?.get(id) as? Map<*, *>
                    }
                    Triple(name, attempts.sumOf { (it["score"] as? Number)?.toInt() ?: 0 }, attempts.size)
                }.sortedWith(compareByDescending<Triple<String, Int, Int>> { it.second }.thenByDescending { it.third })
                table.forEachIndexed { i, row ->
                    ranks.addView(text((i + 1).toString() + "위 · " + row.first +
                        "    " + row.second + "점  (" + row.third + "일 참여)", 14f))
                }
            }.addOnFailureListener { e ->
                ranks.removeAllViews()
                ranks.addView(text("순위를 불러오지 못했습니다: " + e.message, 12f))
            }
    }
}

