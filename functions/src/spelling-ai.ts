/**
 * Daily, shared Korean spelling quiz.
 *
 * API key is available only to the server through Firebase Secret Manager.
 * The questions use VERIFIED correct/incorrect spelling pairs, while Gemini
 * writes new contextual prompts. If AI is unavailable, curated prompts are
 * stored instead, without affecting the family calendar.
 */
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'

if (!getApps().length) initializeApp()
const db = getFirestore()
const geminiApiKey = defineSecret('GEMINI_API_KEY')
const KST_OFFSET = 9 * 60 * 60 * 1000
const DAY_MS = 86400000
const MODEL = 'gemini-3.5-flash-lite'
const QUESTION_LIMIT = 3
const REMINDER_GAPS = [3, 7, 14]

type MemberId = 'me' | 'wife' | 'son'
type SpellingQuestion = {
  id: string
  grade: number
  kind: 'choice' | 'write'
  prompt: string
  options?: string[]
  answer: string
  explanation: string
}
type SpellingSubmission = { answers?: string[]; score?: number }
type SpellingQuiz = {
  date: string
  grade: number
  source: 'ai' | 'curated'
  questions: SpellingQuestion[]
  submissions: Partial<Record<MemberId, SpellingSubmission>>
}
type VerifiedPair = {
  id: string
  grade: number
  right: string
  wrong: string
  explanation: string
}
const VERIFIED: VerifiedPair[] = [
  { id:'g4-wen',grade:4,right:'웬일',wrong:'왠일',explanation:'뜻밖의 일을 말할 때는 ‘웬일’이에요.' },
  { id:'g4-days',grade:4,right:'며칠',wrong:'몇일',explanation:'날짜 수를 나타내는 말은 ‘며칠’이에요.' },
  { id:'g4-dwae',grade:4,right:'돼',wrong:'되',explanation:'‘돼’는 ‘되어’의 준말이에요. ‘되어’로 바꿀 수 있는 자리에 써요.' },
  { id:'g4-ricecake',grade:4,right:'떡볶이',wrong:'떡복이',explanation:'음식 이름은 ‘떡볶이’가 표준어예요.' },
  { id:'g4-pillow',grade:4,right:'베개',wrong:'배게',explanation:'머리를 받치는 물건은 ‘베개’라고 써요.' },
  { id:'g4-dishes',grade:4,right:'설거지',wrong:'설겆이',explanation:'‘설거지’가 표준어예요.' },
  { id:'g4-longtime',grade:4,right:'오랜만에',wrong:'오랫만에',explanation:'‘오랜만’은 ‘오래간만’이 줄어든 말이에요.' },
  { id:'g4-quick',grade:4,right:'금세',wrong:'금새',explanation:'‘금세’는 ‘금시에’가 줄어든 말이에요.' },
  { id:'g4-wow',grade:4,right:'어이없다',wrong:'어의없다',explanation:'황당할 때는 ‘어이없다’라고 써요.' },
  { id:'g4-low',grade:4,right:'낫다',wrong:'낮다',explanation:'병이 좋아지는 것은 ‘낫다’예요.' },
  { id:'g4-score',grade:4,right:'낮다',wrong:'낫다',explanation:'점수가 높지 않다는 뜻은 ‘낮다’예요.' },
  { id:'g4-together',grade:4,right:'함께',wrong:'함깨',explanation:'다 같이 한다는 뜻의 말은 ‘함께’예요.' },
  { id:'g4-not',grade:4,right:'안',wrong:'않',explanation:'‘안’은 부정을 나타내는 부사예요.' },
  { id:'g5-telephone',grade:5,right:'할게',wrong:'할께',explanation:'약속을 나타내는 어미는 ‘-ㄹ게’예요.' },
  { id:'g5-visit',grade:5,right:'뵙겠습니다',wrong:'봽겠습니다',explanation:'‘뵙다’를 활용하면 ‘뵙겠습니다’예요.' },
  { id:'g5-sudden',grade:5,right:'문득',wrong:'문뜩',explanation:'갑자기 떠올랐다는 뜻의 말은 ‘문득’이에요.' },
  { id:'g5-clean',grade:5,right:'깨끗이',wrong:'깨끗히',explanation:'‘깨끗이’가 올바른 표기예요.' },
  { id:'g5-point',grade:5,right:'가리켰다',wrong:'가르켰다',explanation:'방향이나 대상을 짚어 보이는 것은 ‘가리키다’예요.' },
  { id:'g5-teach',grade:5,right:'가르쳤다',wrong:'가르쳣다',explanation:'방법이나 지식을 알려 주는 것은 ‘가르치다’예요.' },
  { id:'g5-hit',grade:5,right:'부딪쳐',wrong:'부딫쳐',explanation:'‘부딪치다’를 활용하면 ‘부딪쳐’예요.' },
  { id:'g5-forget',grade:5,right:'잊어버려서',wrong:'잊어버려써',explanation:'‘잊어버리다’는 기억을 못 한다는 뜻이에요.' },
  { id:'g6-middle',grade:6,right:'안팎',wrong:'않팎',explanation:'안과 밖을 함께 이르는 말은 ‘안팎’이에요.' },
  { id:'g6-reward',grade:6,right:'대가',wrong:'댓가',explanation:'노력이나 행동의 보답은 ‘대가’예요.' },
  { id:'g6-think',grade:6,right:'곰곰이',wrong:'곰곰히',explanation:'깊이 생각할 때는 ‘곰곰이’라고 써요.' },
  { id:'g6-eye',grade:6,right:'눈곱',wrong:'눈꼽',explanation:'‘눈곱’이 표준어예요.' },
  { id:'g6-risk',grade:6,right:'무릅쓰고',wrong:'무릎쓰고',explanation:'어려움을 감수한다는 말은 ‘무릅쓰다’예요.' },
  { id:'g6-future',grade:6,right:'훗날',wrong:'후날',explanation:'먼 미래를 말할 때는 ‘훗날’이에요.' },
  { id:'g6-late',grade:6,right:'뒤처지지',wrong:'뒤쳐지지',explanation:'늦어지는 것은 ‘뒤처지다’예요.' },
  { id:'g6-wash',grade:6,right:'닦달했다',wrong:'닥달했다',explanation:'‘닦달하다’가 올바른 표기예요.' },
]
const dateKey = (value: Date) => new Date(value.getTime() + KST_OFFSET).toISOString().slice(0,10)
const shiftDay = (day:string, days:number) => new Date(Date.parse(day + 'T12:00:00Z') + days * DAY_MS).toISOString().slice(0,10)
const gradeOn = (day:string) => {
  const y=Number(day.slice(0,4)), m=Number(day.slice(5,7))
  return Math.min(6,Math.max(1,4+(y-2026)-(m<3?1:0)))
}
const canonical = (s:string) => s.normalize('NFC').replace(/[\s.,!?'"‘’“”]/g,'').toLocaleLowerCase('ko-KR')
const stableHash = (s:string) => {
  let h=2166136261
  for (const c of s) h=Math.imul(h ^ c.charCodeAt(0),16777619)
  return h>>>0
}
const eligible = (grade:number) => {
  if (grade < 5) return VERIFIED.filter(x=>x.grade===4)
  if (grade === 5) return VERIFIED.filter(x=>x.grade===4||x.grade===5)
  return VERIFIED
}
const CONTEXT_BY_ANSWER: Record<string,string> = {
  '웬일':'네가 먼저 숙제를 하다니, 이게 무슨 (____)이야?',
  '며칠':'우리는 여행을 (____) 동안 다녀올까?',
  '돼':'숙제를 다 했으니 이제 놀아도 (____).',
  '안':'오늘은 몸이 아파서 학교에 (____) 가.',
  '낫다':'동생은 어제까지 아팠지만 이제 감기가 (____).',
  '낮다':'나는 너보다 시험 점수가 (____).',
  '떡볶이':'나는 매콤한 (____)를 먹는 것을 좋아한다.',
  '베개':'잠잘 때 머리 아래에 (____)를 놓았다.',
  '설거지':'저녁을 먹고 나서 내가 (____)를 했다.',
  '오랜만에':'전학 간 친구를 (____) 만났다.',
  '금세':'달리기를 시작하자마자 (____) 결승선에 도착했다.',
  '어이없다':'그런 이유로 화를 내다니 정말 (____).',
  '함께':'우리 가족은 주말마다 (____) 산책한다.',
  '할게':'내가 내일 꼭 전화(____).',
  '뵙겠습니다':'선생님, 내일 다시 (____).',
  '문득':'길을 걷다가 (____) 친구가 생각났다.',
  '깨끗이':'나는 책상을 걸레로 (____) 닦았다.',
  '가리켰다':'선생님은 손가락으로 칠판을 (____).',
  '가르쳤다':'선생님은 우리에게 수학을 (____).',
  '부딪쳐':'공에 머리를 (____) 다쳤다.',
  '잊어버려서':'친구와의 약속을 (____) 미안했다.',
  '안팎':'우리 가족은 집 (____)을 청소했다.',
  '대가':'열심히 일한 (____)를 받았다.',
  '곰곰이':'나는 어려운 문제를 (____) 생각했다.',
  '눈곱':'아침에 일어나니 눈에 (____)이 끼었다.',
  '무릅쓰고':'소방관은 위험을 (____) 사람들을 구했다.',
  '훗날':'나는 (____) 훌륭한 의사가 되고 싶다.',
  '뒤처지지':'친구들보다 (____) 않으려고 노력했다.',
  '닦달했다':'엄마는 숙제를 하지 않은 동생을 (____).',
}
const fallbackPrompt = (pair:VerifiedPair, _kind:'choice'|'write') =>
  CONTEXT_BY_ANSWER[pair.right] ?? '문장을 읽고 (____)에 알맞은 말을 고르세요.'

const build = (pair:VerifiedPair, grade:number, kind:'choice'|'write',
               prompt?:string, explanation?:string):SpellingQuestion => {
  const options = kind === 'choice' ? (
    stableHash(pair.id + ':' + grade) % 2
      ? [pair.wrong, pair.right] : [pair.right,pair.wrong]
  ) : undefined
  return {
    id: pair.id + ':' + kind,
    grade, kind,
    prompt: prompt || fallbackPrompt(pair,kind),
    ...(options ? {options} : {}),
    answer:pair.right,
    explanation:pair.explanation,
  }
}

/**
 * Generates TOMORROW's quiz at 23:50 Korea time, so it is ready by midnight.
 * This avoids the client-created fallback taking precedence before an
 * after-midnight AI task would run.
 */
export const generateDailySpellingQuiz = onSchedule({
  schedule:'50 23 * * *',
  timeZone:'Asia/Seoul',
  region:'asia-northeast3',
  secrets:[geminiApiKey],
  timeoutSeconds:120,
  retryCount:0,
  memory:'256MiB',
}, async () => {
  const tomorrow=shiftDay(dateKey(new Date()),1)
  const ref=db.collection('scheduleDays').doc(tomorrow)
  if ((await ref.get()).get('spellingQuiz')) return
  const grade=gradeOn(tomorrow)
  const historySnap=await db.collection('scheduleDays')
    .where('date','>=',shiftDay(tomorrow,-28))
    .where('date','<',tomorrow).get()
  const history=historySnap.docs.map(d=>d.get('spellingQuiz') as SpellingQuiz|undefined)
    .filter((q):q is SpellingQuiz=>!!q)
    .sort((a,b)=>a.date.localeCompare(b.date))
  const used=new Set(history.flatMap(q=>q.questions.map(x=>x.id.split(':')[0])))
  const pastPrompts=history.flatMap(q=>q.questions.map(x=>x.prompt))
  const sorted=eligible(grade).sort((a,b)=>stableHash(tomorrow+a.id)-stableHash(tomorrow+b.id))
  const fresh=sorted.filter(x=>!used.has(x.id)).concat(sorted.filter(x=>used.has(x.id)))
  let review:SpellingQuestion|undefined
  for (const past of history.slice().reverse()) {
    const gap=Math.round((Date.parse(tomorrow)-Date.parse(past.date))/DAY_MS)
    if (!REMINDER_GAPS.includes(gap)) continue
    review=past.questions.find((question,i)=>
      Object.values(past.submissions||{}).some(s=>
        Array.isArray(s?.answers) && canonical(s.answers[i]||'')!==canonical(question.answer)))
    if (review) break
  }
  // Historical free-text errors are reviewed using selectable spellings.
  if (review?.kind === 'write' || (review && (!review.options || review.options.length !== 2))) {
    const pair=VERIFIED.find(x=>x.right===review?.answer || review?.id.startsWith(x.id+':'))
    review=pair ? {
      ...review, kind:'choice',
      prompt: CONTEXT_BY_ANSWER[review.answer] ?? review.prompt,
      options:stableHash(tomorrow+review.id)%2 ? [pair.right,pair.wrong] : [pair.wrong,pair.right],
    } : undefined
  }
  if (review && CONTEXT_BY_ANSWER[review.answer]) {
    review={...review,prompt:CONTEXT_BY_ANSWER[review.answer]}
  }
  const wanted=review?2:QUESTION_LIMIT
  const selections=fresh.slice(0,wanted)
  const tasks=selections.map((item)=>({
    id:item.id, right:item.right, wrong:item.wrong,
    kind:'choice' as const,
    example: CONTEXT_BY_ANSWER[item.right],
    explanation:item.explanation,
  }))
  let generated:SpellingQuestion[]=[]
  let source:'ai'|'curated'='curated'
  const key=geminiApiKey.value()
  if (key) {
    try {
      const response=await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/'+MODEL+':generateContent',{
          method:'POST',
          headers:{'Content-Type':'application/json','x-goog-api-key':key},
          body:JSON.stringify({
            systemInstruction:{parts:[{text:
              '당신은 한국 초등학교 국어 맞춤법 교사입니다. 주어진 정답/오답 단어쌍을 절대 바꾸지 말고 문제의 문맥만 자연스럽게 만드세요. '+
              '반드시 각 항목에 정확한 id, prompt를 넣으세요. '+
              '모든 문제는 객관식 2지선다입니다. 예시 문장의 의미·정답·문법을 보존하고 문장 표현만 자연스럽게 바꾸세요. '+
              '반드시 한 개의 (____) 빈칸을 포함한 완전한 문장을 쓰고, 정답 단어를 문장에 노출하지 마세요. '+
              '다른 의미도 되는 모호한 문맥을 만들지 마세요. '+
              '설명은 넣지 말고 JSON 객체 {"questions":[{"id":"...","prompt":"..."}]}만 출력하세요.'
            }]},
            contents:[{role:'user',parts:[{text:
              '초등 '+grade+'학년 대상. 문제 '+wanted+'개. 아래의 verified pairs마다 prompt만 생성하세요. '+
              '최근 문장과 겹치지 않게 하세요.\n문제: '+JSON.stringify(tasks)+
              '\n최근 문장: '+JSON.stringify(pastPrompts.slice(-35))
            }]}],
            generationConfig:{responseMimeType:'application/json',temperature:0.5,maxOutputTokens:1400}
          }),
          signal:AbortSignal.timeout(45000),
        }
      )
      if (!response.ok) throw new Error('Gemini HTTP '+response.status)
      const reply=await response.json() as {
        candidates?:{content?:{parts?:{text?:string}[]}}[]
      }
      const responseText=reply.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'{}'
      const obj=JSON.parse(responseText) as {questions?:{id?:string;prompt?:string}[]}
      if (!Array.isArray(obj.questions)||obj.questions.length!==tasks.length) throw new Error('Malformed quiz count')
      const constructed=tasks.map((task,i)=>{
        const item=obj.questions?.find(q=>q.id===task.id)
        const prompt=item?.prompt?.trim()||''
        if (!prompt || prompt.length>200 || pastPrompts.includes(prompt) || 
            !/\(\s*_{3,}\s*\)/.test(prompt) || 
            prompt.includes(task.right) || prompt.includes(task.wrong) ||
            prompt.replace(/\(\s*_{3,}\s*\)/g,'').trim().length<14) {
          throw new Error('Ambiguous or non-contextual Gemini prompt')
        }
        const answerSource=selections[i]
        return build(answerSource,grade,'choice',prompt)
      })
      generated=constructed
      source='ai'
    } catch (e) {
      logger.warn('Gemini daily spelling unavailable; using verified prompts',{
        date:tomorrow,error:e instanceof Error ? e.message : 'unknown error',
      })
    }
  } else {
    logger.warn('GEMINI_API_KEY empty; using verified spelling prompts')
  }
  if (!generated.length) generated=tasks.map((_,i)=>build(selections[i],grade,'choice'))
  const questions=review?[...generated,review]:generated
  if (questions.length!==QUESTION_LIMIT) throw new Error('Expected exactly 3 spelling questions')
  await db.runTransaction(async tx=>{
    const current=await tx.get(ref)
    if (current.get('spellingQuiz')) return
    tx.set(ref,{
      date:tomorrow,
      spellingQuiz:{date:tomorrow,grade,source,questions,submissions:{}},
    },{merge:true})
  })
  logger.info('Daily spelling quiz stored',{
    date:tomorrow,grade,source,review:!!review,
  })
})
