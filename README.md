# Notion Management — AI Second Brain

Notion 지식 노드·관계를 시각화하는 읽기 전용 웹앱입니다.

- Notion 중앙 데이터베이스: 09 지식 노드, 10 지식 관계
- 배포: Vercel (별도 Git 연결 예정)
- 보안: Notion API 키는 서버 환경변수에만 설정
- 기본 화면은 2026-11-19 검증 스냅샷으로 시작하며 실시간 조회는 인증 설정 후 활성화됩니다.

## 환경변수

`NOTION_API_KEY` — 서버 전용 Notion integration secret

`GRAPH_VIEW_KEY` — 웹앱에서 서버 API를 요청할 때 사용하는 별도의 읽기 접근키 (Notion 비밀키와 다름)

## 주의

공개 저장소입니다. 토큰, 환자 개인정보, 연구 비공개 자료는 커밋하지 마세요.
