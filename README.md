# OZICME 소비자용 공개 디렉토리

오직미(OZICME) 쌀을 사용하는 식당을 발견하고 네이버 예약/플레이스 및 길찾기로 이어지는 정적 사이트입니다. 로그인 없이 누구나 이용할 수 있으며, 개인정보와 거래정보는 공개하지 않습니다.

현재 정본 CSV에는 전국 6,044개 식당이 있으며, 첫 접속 시 서울특별시 필터가 적용되어 1,652개가 표시됩니다.

## 로컬 실행 방법

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`에 접속하세요.

## 관리자 식당 등록

저장소 소유자는 `https://ozicmeclub.com/admin.html`에서 식당을 1개씩 입력하거나 CSV로 여러 개 준비할 수 있습니다. 단건 입력은 **상호명, 네이버 플레이스 URL, 대표 이미지 URL(선택), 대표메뉴(선택), 등록 구분**만 받습니다. 주소·지역·업종·검색 태그는 자동으로 채웁니다. 여러 개 등록 CSV와 전체 수정 CSV의 등록 구분은 **1=오직미 쌀 거래식당, 2=외부 좋은 쌀 식당**으로 입력합니다.

1. 관리자 페이지에서 단건 입력 또는 CSV 업로드
2. 등록 데이터 복사
3. GitHub Actions의 **오직미클럽 식당 등록** 실행 화면에서 데이터 붙여넣기
4. **Run workflow** 실행

기존 정본 CSV에 같은 네이버 플레이스 URL이 있으면 브라우저에서 즉시 자동 입력 결과를 확인할 수 있습니다. 신규 식당은 GitHub Actions에서 **NAVER API HUB 지역검색 API**로 조회합니다. `음식점 > 일식 > 일식당`처럼 맨 앞에 붙는 일반 분류 `음식점`은 제외해 업종을 `일식`으로 저장합니다. 지역검색 API에는 별도 메뉴 필드가 없으므로, 설명·세부업종에서 확실한 메뉴만 자동 추출하고 부족할 때는 선택 항목인 대표메뉴에 쉼표로 구분해 입력할 수 있습니다. 2026년 7월 31일부터 기존 네이버 개발자센터에서는 검색 API를 신규 신청할 수 없으므로, 반드시 네이버 클라우드 플랫폼의 NAVER API HUB에서 Application을 만들고 검색 API를 선택해야 합니다. 저장소의 **Settings → Secrets and variables → Actions**에 아래 Repository secrets를 등록합니다.

- `NAVER_CLIENT_ID`: NAVER API HUB Application의 Client ID
- `NAVER_CLIENT_SECRET`: 같은 HUB Application의 Client Secret

기존 네이버 개발자센터에서 발급받은 값은 사용할 수 없습니다. 이미 같은 이름의 GitHub Secret이 있다면 HUB에서 발급받은 새 값으로 각각 업데이트합니다. Secret 값은 관리자 페이지나 등록 JSON에 포함하지 않습니다.

실제 등록은 GitHub 저장소 소유자만 실행할 수 있습니다. 공개 페이지에는 GitHub 토큰이나 관리자 비밀번호를 저장하지 않습니다.

- 관리자 추가 데이터: `data/admin-restaurants.json`
- 검증·중복 제거: `scripts/add_restaurants.py`
- 자동 반영: `.github/workflows/add-restaurants.yml`
- 중복 기준: 공백·기호를 제거한 `상호명 + 대표주소`
- 오직미 쌀 거래식당: `오직미클럽` 배지 표시
- 외부 좋은 쌀 식당: 배지 미표시, 근거URL·근거문구 선택 입력

## 관리자 기존 식당 수정

관리자 페이지의 **기존 식당 수정**에서는 전체 목록 수정과 1개 검색 수정을 모두 지원합니다. 전체 목록 버튼으로 UTF-8 CSV를 내려받아 엑셀에서 수정한 뒤 같은 파일을 올리면, 브라우저가 현재 목록과 비교해 변경된 식당만 `data/restaurant-overrides.json`에 저장할 GitHub 입력 데이터로 만듭니다. 원본 CSV는 그대로 보호하며 기존 정본 식당과 관리자 화면에서 새로 등록한 식당을 모두 수정할 수 있습니다.

1. `https://ozicmeclub.com/admin.html`에서 **기존 식당 수정** 선택
2. 전체 수정은 **전체 N개 내려받기** → 엑셀 수정 → **수정한 전체 CSV 올리기** 순서로 진행. `수정대상키(수정금지)` 열은 유지
3. 1개 수정은 상호명 또는 주소로 검색하고 수정할 식당 선택
4. 상호명·주소·네이버 URL·이미지·지역·업종·메뉴·검색 태그·등록 구분 수정
5. **수정 데이터 복사** 후 GitHub Actions의 **오직미클럽 기존 식당 수정** 실행. 여러 묶음이면 각 묶음을 순서대로 실행
6. `Run workflow`를 누르면 검증 후 사이트 목록과 상세 화면에 반영

- 수정 데이터: `data/restaurant-overrides.json`
- 검증·저장: `scripts/update_restaurants.py`
- 자동 반영: `.github/workflows/update-restaurants.yml`
- 수정 대상 식별: 관리자 추가 ID 또는 네이버 플레이스 정보에 기존 상호명·주소 지문을 결합해 동명이점도 구분
- 원본 정본 CSV: 수정 작업으로 직접 덮어쓰지 않음

검증 명령:

```bash
npm run test-admin
node --check admin.js
node --check script.js
python scripts/audit_image_urls.py
```

## 대표 이미지 안정성

대표 이미지는 정본 CSV·관리자 추가 데이터·수정 데이터의 URL을 사용하며, 화면에서는 다음 순서로 로딩합니다.

1. 저장된 네이버 이미지 프록시 URL
2. 프록시의 `src`에 들어 있는 원본 정지 이미지 URL
3. 원본으로 다시 만든 네이버 이미지 프록시 URL
4. 모두 실패하거나 URL이 비어 있으면 오직미 기본 이미지

`video-phinf.pstatic.net` 주소라도 확장자가 JPG·PNG 등인 영상 썸네일은 정상 이미지로 허용합니다. 반대로 MP4·WebM·M3U8 등 실제 동영상 파일, `…`로 잘린 주소, URL 앞부분이 중복된 주소, 네이버 플레이스 페이지 주소를 이미지 칸에 넣는 것은 관리자 화면과 GitHub Actions에서 모두 차단합니다.

전체 URL 구조 검사는 식당 등록·수정 테스트에 포함되며, `.github/workflows/audit-restaurant-images.yml`이 매주 월요일 오전 3시 30분(KST)에 모든 대표 이미지의 실제 응답도 점검합니다. 실패 목록과 재시도 내역은 Actions 실행 요약 및 `restaurant-image-health` 보고서에 남습니다.

---

## 데이터 파이프라인(기존 + 외부 대량 병합)

정적 사이트는 기존 정본 CSV와 관리자 추가 JSON을 함께 읽습니다. 아래 파이프라인은 `input/base.csv` + 외부 출처를 병합해 최종 CSV/JSON을 만듭니다.

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
