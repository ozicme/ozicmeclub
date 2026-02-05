# OZICME 소비자용 공개 디렉토리

오직미(OZICME) 쌀을 사용하는 식당을 발견하고 네이버 예약/플레이스 및 길찾기로 이어지는 정적 사이트입니다. 로그인 없이 누구나 이용할 수 있으며, 개인정보와 거래정보는 공개하지 않습니다.

## 로컬 실행 방법

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`에 접속하세요.

---

## 데이터 파이프라인(기존 + 외부 대량 병합)

정적 사이트는 `JSON`만 배포하므로, 아래 파이프라인이 `input/base.csv` + 외부 출처를 병합해 최종 CSV/JSON을 만듭니다.

### 디렉터리 구조

```text
input/
  base.csv
  sources/
    franchise_sources.csv
    municipality_sources.csv
output/
  ozicme_restaurants_merged.csv
  public-restaurants.json
```

### 1) 준비

1. 기존 정본 CSV를 `input/base.csv`로 둡니다.
2. 출처 목록을 아래 파일에 입력합니다.
   - `input/sources/franchise_sources.csv`
   - `input/sources/municipality_sources.csv`

기본 템플릿은 이미 저장되어 있으며, 행을 추가해 확장하면 됩니다.

### 2) 실행

```bash
pip install -r requirements.txt
npm run merge-data
```

실행 스크립트: `scripts/build_restaurant_pipeline.py`

### 3) 파이프라인에서 자동 처리되는 내용

- `input/base.csv` 로드 + `Unnamed*` 컬럼 제거
- 출처 파일 자동 병합
- 소스별 파서 분리
  - HTML 표: BeautifulSoup
  - PDF: pdfplumber 텍스트 추출(실패 시 `output/pdf_manual_review_queue.csv`로 수동 보완 큐 생성)
  - Excel/CSV: pandas 로드
- 공통 정제
  - 주소 기반 `지역_시도/시군구/읍면동` 자동 파싱
  - `상호명 + 주소(정규화)` 기준 중복 제거
  - 룰테이블 기반 `식당유형/주요리/검색태그` 자동 분류
- 네이버 링크 규칙
  - `네이버플레이스`가 없으면 `https://map.naver.com/p/search/{상호명+대표주소}` 생성
  - `네이버예약URL`은 네이버 예약 URL이 있을 때만 그대로 사용, 없으면 네이버 지도 검색 URL 사용
- 배지/출처 메타데이터
  - 기존 리스트: `배지=오직미클럽`, `출처유형=ozicme-base`
  - 외부 추가: `배지=""`
  - 공통 컬럼: `출처유형`, `근거URL`, `근거문구`, `최종업데이트`

### 4) 산출물

- `output/ozicme_restaurants_merged.csv`
- `output/public-restaurants.json` (사이트 배포용)

---

## 출처 템플릿 설명

### `input/sources/franchise_sources.csv`

| 컬럼 | 설명 |
|---|---|
| source_id | 출처 식별자(고유값 권장) |
| 브랜드명 | 프랜차이즈명 |
| 매장리스트URL | 매장 목록 페이지 URL |
| 매장데이터URL | (선택) CSV/XLS/PDF 등 직접 데이터 URL |
| 데이터형식 | html / pdf / xls / xlsx / csv |
| 좋은쌀근거URL | 쌀 관련 홍보/정책 근거 링크 |
| 좋은쌀근거문구 | 근거 텍스트 |

### `input/sources/municipality_sources.csv`

| 컬럼 | 설명 |
|---|---|
| source_id | 출처 식별자(고유값 권장) |
| 지자체명 | 지자체명 |
| 리스트URL | 업소 리스트 URL |
| 형식 | html / pdf / xls / xlsx / csv |
| 근거문구키워드 | 근거 문구 키워드 |

---

## 기존 단일 CSV → JSON 변환(레거시)

기존 방식은 `오직미_식당디렉토리_사이트개발용_최종정비.csv`만 사용합니다.

```bash
npm run seed
```

