# 논리 퍼즐 모음

직접 고른 논리 퍼즐 게임을 하나씩 모아 가는 정적 웹사이트입니다. 빌드 과정 없이 HTML/CSS/JS 만으로 동작하며, GitHub Pages 같은 정적 호스팅에 그대로 올릴 수 있습니다.

## 게임 목록

| 게임 | 경로 | 설명 |
| --- | --- | --- |
| 스카이스크래퍼 | `games/skyscraper/` | three.js 로 만든 3D 빌딩 퍼즐 (4×4 ~ 7×7, 쉬움/보통/어려움) |

## 실행

ES 모듈을 쓰기 때문에 파일을 더블클릭하지 말고 로컬 서버로 여세요.

```bash
python3 -m http.server 8000
```

그다음 브라우저에서 <http://localhost:8000> 을 엽니다.

## 테스트

퍼즐 생성기/풀이기 테스트 (Node 18 이상):

```bash
npm test
```

## 구조

```
index.html            메인(모음) 페이지
css/hub.css           메인 페이지 스타일
js/games.js           게임 목록 ← 새 게임은 여기에 등록
js/hub.js             게임 카드 렌더링
games/skyscraper/     스카이스크래퍼
  index.html          게임 화면
  style.css
  puzzle.js           퍼즐 생성 / 유일해 검사 / 판정 (렌더링과 무관)
  scene.js            three.js 3D 장면
  main.js             게임 진행, 입력, 저장
  thumb.svg           메인 페이지 카드 이미지
vendor/three/         three.js r160 (MIT, 오프라인에서도 동작하도록 포함)
tests/                Node 테스트
```

## 새 게임 추가하기

1. `games/<게임-id>/` 폴더를 만들고 `index.html` 을 둡니다.
2. 카드 이미지(`thumb.svg` 등)를 같은 폴더에 둡니다.
3. `js/games.js` 의 `GAMES` 배열에 항목을 하나 추가합니다.

## 스카이스크래퍼 조작

- 칸 클릭/탭 또는 방향키로 선택, 숫자 버튼 또는 1~7 키로 빌딩 세우기
- Backspace/Delete/0 지우기, N 메모 모드, Shift+숫자 메모, Ctrl+Z 되돌리기
- 드래그로 회전, Q/E 90° 회전, T 위에서 보기
- 바깥 숫자(단서)를 클릭하면 그 자리에서 줄을 따라 바라본 시점으로 이동 (Esc 로 복귀)
- 진행 상황과 최고 기록은 브라우저(localStorage)에 저장됩니다.
