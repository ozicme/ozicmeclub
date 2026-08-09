#!/usr/bin/env python3
"""Audit restaurant identity and metadata against Naver Local Search.

The historical catalogue contains some rows whose restaurant name was joined
to another restaurant's address and place URL.  This command deliberately uses
strict, two-query matching and only prepares an automatic correction when both
queries resolve to the same exact-name/address candidate.  Ambiguous rows are
reported without being changed.

Corrections are stored in ``data/restaurant-overrides.json`` so the historical
CSV remains recoverable and every automatic change can be rolled back.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

try:
    from scripts.add_restaurants import (
        NAVER_LOCAL_SEARCH_URL,
        RegistrationError,
        addresses_match,
        canonical_sido,
        clean_text,
        fetch_naver_place,
        infer_main_dishes,
        normalized_address,
        normalized_name,
        place_id_from_url,
        split_naver_categories,
        strip_markup,
    )
    from scripts.image_urls import ImageUrlError, image_candidate_urls, normalize_image_url
    from scripts.update_restaurants import (
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
        target_key,
        update_restaurants,
    )
except ModuleNotFoundError:  # direct script execution
    from add_restaurants import (  # type: ignore
        NAVER_LOCAL_SEARCH_URL,
        RegistrationError,
        addresses_match,
        canonical_sido,
        clean_text,
        fetch_naver_place,
        infer_main_dishes,
        normalized_address,
        normalized_name,
        place_id_from_url,
        split_naver_categories,
        strip_markup,
    )
    from image_urls import ImageUrlError, image_candidate_urls, normalize_image_url  # type: ignore
    from update_restaurants import (  # type: ignore
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
        target_key,
        update_restaurants,
    )


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEGACY_CSV = REPO_ROOT / (
    "오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비_lagacy.csv"
)
DEFAULT_JSON_REPORT = REPO_ROOT / "output" / "restaurant-data-audit.json"
DEFAULT_CSV_REPORT = REPO_ROOT / "output" / "restaurant-data-audit.csv"
DEFAULT_SUMMARY = REPO_ROOT / "output" / "restaurant-data-audit-summary.md"

GENERIC_CATEGORIES = {"", "음식점", "식당", "기타", "기타음식점"}
BROAD_CATEGORIES = {
    "한식",
    "중식",
    "일식",
    "양식",
    "분식",
    "카페",
    "뷔페",
    "아시아음식",
    "술집",
}
PROVINCE_SIDOS = {
    "경기도",
    "강원특별자치도",
    "충청북도",
    "충청남도",
    "전북특별자치도",
    "전라남도",
    "경상북도",
    "경상남도",
    "제주특별자치도",
}


class AuditError(RuntimeError):
    """Raised for a recoverable per-row audit problem."""


@dataclass(frozen=True)
class LocationHint:
    sido: str = ""
    sigungu: str = ""
    eupmyeondong: str = ""

    @property
    def query(self) -> str:
        return " ".join(part for part in (self.sido, self.sigungu, self.eupmyeondong) if part)

    @property
    def supplied(self) -> bool:
        return bool(self.sido or self.sigungu or self.eupmyeondong)


def normalized_token(value: Any) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", clean_text(value).lower())


def expanded_values(values: Any) -> list[str]:
    source = values if isinstance(values, list) else [values]
    result: list[str] = []
    for value in source:
        for item in re.split(r"[,/\n]+", str(value or "")):
            cleaned = clean_text(item)
            if cleaned and cleaned not in result:
                result.append(cleaned)
    return result


def local_search_items(
    query_text: str,
    client_id: str,
    client_secret: str,
    *,
    attempts: int = 4,
) -> list[dict[str, Any]]:
    query = urlencode({"query": query_text, "display": 5})
    request = Request(
        f"{NAVER_LOCAL_SEARCH_URL}?{query}",
        headers={
            "X-NCP-APIGW-API-KEY-ID": client_id,
            "X-NCP-APIGW-API-KEY": client_secret,
            "User-Agent": "ozicmeclub-data-audit/1.0",
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            items = payload.get("items") if isinstance(payload, dict) else None
            return [item for item in items or [] if isinstance(item, dict)]
        except HTTPError as exc:
            last_error = exc
            if exc.code == 401:
                raise AuditError("네이버 지역검색 API 인증에 실패했습니다(401).") from exc
            if exc.code not in {429, 500, 502, 503, 504}:
                raise AuditError(f"네이버 지역검색 API 오류({exc.code})") from exc
        except (URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            last_error = exc
        if attempt + 1 < attempts:
            time.sleep(0.7 * (2**attempt))
    raise AuditError("네이버 지역검색 API 응답을 확인할 수 없습니다.") from last_error


def unique_exact_candidate(
    items: Iterable[dict[str, Any]], name: str
) -> tuple[dict[str, Any] | None, str]:
    exact = [item for item in items if normalized_name(item.get("title")) == normalized_name(name)]
    by_address: dict[str, dict[str, Any]] = {}
    for item in exact:
        address = clean_text(item.get("roadAddress") or item.get("address"))
        if address:
            by_address.setdefault(normalized_address(address), item)
    candidates = list(by_address.values())
    if len(candidates) == 1:
        return candidates[0], "unique"
    if not candidates:
        return None, "no-exact-match"
    return None, f"ambiguous:{len(candidates)}"


def candidate_addresses(item: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("roadAddress", "address"):
        value = clean_text(item.get(key))
        if value and value not in values:
            values.append(value)
    return values


def same_candidate(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if normalized_name(left.get("title")) != normalized_name(right.get("title")):
        return False
    return any(
        addresses_match(left_address, right_address)
        for left_address in candidate_addresses(left)
        for right_address in candidate_addresses(right)
    )


def canonical_candidate_key(item: dict[str, Any]) -> str:
    address = clean_text(item.get("roadAddress") or item.get("address"))
    return f"{normalized_name(item.get('title'))}|{normalized_address(address)}"


def infer_precise_region(road_address: str, jibun_address: str = "") -> dict[str, str]:
    address = clean_text(road_address or jibun_address)
    tokens = address.split()
    sido = canonical_sido(tokens[0] if tokens else "")
    locality = tokens[1:]

    sigungu = ""
    if sido in PROVINCE_SIDOS:
        if len(locality) >= 2 and locality[0].endswith("시") and locality[1].endswith("구"):
            sigungu = f"{locality[0]} {locality[1]}"
        else:
            sigungu = next((token for token in locality[:3] if re.search(r"(?:시|군|구)$", token)), "")
    elif sido != "세종특별자치시":
        sigungu = next((token for token in locality[:3] if re.search(r"(?:군|구)$", token)), "")

    jibun_tokens = clean_text(jibun_address or road_address).split()
    eupmyeondong = next(
        (
            token
            for token in jibun_tokens[1:7]
            if re.search(r"(?:읍|면|동|가|리)$", token)
            and token not in sigungu.split()
        ),
        "",
    )
    return {"sido": sido, "sigungu": sigungu, "eupmyeondong": eupmyeondong}


def region_equal(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return all(
        normalized_token(left.get(key)) == normalized_token(right.get(key))
        for key in ("sido", "sigungu", "eupmyeondong")
    )


def hint_matches_candidate(hint: LocationHint, candidate: dict[str, Any]) -> bool:
    if not hint.supplied:
        return True
    region = infer_precise_region(
        clean_text(candidate.get("roadAddress")), clean_text(candidate.get("address"))
    )
    if hint.sido and canonical_sido(hint.sido) != region["sido"]:
        return False
    if hint.sigungu:
        expected = normalized_token(hint.sigungu)
        actual = normalized_token(region["sigungu"])
        if expected not in actual and actual not in expected:
            return False
    if hint.eupmyeondong:
        expected = normalized_token(hint.eupmyeondong)
        address_text = normalized_token(
            f"{candidate.get('roadAddress', '')} {candidate.get('address', '')}"
        )
        if expected not in address_text:
            return False
    return True


def secondary_query(name: str, hint: LocationHint, candidate: dict[str, Any]) -> str:
    if hint.query:
        return clean_text(f"{name} {hint.query}")
    address = clean_text(candidate.get("roadAddress") or candidate.get("address"))
    region = infer_precise_region(address, clean_text(candidate.get("address")))
    locality = " ".join(part for part in (region["sido"], region["sigungu"]) if part)
    return clean_text(f"{name} {locality}")


def categories_consistent(current: str, categories: list[str]) -> bool:
    current_token = normalized_token(current)
    if current_token in {normalized_token(value) for value in GENERIC_CATEGORIES}:
        return True
    for category in categories:
        category_token = normalized_token(category)
        if current_token in category_token or category_token in current_token:
            return True
    return False


def category_from_naver(categories: list[str]) -> tuple[str, str]:
    if not categories:
        return "", ""
    broad = next((value for value in categories if value in BROAD_CATEGORIES), "")
    category = broad or categories[-1]
    if category.endswith("식당") and category[:-2] in BROAD_CATEGORIES:
        category = category[:-2]
    detail = next((value for value in reversed(categories) if value != category), "")
    return category, detail


def search_url(name: str, address: str) -> str:
    return f"https://map.naver.com/p/search/{quote(clean_text(f'{name} {address}'))}"


def address_matches_candidate(address: str, candidate: dict[str, Any]) -> bool:
    return any(addresses_match(address, value) for value in candidate_addresses(candidate))


def detail_matches_candidate(detail: dict[str, Any], candidate: dict[str, Any]) -> bool:
    if normalized_name(detail.get("title")) != normalized_name(candidate.get("title")):
        return False
    return any(
        addresses_match(left, right)
        for left in (detail.get("roadAddress"), detail.get("address"))
        if left
        for right in candidate_addresses(candidate)
    )


def record_update_payload(record: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    registration_type = clean_text(record.get("registrationType"))
    if not registration_type:
        registration_type = "ozicme" if bool(record.get("verifiedBadge", True)) else "external"
    return {
        "targetKey": record["targetKey"],
        "name": changes.get("name", record.get("name", "")),
        "address": changes.get("address", record.get("address", "")),
        "naverPlaceUrl": changes.get("naverPlaceUrl", record.get("naverPlaceUrl", "")),
        "imageUrl": changes.get("imageUrl", record.get("imageUrl", "")),
        "region": changes.get("region", record.get("region", {})),
        "category": changes.get("category", record.get("category", "")),
        "categoryDetail": changes.get("categoryDetail", record.get("categoryDetail", "")),
        "mainDishes": changes.get("mainDishes", expanded_values(record.get("mainDishes", []))),
        "searchTags": changes.get("searchTags", expanded_values(record.get("searchTags", []))),
        "registrationType": registration_type,
        "evidenceUrl": record.get("evidenceUrl", ""),
        "evidenceText": record.get("evidenceText", ""),
    }


def audit_one(
    record: dict[str, Any],
    hint: LocationHint,
    lookup: Callable[[str], list[dict[str, Any]]],
    detail_lookup: Callable[[str], dict[str, Any]],
    *,
    check_detail: bool,
) -> dict[str, Any]:
    name = clean_text(record.get("name"))
    current_address = clean_text(record.get("address"))
    result: dict[str, Any] = {
        "targetKey": record["targetKey"],
        "source": record.get("source", ""),
        "name": name,
        "status": "review",
        "currentAddress": current_address,
        "naverAddress": "",
        "currentNaverPlaceUrl": clean_text(record.get("naverPlaceUrl")),
        "recommendedNaverPlaceUrl": "",
        "currentRegion": record.get("region") or {},
        "naverRegion": {},
        "currentCategory": clean_text(record.get("category")),
        "naverCategory": "",
        "issues": [],
        "warnings": [],
        "changes": {},
        "doubleCheck": {},
    }
    if not name:
        result["issues"].append("name_missing")
        return result

    first_items = lookup(name)
    first, first_state = unique_exact_candidate(first_items, name)
    result["doubleCheck"]["firstQuery"] = {"query": name, "result": first_state}
    if not first:
        result["issues"].append(first_state)
        return result

    check_query = secondary_query(name, hint, first)
    second_items = lookup(check_query)
    second, second_state = unique_exact_candidate(second_items, name)
    result["doubleCheck"]["secondQuery"] = {"query": check_query, "result": second_state}
    if not second:
        result["issues"].append(f"second-{second_state}")
        return result
    if not same_candidate(first, second):
        result["issues"].append("double-check-conflict")
        return result

    candidate = first
    candidate_address = clean_text(candidate.get("roadAddress") or candidate.get("address"))
    candidate_region = infer_precise_region(
        clean_text(candidate.get("roadAddress")), clean_text(candidate.get("address"))
    )
    categories = split_naver_categories(candidate.get("category"))
    result["candidateKey"] = canonical_candidate_key(candidate)
    result["naverAddress"] = candidate_address
    result["naverRegion"] = candidate_region
    result["naverCategory"] = " > ".join(categories)
    result["doubleCheck"]["sameCandidate"] = True
    result["doubleCheck"]["hint"] = hint.query
    result["doubleCheck"]["hintMatched"] = hint_matches_candidate(hint, candidate)

    address_matches = address_matches_candidate(current_address, candidate)
    if not address_matches and hint.supplied and not hint_matches_candidate(hint, candidate):
        result["issues"].append("intended-region-conflict")
        return result

    current_url = clean_text(record.get("naverPlaceUrl"))
    place_id = place_id_from_url(current_url)
    detail: dict[str, Any] | None = None
    detail_verified = False
    if check_detail and place_id:
        try:
            detail = detail_lookup(place_id)
            detail_verified = detail_matches_candidate(detail, candidate)
            result["doubleCheck"]["placeDetail"] = {
                "placeId": place_id,
                "title": clean_text(detail.get("title")),
                "address": clean_text(detail.get("roadAddress") or detail.get("address")),
                "matched": detail_verified,
            }
        except (RegistrationError, AuditError) as exc:
            result["doubleCheck"]["placeDetail"] = {
                "placeId": place_id,
                "matched": False,
                "error": str(exc),
            }
    elif check_detail:
        result["doubleCheck"]["placeDetail"] = {
            "placeId": "",
            "matched": False,
            "error": "direct-place-id-missing",
        }

    changes: dict[str, Any] = {}
    identity_review_required = False
    if not address_matches:
        result["issues"].append("address_mismatch")
        # A name can legitimately exist at several branches.  Never repair an
        # address unless the *currently linked* direct Place ID independently
        # proves that the row and the Naver search candidate are the same
        # restaurant.  This prevents a correct URL/menu/image bundle from being
        # combined with another branch's address.
        if detail_verified:
            changes["address"] = candidate_address
            changes["region"] = candidate_region
        else:
            identity_review_required = True
            result["warnings"].append("address-fix-requires-place-detail-match")
    elif not region_equal(record.get("region") or {}, candidate_region):
        result["issues"].append("region_mismatch")
        changes["region"] = candidate_region

    if check_detail and not detail_verified:
        identity_review_required = True
        if place_id:
            result["issues"].append("naver_place_identity_mismatch")
        else:
            result["issues"].append("naver_place_id_missing")
        result["recommendedNaverPlaceUrl"] = search_url(name, candidate_address)
    elif not check_detail and not address_matches:
        identity_review_required = True
        result["warnings"].append("naver_place_identity_not_checked")

    current_category = clean_text(record.get("category"))
    if not categories_consistent(current_category, categories):
        result["warnings"].append("category_mismatch")
    if normalized_token(current_category) in {
        normalized_token(value) for value in GENERIC_CATEGORIES
    }:
        category, detail_category = category_from_naver(categories)
        if category and category != current_category:
            changes["category"] = category
            if detail_category and not clean_text(record.get("categoryDetail")):
                changes["categoryDetail"] = detail_category
            result["issues"].append("category_generic")

    dishes = expanded_values(record.get("mainDishes") or [])
    detail_dishes: list[str] = []
    if detail_verified and detail is not None:
        detail_dishes = [
            clean_text(value)
            for value in detail.get("mainDishes") or []
            if clean_text(value)
        ]
        if detail_dishes and dishes:
            current_tokens = {normalized_token(value) for value in dishes}
            detail_tokens = {normalized_token(value) for value in detail_dishes}
            matched_tokens = current_tokens & detail_tokens
            menus_matched = bool(matched_tokens)
            current_coverage = (
                len(matched_tokens) / len(current_tokens) if current_tokens else 0.0
            )
            result["doubleCheck"]["menus"] = {
                "matched": menus_matched,
                "matchedCount": len(matched_tokens),
                "currentCount": len(dishes),
                "placeDetailCount": len(detail_dishes),
                "currentCoverage": round(current_coverage, 3),
            }
            if not menus_matched:
                result["warnings"].append("menus_mismatch")
            elif current_coverage < 0.5:
                result["warnings"].append("menus_partial_mismatch")
        elif detail_dishes and not dishes:
            changes["mainDishes"] = detail_dishes[:10]
            result["issues"].append("menus_missing")
    elif dishes:
        result["warnings"].append("menus_require_place-detail-review")
    inferred_dishes = infer_main_dishes(strip_markup(candidate.get("description")), categories)
    if not dishes:
        if "menus_missing" not in result["issues"]:
            result["warnings"].append("menus_missing")
        if not detail_dishes and inferred_dishes:
            result["warnings"].append("menus_inferred_but_not_applied")

    tags = [clean_text(value) for value in record.get("searchTags") or [] if clean_text(value)]
    if not tags:
        rebuilt_tags = list(dict.fromkeys([*categories, *dishes, *inferred_dishes]))
        if rebuilt_tags:
            changes["searchTags"] = rebuilt_tags
            result["issues"].append("search_tags_missing")

    image_url = clean_text(record.get("imageUrl"))
    detail_images = list(detail.get("imageUrls") or []) if detail_verified and detail else []
    if not image_url:
        result["warnings"].append("image_missing")
        if detail_images:
            try:
                changes["imageUrl"] = normalize_image_url(detail_images[0])
                result["issues"].append("image_missing")
            except ImageUrlError:
                result["warnings"].append("place_detail_image_invalid")
    else:
        try:
            normalize_image_url(image_url)
        except ImageUrlError:
            result["warnings"].append("image_url_invalid")
            if detail_images:
                try:
                    changes["imageUrl"] = normalize_image_url(detail_images[0])
                    result["issues"].append("image_url_invalid")
                except ImageUrlError:
                    result["warnings"].append("place_detail_image_invalid")
        if detail_verified and detail is not None:
            if detail_images:
                current_candidates = set(image_candidate_urls(image_url))
                detail_candidates = {
                    candidate
                    for value in detail_images
                    for candidate in image_candidate_urls(value)
                }
                image_matched = bool(current_candidates & detail_candidates)
                result["doubleCheck"]["image"] = {
                    "matched": image_matched,
                    "placeDetailCandidates": len(detail_candidates),
                }
                if not image_matched:
                    result["warnings"].append("image_mismatch")
            else:
                result["warnings"].append("image_identity_requires_review")
        else:
            result["warnings"].append("image_identity_requires_review")

    result["changes"] = changes
    if identity_review_required:
        # Do not leave partially safe changes available to --apply.  The report
        # still contains the independently observed Naver values for review.
        result["changes"] = {}
        result["status"] = "review"
    else:
        result["status"] = "fix-ready" if changes else "verified"
    return result


def load_hints(base_csv: Path, legacy_csv: Path) -> dict[str, LocationHint]:
    if not base_csv.exists() or not legacy_csv.exists():
        return {}
    with base_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        base_rows = list(csv.DictReader(handle))
    with legacy_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        legacy_rows = list(csv.DictReader(handle))

    occurrences: Counter[str] = Counter()
    hints: dict[str, LocationHint] = {}
    for base, legacy in zip(base_rows, legacy_rows):
        if clean_text(base.get("상호명")) != clean_text(legacy.get("상호명")):
            continue
        record = {
            "name": base.get("상호명", ""),
            "address": base.get("대표주소", ""),
            "naverPlaceUrl": base.get("네이버플레이스", ""),
        }
        base_key = target_key(record)
        occurrences[base_key] += 1
        key = base_key if occurrences[base_key] == 1 else f"{base_key}:duplicate:{occurrences[base_key]}"
        hints[key] = LocationHint(
            sido=clean_text(legacy.get("지역_시도")),
            sigungu=clean_text(legacy.get("지역_시군구")),
            eupmyeondong=clean_text(legacy.get("지역_읍면동")),
        )
    return hints


def write_reports(
    results: list[dict[str, Any]],
    json_output: Path,
    csv_output: Path,
    summary_output: Path,
    *,
    applied: int,
) -> dict[str, int]:
    status_counts = Counter(result["status"] for result in results)
    issue_counts: Counter[str] = Counter()
    warning_counts: Counter[str] = Counter()
    for result in results:
        issue_counts.update(result.get("issues") or [])
        warning_counts.update(result.get("warnings") or [])

    summary = {
        "audited": len(results),
        "verified": status_counts["verified"],
        "fixReady": status_counts["fix-ready"],
        "review": status_counts["review"],
        "applied": applied,
    }
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "issueCounts": dict(issue_counts.most_common()),
        "warningCounts": dict(warning_counts.most_common()),
        "results": results,
    }
    json_output.parent.mkdir(parents=True, exist_ok=True)
    json_output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_output.parent.mkdir(parents=True, exist_ok=True)
    with csv_output.open("w", encoding="utf-8-sig", newline="") as handle:
        fieldnames = [
            "상태",
            "식당명",
            "현재주소",
            "네이버확인주소",
            "현재업종",
            "네이버업종",
            "오류",
            "주의",
            "수정항목",
            "대상키",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for result in results:
            writer.writerow(
                {
                    "상태": result["status"],
                    "식당명": result["name"],
                    "현재주소": result["currentAddress"],
                    "네이버확인주소": result["naverAddress"],
                    "현재업종": result["currentCategory"],
                    "네이버업종": result["naverCategory"],
                    "오류": " | ".join(result.get("issues") or []),
                    "주의": " | ".join(result.get("warnings") or []),
                    "수정항목": " | ".join((result.get("changes") or {}).keys()),
                    "대상키": result["targetKey"],
                }
            )

    lines = [
        "## 오직미클럽 식당 데이터 교차 점검",
        "",
        f"- 점검: **{summary['audited']:,}개**",
        f"- 일치 확인: **{summary['verified']:,}개**",
        f"- 자동 수정 가능: **{summary['fixReady']:,}개**",
        f"- 사람 확인 필요: **{summary['review']:,}개**",
        f"- 실제 반영: **{summary['applied']:,}개**",
        "",
        "### 주요 오류",
        "",
    ]
    lines.extend(f"- `{name}`: {count:,}개" for name, count in issue_counts.most_common(12))
    lines.extend(["", "### 주의 항목", ""])
    lines.extend(f"- `{name}`: {count:,}개" for name, count in warning_counts.most_common(12))
    summary_output.parent.mkdir(parents=True, exist_ok=True)
    summary_output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary


def parse_names(value: str) -> set[str]:
    return {clean_text(name) for name in re.split(r"[\n,]+", value or "") if clean_text(name)}


def run(args: argparse.Namespace) -> dict[str, int]:
    client_id = os.environ.get("NAVER_CLIENT_ID", "").strip()
    client_secret = os.environ.get("NAVER_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise SystemExit("NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET이 필요합니다.")

    targets, _ = load_targets(args.base_csv, args.admin_data, args.overrides)
    names = parse_names(args.names)
    selected = [
        record
        for record in targets.values()
        if not names or clean_text(record.get("name")) in names
    ]
    if args.max_records:
        selected = selected[: args.max_records]
    hints = load_hints(args.base_csv, args.legacy_csv)

    cache: dict[str, list[dict[str, Any]]] = {}
    cache_lock = threading.Lock()

    def lookup(query: str) -> list[dict[str, Any]]:
        key = clean_text(query)
        with cache_lock:
            cached = cache.get(key)
        if cached is not None:
            return cached
        value = local_search_items(key, client_id, client_secret)
        with cache_lock:
            cache.setdefault(key, value)
            return cache[key]

    def work(record: dict[str, Any]) -> dict[str, Any]:
        try:
            return audit_one(
                record,
                hints.get(record["targetKey"], LocationHint()),
                lookup,
                fetch_naver_place,
                check_detail=args.check_detail,
            )
        except Exception as exc:  # keep one row from aborting the full audit
            return {
                "targetKey": record["targetKey"],
                "source": record.get("source", ""),
                "name": clean_text(record.get("name")),
                "status": "review",
                "currentAddress": clean_text(record.get("address")),
                "naverAddress": "",
                "currentNaverPlaceUrl": clean_text(record.get("naverPlaceUrl")),
                "recommendedNaverPlaceUrl": "",
                "currentRegion": record.get("region") or {},
                "naverRegion": {},
                "currentCategory": clean_text(record.get("category")),
                "naverCategory": "",
                "issues": [f"lookup-error:{type(exc).__name__}"],
                "warnings": [],
                "changes": {},
                "doubleCheck": {"error": str(exc)},
            }

    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(work, record): record for record in selected}
        for future in as_completed(futures):
            results.append(future.result())
    order = {record["targetKey"]: index for index, record in enumerate(selected)}
    results.sort(key=lambda result: order[result["targetKey"]])

    # A single Naver candidate must never silently validate multiple catalogue
    # rows.  Even if neither row needs a field update, this is a duplicate or a
    # cross-row identity collision that a human must resolve.
    candidate_rows: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in results:
        if result.get("candidateKey"):
            candidate_rows[result["candidateKey"]].append(result)
    for group in candidate_rows.values():
        unique_targets = {result["targetKey"] for result in group}
        if len(unique_targets) <= 1:
            continue
        for result in group:
            result["status"] = "review"
            if "candidate-used-by-multiple-rows" not in result["issues"]:
                result["issues"].append("candidate-used-by-multiple-rows")
            result["changes"] = {}

    applied = 0
    if args.apply:
        by_key = {record["targetKey"]: record for record in selected}
        updates = [
            record_update_payload(by_key[result["targetKey"]], result["changes"])
            for result in results
            if result["status"] == "fix-ready" and result.get("changes")
        ]
        if updates:
            update_restaurants(
                json.dumps(updates, ensure_ascii=False),
                args.base_csv,
                args.admin_data,
                args.overrides,
            )
            applied = len(updates)

    return write_reports(
        results,
        args.json_output,
        args.csv_output,
        args.summary_output,
        applied=applied,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="오직미클럽 전체 식당 네이버 교차 점검")
    parser.add_argument("--base-csv", type=Path, default=DEFAULT_BASE_CSV)
    parser.add_argument("--legacy-csv", type=Path, default=DEFAULT_LEGACY_CSV)
    parser.add_argument("--admin-data", type=Path, default=DEFAULT_ADMIN_DATA)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--json-output", type=Path, default=DEFAULT_JSON_REPORT)
    parser.add_argument("--csv-output", type=Path, default=DEFAULT_CSV_REPORT)
    parser.add_argument("--summary-output", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--names", default="", help="쉼표 또는 줄바꿈으로 구분한 식당명")
    parser.add_argument("--max-records", type=int, default=0)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--check-detail", action="store_true")
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> int:
    summary = run(parse_args())
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
