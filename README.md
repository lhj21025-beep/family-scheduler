# 우리 가족 스케줄러

가족 3명의 일정을 월/주/일 캘린더에서 함께 관리하기 위한 React + FullCalendar + Firebase 웹앱입니다.

## 현재 구현

- 월/주/일 보기
- 주/일 시간대 그리드
- 현재 시간 빨간색 Now Indicator
- 가족별 필터와 색상
- 일정 추가/수정/삭제
- 빈 시간 클릭으로 일정 추가
- 드래그 이동 및 시간 조절
- 오늘 일정 요약
- 브라우저 알림 권한 요청 및 알림 기반
- Firebase Firestore 실시간 동기화(환경변수 설정 시)
- 모바일 반응형

Firebase 환경변수가 없으면 데모 일정으로 UI를 테스트할 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

## Firebase 설정

1. Firebase Console에서 프로젝트를 생성합니다.
2. Authentication에서 로그인 제공업체를 활성화합니다.
3. Firestore Database를 생성합니다.
4. 웹 앱을 등록합니다.
5. `.env.example`을 `.env`로 복사하고 Firebase 웹 앱 설정값을 입력합니다.
6. `firestore.rules`를 Firebase에 적용합니다.

```bash
npm run build
```

## 주의

현재 Firebase 데이터는 로그인 사용자 여부를 기준으로 접근을 제한하는 초기 규칙입니다. 실제 가족별 접근 제어를 적용하기 전에는 `familyId` membership 검증을 추가하는 것을 권장합니다.

백그라운드 푸시 알림(앱이 완전히 닫힌 상태)은 향후 Firebase Cloud Messaging으로 확장할 수 있습니다.
