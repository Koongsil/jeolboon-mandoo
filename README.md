# 만두 만들기 (Flash → Web 포팅)

`original/b3_mandu.swf`(Flash 6, AS1/AS2)를 브라우저에서 원본과 같이 동작하도록 옮긴 프로젝트입니다.
그림·애니메이션·사운드는 SWF에서 추출한 데이터를 그대로 쓰고, 게임 로직은 디컴파일한 ActionScript를 그대로 실행합니다.

## 실행

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ 에 정적 파일 생성
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/actions/` | **게임 로직** (원본 ActionScript). `root/frame_N.as` = 메인 타임라인 N프레임, `buttons/button_ID.as` = 버튼 클릭, `sprite_ID/frame_N.as` = 무비클립 내부 |
| `public/assets/` | 도형·텍스트(SVG), 사운드(mp3) |
| `src/data/swf.json` | 타임라인/버튼/배치 데이터 |
| `src/engine/` | 경량 Flash 타임라인 재생기 (Canvas 2D + WebAudio + AS1 실행기) |
| `tools/` | SWF 재추출 스크립트 (`npm run export-swf && npm run extract`, Java 필요) |

`npm run extract`를 다시 실행하면 `src/actions/`, `public/assets/`, `src/data/swf.json`이 덮어써집니다.
수정을 시작한 뒤에는 재추출하지 마세요.

## 주요 스크립트 위치

- 속재료 버튼: `buttons/button_161.as`(돼지고기) ~ `button_204.as`, 다음 버튼 `button_235.as`(5개 미만 경고)
- 만두피(가루/액체): `buttons/button_276~291.as`, `check1` 프레임 1~9 = 가루×액체 조합 (4 = 밀가루+물)
- 모양: `button_429`(긴반달) `430`(또아리) `431`(쭈그리)
- 요리법: `button_531`(삶기) `534`(굽기) `537`(찌기)
- 최종 판정: `root/frame_175.as` (`score_sok >= 8` 이고 조합이 맞으면 성공)

## 모드

- `src/mods/ingredients.ts` — 정답 재료 7개를 아이템 이미지(`public/assets/items/`)로 교체.
  버튼 글자, 그릇 속 그림, 위치·크기를 이 파일에서 바꿀 수 있습니다. 점수 로직은 원본 그대로입니다.
  모드를 끄려면 `src/main.ts`의 `applyIngredientMod(...)` 줄을 지우세요.
