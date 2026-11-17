import rawBank from "../shared/english-bank.json";
import type { DailySpellingQuiz, SpellingQuestion } from "./spellingQuiz";
import { spellingGrade } from "./spellingQuiz";

export const ENGLISH_BANK_VERSION = 1;
export const ENGLISH_START_DAY = "2026-11-17";
export const englishBank = rawBank.map(q => ({ ...q, grade: 4, kind: "choice" as const })) as SpellingQuestion[];

const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
};

export function selectEnglishQuestions(date: string, history: DailySpellingQuiz[]): SpellingQuestion[] {
  const recentIds = new Set(
    history
      .filter(item => item.date < date && Date.parse(date) - Date.parse(item.date) <= 30 * 86400000)
      .flatMap(item => item.questions.map(question => question.id)),
  );
  const ordered = englishBank.slice().sort((a, b) => stableHash(a.id) - stableHash(b.id));
  const offset = ((Math.floor(Date.parse(date) / 86400000) * 3) % ordered.length + ordered.length) % ordered.length;
  const rotated = [...ordered.slice(offset), ...ordered.slice(0, offset)];
  const selected = rotated.filter(question => !recentIds.has(question.id)).slice(0, 3);
  if (selected.length !== 3) throw new Error("새 영어 문제를 충분히 찾지 못했습니다.");
  return selected.map(question => ({
    ...question,
    options: stableHash(date + question.id + "options") % 2 === 0
      ? [...(question.options ?? [])].reverse()
      : [...(question.options ?? [])],
  }));
}

export const fallbackEnglishQuiz = (date: string, history: DailySpellingQuiz[]): DailySpellingQuiz => ({
  date,
  grade: spellingGrade(date),
  bankVersion: ENGLISH_BANK_VERSION,
  source: "curated",
  questions: selectEnglishQuestions(date, history),
  submissions: {},
});

export const needsEnglishQuiz = (quiz?: DailySpellingQuiz | null): boolean =>
  !quiz || ((quiz.bankVersion ?? 0) < ENGLISH_BANK_VERSION && Object.keys(quiz.submissions ?? {}).length === 0);

