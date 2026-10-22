// AI generator module kept separate until the Secret Manager API and
// OPENAI_API_KEY are configured. The active Functions index must NOT import
// this module before the secret exists.
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'

if (!getApps().length) initializeApp()
const db = getFirestore()
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
function kstDateKey(date: Date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

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
