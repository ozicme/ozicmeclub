#!/usr/bin/env python3
"""Rebuild 지역_시도/지역_시군구/지역_읍면동 from 대표주소."""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Any

SIDO_ALIASES: dict[str, str] = {
    "서울": "서울특별시",
    "서울시": "서울특별시",
    "서울특별시": "서울특별시",
    "부산": "부산광역시",
    "부산시": "부산광역시",
    "부산광역시": "부산광역시",
    "대구": "대구광역시",
    "대구시": "대구광역시",
    "대구광역시": "대구광역시",
    "인천": "인천광역시",
    "인천시": "인천광역시",
    "인천광역시": "인천광역시",
    "광주": "광주광역시",
    "광주시": "광주광역시",
    "광주광역시": "광주광역시",
    "대전": "대전광역시",
    "대전시": "대전광역시",
    "대전광역시": "대전광역시",
    "울산": "울산광역시",
    "울산시": "울산광역시",
    "울산광역시": "울산광역시",
    "세종": "세종특별자치시",
    "세종시": "세종특별자치시",
    "세종특별자치시": "세종특별자치시",
    "경기": "경기도",
    "경기도": "경기도",
    "강원": "강원특별자치도",
    "강원도": "강원특별자치도",
    "강원특별자치도": "강원특별자치도",
    "충북": "충청북도",
    "충청북도": "충청북도",
    "충남": "충청남도",
    "충청남도": "충청남도",
    "전북": "전북특별자치도",
    "전라북도": "전북특별자치도",
    "전북특별자치도": "전북특별자치도",
    "전남": "전라남도",
    "전라남도": "전라남도",
    "경북": "경상북도",
    "경상북도": "경상북도",
    "경남": "경상남도",
    "경상남도": "경상남도",
    "제주": "제주특별자치도",
    "제주도": "제주특별자치도",
    "제주특별자치도": "제주특별자치도",
}

SIGUNGU_RE = re.compile(r"(시|군|구)$")
EUPMYEONDONG_RE = re.compile(r"(읍|면|동|가|리)$")
TOKEN_EDGE_RE = re.compile(r"^[\[\(\{\"']+|[\]\)\}\"',]+$")
PARENS_RE = re.compile(r"\(([^)]{1,40})\)")


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def clean_token(token: str) -> str:
    return TOKEN_EDGE_RE.sub("", normalize_space(token))


def normalize_sido(value: str) -> str:
    token = clean_token(value)
    return SIDO_ALIASES.get(token, token)


def parse_region_from_address(address: str) -> tuple[str, str, str]:
    address = normalize_space(address)
    if not address:
        return "", "", ""

    tokens = [t for t in address.split(" ") if t]
    if not tokens:
        return "", "", ""

    # 주소 시작이 아닌 위치에 시도가 들어온 케이스 방어(최대 2토큰만 탐색).
    sido = ""
    start_idx = 0
    for idx in range(min(2, len(tokens))):
        mapped = normalize_sido(tokens[idx])
        if mapped in SIDO_ALIASES.values():
            sido = mapped
            start_idx = idx + 1
            break

    sigungu = ""
    sigungu_idx: int | None = None

    # 세종특별자치시는 일반적으로 시군구가 없음.
    if sido != "세종특별자치시":
        for idx in range(start_idx, min(len(tokens), start_idx + 6)):
            token = clean_token(tokens[idx])
            if not token:
                continue
            if normalize_sido(token) in SIDO_ALIASES.values():
                continue
            if not SIGUNGU_RE.search(token):
                continue

            sigungu = token
            sigungu_idx = idx

            # "천안시 서북구" 같은 복합 시군구 결합.
            if idx + 1 < len(tokens):
                next_token = clean_token(tokens[idx + 1])
                if token.endswith("시") and next_token.endswith("구"):
                    sigungu = f"{token} {next_token}"
            break

    eupmyeondong = ""
    search_start = start_idx
    if sigungu_idx is not None:
        search_start = sigungu_idx + (2 if " " in sigungu else 1)

    for idx in range(search_start, len(tokens)):
        token = clean_token(tokens[idx])
        if EUPMYEONDONG_RE.search(token):
            eupmyeondong = token
            break

    # 도로명 주소에서 괄호 법정동 표기 보강. ex) (태평로1가)
    if not eupmyeondong:
        for candidate in PARENS_RE.findall(address):
            candidate = clean_token(candidate)
            if EUPMYEONDONG_RE.search(candidate):
                eupmyeondong = candidate
                break

    return sido, sigungu, eupmyeondong


