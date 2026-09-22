package com.familyscheduler.nativeapp

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.time.LocalDateTime
import java.time.ZoneId

object AlarmScheduler {
    const val CHANNEL_ID = "family_schedule_alerts"
    private const val PREFS = "scheduled_family_alarms"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audio = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()
        val channel = NotificationChannel(CHANNEL_ID, "가족 일정 알림", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "가족 일정 시작 전 알림"
            enableVibration(true); vibrationPattern = longArrayOf(0, 250, 120, 250)
            setSound(sound, audio)
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun scheduleEvent(context: Context, event: FamilyEvent) {
        if (event.kind != "event" || event.alarmMinutes.isEmpty()) return
        val start = runCatching { LocalDateTime.parse(event.start) }.getOrNull() ?: return
        event.alarmMinutes.forEach { minutes ->
            val trigger = start.minusMinutes(minutes.toLong()).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            if (trigger <= System.currentTimeMillis()) return@forEach
            schedule(context, alarmKey(event.id, minutes), trigger, event.title, event.location.orEmpty(), minutes)
        }
    }

    fun cancelEvent(context: Context, eventId: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val keys = prefs.all.keys.filter { it.startsWith("$eventId|") }
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        keys.forEach { key -> manager.cancel(pending(context, key, PendingIntent.FLAG_NO_CREATE)); prefs.edit().remove(key).apply() }
    }

    fun restore(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.all.forEach { (key, raw) ->
            val item = runCatching { JSONObject(raw as String) }.getOrNull() ?: return@forEach
            val trigger = item.optLong("trigger")
            if (trigger > System.currentTimeMillis()) schedule(context, key, trigger, item.optString("title"), item.optString("location"), item.optInt("minutes"))
            else prefs.edit().remove(key).apply()
        }
    }

    private fun schedule(context: Context, key: String, trigger: Long, title: String, location: String, minutes: Int) {
        createChannel(context)
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = pending(context, key, PendingIntent.FLAG_UPDATE_CURRENT, title, location, minutes)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, intent)
        else manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, intent)
        val json = JSONObject().put("trigger", trigger).put("title", title).put("location", location).put("minutes", minutes)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(key, json.toString()).apply()
    }

    private fun pending(context: Context, key: String, flags: Int, title: String = "", location: String = "", minutes: Int = 0): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).putExtra("key", key).putExtra("title", title).putExtra("location", location).putExtra("minutes", minutes)
        return PendingIntent.getBroadcast(context, key.hashCode(), intent, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun alarmKey(id: String, minutes: Int) = "$id|$minutes"
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        AlarmScheduler.createChannel(context)
        val key = intent.getStringExtra("key") ?: return
        val title = intent.getStringExtra("title") ?: "가족 일정"
        val minutes = intent.getIntExtra("minutes", 0)
        val location = intent.getStringExtra("location").orEmpty()
        val open = PendingIntent.getActivity(context, key.hashCode(), Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val body = buildString { append("${minutes}분 후 일정이 시작됩니다."); if (location.isNotBlank()) append("  장소: $location") }
        val notification = NotificationCompat.Builder(context, AlarmScheduler.CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("📅 $title").setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true).setContentIntent(open).setVibrate(longArrayOf(0, 250, 120, 250)).build()
        runCatching { NotificationManagerCompat.from(context).notify(key.hashCode(), notification) }
        context.getSharedPreferences("scheduled_family_alarms", Context.MODE_PRIVATE).edit().remove(key).apply()
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { AlarmScheduler.restore(context) }
}
