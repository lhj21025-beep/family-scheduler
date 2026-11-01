# Spelling question bank v2

128 distinct reviewed choice questions with contextual prompts and explanations.
The JSON is the canonical content. Web/server and Android store the same IDs and
use the same FNV-1a ordering, day rotation, and semantic history exclusion.

Selection excludes the previous 30 calendar days. It compares answer, choice
pair, prompt and known topic rather than trusting old web/native/AI IDs. The old
3/7/14-day forced review is removed; past quizzes remain accessible. Submitted
family quizzes and scores are immutable; only untouched legacy quizzes upgrade.

New daily tests use vetted sentences instead of AI paraphrases: changing the
context can change the correct word (for example 맞히다/맞추다). Explanations are
shown after submission for correct and incorrect answers alike.

Reference material consulted for meaning and spacing distinctions:
- https://www.korean.go.kr/front/onlineQna/onlineQnaView.do?mn_id=261&pageIndex=1&qna_seq=314860
- https://www.korean.go.kr/front/onlineQna/onlineQnaView.do?mn_id=216&qna_seq=306497
- https://www.korean.go.kr/front/onlineQna/onlineQnaView.do?mn_id=216&qna_seq=307748
- https://m.korean.go.kr/front/onlineQna/onlineQnaView.do?mn_id=216&pageIndex=1&qna_seq=309007

Regression coverage: 365 days with no daily or 30-day content overlap; old IDs and
writing variants; zero-score submission preservation; meaningful whitespace;
matching web/Android deterministic fixtures. Android release: 1.6.18 (27).