def derive_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}_region_rebuilt{input_path.suffix}")


def run(input_csv: Path, output_csv: Path, fill_only: bool, strict_address: bool) -> None:
    with input_csv.open("r", encoding="utf-8-sig", newline="") as fp:
        reader = csv.DictReader(fp)
        headers = reader.fieldnames or []
        rows = list(reader)

    required = ["대표주소", "지역_시도", "지역_시군구", "지역_읍면동"]
    missing = [col for col in required if col not in headers]
    if missing:
        raise ValueError(f"필수 컬럼 누락: {', '.join(missing)}")

    total = len(rows)
    parsed_sido = 0
    parsed_sigungu = 0
    parsed_eup = 0
    updated_sido = 0
    updated_sigungu = 0
    updated_eup = 0
    unresolved_rows = 0

    for row in rows:
        address = normalize_space(row.get("대표주소", ""))
        p_sido, p_sigungu, p_eup = parse_region_from_address(address)

        if p_sido:
            parsed_sido += 1
        if p_sigungu:
            parsed_sigungu += 1
        if p_eup:
            parsed_eup += 1
        if not p_sido:
            unresolved_rows += 1

        old_sido = normalize_space(row.get("지역_시도", ""))
        old_sigungu = normalize_space(row.get("지역_시군구", ""))
        old_eup = normalize_space(row.get("지역_읍면동", ""))

        if fill_only:
            next_sido = old_sido or p_sido
            next_sigungu = old_sigungu or p_sigungu
            next_eup = old_eup or p_eup
        elif strict_address:
            next_sido = p_sido
            next_sigungu = p_sigungu
            next_eup = p_eup
        else:
            next_sido = p_sido or old_sido
            next_sigungu = p_sigungu or old_sigungu
            next_eup = p_eup or old_eup

        if next_sido != old_sido:
            updated_sido += 1
        if next_sigungu != old_sigungu:
            updated_sigungu += 1
        if next_eup != old_eup:
            updated_eup += 1

        row["지역_시도"] = next_sido
        row["지역_시군구"] = next_sigungu
        row["지역_읍면동"] = next_eup

    with output_csv.open("w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)

    print(f"입력 행 수: {total}")
    print(f"파싱 성공(시도/시군구/읍면동): {parsed_sido}/{parsed_sigungu}/{parsed_eup}")
    print(f"주소에서 시도 파싱 실패 행: {unresolved_rows}")
    print(f"수정 건수(시도/시군구/읍면동): {updated_sido}/{updated_sigungu}/{updated_eup}")
    print(f"출력 파일: {output_csv}")


def main() -> None:
    parser = argparse.ArgumentParser(description="대표주소 기준 지역 컬럼 재구성")
    parser.add_argument(
        "--input",
        default="오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비.csv",
        help="입력 CSV 경로",
    )
    parser.add_argument(
        "--output",
        default="",
        help="출력 CSV 경로(미지정 시 *_region_rebuilt.csv)",
    )
    parser.add_argument(
        "--inplace",
        action="store_true",
        help="입력 파일을 직접 덮어쓰기",
    )
    parser.add_argument(
        "--fill-only",
        action="store_true",
        help="기존 값은 유지하고 빈 지역 컬럼만 채우기",
    )
    parser.add_argument(
        "--strict-address",
        action="store_true",
        help="주소에서 파싱한 값만 사용하고 파싱 실패 시 지역 컬럼을 비움",
    )
    args = parser.parse_args()

    input_csv = Path(args.input)
    if not input_csv.exists():
        raise FileNotFoundError(f"입력 파일을 찾을 수 없습니다: {input_csv}")

    if args.inplace and args.output:
        raise ValueError("--inplace와 --output은 동시에 사용할 수 없습니다")

    if args.inplace:
        output_csv = input_csv
    elif args.output:
        output_csv = Path(args.output)
    else:
        output_csv = derive_output_path(input_csv)

    run(
        input_csv=input_csv,
        output_csv=output_csv,
        fill_only=args.fill_only,
        strict_address=args.strict_address,
    )


if __name__ == "__main__":
    main()
