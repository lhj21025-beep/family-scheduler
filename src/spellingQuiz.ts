import { expandedSpellingBank } from "./spellingBank";
import { selectSpellingQuestions, SPELLING_BANK_VERSION } from "./spellingSelection";
export { needsQuizUpgrade, detailedExplanation } from "./spellingSelection";
// Shared spelling-quiz model for the family scheduler.
export type SpellingMember = "me" | "wife" | "son";
export type SpellingQuestion = {
  id: string;
  grade: number;
  kind: "choice" | "write";
  prompt: string;
  options?: string[];
  answer: string;
  explanation: string;
};
export type SpellingSubmission = {
  answers: string[];
  score: number;
  submittedAt: string;
};
export type DailySpellingQuiz = {
  bankVersion?: number;
  date: string;
  grade: number;
  source: "curated" | "ai";
  questions: SpellingQuestion[];
  submissions: Partial<Record<SpellingMember, SpellingSubmission>>;
};

export const spellingBank = expandedSpellingBank as SpellingQuestion[];

export const kstDay = (): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const spellingGrade = (day: string): number => {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return Math.max(1, Math.min(6, 4 + year - 2026 - (month < 3 ? 1 : 0)));
};

export const shiftedDay = (day: string, delta: number): string => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export const isCorrect = (answer: string, expected: string): boolean =>
  answer.normalize("NFC").trim().replace(/[.,!?'"‘’“”]/g, "").replace(/\s+/g, " ").toLocaleLowerCase("ko-KR")
  === expected.normalize("NFC").trim().replace(/[.,!?'"‘’“”]/g, "").replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");

const hashCode = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};


// Legacy writing questions are displayed as multiple choice without changing
// the shared stored answer or historical scores.
export const spellingChoices = (question: SpellingQuestion): string[] => {
  if (question.options?.length === 2 && question.options.includes(question.answer))
    return question.options;
  const pair = spellingBank.find(q => q.kind === "choice" &&
    q.answer === question.answer && q.options?.some(v => v !== question.answer));
  const wrongByAnswer: Record<string, string> = {
    "웬일": "왠일", "며칠": "몇일", "돼": "되", "떡볶이": "떡복이",
    "오랜만에": "오랫만에", "베개": "배게", "깨끗이": "깨끗히",
    "문득": "문뜩", "갈게": "갈께", "뵙겠습니다": "봽겠습니다",
    "곰곰이": "곰곰히", "대가": "댓가", "눈곱": "눈꼽",
    "무릅쓰고": "무릎쓰고", "뒤처지지": "뒤쳐지지",
    "부딪쳐": "부딫쳐", "가르쳤다": "가리켰다",
    "할게": "할께", "가리켰다": "가르켰다",
    "어이없다": "어의없다", "낫다": "낮다", "함께": "함깨",
    "안": "않", "금세": "금새", "설거지": "설겆이",
    "안팎": "않팎", "훗날": "후날", "닦달했다": "닥달했다",
    "잊어버려서": "잊어버려써",
  };
  const wrong = pair?.options?.find(v => v !== question.answer) ??
    wrongByAnswer[question.answer];
  if (!wrong) return [];
  return hashCode(question.id) % 2
    ? [question.answer, wrong] : [wrong, question.answer];
};

// Each answer has a reviewed, unambiguous sentence. This also fixes previously
// generated "choose the correct spelling" questions without rewriting scores.
const CONTEXT_BY_ANSWER: Record<string, string> = {
  "웬일": "네가 먼저 숙제를 하다니, 이게 무슨 (____)이야?",
  "며칠": "우리는 여행을 (____) 동안 다녀올까?",
  "돼": "숙제를 다 했으니 이제 놀아도 (____).",
  "안": "오늘은 몸이 아파서 학교에 (____) 가.",
  "낫다": "동생은 어제까지 아팠지만 이제 감기가 (____).",
  "낮다": "나는 너보다 시험 점수가 (____).",
  "어이없는": "아무 말 없이 약속을 취소하다니 정말 (____) 일이야.",
  "어이없다": "그런 이유로 화를 내다니 정말 (____).",
  "금세": "달리기를 시작하자마자 (____) 결승선에 도착했다.",
  "함께": "우리 가족은 주말마다 (____) 산책한다.",
  "떡볶이": "나는 매콤한 (____)를 먹는 것을 좋아한다.",
  "설거지": "저녁을 먹고 나서 내가 (____)를 했다.",
  "베개": "잠잘 때 머리 아래에 (____)를 놓았다.",
  "오랜만에": "전학 간 친구를 (____) 만났다.",
  "어떡해": "숙제를 실수로 지워 버렸어. 이제 (____)?",
  "할게": "내가 내일 꼭 전화(____).",
  "갈게": "내가 내일 꼭 (____).",
  "뵙겠습니다": "선생님, 내일 다시 (____).",
  "부딪쳐": "공에 머리를 (____) 다쳤다.",
  "문득": "길을 걷다가 (____) 친구가 생각났다.",
  "깨끗이": "나는 책상을 걸레로 (____) 닦았다.",
  "가르쳤다": "선생님은 우리에게 수학을 (____).",
  "가리켰다": "선생님은 손가락으로 칠판을 (____).",
  "잃어버려": "열쇠를 (____) 집에 들어가지 못했다.",
  "잊어버려서": "친구와의 약속을 (____) 미안했다.",
  "안팎": "우리 가족은 집 (____)을 청소했다.",
  "대가": "열심히 일한 (____)를 받았다.",
  "곰곰이": "나는 어려운 문제를 (____) 생각했다.",
  "빈틈없이": "경비원은 문단속을 (____) 했다.",
  "닦달했다": "엄마는 숙제를 하지 않은 동생을 (____).",
  "뒤처지지": "친구들보다 (____) 않으려고 노력했다.",
  "훗날": "나는 (____) 훌륭한 의사가 되고 싶다.",
  "눈곱": "아침에 일어나니 눈에 (____)이 끼었다.",
  "무릅쓰고": "소방관은 위험을 (____) 사람들을 구했다.",
  "꼼꼼히": "선생님은 시험지를 (____) 살펴보셨다.",
};

export const spellingChoicePrompt = (question: SpellingQuestion): string => {
  const vetted = CONTEXT_BY_ANSWER[question.answer];
  const prompt = question.prompt || "";
  // Only trust already contextualized, blank-filling questions. Generic AI
  // output and free-text legacy items use the carefully reviewed template.
  const hasContext = /_{3,}/.test(prompt) &&
    !/다음 중|올바른 맞춤법을 고르세요|틀린 낱말을/.test(prompt) &&
    prompt.replace(/_{3,}/g, "").trim().length >= 12;
  return hasContext ? prompt : vetted ?? prompt;
};

export const spellingContextForAnswer = (answer: string): string | undefined =>
  CONTEXT_BY_ANSWER[answer];

export const fallbackQuiz = (date: string, history: DailySpellingQuiz[]): DailySpellingQuiz => ({
  date, grade: spellingGrade(date), bankVersion: SPELLING_BANK_VERSION, source: "curated",
  questions: selectSpellingQuestions(date, history) as SpellingQuestion[], submissions: {},
});
