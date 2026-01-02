# OZICME 소비자용 공개 디렉토리

오직미(OZICME) 쌀을 사용하는 식당을 발견하고 예약·길찾기까지 이어지는 정적 사이트입니다. 로그인 없이 누구나 이용할 수 있으며, 개인정보와 거래정보는 공개하지 않습니다.

## 로컬 실행 방법

간단한 정적 서버로 실행합니다.

```bash
python -m http.server 8000
```

브라우저에서 아래 주소로 접속하세요.

- 리스트: `http://localhost:8000/index.html`
- 상세: `http://localhost:8000/restaurant.html?slug=식당명`

## JSON 데이터 추가/수정 방법

`public-restaurants.json`에 식당 정보를 추가합니다. 기본 필드는 기존 데이터(`name`, `region`, `riceVarieties`, `firstOrder`, `lastOrder`, `purchaseCount`)이며, 소비자용 확장 필드는 누락되어도 UI가 깨지지 않도록 `미등록`으로 표시됩니다.

```json
{
  "name": "오직미 샘플 식당",
  "region": {"sido": "서울", "sigungu": "강남구"},
  "riceVarieties": ["오직미 프리미엄"],
  "firstOrder": "2024-01-01",
  "lastOrder": "2024-08-01",
  "purchaseCount": 5,
  "category": "한식",
  "signatureMenus": ["대표 메뉴 1", "대표 메뉴 2"],
  "priceRange": "2만원대",
  "openHours": "11:00 - 21:00",
  "closedDays": "월요일",
  "addressPublic": "서울 강남구 청담동",
  "mapLinks": {
    "naver": "https://map.naver.com",
    "kakao": "https://map.kakao.com",
    "google": "https://maps.google.com"
  },
  "reserveLinks": {
    "naverReservation": "https://booking.naver.com",
    "catchtable": "https://app.catchtable.co.kr",
    "kakao": "https://pf.kakao.com",
    "phone": "02-000-0000",
    "homepage": "https://example.com"
  },
  "thumbnail": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80",
  "images": ["https://images.unsplash.com/photo-1525755662778-989d0524087e?auto=format&fit=crop&w=800&q=80"],
  "verifiedBadge": true,
  "verifiedMonth": "2024-08"
}
```

### 필드 설명

- `addressPublic`: 구/동 수준 또는 도로명까지만 입력합니다. 상세 위치는 `mapLinks`로 대신합니다.
- `reserveLinks`: 예약 링크가 하나라도 있으면 리스트에서 예약 가능 매장으로 분류됩니다.
- `thumbnail`: 카드 및 상세 대표 이미지로 사용됩니다.
- `images`: 상세 페이지 갤러리 이미지 배열입니다.
- `verifiedBadge`: 오직미 인증 배지 노출 여부입니다.
- `verifiedMonth`: 최근 확인 월(YYYY-MM)로 입력합니다.

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
- 거래 정보 및 상세 개인정보는 노출하지 않습니다.
- 지도는 API 키 없이 외부 링크로만 연결합니다.
