import rawBank from './english-bank.json';
import type { QuizHistory, QuizQuestion } from './spellingSelection.js';

export const ENGLISH_BANK_VERSION = 1;
const bank: QuizQuestion[] = rawBank.map(q => ({ ...q, grade: 4, kind: 'choice' }));
const hash = (value: string): number => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
};
export function selectEnglishQuestions(date: string, history: QuizHistory[]): QuizQuestion[] {
  const recent = new Set(history.filter(item => item.date < date && Date.parse(date) - Date.parse(item.date) <= 30 * 86400000)
    .flatMap(item => item.questions.map(question => question.id)));
  const ordered = bank.slice().sort((a, b) => hash(a.id) - hash(b.id));
  const offset = ((Math.floor(Date.parse(date) / 86400000) * 3) % ordered.length + ordered.length) % ordered.length;
  const selected = [...ordered.slice(offset), ...ordered.slice(0, offset)].filter(q => !recent.has(q.id)).slice(0, 3);
  if (selected.length !== 3) throw new Error('새 영어 문제를 충분히 찾지 못했습니다.');
  return selected.map(q => ({ ...q, options: hash(date + q.id + 'options') % 2 === 0 ? q.options?.slice().reverse() : q.options?.slice() }));
}
export const needsEnglishQuiz = (quiz?: { bankVersion?: number; submissions?: object } | null): boolean =>
  !quiz || ((quiz.bankVersion ?? 0) < ENGLISH_BANK_VERSION && Object.keys(quiz.submissions ?? {}).length === 0);
