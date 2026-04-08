# World Map - 로컬 검색 구조 개편본

## 파일 구조

- `index.html`
  - UI 레이아웃과 Cesium 로더 연결
- `data/countries.js`
  - 전세계 국가 데이터
  - 국가명(한글/영문), ISO 코드, 별칭, 중심 좌표, 수도 정보 포함
- `data/cities.js`
  - 전세계 주요 도시 + 각국 수도 데이터
  - 도시명(한글/영문), 국가 정보, 좌표, 우선순위, 별칭 포함
- `js/search-engine.js`
  - 정규화, 점수화, 중복 제거, 국가/도시 분기 검색 담당
- `js/app.js`
  - Cesium 초기화, 검색 UI 이벤트, flyTo 처리 담당
- `favicon.png`
  - 파비콘

## 검색 동작 순서

1. 사용자가 검색창에 입력
2. `search-engine.js` 가 입력값을 정규화
   - 대소문자 정리
   - 공백/하이픈/쉼표 정리
   - 악센트 제거
3. `countries.js`, `cities.js` 로컬 데이터를 대상으로 검색
4. 점수화 기준으로 결과 정렬
   - 정확히 일치하는 이름 우선
   - 국가+도시 조합 일치 우선
   - 주요 도시 > 수도 > 일반 국가 순으로 가중치 반영
5. 같은 장소가 중복으로 잡히면 하나만 남기고 제거
6. 결과 리스트를 드롭다운에 표시
7. 항목 클릭 시 해당 좌표로 카메라 이동

## 확장 방법

### 국가 추가/수정
`data/countries.js`에서 항목을 추가하면 됩니다.

### 도시 추가/수정
`data/cities.js`에 아래 형식으로 추가하면 됩니다.

```js
{
  nameKo: "브뤼셀",
  nameEn: "Brussels",
  countryCode: "BE",
  countryKo: "벨기에",
  countryEn: "Belgium",
  lat: 50.8503,
  lon: 4.3517,
  zoom: 10,
  isCapital: true,
  priority: 100,
  aliases: ["브뤼셀", "brussels", "bruxelles", "brussel"]
}
```

### 검색 우선순위 조정
`js/search-engine.js` 안의 `scoreEntry()`에서 조정하면 됩니다.

## 현재 포함 범위

- 전세계 국가 전체
- 전세계 수도 다수
- 주요 글로벌 도시 다수
- 한글/영문/별칭 검색 일부 지원

## 참고

도시 데이터는 "전세계 모든 소도시"까지 넣은 구조는 아닙니다.
지금 버전은 **전세계 국가 전체 + 주요 도시 + 수도 중심 구조**입니다.
필요하면 `cities.js`만 계속 확장해서 검색 범위를 넓히면 됩니다.
