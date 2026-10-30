import test from 'node:test';
import assert from 'node:assert/strict';
import { sameRegistration, uniqueRegistrations, registrationSummary } from '../src/registration.ts';
const event = (overrides = {}) => ({ id: 'new', title: '수영', start: '2026-11-11T18:00', kind: 'event', memberIds: ['son'], ...overrides });
const homework = (overrides = {}) => event({ title: '📝 엘리하이(영어)', kind: 'homework', homeworkId: 'eli-english', allDay: true, ...overrides });
const hundred = (factory) => Array.from({ length: 100 }, (_, i) => factory({ id: `new-${i}`, start: new Date(Date.UTC(2026, 10, 4 + i * 7, 18)).toISOString().slice(0, 16) }));
for (const [name, factory] of [['일정', event], ['숙제', homework]]) {
  test(`${name}: inspect all 100 dates, skip two including distant future`, () => {
    const rows = hundred(factory);
    const existing = [rows[2], rows[98]].map((r, i) => ({ ...r, id: `old-${i}` }));
    const snapshot = JSON.stringify(existing);
    const saved = uniqueRegistrations(rows, existing);
    assert.equal(saved.length, 98);
    assert.ok(!saved.includes(rows[2]) && !saved.includes(rows[98]));
    assert.equal(JSON.stringify(existing), snapshot);
    assert.equal(registrationSummary(rows.length, saved.length), '100건 중 2건은 중복으로 제외하고 98건 등록했습니다.');
    assert.equal(uniqueRegistrations(rows, []).length, 100);
    assert.equal(uniqueRegistrations(rows, rows).length, 0);
  });
}
test('times, family, kinds and all-day semantics', () => {
  assert.ok(sameRegistration(event(), event({ start: '2026-11-11T18:00:00' })));
  assert.ok(!sameRegistration(event(), event({ start: '2026-11-11T19:00' })));
  assert.ok(!sameRegistration(event(), event({ memberIds: ['me'] })));
  assert.ok(!sameRegistration(event(), event({ allDay: true })));
  assert.ok(!sameRegistration(event(), event({ title: '축구' })));
  assert.ok(!sameRegistration(event(), event({ kind: 'approval-alert' })));
  assert.ok(sameRegistration(event({ memberIds: ['me', 'son'] }), event({ memberIds: ['son', 'me'] })));
  assert.ok(sameRegistration(event({ allDay: true }), event({ allDay: true, start: '2026-11-11T00:00' })));
});
test('completed and renamed homework; detailed school homework remains distinct', () => {
  assert.ok(sameRegistration(homework(), homework({ title: '✅ 엘리하이(영어)', kind: 'homework-complete' })));
  assert.ok(sameRegistration(homework(), homework({ title: '영어 학습' })));
  assert.ok(!sameRegistration(homework({ homeworkId: 'school-other', title: '학교숙제 · 수학 20쪽' }), homework({ homeworkId: 'school-other', title: '학교숙제 · 과학 조사' })));
});
test('overlapping input dates and concurrent recheck do not insert duplicates', () => {
  const rows = [homework(), homework({ id: 'another' })];
  const preflight = uniqueRegistrations(rows, []);
  assert.equal(preflight.length, 1);
  assert.equal(uniqueRegistrations(preflight, [homework({ id: 'concurrent' })]).length, 0);
});
test('web edit keeps the current event editable without duplicating other events', () => {
  const row = event();
  assert.equal(uniqueRegistrations([row], [row], row.id).length, 1);
  assert.equal(uniqueRegistrations([row], [row, event({ id: 'other' })], row.id).length, 0);
});
