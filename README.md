# OZICME CLUB 소비자용 공개 디렉토리

오직미(OZICME) 쌀을 사용하는 식당을 지역/유형별로 검색하고 **네이버 예약/플레이스**로 연결되는 정적 사이트입니다. 로그인 없이 누구나 이용할 수 있으며 개인정보/거래정보는 화면에 노출하지 않습니다.

## 로컬 실행 방법

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`에 접속하세요.

## 데이터 업데이트

`public-restaurants.json`을 갱신해 배포합니다. 업데이트 시 아래 필드를 유지해주세요.

### 필수 필드

- `name`: 식당명
- `region`: 지역 정보
  - `sido`, `sigungu` (시/도, 시/군/구)
- `type`: 식당유형/카테고리 (예: 한식, 일식, 분식, 고깃집)
- `naverReservationUrl`: 네이버 예약 URL (없으면 빈 문자열)
- `naverPlaceUrl`: 네이버 플레이스 URL (예약 URL이 없을 때 대체)

### 선택 필드 (없어도 UI는 "미등록" 처리)

- `addressPublic`: 구/동 또는 도로명까지만
- `signatureMenus`: 대표 메뉴 배열
- `thumbnail`, `images`: 대표 이미지
- `naverMapUrl`: 길찾기 링크

> **예약 버튼 규칙**
> - `naverReservationUrl`이 있으면 해당 링크로 이동
> - 없으면 `naverPlaceUrl`로 이동
> - 둘 다 없으면 예약 버튼이 비활성화됩니다.

### JSON 예시

```json
{
  "id": "ozicme-999",
  "name": "오직미 샘플 식당",
  "region": {"sido": "서울특별시", "sigungu": "강남구"},
  "type": "한식",
  "addressPublic": "서울특별시 강남구 테헤란로",
  "signatureMenus": ["백반", "정식"],
  "thumbnail": "https://...",
  "images": [],
  "naverReservationUrl": "https://booking.naver.com/booking/6/bizes/123456",
  "naverPlaceUrl": "https://map.naver.com/v5/search/...",
  "naverMapUrl": "https://map.naver.com/v5/search/..."
}
```

### 타입(type) 누락 시

`type`이 없는 데이터는 **자동으로 "기타"** 로 처리됩니다. 추후 태깅을 위해 위 JSON 예시처럼 손쉽게 추가할 수 있도록 유지해주세요.

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
