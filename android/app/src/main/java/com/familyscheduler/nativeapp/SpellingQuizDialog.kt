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
    private val dayId = today.toString()
    private val doc = db.collection("scheduleDays").document(dayId)
    private val box = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(18, 16, 18, 18) }
    private val members = listOf("me" to "아빠", "wife" to "엄마", "son" to "강천")
    private lateinit var dialog: AlertDialog

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

    private val bank = listOf(
        Item("n4-01",4,"choice","‘이게 무슨 ___이야?’에 알맞은 말은?",listOf("웬일","왠일"),"웬일","‘웬일’이 바른 표기예요."),
        Item("n4-02",4,"choice","‘___ 동안 못 만났니?’에 알맞은 말은?",listOf("며칠","몇일"),"며칠","‘며칠’이 맞는 표기예요."),
        Item("n4-03",4,"choice","‘집에 가도 ___.’에 알맞은 말은?",listOf("돼","되"),"돼","‘돼’는 ‘되어’의 준말이에요."),
        Item("n4-11",4,"choice","‘나는 너보다 시험 점수가 ___.’에 알맞은 말은?",listOf("낮다","낫다"),"낮다","점수가 높지 않다는 뜻은 ‘낮다’예요."),
        Item("n4-04",4,"choice","‘학교에 ___ 가.’에 알맞은 말은?",listOf("안","않"),"안","부정 부사는 ‘안’이에요."),
        Item("n4-05",4,"choice","‘밥을 먹고 ___를 했다.’",listOf("설거지","설겆이"),"설거지","‘설거지’가 표준어예요."),
        Item("n4-06",4,"choice","‘___를 베고 잤다.’",listOf("베개","배게"),"베개","‘베개’가 바른 표기예요."),
        Item("n4-07",4,"write","‘이게 왠일이야?’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"웬일","‘웬일’이 맞아요."),
        Item("n4-08",4,"write","‘떡복이를 먹었다.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"떡볶이","‘떡볶이’가 바른 표기예요."),
        Item("n4-09",4,"write","‘몇일 동안 놀았니?’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"며칠","‘며칠’이 올바른 표기예요."),
        Item("n4-10",4,"write","‘오랫만에 만났다.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"오랜만에","‘오랜만에’가 맞아요."),
        Item("n5-01",5,"choice","‘내가 내일 전화___.’에 알맞은 말은?",listOf("할게","할께"),"할게","약속의 어미는 ‘-ㄹ게’예요."),
        Item("n5-02",5,"choice","‘선생님, 내일 ___.’",listOf("뵙겠습니다","봽겠습니다"),"뵙겠습니다","‘뵙다’를 활용한 말이에요."),
        Item("n5-03",5,"choice","‘___ 생각이 났다.’",listOf("문득","문뜩"),"문득","‘문득’이 바른 표현이에요."),
        Item("n5-04",5,"choice","‘책상을 ___ 닦았다.’",listOf("깨끗이","깨끗히"),"깨끗이","‘깨끗이’가 맞아요."),
        Item("n5-05",5,"choice","‘손가락으로 시계를 ___.’",listOf("가리켰다","가르쳤다"),"가리켰다","짚어 보이는 것은 ‘가리키다’예요."),
        Item("n5-06",5,"write","‘내일 꼭 갈께.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"갈게","약속의 어미는 ‘-ㄹ게’예요."),
        Item("n5-07",5,"write","‘문뜩 좋은 생각이 났다.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"문득","‘문득’이 맞아요."),
        Item("n5-08",5,"write","‘깨끗히 닦았다.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"깨끗이","‘깨끗이’가 맞아요."),
        Item("n6-01",6,"choice","‘집 ___을 쓸었다.’",listOf("안팎","않팎"),"안팎","‘안팎’이 표준어예요."),
        Item("n6-02",6,"choice","‘노력의 ___를 받았다.’",listOf("대가","댓가"),"대가","‘대가’가 표준어예요."),
        Item("n6-03",6,"choice","‘___ 생각해 보았다.’",listOf("곰곰이","곰곰히"),"곰곰이","‘곰곰이’라고 써요."),
        Item("n6-04",6,"choice","‘눈에 ___이 끼었다.’",listOf("눈곱","눈꼽"),"눈곱","‘눈곱’이 맞아요."),
        Item("n6-05",6,"choice","‘위험을 ___ 도전했다.’",listOf("무릅쓰고","무릎쓰고"),"무릅쓰고","‘무릅쓰다’를 활용한 표현이에요."),
        Item("n6-06",6,"write","‘댓가를 바란 것은 아니다.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"대가","‘대가’가 맞아요."),
        Item("n6-07",6,"write","‘곰곰히 생각했다.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"곰곰이","‘곰곰이’라고 써요."),
        Item("n6-08",6,"write","‘눈꼽이 끼었다.’에서 틀린 낱말을 바로 쓰세요.",emptyList(),"눈곱","‘눈곱’이 맞아요.")
    )

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

    private fun grade() = (4 + today.year - 2026 - if (today.monthValue < 3) 1 else 0).coerceIn(1, 6)
    private fun text(value: String, size: Float = 15f, bold: Boolean = false): TextView =
        TextView(activity).apply {
            this.text = value
            textSize = size
            setTextColor(Color.rgb(32,33,36))
            setPadding(8, 14, 8, 14)
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }
    private fun normalise(value: String): String =
        value.trim().replace(Regex("[\\s.,!?\"'‘’“”]"), "").lowercase()
    private fun correct(actual: String, expected: String): Boolean = normalise(actual) == normalise(expected)

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

    private fun load() {
        doc.get().addOnSuccessListener { snap ->
            val quiz = snap.get("spellingQuiz") as? Map<*, *>
            if (quiz != null) render(quiz)
            else createFallback()
        }.addOnFailureListener { error -> showError("시험을 불러오지 못했습니다: " + error.message) }
    }

    private fun createFallback() {
        val weekAgo = listOf(3L, 7L, 14L).map { day ->
            db.collection("scheduleDays").document(today.minusDays(day).toString())
        }
        com.google.android.gms.tasks.Tasks.whenAllSuccess<com.google.firebase.firestore.DocumentSnapshot>(
            weekAgo.map { it.get() }
        ).addOnSuccessListener { old ->
            val reviewed = old.flatMap { snap ->
                val q = snap.get("spellingQuiz") as? Map<*, *> ?: return@flatMap emptyList()
                val questions = (q["questions"] as? List<*>)?.mapNotNull {
                    (it as? Map<*, *>)?.let(Item::fromMap)
                }.orEmpty()
                val submissions = q["submissions"] as? Map<*, *> ?: emptyMap<String, Any>()
                questions.filterIndexed { i, item ->
                    submissions.values.any { raw ->
                        val answers = (raw as? Map<*, *>)?.get("answers") as? List<*>
                        answers != null && !correct(answers.getOrNull(i) as? String ?: "", item.answer)
                    }
                }
            }
            val sorted = bank.filter { it.grade == grade() }
                .sortedBy { (dayId + it.id).hashCode().toUInt().toLong() }
            val selected = sorted.filter { it.kind == "choice" }.take(3).toMutableList()
            val review = reviewed.firstOrNull { r ->
                selected.none { it.id == r.id } && optionsFor(r).size == 2
            }
            if (review != null && selected.size == 3) {
                selected[2] = review.copy(
                    kind = "choice",
                    prompt = choicePrompt(review),
                    options = optionsFor(review),
                )
            }
            val payload = mapOf(
                "date" to dayId, "grade" to grade(), "source" to "curated",
                "questions" to selected.map { item ->
                    if (item.kind == "choice" && (dayId + item.id).hashCode() % 2 == 0)
                        item.copy(options = item.options.reversed()).toMap()
                    else item.toMap()
                }, "submissions" to emptyMap<String, Any>(),
            )
            db.runTransaction { tx ->
                val existing = tx.get(doc)
                if (!existing.contains("spellingQuiz")) {
                    tx.set(doc, mapOf("date" to dayId, "spellingQuiz" to payload), SetOptions.merge())
                }
                null
            }.addOnSuccessListener { load() }
                .addOnFailureListener { e -> showError("문제를 만들지 못했습니다: " + e.message) }
        }.addOnFailureListener { error -> showError("복습 문제 확인에 실패했습니다: " + error.message) }
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
            "검증된 맞춤법 문제은행 · AI 미생성 시 자동 대체"
        }
        box.addView(text(dayId + " · 초등 " + (quiz["grade"] ?: grade()).toString() +
            "학년\n" + sourceDescription + " · 가족 공통 3문제", 14f))
        if (mine != null) {
            box.addView(text("오늘 완료 · " + (mine["score"] ?: 0).toString() + "/3점", 17f, true))
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
                box.addView(text((if (success) "정답" else "오답") + " · " + item.answer + "\n" + item.explanation, 13f))
            }
        }
        if (mine == null) {
            box.addView(Button(activity).apply {
                text = "3문제 채점하고 제출"
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
            box.addView(text("하루 1회 응시 · 가족에게는 점수와 순위만 공개됩니다.\n틀린 문제는 3일·7일·14일 후 복습에 활용됩니다.", 12f))
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

    private fun save(questions: List<Item>, picks: List<String>) {
        db.runTransaction { tx ->
            val snap = tx.get(doc)
            val live = snap.get("spellingQuiz") as? Map<*, *> ?: error("오늘 시험이 없습니다.")
            val currentQuestions = (live["questions"] as? List<*>)?.mapNotNull {
                (it as? Map<*, *>)?.let(Item::fromMap)
            }.orEmpty()
            if (currentQuestions.map { it.id } != questions.map { it.id }) error("문제가 변경되었습니다.")
            val submissions = live["submissions"] as? Map<*, *> ?: emptyMap<String, Any>()
            if (submissions[member] != null) error("이미 제출한 시험입니다.")
            val score = questions.indices.count { correct(picks[it], questions[it].answer) }
            tx.update(doc, "spellingQuiz.submissions." + member, mapOf(
                "answers" to picks, "score" to score, "submittedAt" to java.time.Instant.now().toString(),
            ))
            score
        }.addOnSuccessListener { load() }
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
