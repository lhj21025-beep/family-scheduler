package com.familyscheduler.nativeapp

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.setPadding
import com.google.android.material.button.MaterialButton
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

class MainActivity : AppCompatActivity() {
    private val repo = FamilyRepository()
    private var month = YearMonth.now()
    private var selectedDate = LocalDate.now()
    private var allEvents = emptyList<FamilyEvent>()
    private var homeworks = defaultHomeworks
    private val visibleMembers = members.map { it.id }.toMutableSet()

    private lateinit var monthTitle: TextView
    private lateinit var calendar: GridLayout
    private lateinit var selectedTitle: TextView
    private lateinit var eventList: LinearLayout
    private lateinit var loading: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (repo.isLoggedIn()) showCalendar() else showLogin()
    }

    override fun onDestroy() { repo.close(); super.onDestroy() }

    private fun showLogin() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(dp(24)); setBackgroundColor(Color.rgb(247, 248, 252))
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(26)); background = rounded(Color.WHITE, 24f)
            elevation = dp(8).toFloat()
        }
        val logo = ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher)
            layoutParams = LinearLayout.LayoutParams(dp(88), dp(88)).apply { gravity = Gravity.CENTER_HORIZONTAL }
        }
        val title = TextView(this).apply {
            text = "우리 가족 스케줄러"; textSize = 25f; typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER; setPadding(0, dp(14), 0, dp(6))
        }
        val subtitle = TextView(this).apply {
            text = "가족 구성원을 선택하고 로그인하세요."; textSize = 14f; setTextColor(Color.DKGRAY)
            gravity = Gravity.CENTER; setPadding(0, 0, 0, dp(20))
        }
        val member = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item,
                listOf("👨 아빠", "👩 엄마", "👦 강천"))
        }
        val password = EditText(this).apply {
            hint = "비밀번호"; setText("111111"); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSelectAllOnFocus(true); setPadding(dp(12))
        }
        val login = MaterialButton(this).apply {
            text = "로그인"; setTextColor(Color.WHITE); setBackgroundColor(Color.rgb(37, 99, 235))
            setOnClickListener {
                isEnabled = false; text = "로그인 중…"
                val emails = listOf("dad@family-scheduler.app", "mom@family-scheduler.app", "son@family-scheduler.app")
                repo.login(emails[member.selectedItemPosition], password.text.toString()) { result ->
                    runOnUiThread {
                        isEnabled = true; text = "로그인"
                        if (result.isSuccess) showCalendar() else toast("로그인할 수 없습니다. 비밀번호를 확인해 주세요.")
                    }
                }
            }
        }
        card.addView(logo); card.addView(title); card.addView(subtitle)
        card.addView(label("가족 구성원")); card.addView(member, matchWrap(bottom = 14))
        card.addView(label("비밀번호")); card.addView(password, matchWrap(bottom = 18)); card.addView(login, matchWrap())
        page.addView(card, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(page)
    }

    private fun showCalendar() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(247, 248, 252))
        }
        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(16), dp(10), dp(10), dp(8)); setBackgroundColor(Color.WHITE)
        }
        header.addView(ImageView(this).apply { setImageResource(R.mipmap.ic_launcher) }, LinearLayout.LayoutParams(dp(42), dp(42)))
        header.addView(TextView(this).apply { text = "우리 가족"; textSize = 21f; typeface = Typeface.DEFAULT_BOLD; setPadding(dp(10), 0, 0, 0) }, LinearLayout.LayoutParams(0, dp(48), 1f))
        header.addView(Button(this).apply {
            text = "로그아웃"; textSize = 12f
            setOnClickListener { repo.logout(); showLogin() }
        })
        root.addView(header)

        val memberBar = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val memberRow = LinearLayout(this).apply { setPadding(dp(10), dp(6), dp(10), dp(3)); gravity = Gravity.CENTER_VERTICAL }
        members.forEach { item ->
            memberRow.addView(CheckBox(this).apply {
                text = "${item.icon} ${item.label}"; isChecked = true; buttonTintList = android.content.res.ColorStateList.valueOf(item.color)
                setOnCheckedChangeListener { _, checked -> if (checked) visibleMembers += item.id else visibleMembers -= item.id; renderMonth() }
            })
        }
        memberBar.addView(memberRow); root.addView(memberBar)

        val nav = LinearLayout(this).apply { gravity = Gravity.CENTER; setPadding(dp(8), dp(4), dp(8), dp(4)) }
        nav.addView(Button(this).apply { text = "‹"; textSize = 22f; setOnClickListener { month = month.minusMonths(1); selectMonthStart(); listenMonth() } }, LinearLayout.LayoutParams(dp(64), dp(48)))
        monthTitle = TextView(this).apply { textSize = 20f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER }
        nav.addView(monthTitle, LinearLayout.LayoutParams(0, dp(48), 1f))
        nav.addView(Button(this).apply { text = "›"; textSize = 22f; setOnClickListener { month = month.plusMonths(1); selectMonthStart(); listenMonth() } }, LinearLayout.LayoutParams(dp(64), dp(48)))
        root.addView(nav)

        calendar = GridLayout(this).apply { columnCount = 7; setPadding(dp(8), 0, dp(8), dp(4)) }
        root.addView(calendar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val agendaCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(14)); background = rounded(Color.WHITE, 20f); elevation = dp(2).toFloat()
        }
        selectedTitle = TextView(this).apply { textSize = 18f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.rgb(30, 41, 59)) }
        agendaCard.addView(selectedTitle)
        loading = ProgressBar(this).apply { visibility = View.GONE }
        agendaCard.addView(loading, LinearLayout.LayoutParams(dp(30), dp(30)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        eventList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(this).apply { addView(eventList) }
        agendaCard.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(agendaCard, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply { setMargins(dp(10), dp(5), dp(10), dp(5)) })

        val actions = LinearLayout(this).apply { gravity = Gravity.CENTER; setPadding(dp(8), dp(4), dp(8), dp(8)) }
        actions.addView(actionButton("＋ 일정", 0xFF2563EB.toInt()) { showEventEditor(null) }, LinearLayout.LayoutParams(0, dp(52), 1f).apply { setMargins(dp(3), 0, dp(3), 0) })
        actions.addView(actionButton("📝 숙제", 0xFFEC4899.toInt()) { showHomeworkDialog() }, LinearLayout.LayoutParams(0, dp(52), 1f).apply { setMargins(dp(3), 0, dp(3), 0) })
        actions.addView(actionButton("오늘", 0xFF4F46E5.toInt()) { month = YearMonth.now(); selectedDate = LocalDate.now(); listenMonth() }, LinearLayout.LayoutParams(0, dp(52), 0.72f).apply { setMargins(dp(3), 0, dp(3), 0) })
        root.addView(actions)
        setContentView(root)
        repo.listenHomeworks { runOnUiThread { homeworks = it } }
        listenMonth()
    }

    private fun selectMonthStart() { selectedDate = if (month == YearMonth.now()) LocalDate.now() else month.atDay(1) }

    private fun listenMonth() {
        loading.visibility = View.VISIBLE
        repo.listenMonth(month, { runOnUiThread { allEvents = it; loading.visibility = View.GONE; renderMonth() } },
            { runOnUiThread { loading.visibility = View.GONE; toast("일정을 불러오지 못했습니다.") } })
    }

    private fun renderMonth() {
        monthTitle.text = month.format(DateTimeFormatter.ofPattern("yyyy년 M월"))
        calendar.removeAllViews()
        listOf("일", "월", "화", "수", "목", "금", "토").forEachIndexed { i, day ->
            calendar.addView(TextView(this).apply {
                text = day; gravity = Gravity.CENTER; textSize = 12f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (i == 0) 0xFFEF4444.toInt() else if (i == 6) 0xFF2563EB.toInt() else 0xFF64748B.toInt())
            }, gridParams(dp(28)))
        }
        val firstOffset = month.atDay(1).dayOfWeek.value % 7
        repeat(firstOffset) { calendar.addView(Space(this), gridParams(dp(56))) }
        for (day in 1..month.lengthOfMonth()) {
            val date = month.atDay(day)
            val dayEvents = filteredEvents().filter { it.date == date.toString() }
            val cell = TextView(this).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; setPadding(dp(2), dp(5), dp(2), dp(2))
                textSize = 13f; text = if (dayEvents.isEmpty()) "$day" else "$day\n${dayEvents.take(3).joinToString("") { "●" }}"
                setTextColor(if (date.dayOfWeek.value == 7) 0xFFEF4444.toInt() else if (date.dayOfWeek.value == 6) 0xFF2563EB.toInt() else 0xFF1E293B.toInt())
                background = when {
                    date == selectedDate -> rounded(0xFFDBEAFE.toInt(), 13f, 0xFF2563EB.toInt())
                    date == LocalDate.now() -> rounded(0xFFEFF6FF.toInt(), 13f)
                    else -> rounded(Color.TRANSPARENT, 13f)
                }
                setOnClickListener { selectedDate = date; renderMonth() }
            }
            calendar.addView(cell, gridParams(dp(56)))
        }
        renderAgenda()
    }

    private fun filteredEvents() = allEvents.filter { event -> event.memberIds.any(visibleMembers::contains) }

    private fun renderAgenda() {
        selectedTitle.text = selectedDate.format(DateTimeFormatter.ofPattern("M월 d일 EEEE"))
        eventList.removeAllViews()
        val events = filteredEvents().filter { it.date == selectedDate.toString() }
        if (events.isEmpty()) {
            eventList.addView(TextView(this).apply { text = "등록된 일정이 없습니다."; setTextColor(0xFF94A3B8.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(34), 0, dp(34)) })
            return
        }
        events.forEach { event ->
            val member = members.firstOrNull { it.id == event.memberIds.firstOrNull() }
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12));
                background = rounded(if (event.completed) 0xFFF1F5F9.toInt() else 0xFFF8FAFC.toInt(), 14f)
                setOnClickListener { showEventDetails(event) }
            }
            row.addView(View(this).apply { setBackgroundColor(if (event.completed) 0xFF94A3B8.toInt() else member?.color ?: 0xFF2563EB.toInt()) }, LinearLayout.LayoutParams(dp(5), dp(48)))
            val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), 0, dp(6), 0) }
            texts.addView(TextView(this).apply { text = event.title; textSize = 16f; typeface = Typeface.DEFAULT_BOLD; setTextColor(if (event.completed) 0xFF64748B.toInt() else 0xFF1E293B.toInt()) })
            val time = if (event.allDay) "종일" else event.start.drop(11).take(5)
            texts.addView(TextView(this).apply { text = "${member?.icon ?: "👪"} ${member?.label ?: "가족"} · $time${event.location?.let { " · $it" } ?: ""}"; textSize = 12f; setTextColor(0xFF64748B.toInt()) })
            row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(TextView(this).apply { text = "›"; textSize = 26f; setTextColor(0xFF94A3B8.toInt()) })
            eventList.addView(row, matchWrap(bottom = 7))
        }
    }

    private fun showEventDetails(event: FamilyEvent) {
        val message = buildString {
            append(if (event.allDay) "종일" else event.start.drop(11).take(5))
            event.location?.takeIf { it.isNotBlank() }?.let { append("\n장소: $it") }
            event.memo?.takeIf { it.isNotBlank() }?.let { append("\n\n$it") }
        }
        val dialog = AlertDialog.Builder(this).setTitle(event.title).setMessage(message)
        when (event.kind) {
            "homework" -> {
                dialog.setPositiveButton(if (event.completed) "완료 되돌리기" else "숙제 완료") { _, _ ->
                    repo.setHomeworkCompleted(event, !event.completed) { result -> runOnUiThread { toast(if (result.isSuccess) "숙제 상태를 변경했습니다." else "변경에 실패했습니다: ${result.exceptionOrNull()?.message}") } }
                }.setNeutralButton("삭제") { _, _ -> confirmDelete(event) }
            }
            "event" -> dialog.setPositiveButton("수정") { _, _ -> showEventEditor(event) }.setNeutralButton("삭제") { _, _ -> confirmDelete(event) }
        }
        dialog.setNegativeButton("닫기", null).show()
    }

    private fun confirmDelete(event: FamilyEvent) {
        AlertDialog.Builder(this).setTitle("삭제할까요?").setMessage(event.title)
            .setPositiveButton("삭제") { _, _ -> repo.deleteEvent(event) { result -> runOnUiThread { toast(if (result.isSuccess) "삭제했습니다." else "삭제하지 못했습니다.") } } }
            .setNegativeButton("취소", null).show()
    }

    private fun showEventEditor(existing: FamilyEvent?) {
        val date = existing?.date?.let { LocalDate.parse(it) } ?: selectedDate
        val startTime = existing?.start?.drop(11)?.take(5)?.let { LocalTime.parse(it) } ?: LocalTime.of(9, 0)
        val endTime = existing?.end?.drop(11)?.take(5)?.let { LocalTime.parse(it) } ?: startTime.plusHours(1)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20)) }
        val title = edit("일정 제목", existing?.title.orEmpty()); box.addView(title)
        val memberSpinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, members.map { "${it.icon} ${it.label}" })
            setSelection(members.indexOfFirst { it.id == existing?.memberIds?.firstOrNull() }.coerceAtLeast(members.indexOfFirst { it.id == repo.signedMember() }).coerceAtLeast(0))
        }; box.addView(label("담당 가족")); box.addView(memberSpinner, matchWrap(bottom = 10))
        val dateInput = edit("날짜", date.toString(), false).apply { setOnClickListener { pickDate(this) } }; box.addView(dateInput)
        val allDay = CheckBox(this).apply { text = "종일 일정"; isChecked = existing?.allDay ?: false }; box.addView(allDay)
        val timeRow = LinearLayout(this)
        val startInput = edit("시작", startTime.toString(), false).apply { setOnClickListener { pickTime(this) } }
        val endInput = edit("종료", endTime.toString(), false).apply { setOnClickListener { pickTime(this) } }
        timeRow.addView(startInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(0, 0, dp(4), 0) })
        timeRow.addView(endInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(4), 0, 0, 0) }); box.addView(timeRow)
        val location = edit("장소", existing?.location.orEmpty()); box.addView(location)
        val memo = edit("메모", existing?.memo.orEmpty()); box.addView(memo)
        val repeatSpinner = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("반복 안 함", "매일", "평일", "매주", "매월")) }
        val repeatCount = edit("반복 횟수", (existing?.repeatCount ?: 2).toString()).apply { inputType = InputType.TYPE_CLASS_NUMBER }
        if (existing == null) { box.addView(label("반복")); box.addView(repeatSpinner); box.addView(repeatCount) }
        val scroller = ScrollView(this).apply { addView(box) }
        val alert = AlertDialog.Builder(this).setTitle(if (existing == null) "새 일정" else "일정 수정").setView(scroller)
            .setPositiveButton("저장", null).setNegativeButton("취소", null).create()
        alert.setOnShowListener {
            alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (title.text.isBlank()) return@setOnClickListener toast("일정 제목을 입력해 주세요.")
                val chosenDate = runCatching { LocalDate.parse(dateInput.text) }.getOrNull() ?: return@setOnClickListener toast("날짜를 확인해 주세요.")
                val start = runCatching { LocalTime.parse(startInput.text) }.getOrNull() ?: LocalTime.of(0, 0)
                val end = runCatching { LocalTime.parse(endInput.text) }.getOrNull() ?: start.plusHours(1)
                val repeatCodes = listOf("none", "daily", "weekdays", "weekly", "monthly")
                val repeat = if (existing == null) repeatCodes[repeatSpinner.selectedItemPosition] else "none"
                val count = repeatCount.text.toString().toIntOrNull()?.coerceIn(1, 365) ?: 1
                val occurrenceDates = repeatStarts(chosenDate, repeat, count)
                val baseId = existing?.id ?: newId()
                val events = occurrenceDates.mapIndexed { index, day ->
                    FamilyEvent(
                        id = if (index == 0) baseId else newId(), title = title.text.toString().trim(),
                        start = dateTime(day, start.hour, start.minute), end = dateTime(day, end.hour, end.minute),
                        allDay = allDay.isChecked, memberIds = listOf(members[memberSpinner.selectedItemPosition].id),
                        location = location.text.toString(), memo = memo.text.toString(),
                        repeat = if (index == 0) repeat else "none", repeatCount = if (index == 0) count else 1
                    )
                }
                alert.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                if (existing != null) repo.moveOrSaveEvent(existing, events.first()) { result -> runOnUiThread { alert.dismiss(); toast(if (result.isSuccess) "일정을 저장했습니다." else "저장하지 못했습니다.") } }
                else repo.saveEvents(events) { result -> runOnUiThread { alert.dismiss(); toast(if (result.isSuccess) "${events.size}개 일정을 저장했습니다." else "저장하지 못했습니다.") } }
            }
        }
        alert.show()
    }

    private fun showHomeworkDialog() {
        val names = homeworks.map { it.name }.toTypedArray()
        val checked = BooleanArray(names.size)
        val chosen = mutableSetOf<Int>()
        AlertDialog.Builder(this).setTitle("등록할 숙제 선택").setMultiChoiceItems(names, checked) { _, which, isChecked -> if (isChecked) chosen += which else chosen -= which }
            .setPositiveButton("다음") { _, _ -> if (chosen.isNotEmpty()) showHomeworkOptions(chosen.map { homeworks[it] }) else toast("숙제를 선택해 주세요.") }
            .setNegativeButton("취소", null).show()
    }

    private fun showHomeworkOptions(selected: List<Homework>) {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20)) }
        box.addView(TextView(this).apply { text = selected.joinToString(", ") { it.name }; setTextColor(0xFF475569.toInt()); setPadding(0, 0, 0, dp(12)) })
        val start = edit("시작일", selectedDate.toString(), false).apply { setOnClickListener { pickDate(this) } }
        val end = edit("종료일", selectedDate.toString(), false).apply { setOnClickListener { pickDate(this) } }
        box.addView(start); box.addView(end)
        val repeat = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("반복 안 함", "매일", "평일", "매주", "매월")) }
        box.addView(label("반복")); box.addView(repeat)
        val count = edit("반복 횟수", "2").apply { inputType = InputType.TYPE_CLASS_NUMBER }; box.addView(count)
        val alert = AlertDialog.Builder(this).setTitle("숙제 등록").setView(box).setPositiveButton("등록", null).setNegativeButton("취소", null).create()
        alert.setOnShowListener {
            alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val startDate = runCatching { LocalDate.parse(start.text) }.getOrNull() ?: return@setOnClickListener toast("시작일을 확인해 주세요.")
                val endDate = runCatching { LocalDate.parse(end.text) }.getOrNull() ?: return@setOnClickListener toast("종료일을 확인해 주세요.")
                if (endDate.isBefore(startDate)) return@setOnClickListener toast("종료일은 시작일 이후여야 합니다.")
                val repeatCodes = listOf("none", "daily", "weekdays", "weekly", "monthly")
                val repeatCode = repeatCodes[repeat.selectedItemPosition]
                val total = count.text.toString().toIntOrNull()?.coerceIn(1, 365) ?: 1
                alert.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                repo.registerHomework(selected, startDate, endDate, repeatCode, total) { result -> runOnUiThread { alert.dismiss(); toast(if (result.isSuccess) "${result.getOrDefault(0)}개 숙제를 등록했습니다." else "숙제 등록에 실패했습니다.") } }
            }
        }
        alert.show()
    }

    private fun pickDate(input: EditText) {
        val date = runCatching { LocalDate.parse(input.text) }.getOrElse { LocalDate.now() }
        DatePickerDialog(this, { _, y, m, d -> input.setText(LocalDate.of(y, m + 1, d).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
    }

    private fun pickTime(input: EditText) {
        val time = runCatching { LocalTime.parse(input.text) }.getOrElse { LocalTime.of(9, 0) }
        TimePickerDialog(this, { _, h, m -> input.setText(LocalTime.of(h, m).format(DateTimeFormatter.ofPattern("HH:mm"))) }, time.hour, time.minute, true).show()
    }

    private fun edit(hint: String, value: String, keyboard: Boolean = true) = EditText(this).apply {
        this.hint = hint; setText(value); setSelectAllOnFocus(true); setPadding(dp(12));
        if (!keyboard) { isFocusable = false; isClickable = true }
    }
    private fun label(text: String) = TextView(this).apply { this.text = text; typeface = Typeface.DEFAULT_BOLD; setTextColor(0xFF334155.toInt()); setPadding(0, dp(5), 0, dp(4)) }
    private fun actionButton(text: String, color: Int, click: () -> Unit) = MaterialButton(this).apply { this.text = text; setTextColor(Color.WHITE); setBackgroundColor(color); setOnClickListener { click() } }
    private fun matchWrap(bottom: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, 0, dp(bottom)) }
    private fun gridParams(height: Int) = GridLayout.LayoutParams().apply { width = 0; this.height = height; columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f) }
    private fun rounded(color: Int, radius: Float, stroke: Int? = null) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius.toInt()).toFloat(); stroke?.let { setStroke(dp(1), it) } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
