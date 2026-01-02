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

## JSON 데이터 추가/수정 방법

`public-restaurants.json`에 식당 정보를 추가합니다. 소비자에게 필요한 필드만 사용하며, 누락된 값은 UI에서 `미등록` 또는 `예약 준비중`으로 자동 보정됩니다.

```json
{
  "name": "오직미 샘플 식당",
  "region": {"sido": "서울", "sigungu": "강남구"},
  "category": "한식",
  "signatureMenus": ["대표 메뉴 1", "대표 메뉴 2"],
  "priceRange": "2만원대",
  "naverReservationUrl": "https://booking.naver.com",
  "naverPlaceUrl": "https://place.naver.com",
  "naverMapUrl": "https://map.naver.com",
  "phone": "02-000-0000",
  "thumbnail": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80",
  "images": ["https://images.unsplash.com/photo-1525755662778-989d0524087e?auto=format&fit=crop&w=900&q=80"],
  "verifiedBadge": true,
  "verifiedMonth": "2024-08"
}
```

### 필드 설명

- `naverReservationUrl`: 예약 최우선 링크입니다. 존재하면 모든 예약 CTA가 이 링크로 이동합니다.
- `naverPlaceUrl`: `naverReservationUrl`이 없을 때 예약 CTA가 이동하는 네이버 플레이스 링크입니다.
- `naverMapUrl`: 길찾기용 네이버 지도 링크입니다. 없을 경우 `mapLinks.naver` 또는 `mapLinks.kakao/google` 순으로 fallback 됩니다.
- `phone`: 예약 링크가 없을 경우 대체 CTA로 사용되는 전화번호입니다.
- `thumbnail`: 리스트 카드 썸네일 이미지(4:3 비율 권장)입니다.
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
- 예약 CTA는 네이버 예약/플레이스로만 연결합니다.
- 지도는 API 키 없이 외부 링크로만 연결합니다.
