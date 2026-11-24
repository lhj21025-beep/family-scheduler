import type { DailySpellingQuiz, SpellingMember, SpellingQuestion } from './spellingQuiz';
import { isCorrect, spellingChoicePrompt, detailedExplanation } from './spellingQuiz';

export type LearningDay = { date: string; spellingQuiz?: DailySpellingQuiz; englishQuiz?: DailySpellingQuiz };
export type Subject = 'spelling' | 'english';
export type WrongQuestion = {
  key: string; subject: Subject; question: SpellingQuestion; prompt: string; explanation: string;
  attempts: number; wrong: number; lastWrongDate: string; lastWrongAnswer: string;
};
export function analyzeLearning(days: LearningDay[], member: SpellingMember, subject?: Subject) {
  const groups = new Map<string, WrongQuestion>();
  let answered = 0, correct = 0;
  // One shared daily document is counted only once, regardless of snapshot order.
  for (const day of new Map(days.map(d => [d.date, d])).values()) {
    for (const course of ['spelling', 'english'] as const) {
      if (subject && subject !== course) continue;
      const quiz = course === 'spelling' ? day.spellingQuiz : day.englishQuiz;
      const submission = quiz?.submissions?.[member];
      if (!quiz || !submission) continue;
      quiz.questions.forEach((q, i) => {
        const answer = submission.answers?.[i];
        if (typeof answer !== 'string' || !answer.trim()) return;
        const prompt = course === 'spelling' ? spellingChoicePrompt(q) : q.prompt;
        // IDs and option order may change; distinct sentences with the same answer stay distinct.
        const key = JSON.stringify([course, prompt.normalize('NFC').trim().replace(/\s+/g, ' '), q.answer.normalize('NFC').trim()]);
        const row = groups.get(key) ?? { key, subject: course, question: q, prompt,
          explanation: course === 'spelling' ? detailedExplanation(q) : q.explanation,
          attempts: 0, wrong: 0, lastWrongDate: '', lastWrongAnswer: '' };
        row.attempts++; answered++;
        if (isCorrect(answer, q.answer)) correct++;
        else {
          row.wrong++;
          if (day.date >= row.lastWrongDate) {
            row.lastWrongDate = day.date; row.lastWrongAnswer = answer;
            row.question = q;
          }
        }
        groups.set(key, row);
      });
    }
  }
  return { answered, correct, accuracy: answered ? Math.round(correct / answered * 100) : null,
    wrong: answered - correct,
    questions: [...groups.values()].filter(q => q.wrong > 0).sort((a, b) =>
      b.wrong - a.wrong || b.wrong / b.attempts - a.wrong / a.attempts ||
      b.lastWrongDate.localeCompare(a.lastWrongDate) || a.key.localeCompare(b.key)) };
}
