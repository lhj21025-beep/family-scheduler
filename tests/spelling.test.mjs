import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp = mkdtempSync(join(tmpdir(), 'spelling-'));
writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
for (const name of ['spellingBank', 'spellingSelection', 'spellingQuiz']) {
  const source = readFileSync(new URL('../src/' + name + '.ts', import.meta.url), 'utf8');
  writeFileSync(join(temp, name + '.ts'), source.replace(/from (['"])(\.\/spelling\w+)\1/g, 'from $1$2.ts$1'));
}
const { selectSpellingQuestions, contentKeys, needsQuizUpgrade, detailedExplanation } = await import(pathToFileURL(join(temp, 'spellingSelection.ts')));
const { spellingBank, fallbackQuiz, isCorrect } = await import(pathToFileURL(join(temp, 'spellingQuiz.ts')));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
test('128 distinct reviewed sentences, choices and complete explanations', () => {
  assert.equal(spellingBank.length, 128);
  for (const field of ['id', 'prompt', 'answer']) assert.equal(new Set(spellingBank.map(q => q[field])).size, 128);
  for (const q of spellingBank) {
    assert.equal(q.options.length, 2); assert.notEqual(...q.options);
    assert.ok(q.options.includes(q.answer)); assert.equal(q.prompt.split('(____)').length, 2);
    assert.ok(q.explanation.length > 100); assert.ok(q.explanation.includes('완성 문장:'));
    assert.ok(!isCorrect(q.options.find(o => o !== q.answer), q.answer));
  }
});
test('365 consecutive quizzes never repeat content within a day or the last 30 days', () => {
  const history = [];
  for (let n = 0; n < 365; n++) {
    const date = new Date(Date.UTC(2026, 10, 2 + n)).toISOString().slice(0, 10);
    const quiz = fallbackQuiz(date, history);
    assert.equal(quiz.questions.length, 3);
    const recent = new Set(history.slice(-30).flatMap(h => h.questions.flatMap(contentKeys)));
    const daily = new Set();
    for (const q of quiz.questions) for (const k of contentKeys(q)) {
      assert.ok(!recent.has(k), date + ' recent ' + k); assert.ok(!daily.has(k), date + ' daily ' + k); daily.add(k);
    }
    history.push(quiz);
  }
});
test('legacy native/web/AI IDs, reversed choices and writing questions count as the same topic', () => {
  const originals = selectSpellingQuestions('2026-11-02', []);
  const variants = originals.map((q, i) => ({ ...q, id: 'legacy-' + i, kind: 'write', options: undefined, prompt: '바로 쓰세요 ' + i }));
  const picked = selectSpellingQuestions('2026-11-03', [{ date: '2026-11-02', questions: variants }]);
  const old = new Set(originals.flatMap(contentKeys));
  assert.ok(picked.every(q => contentKeys(q).every(k => !old.has(k))));
  assert.ok(contentKeys({ ...originals[0], answer: '낫다', options: ['낫다', '낮다'] }).includes('topic:bank2-005'));
});
test('selection deterministic across clients and no injected review repeats', () => {
  const actual = selectSpellingQuestions('2026-11-02', []).map(q => q.id);
  assert.deepEqual(actual, ['bank2-110', 'bank2-095', 'bank2-111']);
  assert.deepEqual(selectSpellingQuestions('2026-11-02', []).map(q => q.id), actual);
});
test('preserve all family submissions when upgrading, including a zero score', () => {
  assert.ok(needsQuizUpgrade(undefined)); assert.ok(needsQuizUpgrade({ submissions: {} }));
  assert.ok(!needsQuizUpgrade({ submissions: { son: { score: 0 } } }));
  assert.ok(!needsQuizUpgrade({ bankVersion: 2, submissions: {} }));
});
test('grading preserves meaningful spacing, explanations shown for either result', () => {
  assert.ok(isCorrect(' 할 수 ', '할 수')); assert.ok(!isCorrect('할수', '할 수'));
  assert.ok(isCorrect('돼.', '돼'));
  const q = spellingBank[0]; assert.equal(detailedExplanation({ ...q, explanation: '짧은 예전 설명' }), q.explanation);
});
