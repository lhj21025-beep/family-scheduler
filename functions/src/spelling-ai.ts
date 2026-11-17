/** Daily shared quiz. Selection uses the same reviewed content as both clients.
 * Arbitrary AI paraphrases can change which meaning is correct (e.g. 맞히다/맞추다),
 * so the daily exam stores the reviewed sentence and its matching explanation.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { selectSpellingQuestions, SPELLING_BANK_VERSION, needsQuizUpgrade, QuizHistory } from './spellingSelection';
import { ENGLISH_BANK_VERSION, needsEnglishQuiz, selectEnglishQuestions } from './englishSelection.js';
if (!getApps().length) initializeApp();
const db = getFirestore();
export const generateDailySpellingQuiz = onSchedule({
  schedule: '50 23 * * *', timeZone: 'Asia/Seoul', region: 'asia-northeast3',
  timeoutSeconds: 120, retryCount: 0, memory: '256MiB',
}, async () => {
  const date = new Date(Date.now() + 9 * 3600000 + 86400000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(date) - 30 * 86400000).toISOString().slice(0, 10);
  const ref = db.collection('scheduleDays').doc(date);
  const first = await ref.get();
  if (!needsQuizUpgrade(first.get('spellingQuiz')) && !needsEnglishQuiz(first.get('englishQuiz'))) return;
  const snapshots = await db.collection('scheduleDays').where('date', '>=', from).where('date', '<', date).get();
  const history = snapshots.docs.map(d => d.get('spellingQuiz') as QuizHistory | undefined)
    .filter((q): q is QuizHistory => !!q);
  const englishHistory = snapshots.docs.map(d => d.get('englishQuiz') as QuizHistory | undefined)
    .filter((q): q is QuizHistory => !!q);
  const questions = selectSpellingQuestions(date, history);
  const englishQuestions = selectEnglishQuestions(date, englishHistory);
  const grade = Math.max(1, Math.min(6, 4 + Number(date.slice(0, 4)) - 2026 - (Number(date.slice(5, 7)) < 3 ? 1 : 0)));
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const update: Record<string, unknown> = { date };
    if (needsQuizUpgrade(snap.get('spellingQuiz'))) update.spellingQuiz = { date, grade, bankVersion: SPELLING_BANK_VERSION,
      source: 'curated', questions, submissions: {} };
    if (needsEnglishQuiz(snap.get('englishQuiz'))) update.englishQuiz = { date, grade, bankVersion: ENGLISH_BANK_VERSION,
      source: 'curated', questions: englishQuestions, submissions: {} };
    tx.set(ref, update, { merge: true });
  });
});
