# GitHub → Notion 프로젝트 동기화 v1

## 대조 현황 (2026-11-19)
- 연결된 GitHub 계정 `happyyang0226`에서 저장소 15개 확인
- Notion `01 프로젝트`는 2개: `pt-exam-app`, `second-brain-graph`
- GitHub `notion-management`는 기존 `second-brain-graph`의 GitHub 속성으로 연결되어 있으므로 **새 프로젝트로 만들지 않음**
- 다른 13개는 현재 GitHub 연결 계정 기준 신규 등록 후보 (실제 웹앱 서버의 GitHub 접근 범위는 별도)

## 웹앱 기능
1. AI Second Brain의 `GitHub 저장소 ↔ Notion 프로젝트 대조·등록` 패널 열기
2. 기존 `WORKLOG_WRITE_KEY`를 입력 (채팅 공유 금지, GRAPH_VIEW_KEY 사용 불가)
3. `GitHub ↔ Notion 목록 대조` 버튼으로 **현재 서버에서 조회 가능한 GitHub 저장소**와 Notion 전체 01 DB 비교
4. 등록 후보를 선택하고 체크박스에서 등록 승인
5. `선택 항목 등록` 버튼 실행 — 한 번에 최대 5개
6. 서버가 **등록 직전 Notion 프로젝트 목록을 다시 확인**하고 프로젝트 ID·프로젝트명·정확한 GitHub URL로 중복 방지
7. 신규 등록은 상태 `계획`, 분류 `웹개발`, 설명은 `GitHub 기반 등록, 구현/배포 상태 미검증`으로 기록
8. 등록 결과·Notion 링크 확인 후 목록을 다시 대조하고 필요하면 다음 5건을 등록

## 외부 접근과 제한
- `GITHUB_SYNC_TOKEN`이 서버에 없으면 **GitHub 공개 저장소**만 조회합니다.
- 서버에 별도 `GITHUB_SYNC_TOKEN` (적절한 저장소 읽기 권한)을 설정하면 소유한 비공개 저장소도 대조할 수 있습니다. 이 토큰도 Vercel 서버 전용 Secret/Sensitive이며 채팅이나 브라우저에 전달하지 않습니다.
- UI 인증은 기존 `WORKLOG_WRITE_KEY`. 인증된 사용자만 목록 조회 및 등록할 수 있습니다.
- 등록하지 않은 저장소를 임의로 수정/삭제하지 않으며 기존 Notion 항목도 변경하지 않습니다.
- Notion DB의 `프로젝트 ID`는 고유 강제 제약이 아니므로 다중 동시 호출 시 중복을 완벽히 차단하지 못합니다.
- GitHub 저장소를 자동으로 주기적으로 동기화하지 않습니다. 요청할 때 최신 목록을 비교하고 명시적으로 승인된 항목만 등록합니다.
- 배포 READY는 인증/등록 실제 테스트 통과를 의미하지 않습니다. 사용자 브라우저에서 미리보기와 시험 등록을 수행해 검증합니다.
