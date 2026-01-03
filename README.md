# OZICME 소비자용 공개 디렉토리

오직미(OZICME) 쌀을 사용하는 식당을 발견하고 네이버 예약/플레이스 및 길찾기로 이어지는 정적 사이트입니다. 로그인 없이 누구나 이용할 수 있으며, 개인정보와 거래정보는 공개하지 않습니다.

## 로컬 실행 방법

간단한 정적 서버로 실행합니다.

```bash
python -m http.server 8000
```

브라우저에서 아래 주소로 접속하세요.

- 리스트: `http://localhost:8000/index.html`
- 상세: `http://localhost:8000/restaurant.html?slug=식당명`

## 데이터 업데이트 방법 (엑셀 → JSON)

`오직미_식당디렉토리_사이트개발용_최종정비.csv`를 **정본(source of truth)** 으로 사용합니다. 최신 엑셀을 CSV로 저장해 해당 파일을 교체한 뒤, 변환 스크립트를 실행하면 `public-restaurants.json`이 완전히 교체됩니다.

### 빠른 업데이트 절차

1. 최신 엑셀 파일을 CSV로 저장해 `오직미_식당디렉토리_사이트개발용_최종정비.csv`로 교체합니다.
2. 변환 스크립트를 실행합니다.
   ```bash
   node scripts/convert-restaurants.js
   ```
3. `public-restaurants.json`이 갱신되었는지 확인하고 배포합니다.

### 변환 스크립트 옵션

```bash
node scripts/convert-restaurants.js [source.csv] [output.json]
```

### JSON 필드 참고

변환 스크립트는 검색/필터에 필요한 필드를 유지하도록 아래 형태로 출력합니다.

```json
{
  "name": "오직미 샘플 식당",
  "region": {"sido": "서울", "sigungu": "강남구", "eupmyeondong": "역삼동"},
  "category": "한식",
  "categoryDetail": "백반/정식",
  "mainDishes": ["백반", "정식"],
  "searchTags": ["한식", "백반"],
  "signatureMenus": ["백반", "정식"],
  "address": "서울특별시 강남구 ...",
  "naverReservationUrl": "",
  "naverPlaceUrl": "https://map.naver.com/v5/search/...",
  "naverMapUrl": "https://map.naver.com/v5/search/...",
  "priceRange": "",
  "phone": "",
  "thumbnail": "",
  "images": [],
  "verifiedBadge": true,
  "verifiedMonth": ""
}
```

> 내부 지표(주문수/누적결제금액 등)는 변환 과정에서 제외됩니다.

## 배포 방법

### GitHub Pages

1. 레포지토리에서 `Settings → Pages`로 이동합니다.
2. `Branch`를 `main`(또는 사용하는 브랜치)로 설정하고 `/root`를 선택합니다.
3. 저장 후 제공되는 URL로 접속하면 됩니다.

### Netlify

1. Netlify에 로그인 후 `Add new site → Import an existing project`를 선택합니다.
2. 레포지토리를 연결한 뒤 빌드 명령 없이 배포합니다.
3. 출력 디렉토리는 루트(`/`)로 지정합니다.

## 참고 사항

- 로그인/회원가입/관리자 기능은 포함하지 않습니다.
- 예약 CTA는 네이버 예약/플레이스로만 연결합니다.
- 지도는 API 키 없이 외부 링크로만 연결합니다.
