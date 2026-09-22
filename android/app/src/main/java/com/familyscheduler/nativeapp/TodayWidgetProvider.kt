package com.familyscheduler.nativeapp

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.time.LocalDate
import java.time.format.DateTimeFormatter

class TodayWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        update(context, manager, ids)
    }

    companion object {
        fun requestRefresh() {
            val context = FamilySchedulerApp.instance
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidgetProvider::class.java))
            update(context, manager, ids)
        }

        private fun update(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            val click = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val waiting = RemoteViews(context.packageName, R.layout.widget_today).apply {
                setTextViewText(R.id.widget_title, "오늘의 우리 가족 · ${LocalDate.now().format(DateTimeFormatter.ofPattern("M월 d일"))}")
                setTextViewText(R.id.widget_events, "일정을 불러오는 중…")
                setOnClickPendingIntent(R.id.widget_root, click)
            }
            ids.forEach { manager.updateAppWidget(it, waiting) }
            if (!FamilyRepository().isLoggedIn()) {
                waiting.setTextViewText(R.id.widget_events, "앱을 열어 로그인해 주세요.")
                ids.forEach { manager.updateAppWidget(it, waiting) }
                return
            }
            FamilyRepository().loadToday { events ->
                val text = if (events.isEmpty()) "오늘 등록된 일정이 없습니다." else events.take(6).joinToString("\n") { event ->
                    val member = members.firstOrNull { it.id == event.memberIds.firstOrNull() }
                    val time = if (event.allDay) "종일" else event.start.drop(11).take(5)
                    "${member?.icon ?: "•"} $time  ${event.title}"
                }
                val views = RemoteViews(context.packageName, R.layout.widget_today).apply {
                    setTextViewText(R.id.widget_title, "오늘의 우리 가족 · ${LocalDate.now().format(DateTimeFormatter.ofPattern("M월 d일"))}")
                    setTextViewText(R.id.widget_events, text)
                    setOnClickPendingIntent(R.id.widget_root, click)
                }
                ids.forEach { manager.updateAppWidget(it, views) }
            }
        }
    }
}
