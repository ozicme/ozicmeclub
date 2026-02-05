#!/usr/bin/env python3
"""Merge base OZICME csv with franchise/municipality sources and export CSV + JSON."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pandas as pd
import requests
from bs4 import BeautifulSoup

try:
    import pdfplumber
except ImportError:  # optional at runtime
    pdfplumber = None


REQUIRED_BASE_COLUMNS = [
    "상호명",
    "대표주소",
    "네이버플레이스",
    "지역_시도",
    "지역_시군구",
    "지역_읍면동",
    "식당유형_대",
    "식당유형_세부",
    "주요리_대표",
    "검색태그",
]

STANDARD_COLUMNS = [
    "상호명",
    "대표주소",
    "네이버플레이스",
    "네이버지도검색링크",
    "네이버예약URL",
    "지역_시도",
    "지역_시군구",
    "지역_읍면동",
    "식당유형_대",
    "식당유형_세부",
    "주요리_대표",
    "검색태그",
    "배지",
    "출처유형",
    "근거URL",
    "근거문구",
    "최종업데이트",
]

SIDO_PATTERNS = [
    "서울특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "광주광역시",
    "대전광역시",
    "울산광역시",
    "세종특별자치시",
    "경기도",
    "강원특별자치도",
    "충청북도",
    "충청남도",
    "전북특별자치도",
    "전라남도",
    "경상북도",
    "경상남도",
    "제주특별자치도",
]

CATEGORY_RULES: list[tuple[str, tuple[str, str]]] = [
    (r"한식|백반|국밥|한정식|찌개|곰탕", ("한식", "백반/정식")),
    (r"중식|짜장|짬뽕|마라", ("중식", "중화요리")),
    (r"일식|초밥|돈카츠|라멘|우동", ("일식", "일식당")),
    (r"양식|파스타|스테이크|피자|브런치", ("양식", "양식당")),
    (r"카페|커피|디저트", ("카페", "카페/디저트")),
    (r"치킨|족발|보쌈|분식|주점|술", ("기타", "기타(주점/카페/뷔페/기타)")),
]

MAIN_DISH_RULES: list[tuple[str, str]] = [
    (r"백반|정식", "백반/정식"),
    (r"국밥|곰탕|탕", "국밥/탕"),
    (r"초밥|회", "초밥/회"),
    (r"고기|구이|삼겹", "고기/구이"),
    (r"면|라멘|우동|칼국수", "면요리"),
    (r"파스타|피자", "파스타/피자"),
]

TAG_RULES: list[tuple[str, list[str]]] = [
    (r"한식|백반|국밥", ["한식", "백반", "국밥"]),
    (r"일식|초밥|라멘", ["일식", "초밥", "라멘"]),
    (r"중식|짜장|짬뽕", ["중식", "짜장", "짬뽕"]),
    (r"양식|파스타|스테이크", ["양식", "파스타", "스테이크"]),
    (r"카페|디저트", ["카페", "디저트"]),
]


@dataclass
class SourceRecord:
    source_id: str
    source_type: str
    org_name: str
    list_url: str
    data_url: str
    format_hint: str
    evidence_url: str
    evidence_text: str


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_address(value: str) -> str:
    value = normalize_space(value)
    return re.sub(r"[^\w가-힣]", "", value).lower()


def parse_region(address: str) -> tuple[str, str, str]:
    address = normalize_space(address)
    if not address:
        return "", "", ""

    tokens = address.split(" ")
    sido = next((s for s in SIDO_PATTERNS if address.startswith(s)), tokens[0] if tokens else "")

    sigungu = ""
    eupmyeondong = ""
    for token in tokens[1:]:
        if not sigungu and re.search(r"(시|군|구)$", token):
            sigungu = token
        if not eupmyeondong and re.search(r"(읍|면|동|가|로)$", token):
            eupmyeondong = token

    return sido, sigungu, eupmyeondong


def classify_values(name: str, category: str, detail: str, main_dish: str, tags: str) -> tuple[str, str, str, str]:
    basis = " ".join([name, category, detail, main_dish, tags])

    if not category:
        for pattern, pair in CATEGORY_RULES:
            if re.search(pattern, basis, re.IGNORECASE):
                category, detail = pair
                break

    if not detail:
        detail = category

    if not main_dish:
        for pattern, dish in MAIN_DISH_RULES:
            if re.search(pattern, basis, re.IGNORECASE):
                main_dish = dish
                break

    if not tags:
        auto_tags: list[str] = []
        for pattern, rule_tags in TAG_RULES:
            if re.search(pattern, basis, re.IGNORECASE):
                auto_tags.extend(rule_tags)
        deduped = list(dict.fromkeys([t for t in auto_tags if t]))
        tags = ",".join(deduped)

    return category, detail, main_dish, tags


def naver_map_search_url(name: str, address: str) -> str:
    query = normalize_space(f"{name} {address}")
    return f"https://map.naver.com/p/search/{quote(query)}"


def parse_html_table(content: str) -> pd.DataFrame:
    soup = BeautifulSoup(content, "html.parser")
    table = soup.find("table")
    if not table:
        return pd.DataFrame()

    rows: list[list[str]] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all(["th", "td"])
        if not cells:
            continue
        rows.append([normalize_space(cell.get_text(" ")) for cell in cells])

    if len(rows) < 2:
        return pd.DataFrame()

    header = rows[0]
    body = [r[: len(header)] + [""] * max(0, len(header) - len(r)) for r in rows[1:]]
    return pd.DataFrame(body, columns=header)


def parse_pdf_text(url_or_path: str) -> pd.DataFrame:
    if pdfplumber is None:
        return pd.DataFrame()

    path = url_or_path
    if url_or_path.startswith("http"):
        response = requests.get(url_or_path, timeout=20)
        response.raise_for_status()
        tmp = Path("output") / "tmp_source.pdf"
        tmp.write_bytes(response.content)
        path = str(tmp)

    lines: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend([normalize_space(line) for line in text.splitlines() if normalize_space(line)])

    candidates = []
    for line in lines:
        if " " not in line:
            continue
        name, _, address = line.partition(" ")
        if re.search(r"(시|군|구)", address):
            candidates.append({"상호명": name, "대표주소": address})

    return pd.DataFrame(candidates)


def parse_tabular(url_or_path: str) -> pd.DataFrame:
    if url_or_path.startswith("http"):
        if url_or_path.lower().endswith(".csv"):
            return pd.read_csv(url_or_path)
        if url_or_path.lower().endswith((".xls", ".xlsx")):
            return pd.read_excel(url_or_path)
        response = requests.get(url_or_path, timeout=20)
        response.raise_for_status()
        if "text/csv" in response.headers.get("content-type", ""):
            from io import StringIO

            return pd.read_csv(StringIO(response.text))
        raise ValueError(f"Unsupported remote tabular source: {url_or_path}")

    path = Path(url_or_path)
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    if path.suffix.lower() in {".xls", ".xlsx"}:
        return pd.read_excel(path)
    raise ValueError(f"Unsupported tabular file: {url_or_path}")


def load_source_records(franchise_csv: Path, municipality_csv: Path) -> list[SourceRecord]:
    records: list[SourceRecord] = []
    if franchise_csv.exists():
        fdf = pd.read_csv(franchise_csv).fillna("")
        for _, row in fdf.iterrows():
            records.append(
                SourceRecord(
                    source_id=normalize_space(row.get("source_id")),
                    source_type="franchise",
                    org_name=normalize_space(row.get("브랜드명")),
                    list_url=normalize_space(row.get("매장리스트URL")),
                    data_url=normalize_space(row.get("매장데이터URL")),
                    format_hint=normalize_space(row.get("데이터형식") or "html"),
                    evidence_url=normalize_space(row.get("좋은쌀근거URL")),
                    evidence_text=normalize_space(row.get("좋은쌀근거문구")),
                )
            )

    if municipality_csv.exists():
        mdf = pd.read_csv(municipality_csv).fillna("")
        for _, row in mdf.iterrows():
            records.append(
                SourceRecord(
                    source_id=normalize_space(row.get("source_id")),
                    source_type="municipality",
                    org_name=normalize_space(row.get("지자체명")),
                    list_url=normalize_space(row.get("리스트URL")),
                    data_url="",
                    format_hint=normalize_space(row.get("형식") or "html"),
                    evidence_url=normalize_space(row.get("리스트URL")),
                    evidence_text=normalize_space(row.get("근거문구키워드")),
                )
            )
    return records


def source_to_dataframe(source: SourceRecord) -> tuple[pd.DataFrame, str | None]:
    target = source.data_url or source.list_url
    if not target:
        return pd.DataFrame(), "missing-url"

    format_hint = source.format_hint.lower()

    try:
        if format_hint == "html":
            response = requests.get(target, timeout=20)
            response.raise_for_status()
            return parse_html_table(response.text), None

        if format_hint == "pdf":
            parsed = parse_pdf_text(target)
            if parsed.empty:
                return pd.DataFrame(), "pdf-parse-failed"
            return parsed, None

        if format_hint in {"xls", "xlsx", "excel", "csv"}:
            return parse_tabular(target), None

        if target.lower().endswith(".pdf"):
            parsed = parse_pdf_text(target)
            return parsed, None if not parsed.empty else "pdf-parse-failed"

        if target.lower().endswith((".csv", ".xls", ".xlsx")):
            return parse_tabular(target), None

        response = requests.get(target, timeout=20)
        response.raise_for_status()
        return parse_html_table(response.text), None
    except Exception as exc:  # keep pipeline resilient for batch ingestion
        return pd.DataFrame(), str(exc)


def unify_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename_map = {
        "업체명": "상호명",
        "매장명": "상호명",
        "상호": "상호명",
        "주소": "대표주소",
        "도로명주소": "대표주소",
        "소재지": "대표주소",
        "네이버플레이스URL": "네이버플레이스",
        "플레이스URL": "네이버플레이스",
    }
    df = df.rename(columns=rename_map).copy()
    for col in ["상호명", "대표주소", "네이버플레이스", "식당유형_대", "식당유형_세부", "주요리_대표", "검색태그"]:
        if col not in df.columns:
            df[col] = ""
    return df


def prepare_base_df(base_path: Path) -> pd.DataFrame:
    base_df = pd.read_csv(base_path).fillna("")
    base_df = base_df.loc[:, ~base_df.columns.str.startswith("Unnamed")]

    for col in REQUIRED_BASE_COLUMNS:
        if col not in base_df.columns:
            base_df[col] = ""

    base_df["출처유형"] = "ozicme-base"
    base_df["근거URL"] = ""
    base_df["근거문구"] = ""
    base_df["배지"] = "오직미클럽"
    base_df["최종업데이트"] = datetime.now().date().isoformat()
    return base_df


def enrich_dataframe(df: pd.DataFrame, default_source_type: str, evidence_url: str, evidence_text: str, badge: str) -> pd.DataFrame:
    df = df.fillna("").copy()

    for col in ["상호명", "대표주소", "네이버플레이스", "식당유형_대", "식당유형_세부", "주요리_대표", "검색태그"]:
        if col not in df.columns:
            df[col] = ""

    if "배지" not in df.columns:
        df["배지"] = badge
    if "출처유형" not in df.columns:
        df["출처유형"] = default_source_type
    if "근거URL" not in df.columns:
        df["근거URL"] = evidence_url
    if "근거문구" not in df.columns:
        df["근거문구"] = evidence_text

    df["최종업데이트"] = datetime.now().date().isoformat()

    for idx, row in df.iterrows():
        name = normalize_space(row.get("상호명"))
        address = normalize_space(row.get("대표주소"))

        sido, sigungu, eupmyeondong = parse_region(address)
        if not normalize_space(row.get("지역_시도")):
            df.at[idx, "지역_시도"] = sido
        if not normalize_space(row.get("지역_시군구")):
            df.at[idx, "지역_시군구"] = sigungu
        if not normalize_space(row.get("지역_읍면동")):
            df.at[idx, "지역_읍면동"] = eupmyeondong

        category, detail, main_dish, tags = classify_values(
            name=name,
            category=normalize_space(row.get("식당유형_대")),
            detail=normalize_space(row.get("식당유형_세부")),
            main_dish=normalize_space(row.get("주요리_대표")),
            tags=normalize_space(row.get("검색태그")),
        )
        df.at[idx, "식당유형_대"] = category
        df.at[idx, "식당유형_세부"] = detail
        df.at[idx, "주요리_대표"] = main_dish
        df.at[idx, "검색태그"] = tags

        naver_place = normalize_space(row.get("네이버플레이스"))
        fallback_map = naver_map_search_url(name, address)
        if not naver_place:
            df.at[idx, "네이버지도검색링크"] = fallback_map
            df.at[idx, "네이버예약URL"] = fallback_map
        else:
            df.at[idx, "네이버지도검색링크"] = naver_place
            if "booking.naver.com" in naver_place.lower():
                df.at[idx, "네이버예약URL"] = naver_place
            else:
                df.at[idx, "네이버예약URL"] = fallback_map

    return df


def deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    normalized = df.copy()
    normalized["_key"] = (
        normalized["상호명"].map(normalize_space).str.lower() +
        "|" +
        normalized["대표주소"].map(normalize_address)
    )
    normalized = normalized.drop_duplicates(subset=["_key"], keep="first")
    return normalized.drop(columns=["_key"])


def export_json(df: pd.DataFrame, output_json: Path) -> None:
    payload: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        payload.append(
            {
                "name": normalize_space(row.get("상호명")),
                "region": {
                    "sido": normalize_space(row.get("지역_시도")),
                    "sigungu": normalize_space(row.get("지역_시군구")),
                    "eupmyeondong": normalize_space(row.get("지역_읍면동")),
                },
                "category": normalize_space(row.get("식당유형_대")),
                "categoryDetail": normalize_space(row.get("식당유형_세부")),
                "mainDishes": [d for d in re.split(r"[,/]", normalize_space(row.get("주요리_대표"))) if d],
                "searchTags": [t for t in re.split(r"[,/]", normalize_space(row.get("검색태그"))) if t],
                "address": normalize_space(row.get("대표주소")),
                "naverPlaceUrl": normalize_space(row.get("네이버플레이스")),
                "naverMapUrl": normalize_space(row.get("네이버지도검색링크")),
                "naverReservationUrl": normalize_space(row.get("네이버예약URL")),
                "verifiedBadge": normalize_space(row.get("배지")) == "오직미클럽",
                "badgeLabel": normalize_space(row.get("배지")),
                "sourceType": normalize_space(row.get("출처유형")),
                "evidenceUrl": normalize_space(row.get("근거URL")),
                "evidenceText": normalize_space(row.get("근거문구")),
                "updatedAt": normalize_space(row.get("최종업데이트")),
            }
        )

    output_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_pipeline(base_csv: Path, franchise_csv: Path, municipality_csv: Path, output_csv: Path, output_json: Path) -> None:
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    output_json.parent.mkdir(parents=True, exist_ok=True)

    base_df = enrich_dataframe(
        prepare_base_df(base_csv),
        default_source_type="ozicme-base",
        evidence_url="",
        evidence_text="",
        badge="오직미클럽",
    )

    merged_frames = [base_df]
    failures: list[dict[str, str]] = []

    for source in load_source_records(franchise_csv, municipality_csv):
        frame, error = source_to_dataframe(source)
        if error:
            failures.append({"source_id": source.source_id, "org_name": source.org_name, "error": error})
            continue

        frame = unify_columns(frame)
        frame = enrich_dataframe(
            frame,
            default_source_type=source.source_type,
            evidence_url=source.evidence_url,
            evidence_text=source.evidence_text,
            badge="",
        )
        frame["출처유형"] = source.source_type
        frame["근거URL"] = source.evidence_url
        frame["근거문구"] = source.evidence_text
        frame["배지"] = ""
        merged_frames.append(frame)

    merged = pd.concat(merged_frames, ignore_index=True)
    merged = deduplicate(merged)

    for col in STANDARD_COLUMNS:
        if col not in merged.columns:
            merged[col] = ""

    merged = merged[STANDARD_COLUMNS]
    merged.to_csv(output_csv, index=False, encoding="utf-8-sig")
    export_json(merged, output_json)

    if failures:
        pd.DataFrame(failures).to_csv(output_csv.parent / "pdf_manual_review_queue.csv", index=False, encoding="utf-8-sig")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OZICME restaurant merge pipeline")
    parser.add_argument("--base", default="input/base.csv")
    parser.add_argument("--franchise", default="input/sources/franchise_sources.csv")
    parser.add_argument("--municipality", default="input/sources/municipality_sources.csv")
    parser.add_argument("--output-csv", default="output/ozicme_restaurants_merged.csv")
    parser.add_argument("--output-json", default="output/public-restaurants.json")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_pipeline(
        base_csv=Path(args.base),
        franchise_csv=Path(args.franchise),
        municipality_csv=Path(args.municipality),
        output_csv=Path(args.output_csv),
        output_json=Path(args.output_json),
    )
    print(f"Merged pipeline output: {args.output_csv}, {args.output_json}")
