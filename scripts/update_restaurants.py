#!/usr/bin/env python3
"""Validate and store administrator edits for existing restaurants.

The historical CSV remains untouched. Edits are stored as small override
records and applied in the browser on top of the base and admin datasets.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_CSV = REPO_ROOT / "오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비.csv"
DEFAULT_ADMIN_DATA = REPO_ROOT / "data" / "admin-restaurants.json"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "restaurant-overrides.json"
HTML_TAG_NAMES = (
    "a|abbr|address|area|article|aside|audio|b|base|bdi|bdo|blockquote|body|br|"
    "button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|"
    "dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h[1-6]|"
    "head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|"
    "main|map|mark|menu|meta|meter|nav|noscript|object|ol|optgroup|option|output|"
    "p|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|"
    "small|source|span|strong|style|sub|summary|sup|svg|table|tbody|td|template|"
    "textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr"
)
HTML_TAG_PATTERN = re.compile(
    rf"<!--.*?-->|<\s*/\s*[a-zA-Z][^>]*>|<\s*(?:{HTML_TAG_NAMES})\b[^>]*>|"
    r"<\s*[a-zA-Z][\w:-]*\s+[^>]*>|<\s*[a-zA-Z][\w:-]*/\s*>",
    re.DOTALL | re.IGNORECASE,
)


class UpdateError(ValueError):
    """Raised when an existing-restaurant edit is invalid."""


def clean_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if HTML_TAG_PATTERN.search(text):
        raise UpdateError("HTML 태그는 입력할 수 없습니다.")
    return text


def first_value(record: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip() != "":
            return value
    return ""


def clean_url(value: Any, label: str) -> str:
    url = clean_text(value)
    if url and not re.match(r"^https?://", url, re.IGNORECASE):
        raise UpdateError(f"{label}은 http:// 또는 https:// 주소여야 합니다.")
    return url


def clean_naver_url(value: Any) -> str:
    url = clean_url(value, "네이버 플레이스 URL")
    if not url:
        return ""
    hostname = (urlparse(url).hostname or "").lower()
    if hostname != "naver.me" and hostname != "naver.com" and not hostname.endswith(
        ".naver.com"
    ):
        raise UpdateError("네이버 플레이스 URL은 naver.com 또는 naver.me 주소여야 합니다.")
    return url


def canonical_url(value: Any) -> str:
    url = clean_text(value)
    try:
        parsed = urlparse(url)
        return f"{(parsed.hostname or '').lower()}{parsed.path.rstrip('/')}"
    except ValueError:
        return re.sub(r"[?#].*$", "", url).rstrip("/")


def place_id_from_url(value: Any) -> str:
    url = clean_text(value)
    match = re.search(r"/(?:entry/)?place/(\d+)", url, re.IGNORECASE)
    if not match:
        match = re.search(r"/(\d{5,})(?:/|$|[?#])", url)
    return match.group(1) if match else ""


def record_fingerprint(name: Any, address: Any) -> str:
    normalized = re.sub(
        r"[^0-9a-z가-힣]",
        "",
        f"{clean_text(name)}|{clean_text(address)}".lower(),
    )
    value = 0x811C9DC5
    for character in normalized:
        value ^= ord(character)
        value = (value * 0x01000193) & 0xFFFFFFFF
    return f"{value:08x}"


def record_fallback_key(name: Any, address: Any) -> str:
    return f"record:{record_fingerprint(name, address)}"


def target_key(record: dict[str, Any]) -> str:
    supplied = clean_text(record.get("targetKey"))
    if supplied:
        return supplied
    record_id = clean_text(record.get("id"))
    if record_id:
        return f"id:{record_id}"
    fingerprint = record_fingerprint(
        first_value(record, "name", "상호명", "식당명"),
        first_value(record, "address", "대표주소", "주소"),
    )
    naver_url = first_value(
        record,
        "naverPlaceUrl",
        "네이버플레이스",
        "네이버플레이스URL",
        "네이버플레이스링크",
    )
    place_id = place_id_from_url(naver_url)
    if place_id:
        return f"place:{place_id}:{fingerprint}"
    canonical = canonical_url(naver_url)
    if canonical:
        return f"url:{canonical}:{fingerprint}"
    return f"record:{fingerprint}"


def as_list(value: Any) -> list[str]:
    items = value if isinstance(value, list) else re.split(r"[,\n]+", str(value or ""))
    result: list[str] = []
    for item in items:
        cleaned = clean_text(item)
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


def base_row_to_record(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": first_value(row, "상호명", "name"),
        "address": first_value(row, "대표주소", "주소", "address"),
        "naverPlaceUrl": first_value(row, "네이버플레이스", "naverPlaceUrl"),
        "imageUrl": first_value(row, "이미지", "imageUrl"),
        "region": {
            "sido": first_value(row, "지역_시도", "sido"),
            "sigungu": first_value(row, "지역_시군구", "sigungu"),
            "eupmyeondong": first_value(row, "지역_읍면동", "eupmyeondong"),
        },
        "category": first_value(row, "식당유형_대", "category"),
        "categoryDetail": first_value(row, "식당유형_세부", "categoryDetail"),
        "mainDishes": as_list(first_value(row, "주요리_대표", "mainDishes")),
        "searchTags": as_list(first_value(row, "검색태그", "searchTags")),
        "verifiedBadge": True,
        "registrationType": "ozicme",
        "source": "base",
    }


def load_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise UpdateError(f"{path.name} 파일은 JSON 배열이어야 합니다.")
    return [item for item in value if isinstance(item, dict)]


def load_targets(
    base_csv: Path,
    admin_data: Path,
    override_output: Path,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    targets: dict[str, dict[str, Any]] = {}
    if base_csv.exists():
        with base_csv.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                record = base_row_to_record(row)
                key = target_key(record)
                record["targetKey"] = key
                targets[key] = record

    for item in load_json_list(admin_data):
        record = {**item, "source": "admin"}
        record["registrationType"] = (
            "ozicme" if bool(record.get("verifiedBadge")) else "external"
        )
        key = target_key(record)
        record["targetKey"] = key
        targets[key] = record

    overrides = load_json_list(override_output)
    for override in overrides:
        key = clean_text(override.get("targetKey"))
        if key in targets:
            base = targets[key]
            targets[key] = {
                **base,
                **override,
                "region": {**(base.get("region") or {}), **(override.get("region") or {})},
                "targetKey": key,
                "source": override.get("source") or base.get("source"),
            }
    return targets, overrides


def normalize_registration_type(value: Any, current: dict[str, Any]) -> str:
    normalized = clean_text(value).lower().replace(" ", "")
    if not normalized:
        return "ozicme" if bool(current.get("verifiedBadge", True)) else "external"
    if normalized in {"ozicme", "오직미", "오직미쌀거래식당", "오직미거래식당"}:
        return "ozicme"
    if normalized in {"external", "외부", "외부좋은쌀식당"}:
        return "external"
    raise UpdateError("등록 구분을 확인하세요.")


def normalize_update(
    source: dict[str, Any],
    current: dict[str, Any],
    timestamp: datetime,
) -> dict[str, Any]:
    key = clean_text(source.get("targetKey"))
    name = clean_text(first_value(source, "name", "상호명"))
    address = clean_text(first_value(source, "address", "대표주소", "주소"))
    if not name or not address:
        raise UpdateError("상호명과 대표주소는 필수입니다.")

    region_value = source.get("region") if isinstance(source.get("region"), dict) else {}
    region = {
        "sido": clean_text(first_value(region_value, "sido", "지역_시도")),
        "sigungu": clean_text(first_value(region_value, "sigungu", "지역_시군구")),
        "eupmyeondong": clean_text(
            first_value(region_value, "eupmyeondong", "지역_읍면동")
        ),
    }
    registration_type = normalize_registration_type(
        first_value(source, "registrationType", "등록구분"), current
    )
    evidence_url = clean_url(first_value(source, "evidenceUrl", "근거URL"), "근거URL")
    evidence_text = clean_text(first_value(source, "evidenceText", "근거문구"))
    if registration_type == "external" and (not evidence_url or not evidence_text):
        raise UpdateError("외부 좋은 쌀 식당은 근거URL과 근거문구가 모두 필요합니다.")

    is_ozicme = registration_type == "ozicme"
    return {
        "targetKey": key,
        "source": clean_text(current.get("source")) or "base",
        "originalName": clean_text(current.get("originalName") or current.get("name")),
        "originalAddress": clean_text(
            current.get("originalAddress") or current.get("address")
        ),
        "name": name,
        "address": address,
        "naverPlaceUrl": clean_naver_url(
            first_value(source, "naverPlaceUrl", "네이버플레이스URL")
        ),
        "imageUrl": clean_url(first_value(source, "imageUrl", "이미지URL"), "이미지 URL"),
        "region": region,
        "category": clean_text(first_value(source, "category", "식당유형_대")),
        "categoryDetail": clean_text(
            first_value(source, "categoryDetail", "식당유형_세부")
        ),
        "mainDishes": as_list(first_value(source, "mainDishes", "주요리_대표")),
        "signatureMenus": as_list(
            first_value(source, "mainDishes", "signatureMenus", "주요리_대표")
        ),
        "searchTags": as_list(first_value(source, "searchTags", "검색태그")),
        "registrationType": registration_type,
        "verifiedBadge": is_ozicme,
        "badgeLabel": "오직미클럽" if is_ozicme else "",
        "sourceType": "ozicme-admin-edit" if is_ozicme else "external-admin-edit",
        "evidenceUrl": evidence_url if not is_ozicme else "",
        "evidenceText": evidence_text if not is_ozicme else "",
        "updatedAt": timestamp.astimezone(timezone.utc).date().isoformat(),
        "updateSource": "github-admin-edit",
    }


def load_updates(raw: str) -> list[dict[str, Any]]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise UpdateError(f"수정 데이터가 올바른 JSON이 아닙니다: {exc}") from exc
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list) or not value:
        raise UpdateError("수정 데이터는 1개 이상의 JSON 배열이어야 합니다.")
    if not all(isinstance(item, dict) for item in value):
        raise UpdateError("각 수정 데이터는 객체 형식이어야 합니다.")
    return value


def write_json_atomic(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    ) as handle:
        json.dump(records, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_path = Path(handle.name)
    temp_path.replace(path)


def update_restaurants(
    raw: str,
    base_csv: Path,
    admin_data: Path,
    output: Path,
    now: datetime | None = None,
) -> dict[str, Any]:
    timestamp = now or datetime.now(timezone.utc)
    submitted = load_updates(raw)
    targets, existing_overrides = load_targets(base_csv, admin_data, output)
    override_by_key = {
        clean_text(item.get("targetKey")): item
        for item in existing_overrides
        if clean_text(item.get("targetKey"))
    }
    order = [
        clean_text(item.get("targetKey"))
        for item in existing_overrides
        if clean_text(item.get("targetKey"))
    ]
    updated_names: list[str] = []

    for position, source in enumerate(submitted, start=1):
        key = clean_text(source.get("targetKey"))
        if not key:
            raise UpdateError(f"{position}번째 식당: 수정 대상 식별값이 없습니다.")
        current = targets.get(key)
        if not current:
            raise UpdateError(f"{position}번째 식당: 기존 식당 목록에서 대상을 찾지 못했습니다.")
        try:
            override = normalize_update(source, current, timestamp)
        except UpdateError as exc:
            raise UpdateError(f"{position}번째 식당: {exc}") from exc
        if key not in override_by_key:
            order.append(key)
        override_by_key[key] = override
        targets[key] = {**current, **override}
        updated_names.append(override["name"])

    records = [override_by_key[key] for key in order]
    write_json_atomic(output, records)
    return {
        "submitted": len(submitted),
        "updated": len(updated_names),
        "updatedNames": updated_names,
        "totalOverrides": len(records),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="오직미클럽 기존 식당 수정")
    parser.add_argument("--input-file", type=Path, help="수정 JSON 파일")
    parser.add_argument("--base-csv", type=Path, default=DEFAULT_BASE_CSV)
    parser.add_argument("--admin-data", type=Path, default=DEFAULT_ADMIN_DATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    raw = (
        args.input_file.read_text(encoding="utf-8")
        if args.input_file
        else os.environ.get("UPDATES_JSON", "")
    )
    if not raw.strip():
        raise SystemExit("UPDATES_JSON 또는 --input-file이 필요합니다.")
    try:
        result = update_restaurants(raw, args.base_csv, args.admin_data, args.output)
    except UpdateError as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
