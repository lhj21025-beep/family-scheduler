import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'

initializeApp()

const db = getFirestore()
const FAMILY_ID = 'family-main'
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

type MemberId = 'me' | 'wife' | 'son'
type Alarm = 0 | 5 | 10 | 30 | 60
type EventItem = {
  id: string
  title: string
  start: string
  end?: string
  memberIds: MemberId[]
  kind?: 'event' | 'homework' | 'homework-complete' | 'approval-alert'
  location?: string
  alarmMinutes?: Alarm[]
  completed?: boolean
  completedAt?: string
  completedBy?: MemberId
}
type PushToken = { token: string; memberId: MemberId; platform?: 'web' | 'android'; updatedAt?: string }

type FamilyData = {
  pushTokens?: Record<string, PushToken>
}

function kstMinute(date: Date) {
  const kst = new Date(date.getTime() + KST_OFFSET_MS)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  const h = String(kst.getUTCHours()).padStart(2, '0')
  const min = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

function kstDateKey(date: Date) {
  return kstMinute(date).slice(0, 10)
}

function eventAlarmTarget(start: string, alarmMinutes: number) {
  const y = Number(start.slice(0, 4))
  const m = Number(start.slice(5, 7))
  const d = Number(start.slice(8, 10))
  const h = Number(start.slice(11, 13))
  const min = Number(start.slice(14, 16))
  const eventUtcMs = Date.UTC(y, m - 1, d, h, min) - KST_OFFSET_MS
  return kstMinute(new Date(eventUtcMs - alarmMinutes * 60 * 1000))
}

function sentKey(eventId: string, alarmMinutes: number) {
  return `${eventId}_${alarmMinutes}`.replace(/[^A-Za-z0-9_]/g, '_')
}

function cleanHomeworkTitle(title: string) {
  return title
    .replace(/^(?:(?:📝|✅|☑️|☑|✔️|✔)\s*)+/u, '')
    .replace(/^숙제 완료\s*·\s*/, '')
    .trim()
}

function completionEpoch(value?: string) {
  if (!value) return 0
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  const parsed = Date.parse(zoned ? value : `${value}+09:00`)
  return Number.isFinite(parsed) ? parsed : 0
}

function completionKstDate(value?: string) {
  const epoch = completionEpoch(value)
  return epoch ? kstDateKey(new Date(epoch)) : ''
}

function completionKstTime(value?: string) {
  const epoch = completionEpoch(value)
  return epoch ? kstMinute(new Date(epoch)).slice(11, 16) : '--:--'
}

export const sendScheduleReminders = onSchedule(
  {
    schedule: '* * * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    maxInstances: 1,
    memory: '256MiB',
  },
  async () => {
    const now = new Date()
    const nowMinute = kstMinute(now)
    const today = kstDateKey(now)

    const [daySnap, familySnap] = await Promise.all([
      db.collection('scheduleDays').doc(today).get(),
      db.collection('familyData').doc(FAMILY_ID).get(),
    ])

    if (!daySnap.exists || !familySnap.exists) return

    const day = daySnap.data() as {
      events?: Record<string, EventItem>
      sentAlarms?: Record<string, string>
    }
    const family = familySnap.data() as FamilyData
    const events = Object.values(day.events ?? {})
    const sentAlarms = day.sentAlarms ?? {}
    const pushTokens = Object.values(family.pushTokens ?? {}).filter(x => x?.token && x?.memberId)

    if (!pushTokens.length) return

    const messages: Array<{ token: string; title: string; body: string; key: string }> = []
    for (const event of events) {
      if (event.kind === 'homework-complete' || !event.alarmMinutes?.length || !event.memberIds?.length) continue
      for (const alarmMinutes of event.alarmMinutes) {
        if (eventAlarmTarget(event.start, alarmMinutes) !== nowMinute) continue
        const recipients = pushTokens.filter(t =>
          event.memberIds.includes(t.memberId) &&
          (event.kind === 'approval-alert' || t.platform !== 'android')
        )
        for (const recipient of recipients) {
          const key = `${sentKey(event.id, alarmMinutes)}_${recipient.memberId}`
          if (sentAlarms[key]) continue
          messages.push({
            token: recipient.token,
            title: `📅 ${event.title}`,
            body: `${alarmMinutes}분 후 일정이 시작됩니다.${event.location ? ` 장소: ${event.location}` : ''}`,
            key,
          })
        }
      }
    }

    if (!messages.length) return

    const unique = new Map<string, { token: string; title: string; body: string; key: string }>()
    messages.forEach(m => unique.set(`${m.token}:${m.key}`, m))
    const pending = Array.from(unique.values())

    const response = await getMessaging().sendEach(
      pending.map(m => ({
        token: m.token,
        notification: { title: m.title, body: m.body },
        webpush: {
          fcmOptions: { link: 'https://lhj21025-beep.github.io/family-scheduler/' },
          notification: { icon: 'https://lhj21025-beep.github.io/family-scheduler/favicon.svg' },
        },
      })),
    )

    const updates: Record<string, string> = {}
    pending.forEach((m, index) => {
      if (response.responses[index]?.success) updates[`sentAlarms.${m.key}`] = now.toISOString()
    })

    if (Object.keys(updates).length) {
      await daySnap.ref.update(updates)
    }

    logger.info('Schedule reminders processed', {
      minute: nowMinute,
      messages: pending.length,
      success: response.successCount,
      failure: response.failureCount,
    })
  },
)


export const notifyDailyHomeworkComplete = onDocumentUpdated(
  {
    document: 'scheduleDays/{date}',
    region: 'asia-northeast3',
    memory: '256MiB',
    maxInstances: 2,
  },
  async event => {
    const date = event.params.date
    const beforeData = event.data?.before.data() as {
      events?: Record<string, EventItem>
      homeworkAllCompleteNotifiedAt?: string
    } | undefined
    const afterData = event.data?.after.data() as {
      events?: Record<string, EventItem>
      homeworkAllCompleteNotifiedAt?: string
    } | undefined
    if (!afterData) return

    const today = kstDateKey(new Date())
    if (date !== today || afterData.homeworkAllCompleteNotifiedAt) return

    const beforeHomeworks = Object.values(beforeData?.events ?? {}).filter(
      item => item.kind === 'homework' && item.memberIds?.includes('son'),
    )
    const homeworks = Object.values(afterData.events ?? {}).filter(
      item => item.kind === 'homework' && item.memberIds?.includes('son'),
    )
    if (!homeworks.length) return

    const beforeAllComplete =
      beforeHomeworks.length > 0 &&
      beforeHomeworks.every(item => item.completed && item.completedAt)
    const allComplete =
      homeworks.every(item => item.completed && item.completedAt)

    // Only notify at the moment today's list changes from incomplete to complete.
    if (beforeAllComplete || !allComplete) return

    const latestHomework = [...homeworks]
      .sort((a, b) => completionEpoch(b.completedAt) - completionEpoch(a.completedAt))[0]
    const allCompletedBySon = homeworks.every(item => item.completedBy === 'son')
    if (
      !allCompletedBySon ||
      completionKstDate(latestHomework?.completedAt) !== today
    ) return

    const familySnap = await db.collection('familyData').doc(FAMILY_ID).get()
    const family = familySnap.data() as FamilyData | undefined
    const parentTokens = Object.values(family?.pushTokens ?? {})
      .filter(item => item?.token && (item.memberId === 'me' || item.memberId === 'wife'))
    if (!parentTokens.length) {
      logger.warn('No parent push tokens registered for homework completion notification', { date })
      return
    }

    const homeworkLines = [...homeworks]
      .sort((a, b) => completionEpoch(a.completedAt) - completionEpoch(b.completedAt))
      .map(item => `${cleanHomeworkTitle(item.title)} · ${completionKstTime(item.completedAt)} 완료`)

    const title = '✅ 강천이 오늘 숙제를 모두 완료했어요'
    const body = `오늘 숙제를 모두 완료했어요.\n${homeworkLines.join('\n')}`

    const response = await getMessaging().sendEach(
      parentTokens.map(item => ({
        token: item.token,
        notification: { title, body },
        data: { title, body, type: 'homework_all_complete', date },
        android: {
          priority: 'high' as const,
          notification: { channelId: 'family_schedule_alerts' },
        },
        webpush: {
          fcmOptions: { link: 'https://lhj21025-beep.github.io/family-scheduler/' },
          notification: {
            icon: 'https://lhj21025-beep.github.io/family-scheduler/favicon.svg',
          },
        },
      })),
    )

    if (response.successCount > 0) {
      await event.data?.after.ref.update({
        homeworkAllCompleteNotifiedAt: new Date().toISOString(),
      })
    }

    logger.info('Daily homework completion notification processed', {
      date,
      homeworkCount: homeworks.length,
      recipients: parentTokens.length,
      success: response.successCount,
      failure: response.failureCount,
    })
  },
)


export { generateDailySpellingQuiz } from './spelling-ai.js'
