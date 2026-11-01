// Pure selection policy, shared verbatim with the scheduled generator.
import { expandedSpellingBank } from './spellingBank';
export const SPELLING_BANK_VERSION = 2;
export type QuizQuestion = { id: string; grade: number; kind: string; prompt: string; options?: string[]; answer: string; explanation: string };
export type QuizHistory = { date: string; questions: QuizQuestion[] };
const key = (s: string) => s.normalize('NFC').replace(/[\s.,!?'"‘’“”()_]/g, '').toLowerCase();
const aliases: Record<string, string> = {
  '어이없다': '어이없는', '갈게': '할게', '가리켰다': '가르쳤다',
  '잊어버려서': '잃어버려', '잊어버려': '잃어버려', '낫다': '낮다',
};
export const contentKeys = (q: QuizQuestion): string[] => {
  const words = [q.answer, ...(q.options ?? [])].map(x => key(aliases[x] ?? x));
  const known = expandedSpellingBank.filter(b => b.options.some(o => words.includes(key(o))));
  return [...new Set(['answer:' + key(aliases[q.answer] ?? q.answer), 'prompt:' + key(q.prompt),
    ...known.map(b => 'topic:' + b.id), ...(q.options?.length ? ['pair:' + q.options.map(key).sort().join('|')] : [])])];
};
export const stableHash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
export function selectSpellingQuestions(date: string, history: QuizHistory[]): QuizQuestion[] {
  const recent = history.filter(h => h.date < date && Date.parse(date) - Date.parse(h.date) <= 30 * 86400000);
  const seen = new Set(recent.flatMap(h => h.questions.flatMap(contentKeys)));
  const ordered = expandedSpellingBank.slice().sort((a, b) => stableHash(a.id) - stableHash(b.id));
  const offset = ((Math.floor(Date.parse(date) / 86400000) * 3) % ordered.length + ordered.length) % ordered.length;
  const rotated = [...ordered.slice(offset), ...ordered.slice(0, offset)];
  const selected: QuizQuestion[] = [];
  const chosen = new Set<string>();
  // With 128 topics, three per day leaves ample room for a 30-day exclusion.
  for (const q of rotated) {
    const keys = contentKeys(q);
    if (keys.some(k => seen.has(k) || chosen.has(k))) continue;
    selected.push({ ...q, options: stableHash(date + q.id + 'options') % 2 === 0 ? q.options.slice().reverse() : q.options.slice() });
    keys.forEach(k => chosen.add(k));
    if (selected.length === 3) break;
  }
  if (selected.length !== 3) throw new Error('새 맞춤법 문제를 충분히 찾지 못했습니다. 문제은행을 확인해 주세요.');
  return selected;
}
export const needsQuizUpgrade = (q?: { bankVersion?: number; submissions?: object } | null): boolean =>
  !q || ((q.bankVersion ?? 0) < SPELLING_BANK_VERSION && Object.keys(q.submissions ?? {}).length === 0);
export const detailedExplanation = (q: QuizQuestion): string =>
  expandedSpellingBank.find(b => b.answer === q.answer)?.explanation ?? q.explanation;
