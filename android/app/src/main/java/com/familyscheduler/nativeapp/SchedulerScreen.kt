package com.familyscheduler.nativeapp

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter

private val GoogleBlue = Color(0xFF1A73E8)
private val GoogleBorder = Color(0xFFDADCE0)
private val GoogleText = Color(0xFF202124)
private val MutedText = Color(0xFF5F6368)
private val weekdays = listOf("일", "월", "화", "수", "목", "금", "토")

@Composable
fun SchedulerScreen(
    events: List<FamilyEvent>,
    loading: Boolean,
    startMonth: YearMonth,
    onMonthChanged: (YearMonth) -> Unit,
    onEventClick: (FamilyEvent) -> Unit,
    onAddEvent: (LocalDate) -> Unit,
    onToday: () -> Unit,
    onNotice: () -> Unit,
    onStats: () -> Unit,
    onHomework: (LocalDate) -> Unit,
    onSettings: () -> Unit,
    onSearch: (String, (Result<List<FamilyEvent>>) -> Unit) -> Unit,
) {
    var month by remember(startMonth) { mutableStateOf(startMonth) }
    var selectedDate by remember { mutableStateOf(LocalDate.now()) }
    var viewMode by remember { mutableStateOf("week") }
    var selectedMembers by remember { mutableStateOf(members.map { it.id }.toSet()) }
    var query by remember { mutableStateOf("") }
    var searchOpen by remember { mutableStateOf(false) }
    var searchLoading by remember { mutableStateOf(false) }
    var searchError by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf(emptyList<FamilyEvent>()) }

    fun runSearch() {
        val term = query.trim()
        if (term.isBlank()) return
        searchOpen = true; searchLoading = true; searchError = ""
        onSearch(term) { result ->
            searchLoading = false
            result.onSuccess { searchResults = it }.onFailure { searchError = "검색 결과를 불러오지 못했습니다." }
        }
    }

    MaterialTheme(colorScheme = lightColorScheme(primary = GoogleBlue, surface = Color.White, background = Color.White)) {
        Surface(Modifier.fillMaxSize(), color = Color.White) {
            if (searchOpen) {
                SearchResultsScreen(
                    query = query,
                    results = searchResults,
                    loading = searchLoading,
                    error = searchError,
                    onQueryChange = { query = it },
                    onSearch = ::runSearch,
                    onBack = { searchOpen = false },
                    onEventClick = { searchOpen = false; onEventClick(it) },
                )
            } else Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("📅", fontSize = 24.sp)
                    Text("우리 가족 스케줄러", Modifier.padding(start = 8.dp).weight(1f), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    TextButton(onClick = onSettings) { Text("⚙️", fontSize = 20.sp) }
                }
                HorizontalActionBar(onToday, onNotice, onStats, { onHomework(selectedDate) }) { onAddEvent(selectedDate) }
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("가족", fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 8.dp))
                    members.forEach { member ->
                        FilterChip(
                            selected = member.id in selectedMembers,
                            onClick = { selectedMembers = if (member.id in selectedMembers) selectedMembers - member.id else selectedMembers + member.id },
                            label = { Text("${member.icon} ${member.label}") },
                            modifier = Modifier.padding(end = 6.dp),
                        )
                    }
                }
                SearchBar(query, { query = it }, ::runSearch)
                CalendarToolbar(
                    month = month,
                    selectedDate = selectedDate,
                    viewMode = viewMode,
                    onPrevious = {
                        selectedDate = when (viewMode) { "month" -> selectedDate.minusMonths(1); "week" -> selectedDate.minusWeeks(1); else -> selectedDate.minusDays(1) }
                        month = YearMonth.from(selectedDate); onMonthChanged(month)
                    },
                    onNext = {
                        selectedDate = when (viewMode) { "month" -> selectedDate.plusMonths(1); "week" -> selectedDate.plusWeeks(1); else -> selectedDate.plusDays(1) }
                        month = YearMonth.from(selectedDate); onMonthChanged(month)
                    },
                    onToday = { selectedDate = LocalDate.now(); month = YearMonth.now(); onMonthChanged(month) },
                    onMode = { viewMode = it },
                )
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                val visible = events.filter { event -> event.memberIds.any(selectedMembers::contains) }
                Box(Modifier.fillMaxWidth().weight(1f)) {
                    when (viewMode) {
                        "month" -> MonthCalendar(month, selectedDate, visible, { selectedDate = it }, onEventClick)
                        "day" -> TimeCalendar(listOf(selectedDate), visible, onEventClick) { onAddEvent(selectedDate) }
                        else -> {
                            val monday = selectedDate.minusDays((selectedDate.dayOfWeek.value - 1).toLong())
                            TimeCalendar((0L..6L).map(monday::plusDays), visible, onEventClick) { onAddEvent(selectedDate) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HorizontalActionBar(onToday: () -> Unit, onNotice: () -> Unit, onStats: () -> Unit, onHomework: () -> Unit, onAdd: () -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 3.dp)) {
        SmallAction("📌 오늘", onToday); SmallAction("📣 가족 메모", onNotice); SmallAction("📊 통계", onStats); SmallAction("📝 숙제 체크", onHomework)
        Button(onClick = onAdd, shape = RoundedCornerShape(7.dp), contentPadding = PaddingValues(horizontal = 13.dp), modifier = Modifier.height(40.dp)) { Text("＋ 일정 추가") }
    }
}

@Composable private fun SmallAction(label: String, click: () -> Unit) {
    OutlinedButton(onClick = click, shape = RoundedCornerShape(7.dp), contentPadding = PaddingValues(horizontal = 11.dp), modifier = Modifier.padding(end = 6.dp).height(40.dp)) { Text(label, color = GoogleText, fontSize = 12.sp) }
}

@Composable
private fun SearchBar(query: String, onChange: (String) -> Unit, onSearch: () -> Unit) {
    OutlinedTextField(
        value = query, onValueChange = onChange, singleLine = true,
        placeholder = { Text("일정·장소·메모 검색") }, leadingIcon = { Text("🔍") },
        trailingIcon = { TextButton(onClick = onSearch) { Text("검색") } },
        shape = RoundedCornerShape(7.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 3.dp),
    )
}

@Composable
private fun CalendarToolbar(
    month: YearMonth, selectedDate: LocalDate, viewMode: String,
    onPrevious: () -> Unit, onNext: () -> Unit, onToday: () -> Unit, onMode: (String) -> Unit,
) {
    val title = when (viewMode) {
        "month" -> month.format(DateTimeFormatter.ofPattern("yyyy년 M월"))
        "day" -> selectedDate.format(DateTimeFormatter.ofPattern("yyyy년 M월 d일"))
        else -> {
            val start = selectedDate.minusDays((selectedDate.dayOfWeek.value - 1).toLong()); val end = start.plusDays(6)
            "${start.monthValue}월 ${start.dayOfMonth}일 – ${end.monthValue}월 ${end.dayOfMonth}일"
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onPrevious, contentPadding = PaddingValues(0.dp), modifier = Modifier.size(42.dp)) { Text("‹", fontSize = 24.sp) }
            OutlinedButton(onClick = onNext, contentPadding = PaddingValues(0.dp), modifier = Modifier.padding(start = 4.dp).size(42.dp)) { Text("›", fontSize = 24.sp) }
            TextButton(onClick = onToday, modifier = Modifier.padding(start = 4.dp)) { Text("오늘") }
            Text(title, Modifier.weight(1f), textAlign = TextAlign.Center, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        }
        Row(Modifier.align(Alignment.End)) {
            listOf("month" to "월", "week" to "주", "day" to "일").forEach { (mode, label) ->
                if (viewMode == mode) Button(onClick = { onMode(mode) }, contentPadding = PaddingValues(horizontal = 13.dp), modifier = Modifier.height(36.dp)) { Text(label) }
                else OutlinedButton(onClick = { onMode(mode) }, contentPadding = PaddingValues(horizontal = 13.dp), modifier = Modifier.height(36.dp)) { Text(label, color = GoogleText) }
            }
        }
    }
}

@Composable
private fun MonthCalendar(month: YearMonth, selected: LocalDate, events: List<FamilyEvent>, onDate: (LocalDate) -> Unit, onEvent: (FamilyEvent) -> Unit) {
    val offset = month.atDay(1).dayOfWeek.value % 7
    val cells = (0 until 42).map { index -> (index - offset + 1).takeIf { it in 1..month.lengthOfMonth() }?.let(month::atDay) }
    Column(Modifier.fillMaxSize().padding(horizontal = 8.dp)) {
        Row { weekdays.forEachIndexed { index, name -> Text(name, Modifier.weight(1f).padding(6.dp), textAlign = TextAlign.Center, color = if (index == 0) Color(0xFFEA4335) else if (index == 6) GoogleBlue else MutedText, fontWeight = FontWeight.Bold) } }
        cells.chunked(7).forEach { week ->
            Row(Modifier.weight(1f)) {
                week.forEach { date ->
                    Column(
                        Modifier.weight(1f).fillMaxHeight().border(0.5.dp, GoogleBorder).background(if (date == LocalDate.now()) Color(0xFFF8FBFF) else Color.White)
                            .clickable(enabled = date != null) { date?.let(onDate) }.padding(3.dp),
                    ) {
                        if (date != null) {
                            Text(date.dayOfMonth.toString(), Modifier.size(25.dp).background(if (date == selected) GoogleBlue else Color.Transparent, CircleShape).padding(top = 3.dp), textAlign = TextAlign.Center, color = if (date == selected) Color.White else GoogleText, fontSize = 12.sp)
                            solarToLunar(date)?.let { lunar -> Text("음 ${lunar.month}/${lunar.day}${if (lunar.leap) " 윤" else ""}", fontSize = 7.sp, color = MutedText, maxLines = 1) }
                            events.filter { it.date == date.toString() }.take(3).forEach { event -> EventPill(event, onEvent, 9) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TimeCalendar(days: List<LocalDate>, events: List<FamilyEvent>, onEvent: (FamilyEvent) -> Unit, onEmpty: () -> Unit) {
    val hourHeight = 48.dp
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(end = 4.dp)) {
            Spacer(Modifier.width(43.dp))
            days.forEach { day ->
                Column(Modifier.weight(1f).padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(listOf("월", "화", "수", "목", "금", "토", "일")[day.dayOfWeek.value - 1], fontSize = 11.sp, color = MutedText)
                    Text(day.dayOfMonth.toString(), Modifier.size(28.dp).background(if (day == LocalDate.now()) GoogleBlue else Color.Transparent, CircleShape).padding(top = 4.dp), textAlign = TextAlign.Center, color = if (day == LocalDate.now()) Color.White else GoogleText)
                    solarToLunar(day)?.let { lunar -> Text("음 ${lunar.month}/${lunar.day}", fontSize = 8.sp, color = MutedText) }
                }
            }
        }
        Row(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            Column(Modifier.width(43.dp)) { (0..23).forEach { hour -> Text(String.format("%02d:00", hour), Modifier.height(hourHeight).fillMaxWidth().padding(top = 2.dp, end = 4.dp), textAlign = TextAlign.End, fontSize = 9.sp, color = MutedText) } }
            days.forEach { day ->
                Box(Modifier.weight(1f).height(hourHeight * 24).border(0.5.dp, GoogleBorder).clickable { onEmpty() }) {
                    Column(Modifier.fillMaxSize()) { repeat(24) { Spacer(Modifier.fillMaxWidth().height(hourHeight).border(0.3.dp, Color(0xFFEEEEEE))) } }
                    events.filter { it.date == day.toString() }.forEach { event ->
                        val start = runCatching { LocalDateTime.parse(event.start) }.getOrNull()
                        val end = event.end?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
                        val startMinutes = if (event.allDay || start == null) 0 else start.hour * 60 + start.minute
                        val duration = if (event.allDay) 50 else ((end?.let { java.time.Duration.between(start, it).toMinutes() } ?: 60L).coerceIn(30L, 360L)).toInt()
                        Box(
                            Modifier.fillMaxWidth().offset(y = hourHeight * (startMinutes / 60f)).height((hourHeight * (duration / 60f)).coerceAtLeast(28.dp)).padding(horizontal = 1.dp, vertical = 1.dp)
                                .background(Color(eventColorLong(event)), RoundedCornerShape(5.dp)).clickable { onEvent(event) }.padding(3.dp),
                        ) { Text("${if (event.allDay) "" else event.start.drop(11).take(5) + " "}${event.title}", color = Color.White, fontSize = 9.sp, lineHeight = 11.sp, fontWeight = FontWeight.SemiBold) }
                    }
                }
            }
        }
    }
}

@Composable private fun EventPill(event: FamilyEvent, onEvent: (FamilyEvent) -> Unit, size: Int) {
    Text(event.title, color = Color.White, fontSize = size.sp, maxLines = 1, modifier = Modifier.fillMaxWidth().padding(top = 2.dp).background(Color(eventColorLong(event)), RoundedCornerShape(4.dp)).clickable { onEvent(event) }.padding(horizontal = 2.dp, vertical = 1.dp))
}

private fun eventColorLong(event: FamilyEvent): Long = when {
    event.completed -> 0xFF9AA0A6
    event.kind == "homework" && event.title.contains("엘리하이") -> 0xFF06B6D4
    event.kind == "homework" -> 0xFFEC4899
    else -> (members.firstOrNull { event.memberIds.contains(it.id) }?.color?.toLong() ?: 0xFF4285F4).and(0xFFFFFFFF)
}

@Composable
private fun SearchResultsScreen(
    query: String, results: List<FamilyEvent>, loading: Boolean, error: String,
    onQueryChange: (String) -> Unit, onSearch: () -> Unit, onBack: () -> Unit, onEventClick: (FamilyEvent) -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Color.White)) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("←", fontSize = 24.sp) }
            OutlinedTextField(query, onQueryChange, Modifier.weight(1f), singleLine = true, leadingIcon = { Text("🔍") }, trailingIcon = { TextButton(onClick = onSearch) { Text("검색") } })
            TextButton(onClick = onBack) { Text("×", fontSize = 24.sp) }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) { Text("‘$query’ 검색 결과", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); if (!loading && error.isBlank()) Text("${results.size}개", color = MutedText) }
        when { loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; error.isNotBlank() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error, color = Color(0xFFC62828)) }; results.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("일치하는 일정이 없습니다.", color = MutedText) }; else -> {
            Row(Modifier.fillMaxWidth().background(Color(0xFFF8F9FA)).padding(9.dp)) { Header("년", .65f); Header("월", .4f); Header("일", .4f); Header("시간", .65f); Header("제목", 1.4f); Header("설명", 1.8f); Header("가족", .55f) }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                results.forEach { event ->
                    val parts = event.date.split("-"); val description = listOfNotNull(event.location, event.memo).filter(String::isNotBlank).joinToString(" · ").ifBlank { "-" }
                    Row(Modifier.fillMaxWidth().clickable { onEventClick(event) }.border(0.5.dp, Color(0xFFEEEEEE)).padding(horizontal = 9.dp, vertical = 12.dp), verticalAlignment = Alignment.Top) {
                        Cell(parts.getOrElse(0) { "" }, .65f); Cell(parts.getOrElse(1) { "" }, .4f); Cell(parts.getOrElse(2) { "" }, .4f)
                        Cell(if (event.allDay) "종일" else event.start.drop(11).take(5), .65f)
                        Text(highlighted(event.title, query), Modifier.weight(1.4f).padding(horizontal = 4.dp), fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                        Text(highlighted(description, query), Modifier.weight(1.8f).padding(horizontal = 4.dp), fontSize = 12.sp)
                        Cell(event.memberIds.mapNotNull { id -> members.firstOrNull { it.id == id }?.icon }.joinToString(""), .55f)
                    }
                }
            }
        }
    }
}
}

@Composable private fun RowScope.Header(text: String, weight: Float) = Text(text, Modifier.weight(weight).padding(horizontal = 4.dp), color = MutedText, fontSize = 11.sp, fontWeight = FontWeight.Bold)
@Composable private fun RowScope.Cell(text: String, weight: Float) = Text(text, Modifier.weight(weight).padding(horizontal = 4.dp), fontSize = 11.sp)

private fun highlighted(text: String, query: String) = buildAnnotatedString {
    if (query.isBlank()) { append(text); return@buildAnnotatedString }
    var cursor = 0
    while (cursor < text.length) {
        val index = text.indexOf(query, cursor, ignoreCase = true)
        if (index < 0) { append(text.substring(cursor)); break }
        append(text.substring(cursor, index))
        withStyle(SpanStyle(background = Color(0xFFFFF176), color = GoogleText, fontWeight = FontWeight.Bold)) { append(text.substring(index, index + query.length)) }
        cursor = index + query.length
    }
}
