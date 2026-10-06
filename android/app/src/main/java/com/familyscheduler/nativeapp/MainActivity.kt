package com.familyscheduler.nativeapp

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.view.setPadding
import androidx.core.app.ActivityCompat
import com.google.android.material.button.MaterialButton
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter

class MainActivity : ComponentActivity() {
    private val repo = FamilyRepository()
    private var month = YearMonth.now()
    private var selectedDate = LocalDate.now()
    private var allEvents = emptyList<FamilyEvent>()
    private var homeworks = defaultHomeworks
    private var notices = emptyList<FamilyNotice>()
    private val visibleMembers = members.map { it.id }.toMutableSet()
    private var viewMode = "week"
    private var searchQuery = ""
    private var composeEvents by mutableStateOf(emptyList<FamilyEvent>())
    private var composeLoading by mutableStateOf(false)

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
        setContent {
            SchedulerScreen(
                events = composeEvents,
                loading = composeLoading,
                startMonth = month,
                onMonthChanged = { next -> month = next; listenMonth() },
                onEventClick = { showEventDetails(it) },
                onAddEvent = { date -> selectedDate = date; showEventEditor(null) },
                onToday = { showTodaySummary() },
                onNotice = { showNoticeInfo() },
                onStats = { showStats() },
                onHomework = { date -> selectedDate = date; showHomeworkDialog() },
                onSettings = { showSettings() },
                onSearch = { term, done -> repo.searchEvents(term, done) },
            )
        }
        repo.listenHomeworks { runOnUiThread { homeworks = it } }
        repo.listenNotices { runOnUiThread { notices = it } }
        requestNotificationPermission()
        listenMonth()
    }

    @Suppress("unused")
    private fun showLegacyCalendar() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE)
        }
        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(dp(16), dp(10), dp(10), dp(8)); setBackgroundColor(Color.WHITE)
        }
        header.addView(TextView(this).apply { text = "📅  우리 가족 스케줄러"; textSize = 20f; typeface = Typeface.DEFAULT_BOLD }, LinearLayout.LayoutParams(0, dp(48), 1f))
        header.addView(pwaButton("⚙️") { showSettings() }, LinearLayout.LayoutParams(dp(56), dp(42)))
        root.addView(header)

        val actionScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val topActions = LinearLayout(this).apply { setPadding(dp(10), 0, dp(10), dp(6)) }
        topActions.addView(pwaButton("📌 오늘") { showTodaySummary() })
        topActions.addView(pwaButton("📣 가족 메모") { showNoticeInfo() })
        topActions.addView(pwaButton("📊 통계") { showStats() })
        topActions.addView(pwaButton("📝 숙제 체크") { showHomeworkDialog() })
        topActions.addView(actionButton("＋ 일정 추가", 0xFF1A73E8.toInt()) { showEventEditor(null) })
        actionScroll.addView(topActions); root.addView(actionScroll)

        val memberBar = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val memberRow = LinearLayout(this).apply { setPadding(dp(10), dp(6), dp(10), dp(3)); gravity = Gravity.CENTER_VERTICAL }
        members.forEach { item ->
            memberRow.addView(CheckBox(this).apply {
                text = "${item.icon} ${item.label}"; isChecked = true; buttonTintList = android.content.res.ColorStateList.valueOf(item.color)
                setOnCheckedChangeListener { _, checked -> if (checked) visibleMembers += item.id else visibleMembers -= item.id; renderMonth() }
            })
        }
        memberBar.addView(memberRow); root.addView(memberBar)
        val search = EditText(this).apply {
            hint="🔍  일정·장소·메모 검색";setSingleLine(true);textSize=14f;setPadding(dp(12),dp(2),dp(12),dp(2));background=rounded(Color.WHITE,7f,0xFFDADCE0.toInt())
            addTextChangedListener(object:android.text.TextWatcher{override fun beforeTextChanged(s:CharSequence?,st:Int,c:Int,a:Int){};override fun onTextChanged(s:CharSequence?,st:Int,b:Int,c:Int){searchQuery=s?.toString().orEmpty();renderMonth()};override fun afterTextChanged(s:android.text.Editable?) {}})
        }
        root.addView(search,LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,dp(40)).apply{setMargins(dp(12),0,dp(12),dp(5))})

        val nav = LinearLayout(this).apply { gravity = Gravity.CENTER; setPadding(dp(8), dp(4), dp(8), dp(4)) }
        nav.addView(Button(this).apply { text = "‹"; textSize = 22f; setOnClickListener { if(viewMode=="month"){month=month.minusMonths(1);selectMonthStart();listenMonth()}else{selectedDate=selectedDate.plusDays(if(viewMode=="week")-7 else -1);month=YearMonth.from(selectedDate);listenMonth()} } }, LinearLayout.LayoutParams(dp(52), dp(48)))
        monthTitle = TextView(this).apply { textSize = 20f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER }
        nav.addView(monthTitle, LinearLayout.LayoutParams(0, dp(48), 1f))
        nav.addView(Button(this).apply { text = "›"; textSize = 22f; setOnClickListener { if(viewMode=="month"){month=month.plusMonths(1);selectMonthStart();listenMonth()}else{selectedDate=selectedDate.plusDays(if(viewMode=="week")7 else 1);month=YearMonth.from(selectedDate);listenMonth()} } }, LinearLayout.LayoutParams(dp(52), dp(48)))
        listOf("월" to "month","주" to "week","일" to "day").forEach{(name,mode)->nav.addView(pwaButton(name){viewMode=mode;renderMonth()},LinearLayout.LayoutParams(dp(44),dp(42)))}
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

        setContentView(root)
        repo.listenHomeworks { runOnUiThread { homeworks = it } }
        repo.listenNotices { runOnUiThread { notices = it } }
        requestNotificationPermission()
        listenMonth()
    }

    private fun selectMonthStart() { selectedDate = if (month == YearMonth.now()) LocalDate.now() else month.atDay(1) }

    private fun listenMonth() {
        composeLoading = true
        repo.listenMonth(month, { rows -> runOnUiThread {
            allEvents = rows; composeEvents = rows; composeLoading = false
            rows.filter { event -> event.memberIds.contains(repo.signedMember()) }.forEach { event -> AlarmScheduler.scheduleEvent(this, event) }
        } }, { runOnUiThread { composeLoading = false; toast("일정을 불러오지 못했습니다.") } })
    }

    private fun renderMonth() {
        if(viewMode=="week")return renderWeekGrid()
        if(viewMode=="day")return renderDayGrid()
        renderMonthGrid()
    }

    private fun renderMonthGrid() {
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

    private fun renderWeekGrid(){
        val start=selectedDate.minusDays((selectedDate.dayOfWeek.value-1).toLong());monthTitle.text="${start.monthValue}월 ${start.dayOfMonth}일 – ${start.plusDays(6).monthValue}월 ${start.plusDays(6).dayOfMonth}일";calendar.removeAllViews();calendar.columnCount=7
        (0..6).forEach{n->val d=start.plusDays(n.toLong());val es=filteredEvents().filter{it.date==d.toString()};calendar.addView(LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;background=if(d==LocalDate.now())rounded(0xFFF8FBFF.toInt(),4f,0xFFDADCE0.toInt())else rounded(Color.WHITE,4f,0xFFDADCE0.toInt());setPadding(dp(3));addView(TextView(this@MainActivity).apply{text="${listOf("월","화","수","목","금","토","일")[n]} ${d.dayOfMonth}";gravity=Gravity.CENTER;typeface=Typeface.DEFAULT_BOLD});es.take(6).forEach{e->addView(TextView(this@MainActivity).apply{text="${if(e.allDay)"" else e.start.drop(11).take(5)+" "}${e.title}";textSize=9f;setTextColor(Color.WHITE);setPadding(dp(2));background=rounded(eventColor(e),5f);setOnClickListener{showEventDetails(e)}})};setOnClickListener{selectedDate=d;renderAgenda()}},gridParams(dp(360)))};renderAgenda()
    }

    private fun renderDayGrid(){monthTitle.text=selectedDate.format(DateTimeFormatter.ofPattern("yyyy년 M월 d일"));calendar.removeAllViews();calendar.columnCount=1;filteredEvents().filter{it.date==selectedDate.toString()}.forEach{e->calendar.addView(TextView(this).apply{text="${if(e.allDay)"종일" else e.start.drop(11).take(5)}   ${e.title}";textSize=14f;setTextColor(Color.WHITE);setPadding(dp(10));background=rounded(eventColor(e),6f);setOnClickListener{showEventDetails(e)}},GridLayout.LayoutParams().apply{width=ViewGroup.LayoutParams.MATCH_PARENT;height=dp(48);setMargins(dp(6),dp(3),dp(6),dp(3))})};renderAgenda()}

    private fun eventColor(e:FamilyEvent)=when{e.completed->0xFF9AA0A6.toInt();e.kind=="homework"&&e.title.contains("엘리하이")->0xFF06B6D4.toInt();e.kind=="homework"->0xFFEC4899.toInt();else->members.firstOrNull{e.memberIds.contains(it.id)}?.color?:0xFF4285F4.toInt()}

    private fun filteredEvents() = allEvents.filter { event -> event.memberIds.any(visibleMembers::contains) && (searchQuery.isBlank() || "${event.title} ${event.location.orEmpty()} ${event.memo.orEmpty()}".contains(searchQuery,true)) }

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
                }.setNeutralButton("삭제") { _, _ -> showHomeworkDeleteOptions(event) }
            }
            "event" -> dialog.setPositiveButton("수정") { _, _ -> showEventEditor(event) }.setNeutralButton("삭제") { _, _ -> confirmDelete(event) }
        }
        dialog.setNegativeButton("닫기", null).show()
    }

    private fun showHomeworkDeleteOptions(event: FamilyEvent) {
        val choices = arrayOf(
            "이 숙제만\n현재 날짜의 숙제만 삭제",
            "이 일정 및 이후 일정\n현재 날짜부터 반복 숙제 삭제",
            "전체 반복 일정\n이미 지난 일정까지 모두 삭제"
        )
        AlertDialog.Builder(this)
            .setTitle("🗑 숙제 삭제")
            .setItems(choices) { _, which ->
                val mode = listOf("one", "future", "all")[which]
                repo.deleteHomeworkEvents(event, mode) { result ->
                    runOnUiThread {
                        toast(if (result.isSuccess) "${result.getOrDefault(0)}개의 숙제를 삭제했습니다." else "숙제 삭제에 실패했습니다: ${result.exceptionOrNull()?.message.orEmpty()}")
                    }
                }
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun confirmDelete(event: FamilyEvent) {
        AlertDialog.Builder(this).setTitle("삭제할까요?").setMessage(event.title)
            .setPositiveButton("삭제") { _, _ -> repo.deleteEvent(event) { result -> runOnUiThread { if(result.isSuccess)AlarmScheduler.cancelEvent(this,event.id);toast(if (result.isSuccess) "삭제했습니다." else "삭제하지 못했습니다.") } } }
            .setNegativeButton("취소", null).show()
    }

    private fun showEventEditor(existing: FamilyEvent?) {
        val date = existing?.date?.let { LocalDate.parse(it) } ?: selectedDate
        val startTime = existing?.start?.drop(11)?.take(5)?.let { LocalTime.parse(it) } ?: LocalTime.of(9, 0)
        val endTime = existing?.end?.drop(11)?.take(5)?.let { LocalTime.parse(it) } ?: startTime.plusHours(1)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20)) }
        val title = edit("일정 제목", existing?.title.orEmpty()); box.addView(title)
        val selectedMembers=(existing?.memberIds?.toMutableSet()?: mutableSetOf(repo.signedMember()))
        box.addView(label("알림 받을 가족"));val memberRow=LinearLayout(this);members.forEach{m->memberRow.addView(CheckBox(this).apply{text="${m.icon} ${m.label}";isChecked=selectedMembers.contains(m.id);buttonTintList=android.content.res.ColorStateList.valueOf(m.color);setOnCheckedChangeListener{_,yes->if(yes)selectedMembers+=m.id else selectedMembers-=m.id}})};box.addView(memberRow)
        val dateInput = edit("날짜", date.toString(), false).apply { setOnClickListener { pickDate(this) } }; box.addView(dateInput)
        val allDay = CheckBox(this).apply { text = "종일 일정"; isChecked = existing?.allDay ?: false }; box.addView(allDay)
        val timeRow = LinearLayout(this)
        val startInput = edit("시작", startTime.toString(), false).apply { setOnClickListener { pickTime(this) } }
        val endInput = edit("종료", endTime.toString(), false).apply { setOnClickListener { pickTime(this) } }
        timeRow.addView(startInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(0, 0, dp(4), 0) })
        timeRow.addView(endInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(4), 0, 0, 0) }); box.addView(timeRow)
        val location = edit("장소", existing?.location.orEmpty()); box.addView(location)
        val memo = edit("메모", existing?.memo.orEmpty()); box.addView(memo)
        val selectedAlarms=(existing?.alarmMinutes?.toMutableSet()?: mutableSetOf(10));box.addView(label("알림"));val alarmRow=LinearLayout(this);listOf(5,10,30,60).forEach{min->alarmRow.addView(CheckBox(this).apply{text="${min}분 전";isChecked=selectedAlarms.contains(min);setOnCheckedChangeListener{_,yes->if(yes)selectedAlarms+=min else selectedAlarms-=min}})};box.addView(HorizontalScrollView(this).apply{addView(alarmRow)})
        val repeatSpinner = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("반복 안 함", "매일", "평일", "매주", "매월", "음력 매년")) }
        val repeatEndMode = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("횟수", "날짜까지")) }
        val repeatCountValues = listOf(2, 3, 5, 10, 20, 30, 60)
        val repeatCountPreset = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, repeatCountValues.map { "${it}회" } + "직접 입력")
        }
        val repeatCount = edit("횟수 직접 입력", (existing?.repeatCount ?: 2).toString()).apply { inputType = InputType.TYPE_CLASS_NUMBER }
        repeatCountPreset.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position < repeatCountValues.size) repeatCount.setText(repeatCountValues[position].toString())
            }
        }
        val repeatUntil = edit("반복 종료일 📅", date.plusMonths(1).toString(), false).apply { setOnClickListener { pickDate(this) }; visibility = View.GONE }
        val lunarSummary = TextView(this).apply { setTextColor(0xFF64748B.toInt()); setPadding(0, dp(6), 0, dp(6)); visibility = View.GONE }
        if (existing == null) {
            box.addView(label("반복")); box.addView(repeatSpinner); box.addView(label("반복 종료 방식")); box.addView(repeatEndMode); box.addView(label("반복 횟수")); box.addView(repeatCountPreset); box.addView(repeatCount); box.addView(repeatUntil); box.addView(lunarSummary)
            repeatEndMode.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { repeatCountPreset.visibility = if (position == 0) View.VISIBLE else View.GONE; repeatCount.visibility = if (position == 0) View.VISIBLE else View.GONE; repeatUntil.visibility = if (position == 1) View.VISIBLE else View.GONE }
            }
            repeatSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    val lunar = runCatching { LocalDate.parse(dateInput.text.toString()) }.getOrNull()?.let(::solarToLunar)
                    lunarSummary.visibility = if (position == 5) View.VISIBLE else View.GONE
                    lunarSummary.text = lunar?.let { "음력 ${it.month}월 ${it.day}일 · ${if (it.leap) "윤달" else "평달"} (자동 판별)" }.orEmpty()
                    val enabled = position != 0
                    repeatCountPreset.isEnabled = enabled; repeatCount.isEnabled = enabled; repeatEndMode.isEnabled = enabled
                    if (!enabled) repeatCount.setText("1") else if ((repeatCount.text.toString().toIntOrNull() ?: 1) < 2) repeatCount.setText("2")
                }
            }
        }
        val scroller = ScrollView(this).apply { addView(box) }
        val alert = AlertDialog.Builder(this).setTitle(if (existing == null) "새 일정" else "일정 수정").setView(scroller)
            .setPositiveButton("저장", null).setNegativeButton("취소", null).create()
        alert.setOnShowListener {
            alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (title.text.isBlank()) return@setOnClickListener toast("일정 제목을 입력해 주세요.")
                val chosenDate = runCatching { LocalDate.parse(dateInput.text) }.getOrNull() ?: return@setOnClickListener toast("날짜를 확인해 주세요.")
                val start = runCatching { LocalTime.parse(startInput.text) }.getOrNull() ?: LocalTime.of(0, 0)
                val end = runCatching { LocalTime.parse(endInput.text) }.getOrNull() ?: start.plusHours(1)
                val repeatCodes = listOf("none", "daily", "weekdays", "weekly", "monthly", "lunarYearly")
                val repeat = if (existing == null) repeatCodes[repeatSpinner.selectedItemPosition] else "none"
                val count = repeatCount.text.toString().toIntOrNull()?.coerceIn(1, 365) ?: 1
                val until = if (existing == null && repeatEndMode.selectedItemPosition == 1) runCatching { LocalDate.parse(repeatUntil.text.toString()) }.getOrNull() else null
                if (repeat != "none" && repeatEndMode.selectedItemPosition == 1 && (until == null || until.isBefore(chosenDate))) return@setOnClickListener toast("반복 종료일은 시작일과 같거나 이후여야 합니다.")
                val lunar = solarToLunar(chosenDate)
                val occurrenceDates = if (repeat == "lunarYearly" && lunar != null) lunarRepeatStarts(chosenDate, lunar, count, until) else repeatStarts(chosenDate, repeat, count, until)
                val baseId = existing?.id ?: newId()
                val events = occurrenceDates.mapIndexed { index, day ->
                    FamilyEvent(
                        id = if (index == 0) baseId else newId(), title = title.text.toString().trim(),
                        start = dateTime(day, start.hour, start.minute), end = dateTime(day, end.hour, end.minute),
                        allDay = allDay.isChecked, memberIds = selectedMembers.toList(), alarmMinutes=selectedAlarms.sorted(),
                        location = location.text.toString(), memo = memo.text.toString(),
                        repeat = if (index == 0) repeat else "none", repeatCount = if (index == 0) count else 1,
                        repeatEndMode = if (index == 0 && until != null) "date" else "count", repeatUntil = if (index == 0) until?.toString() else null,
                        calendarType = if (repeat == "lunarYearly") "lunar" else "solar", lunarMonth = if (repeat == "lunarYearly") lunar?.month else null,
                        lunarDay = if (repeat == "lunarYearly") lunar?.day else null, lunarLeapMonth = repeat == "lunarYearly" && lunar?.leap == true
                    )
                }
                alert.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                if(selectedMembers.isEmpty())return@setOnClickListener toast("최소 한 명을 선택해 주세요.")
                if (existing != null) repo.moveOrSaveEvent(existing, events.first()) { result -> runOnUiThread { if(result.isSuccess){AlarmScheduler.cancelEvent(this,existing.id);AlarmScheduler.scheduleEvent(this,events.first())};alert.dismiss();toast(if (result.isSuccess) "일정을 저장했습니다." else "저장하지 못했습니다.") } }
                else repo.saveEvents(events) { result -> runOnUiThread { if(result.isSuccess)events.forEach{AlarmScheduler.scheduleEvent(this,it)};alert.dismiss();toast(if (result.isSuccess) "${events.size}개 일정을 저장했습니다." else "저장하지 못했습니다.") } }
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
            .setNeutralButton("숙제 항목 관리") { _, _ -> showHomeworkManageDialog() }
            .setNegativeButton("취소", null).show()
    }

    private fun showHomeworkManageDialog() {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16)) }
        homeworks.forEach { homework ->
            val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
            row.addView(TextView(this).apply {
                text = homework.name; textSize = 14f; setTextColor(0xFF334155.toInt())
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(Button(this).apply {
                text = "수정"; textSize = 11f
                setOnClickListener { showHomeworkEditDialog(homework) }
            })
            row.addView(Button(this).apply {
                text = "삭제"; textSize = 11f
                setOnClickListener {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("숙제 항목 삭제")
                        .setMessage("'${homework.name}' 숙제 항목을 삭제할까요?")
                        .setPositiveButton("삭제") { _, _ ->
                            val next = homeworks.filterNot { it.id == homework.id }
                            repo.saveHomeworks(next) { result ->
                                runOnUiThread {
                                    if (result.isSuccess) { homeworks = next; toast("숙제 항목을 삭제했습니다.") }
                                    else toast("삭제에 실패했습니다.")
                                }
                            }
                        }.setNegativeButton("취소", null).show()
                }
            })
            box.addView(row, matchWrap(bottom = 4))
        }
        AlertDialog.Builder(this)
            .setTitle("숙제 항목 관리")
            .setView(ScrollView(this).apply { addView(box) })
            .setPositiveButton("새 숙제 추가") { _, _ -> showHomeworkEditDialog(null) }
            .setNegativeButton("닫기", null).show()
    }

    private fun showHomeworkEditDialog(existing: Homework?) {
        val input = edit("숙제 이름", existing?.name.orEmpty())
        val dialog = AlertDialog.Builder(this)
            .setTitle(if (existing == null) "새 숙제 추가" else "숙제 항목 수정")
            .setView(input).setPositiveButton("저장", null).setNegativeButton("취소", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = input.text.toString().trim()
                if (name.isBlank()) return@setOnClickListener toast("숙제 이름을 입력해 주세요.")
                if (homeworks.any { it.name == name && it.id != existing?.id }) return@setOnClickListener toast("이미 등록된 숙제입니다.")
                val next = (if (existing == null) homeworks + Homework(newId(), name)
                    else homeworks.map { if (it.id == existing.id) existing.copy(name = name) else it }).sortedBy { it.name }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                repo.saveHomeworks(next) { result ->
                    runOnUiThread {
                        if (result.isSuccess) { homeworks = next; dialog.dismiss(); toast(if (existing == null) "숙제 항목을 추가했습니다." else "숙제 항목을 수정했습니다.") }
                        else { dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true; toast("저장에 실패했습니다.") }
                    }
                }
            }
        }
        dialog.show()
    }

    private fun showHomeworkOptions(selected: List<Homework>) {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20)) }
        box.addView(TextView(this).apply { text = selected.joinToString(", ") { it.name }; setTextColor(0xFF475569.toInt()); setPadding(0, 0, 0, dp(12)) })
        val schoolOtherSelected = selected.any { it.id == "school-other" || it.name.replace(" ", "").contains("학교숙제(기타)") }
        val schoolOtherDetail = edit("어떤 학교숙제인가요? (예: 수학 익힘책 20쪽)", "")
        if (schoolOtherSelected) {
            box.addView(label("학교숙제 내용"))
            box.addView(schoolOtherDetail)
        }
        val start = edit("시작일", selectedDate.toString(), false).apply { setOnClickListener { pickDate(this) } }
        val end = edit("종료일", selectedDate.toString(), false).apply { setOnClickListener { pickDate(this) } }
        box.addView(start); box.addView(end)
        val repeat = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("반복 안 함", "매일", "평일", "매주", "매월")) }
        box.addView(label("반복")); box.addView(repeat)
        box.addView(label("반복 횟수"))
        val countPresetValues = listOf(2, 3, 5, 10, 20, 30, 60)
        val countPreset = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, countPresetValues.map { "${it}회" } + "직접 입력")
        }
        val count = edit("횟수 직접 입력", "2").apply { inputType = InputType.TYPE_CLASS_NUMBER }
        countPreset.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position < countPresetValues.size) count.setText(countPresetValues[position].toString())
            }
        }
        repeat.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val enabled = position != 0
                countPreset.isEnabled = enabled; count.isEnabled = enabled
                if (!enabled) count.setText("1") else if ((count.text.toString().toIntOrNull() ?: 1) < 2) count.setText("2")
            }
        }
        box.addView(countPreset); box.addView(count)
        val alert = AlertDialog.Builder(this).setTitle("숙제 등록").setView(box).setPositiveButton("등록", null).setNegativeButton("취소", null).create()
        alert.setOnShowListener {
            alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val startDate = runCatching { LocalDate.parse(start.text) }.getOrNull() ?: return@setOnClickListener toast("시작일을 확인해 주세요.")
                val endDate = runCatching { LocalDate.parse(end.text) }.getOrNull() ?: return@setOnClickListener toast("종료일을 확인해 주세요.")
                if (endDate.isBefore(startDate)) return@setOnClickListener toast("종료일은 시작일 이후여야 합니다.")
                if (schoolOtherSelected && schoolOtherDetail.text.isBlank()) return@setOnClickListener toast("어떤 학교숙제인지 입력해 주세요.")
                val resolvedSelected = selected.map { homework ->
                    if (homework.id == "school-other" || homework.name.replace(" ", "").contains("학교숙제(기타)")) homework.copy(name = "학교숙제 · ${schoolOtherDetail.text.toString().trim()}") else homework
                }
                val repeatCodes = listOf("none", "daily", "weekdays", "weekly", "monthly")
                val repeatCode = repeatCodes[repeat.selectedItemPosition]
                val total = count.text.toString().toIntOrNull()?.coerceIn(1, 365) ?: 1
                alert.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                repo.registerHomework(resolvedSelected, startDate, endDate, repeatCode, total) { result -> runOnUiThread { alert.dismiss(); toast(if (result.isSuccess) "${result.getOrDefault(0)}개 숙제를 등록했습니다." else "숙제 등록에 실패했습니다.") } }
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

    private fun showTodaySummary(){
        val today=LocalDate.now().toString()
        val todayEvents=allEvents.filter{it.date==today&&it.kind!="homework-complete"}
        val hw=todayEvents.filter{it.kind=="homework"}
        val text=buildString{
            append(members.joinToString("\n\n"){m->
                val es=todayEvents.filter{it.memberIds.contains(m.id)}
                "${m.icon} ${m.label}\n"+(if(es.isEmpty())"오늘 일정 없음" else es.joinToString("\n"){e->"${if(e.kind=="homework"||e.allDay)"종일" else e.start.drop(11).take(5)}  ${e.title}"})
            })
            append("\n\n📝 오늘 숙제\n")
            append(if(hw.isEmpty())"없음" else "${hw.count{it.completed}}/${hw.size} 완료")
            notices.firstOrNull()?.let{notice->append("\n\n📣 최근 가족 메모\n${notice.title}");if(notice.body.isNotBlank())append("\n${notice.body}")}
        }
        AlertDialog.Builder(this).setTitle("📌 오늘").setMessage(text).setPositiveButton("닫기",null).show()
    }
    private fun showStats(){
        val today=LocalDate.now(); val todayKey=today.toString(); val last30Start=today.minusDays(30).toString()
        val last30=allEvents.count{it.kind=="event"&&it.date>=last30Start&&it.date<=todayKey}
        val todayEvents=allEvents.count{it.date==todayKey&&it.kind!="homework-complete"}
        val hw=allEvents.filter{it.date==todayKey&&it.kind=="homework"}
        val rate=if(hw.isEmpty())0 else (hw.count{it.completed}*100/hw.size)
        val completed=allEvents.count{it.kind=="homework"&&it.completed}
        val memberLines=members.joinToString("\n"){m->"${m.icon} ${m.label}  ${allEvents.count{it.kind=="event"&&it.memberIds.contains(m.id)}}"}
        val text="최근 30일 일정  ${last30}개\n오늘 일정  ${todayEvents}개\n오늘 숙제 완료율  ${rate}%\n누적 완료 숙제  ${completed}개\n\n구성원별 일정 수\n$memberLines"
        AlertDialog.Builder(this).setTitle("📊 가족 통계").setMessage(text).setPositiveButton("닫기",null).show()
    }
    private fun showNoticeInfo(){
        val box=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(18))}
        val title=edit("제목","");val body=edit("가족에게 남길 메모나 공지","").apply{minLines=3;gravity=Gravity.TOP}
        box.addView(title);box.addView(body)
        box.addView(TextView(this).apply{text="최근 메모";textSize=17f;typeface=Typeface.DEFAULT_BOLD;setPadding(0,dp(14),0,dp(6))})
        if(notices.isEmpty())box.addView(TextView(this).apply{text="저장된 가족 메모가 없습니다.";setTextColor(0xFF64748B.toInt())})
        notices.take(10).forEach{notice->box.addView(LinearLayout(this).apply{
            orientation=LinearLayout.VERTICAL;setPadding(dp(10));background=rounded(0xFFF8FAFC.toInt(),10f,0xFFE2E8F0.toInt())
            addView(TextView(this@MainActivity).apply{text=notice.title;typeface=Typeface.DEFAULT_BOLD;textSize=15f})
            if(notice.body.isNotBlank())addView(TextView(this@MainActivity).apply{text=notice.body;textSize=13f;setTextColor(0xFF475569.toInt());setPadding(0,dp(3),0,0)})
        },matchWrap(bottom=6))}
        val alert=AlertDialog.Builder(this).setTitle("📣 가족 메모 / 공지").setView(ScrollView(this).apply{addView(box)}).setPositiveButton("저장",null).setNegativeButton("닫기",null).create()
        alert.setOnShowListener{alert.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
            if(title.text.isBlank()&&body.text.isBlank())return@setOnClickListener toast("제목이나 내용을 입력해 주세요.")
            val notice=FamilyNotice(title=title.text.toString().trim().ifBlank{"가족 메모"},body=body.text.toString().trim(),createdBy=repo.signedMember())
            alert.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled=false
            repo.saveNotices(listOf(notice)+notices){result->runOnUiThread{if(result.isSuccess)alert.dismiss() else alert.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled=true;toast(if(result.isSuccess)"가족 메모를 저장했습니다." else "가족 메모를 저장하지 못했습니다.")}}
        }}
        alert.show()
    }
    private fun showSettings(){
        val items=arrayOf("🔔 알림 권한 및 정확한 알람 설정","테스트 알림","🚪 로그아웃")
        AlertDialog.Builder(this).setTitle("⚙️ 알림 / 앱 설정").setItems(items){_,which->
            when(which){
                0->{requestNotificationPermission();if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S)runCatching{startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:$packageName")))}}
                1->{requestNotificationPermission();AlarmScheduler.showTestNotification(this)}
                else->{repo.logout();showLogin()}
            }
        }.setNegativeButton("닫기",null).show()
    }
    private fun requestNotificationPermission(){if(Build.VERSION.SDK_INT>=33&&ActivityCompat.checkSelfPermission(this,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)ActivityCompat.requestPermissions(this,arrayOf(Manifest.permission.POST_NOTIFICATIONS),1001)}

    private fun edit(hint: String, value: String, keyboard: Boolean = true) = EditText(this).apply {
        this.hint = hint; setText(value); setSelectAllOnFocus(true); setPadding(dp(12));
        if (!keyboard) { isFocusable = false; isClickable = true }
    }
    private fun label(text: String) = TextView(this).apply { this.text = text; typeface = Typeface.DEFAULT_BOLD; setTextColor(0xFF334155.toInt()); setPadding(0, dp(5), 0, dp(4)) }
    private fun actionButton(text: String, color: Int, click: () -> Unit) = MaterialButton(this).apply { this.text = text; setTextColor(Color.WHITE); setBackgroundColor(color); setOnClickListener { click() } }
    private fun pwaButton(text:String,click:()->Unit)=Button(this).apply{this.text=text;textSize=12f;isAllCaps=false;background=rounded(Color.WHITE,7f,0xFFDADCE0.toInt());setTextColor(0xFF3C4043.toInt());setOnClickListener{click()};setPadding(dp(10),0,dp(10),0);layoutParams=LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,dp(40)).apply{setMargins(dp(3),0,dp(3),0)}}
    private fun matchWrap(bottom: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, 0, dp(bottom)) }
    private fun gridParams(height: Int) = GridLayout.LayoutParams().apply { width = 0; this.height = height; columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f) }
    private fun rounded(color: Int, radius: Float, stroke: Int? = null) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius.toInt()).toFloat(); stroke?.let { setStroke(dp(1), it) } }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()
}
