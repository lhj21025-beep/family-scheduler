import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { defineSecret } from 'firebase-functions/params'

initializeApp()

const db = getFirestore()
const FAMILY_ID = 'family-main'
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

type MemberId = 'me' | 'wife' | 'son'
type Alarm = 5 | 10 | 30 | 60
type EventItem = {
  id: string
  title: string
  start: string
  end?: string
  memberIds: MemberId[]
  kind?: 'event' | 'homework' | 'homework-complete'
  location?: string
  alarmMinutes?: Alarm[]
  completed?: boolean
  completedAt?: string
  completedBy?: MemberId
}
type PushToken = { token: string; memberId: MemberId; updatedAt?: string }

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
      homeworkAllCompleteNotifiedAt?: string
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
        const key = sentKey(event.id, alarmMinutes)
        if (sentAlarms[key]) continue

        const recipients = pushTokens.filter(t => event.memberIds.includes(t.memberId))
        for (const recipient of recipients) {
          messages.push({
            token: recipient.token,
            title: `📅 ${event.title}`,
            body: `${alarmMinutes}분 후 일정이 시작됩니다.${event.location ? ` 장소: ${event.location}` : ''}`,
            key,
          })
        }
      }
    }

    const homeworks = events.filter(
      event => event.kind === 'homework' && event.memberIds?.includes('son'),
    )
    const allHomeworkCompleted =
      homeworks.length > 0 && homeworks.every(homework => homework.completed && homework.completedAt)
    const latestHomework = allHomeworkCompleted
      ? [...homeworks].sort((a, b) => completionEpoch(b.completedAt) - completionEpoch(a.completedAt))[0]
      : undefined
    const shouldSendHomeworkComplete =
      allHomeworkCompleted &&
      !day.homeworkAllCompleteNotifiedAt &&
      latestHomework?.completedBy === 'son' &&
      completionKstDate(latestHomework.completedAt) === today

    if (shouldSendHomeworkComplete) {
      const parentTokens = pushTokens.filter(token => token.memberId === 'me' || token.memberId === 'wife')
      if (parentTokens.length) {
        const homeworkLines = [...homeworks]
          .sort((a, b) => completionEpoch(a.completedAt) - completionEpoch(b.completedAt))
          .map(homework => `${cleanHomeworkTitle(homework.title)} · ${completionKstTime(homework.completedAt)} 완료`)
        const body = `오늘 숙제를 모두 완료했어요.\n${homeworkLines.join('\n')}`
        for (const recipient of parentTokens) {
          messages.push({
            token: recipient.token,
            title: '✅ 강천이 오늘 숙제를 모두 완료했어요',
            body,
            key: 'homework_all_complete',
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

    if (shouldSendHomeworkComplete) {
      const homeworkPushes = pending
        .map((message, index) => ({ message, response: response.responses[index] }))
        .filter(item => item.message.key === 'homework_all_complete')
      if (homeworkPushes.some(item => item.response?.success)) {
        updates.homeworkAllCompleteNotifiedAt = now.toISOString()
      }
    }

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
    if (
      latestHomework?.completedBy !== 'son' ||
      completionKstDate(latestHomework.completedAt) !== today
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

// Optional AI generator for spelling quizzes. Configure the OPENAI_API_KEY
// Firebase Functions secret before deploying this schedule. Without the
// generator, web and Android clients can create the vetted fallback quiz.
const spellingAiKey = defineSecret('OPENAI_API_KEY')

type GeneratedSpellingQuestion = {
  id: string
  grade: number
  kind: 'choice' | 'write'
  prompt: string
  options?: string[]
  answer: string
  explanation: string
}

function gradeForSpelling(day: string) {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  return Math.min(6, Math.max(1, 4 + year - 2026 - (month < 3 ? 1 : 0)))
}

function normalizeSpellingAnswer(value: string) {
  return value.normalize('NFC').replace(/[\s.,!?'"‘’“”]/g, '').toLocaleLowerCase('ko-KR')
}

// Called daily at 00:10 KST. Does not overwrite a quiz another device has
// already created. A single common set of questions is shared with all users.
export const generateDailySpellingQuiz = onSchedule(
  {
    schedule: '10 0 * * *',
    timeZone: 'Asia/Seoul',
    region: 'asia-northeast3',
    secrets: [spellingAiKey],
    retryCount: 0,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const today = kstDateKey(new Date())
    const ref = db.collection('scheduleDays').doc(today)
    if ((await ref.get()).get('spellingQuiz')) return

    const key = spellingAiKey.value()
    if (!key) {
      logger.warn('OPENAI_API_KEY is not configured; client-side curated quiz remains available')
      return
    }

    try {
      const start = new Date(today + 'T12:00:00Z')
      start.setUTCDate(start.getUTCDate() - 14)
      const old = await db.collection('scheduleDays')
        .where('date', '>=', start.toISOString().slice(0, 10))
        .where('date', '<', today).get()

      let repeatQuestion: GeneratedSpellingQuestion | undefined
      for (const snap of old.docs.slice().reverse()) {
        const date = snap.id
        const gap = Math.round((Date.parse(today) - Date.parse(date)) / 86400000)
        if (![3, 7, 14].includes(gap)) continue
        const prev = snap.get('spellingQuiz') as {
          questions?: GeneratedSpellingQuestion[]
          submissions?: Record<string, { answers?: string[] }>
        } | undefined
        if (!prev?.questions) continue
        const failed = prev.questions.find((q, i) =>
          Object.values(prev.submissions ?? {}).some(a =>
            normalizeSpellingAnswer(a.answers?.[i] ?? '') !== normalizeSpellingAnswer(q.answer)
          )
        )
        if (failed) { repeatQuestion = failed; break }
      }

      const grade = gradeForSpelling(today)
      const questionCount = repeatQuestion ? 2 : 3
      const pastPrompts = old.docs.flatMap(snap =>
        ((snap.get('spellingQuiz') as { questions?: GeneratedSpellingQuestion[] } | undefined)?.questions ?? [])
          .map(q => q.prompt)
      )
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_SPELLING_MODEL || 'gpt-4o-mini',
          temperature: 0.3,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                '당신은 초등학교 국어 맞춤법 교사입니다.',
                '학생의 학년에 맞는 신뢰할 수 있는 표준 맞춤법 문제만 내세요.',
                '단 하나의 명확한 정답만 있어야 합니다. 띄어쓰기나 방언, 문맥이 모호한 문항을 피하세요.',
                'JSON 객체 {"questions":[{"kind":"choice"|"write","prompt":"...","options":["정답","오답"],"answer":"...","explanation":"..."}]}만 출력하세요.',
                'choice는 정확히 2개의 보기와 그중 하나의 정답을, write는 보기 없이 단어 하나를 정답으로 쓰세요.',
                '문제마다 정답 근거를 1~2문장으로 친절하게 설명하세요.',
              ].join(' '),
            },
            {
              role: 'user',
              content: '오늘은 ' + today + '이고 학년은 초등 ' + grade +
                '학년입니다. ' + questionCount + '문제를 출제하세요. 객관식과 직접 쓰기를 섞어 주세요. ' +
                '최근 사용한 문제 문장은 재사용하지 마세요: ' +
                JSON.stringify(pastPrompts.slice(-30)),
            },
          ],
        }),
        signal: AbortSignal.timeout(40000),
      })
      if (!response.ok) throw new Error('OpenAI request failed (' + response.status + ')')
      const data = await response.json() as {
        choices?: { message?: { content?: string } }[]
      }
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as {
        questions?: Partial<GeneratedSpellingQuestion>[]
      }
      if (!Array.isArray(parsed.questions) || parsed.questions.length !== questionCount)
        throw new Error('AI question count was invalid')

      const generated = parsed.questions.map((q, i): GeneratedSpellingQuestion => {
        const kind = q.kind
        const prompt = q.prompt?.trim() ?? ''
        const answer = q.answer?.trim() ?? ''
        const explanation = q.explanation?.trim() ?? ''
        const options = kind === 'choice' ? q.options : undefined
        if (!['choice', 'write'].includes(kind ?? '') || !prompt || !answer || !explanation ||
            prompt.length > 250 || answer.length > 50 || explanation.length > 350)
          throw new Error('Invalid AI question structure')
        if (kind === 'choice' &&
            (!Array.isArray(options) || options.length !== 2 ||
            new Set(options).size !== 2 || !options.includes(answer))) {
          throw new Error('Invalid choice answers')
        }
        return {
          id: 'ai-' + today + '-' + (i + 1), grade, kind: kind as 'choice' | 'write',
          prompt, answer, explanation,
          ...(kind === 'choice' ? { options } : {}),
        }
      })
      const questions = repeatQuestion ? [...generated, repeatQuestion] : generated
      // First writer wins, even when a parent opens the app during AI generation.
      await db.runTransaction(async tx => {
        const existing = await tx.get(ref)
        if (existing.get('spellingQuiz')) return
        tx.set(ref, {
          date: today,
          spellingQuiz: { date: today, grade, source: 'ai', questions, submissions: {} },
        }, { merge: true })
      })
      logger.info('Spelling quiz prepared', { date: today, grade, count: questions.length })
    } catch (error) {
      logger.error('AI spelling generation failed; curated quiz fallback stays enabled', error)
    }
  },
)
