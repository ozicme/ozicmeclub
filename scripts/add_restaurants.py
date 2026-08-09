#!/usr/bin/env python3
"""Validate and append administrator-supplied restaurants.

The public site keeps the large historical CSV untouched. New administrator
registrations are stored in data/admin-restaurants.json and merged in the
browser. The GitHub Actions workflow is the intended production entrypoint.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

try:
    from scripts.image_urls import ImageUrlError, normalize_image_url
except ModuleNotFoundError:  # direct `python scripts/add_restaurants.py` execution
    from image_urls import ImageUrlError, normalize_image_url


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_CSV = REPO_ROOT / "오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비.csv"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "admin-restaurants.json"
NAVER_LOCAL_SEARCH_URL = "https://naverapihub.apigw.ntruss.com/search/v1/local"
NAVER_PLACE_DETAIL_URL = "https://pcmap.place.naver.com/restaurant/{place_id}/home"
HTML_TAG_PATTERN = re.compile(r"<!--.*?-->|<\s*/?\s*[a-zA-Z][^>]*>", re.DOTALL)

SIDO_ALIASES = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
}


class RegistrationError(ValueError):
    """Raised when submitted restaurant data is invalid."""


def clean_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if HTML_TAG_PATTERN.search(text):
        raise RegistrationError("HTML 태그는 입력할 수 없습니다.")
    return text


def clean_url(value: Any, label: str) -> str:
    url = clean_text(value)
    if url and not re.match(r"^https?://", url, re.IGNORECASE):
        raise RegistrationError(f"{label}은 http:// 또는 https:// 주소여야 합니다.")
    return url


def clean_image_url(value: Any) -> str:
    try:
        return normalize_image_url(clean_text(value))
    except ImageUrlError as exc:
        raise RegistrationError(str(exc)) from exc


def clean_naver_place_url(value: Any) -> str:
    url = clean_url(value, "네이버 플레이스 URL")
    if not url:
        return ""
    hostname = (urlparse(url).hostname or "").lower()
    if hostname != "naver.me" and hostname != "naver.com" and not hostname.endswith(
        ".naver.com"
    ):
        raise RegistrationError("네이버 플레이스 URL은 naver.com 또는 naver.me 주소여야 합니다.")
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


def strip_markup(value: Any) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", str(value or ""))).strip()


def first_value(record: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip() != "":
            return value
    return ""


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return clean_text(value).lower() in {
        "1",
        "true",
        "y",
        "yes",
        "예",
        "네",
        "오직미",
        "오직미거래식당",
    }


def as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        items = value
    else:
        items = re.split(r"[,\n]+", str(value or ""))
    result: list[str] = []
    for item in items:
        cleaned = clean_text(item)
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


def canonical_sido(value: str) -> str:
    cleaned = clean_text(value)
    if not cleaned:
        return ""
    for alias, canonical in SIDO_ALIASES.items():
        if cleaned == alias or cleaned.startswith(alias):
            return canonical
    return cleaned


def infer_region(address: str, supplied: dict[str, Any]) -> dict[str, str]:
    tokens = address.split()
    sido = canonical_sido(
        first_value(supplied, "sido", "지역_시도", "시도")
        or (tokens[0] if tokens else "")
    )
    sigungu = clean_text(first_value(supplied, "sigungu", "지역_시군구", "시군구"))
    eupmyeondong = clean_text(
        first_value(supplied, "eupmyeondong", "지역_읍면동", "읍면동")
    )

    if not sigungu:
        sigungu = next(
            (token for token in tokens[1:4] if re.search(r"(시|군|구)$", token)),
            "",
        )
    if not eupmyeondong:
        eupmyeondong = next(
            (token for token in tokens[1:6] if re.search(r"(읍|면|동)$", token)),
            "",
        )
    return {"sido": sido, "sigungu": sigungu, "eupmyeondong": eupmyeondong}


def base_row_to_record(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": first_value(row, "상호명", "name"),
        "address": first_value(row, "대표주소", "주소", "address"),
        "naverPlaceUrl": first_value(
            row, "네이버플레이스", "네이버플레이스URL", "naverPlaceUrl"
        ),
        "imageUrl": first_value(row, "이미지", "이미지URL", "imageUrl"),
        "region": {
            "sido": first_value(row, "지역_시도", "시도", "sido"),
            "sigungu": first_value(row, "지역_시군구", "시군구", "sigungu"),
            "eupmyeondong": first_value(
                row, "지역_읍면동", "읍면동", "eupmyeondong"
            ),
        },
        "category": first_value(row, "식당유형_대", "음식점유형", "category"),
        "categoryDetail": first_value(
            row, "식당유형_세부", "세부유형", "categoryDetail"
        ),
        "mainDishes": first_value(row, "주요리_대표", "대표메뉴", "mainDishes"),
        "searchTags": first_value(row, "검색태그", "searchTags"),
    }


def load_base_url_indexes(
    base_csv: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_url: dict[str, dict[str, Any]] = {}
    by_place_id: dict[str, dict[str, Any]] = {}
    if not base_csv.exists():
        return by_url, by_place_id
    with base_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            record = base_row_to_record(row)
            naver_url = clean_text(record.get("naverPlaceUrl"))
            if not naver_url:
                continue
            by_url[canonical_url(naver_url)] = record
            place_id = place_id_from_url(naver_url)
            if place_id:
                by_place_id[place_id] = record
    return by_url, by_place_id


def normalized_name(value: Any) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", strip_markup(value).lower())


def normalized_address(value: Any) -> str:
    address = clean_text(value)
    for alias, canonical in SIDO_ALIASES.items():
        if address.startswith(alias):
            address = canonical + address[len(alias) :]
            break
    return re.sub(r"[^0-9a-z가-힣]", "", address.lower())


def addresses_match(left: Any, right: Any) -> bool:
    left_normalized = normalized_address(left)
    right_normalized = normalized_address(right)
    if not left_normalized or not right_normalized:
        return False
    if left_normalized == right_normalized:
        return True
    shorter, longer = sorted((left_normalized, right_normalized), key=len)
    return len(shorter) >= 10 and longer.startswith(shorter)


def fetch_naver_place(place_id: str) -> dict[str, Any]:
    """Read the exact public Naver Place identified by the submitted URL."""
    if not re.fullmatch(r"\d{5,}", place_id):
        raise RegistrationError("네이버 플레이스 장소 ID를 확인할 수 없습니다.")

    request = Request(
        NAVER_PLACE_DETAIL_URL.format(place_id=place_id),
        headers={
            "Accept-Language": "ko-KR,ko;q=0.9",
            "Referer": "https://map.naver.com/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
            ),
        },
    )
    page = ""
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                page = response.read().decode("utf-8")
            break
        except HTTPError as exc:
            last_error = exc
            if exc.code not in {429, 500, 502, 503, 504}:
                break
        except (URLError, TimeoutError, UnicodeDecodeError) as exc:
            last_error = exc
        if attempt < 2:
            time.sleep(0.8 * (2**attempt))
    if not page:
        raise RegistrationError("네이버 플레이스 상세 정보를 확인할 수 없습니다.") from last_error

    state_match = re.search(
        r"^\s*window\.__APOLLO_STATE__\s*=\s*(\{.*\})\s*;?\s*$",
        page,
        re.MULTILINE,
    )
    if not state_match:
        raise RegistrationError("네이버 플레이스 상세 정보 형식이 변경되었습니다.")
    try:
        state = json.loads(state_match.group(1))
    except json.JSONDecodeError as exc:
        raise RegistrationError("네이버 플레이스 상세 정보를 읽을 수 없습니다.") from exc

    base = state.get(f"PlaceDetailBase:{place_id}")
    if not isinstance(base, dict):
        base = next(
            (
                value
                for value in state.values()
                if isinstance(value, dict)
                and str(value.get("id", "")) == place_id
                and value.get("name")
                and (value.get("roadAddress") or value.get("address"))
            ),
            None,
        )
    if not isinstance(base, dict):
        raise RegistrationError("네이버 플레이스에서 해당 식당을 찾지 못했습니다.")

    menus: list[str] = []
    menu_prefix = f"Menu:{place_id}_"
    for key, value in state.items():
        if not key.startswith(menu_prefix) or not isinstance(value, dict):
            continue
        menu = strip_markup(value.get("name"))
        if menu and menu not in menus:
            menus.append(menu)

    name = strip_markup(base.get("name"))
    road_address = clean_text(base.get("roadAddress"))
    address = clean_text(base.get("address"))
    if not name or not (road_address or address):
        raise RegistrationError("네이버 플레이스에 상호명 또는 주소가 없습니다.")

    micro_reviews = base.get("microReviews")
    description = " ".join(
        strip_markup(value) for value in micro_reviews or [] if strip_markup(value)
    )
    return {
        "title": name,
        "roadAddress": road_address,
        "address": address,
        "category": clean_text(base.get("category")),
        "description": description,
        "placeId": place_id,
        "mainDishes": menus[:10],
    }


def search_naver_local(
    name: str,
    client_id: str,
    client_secret: str,
    submitted_url: str = "",
) -> dict[str, Any]:
    place_detail: dict[str, Any] | None = None
    place_id = place_id_from_url(submitted_url)
    if place_id:
        try:
            place_detail = fetch_naver_place(place_id)
        except RegistrationError as exc:
            raise RegistrationError(
                "입력한 네이버 장소 ID의 실제 식당을 확인하지 못했습니다. 잠시 후 다시 실행하세요."
            ) from exc
        if normalized_name(place_detail.get("title")) != normalized_name(name):
            raise RegistrationError(
                "입력한 네이버 플레이스 URL의 실제 상호명과 입력한 상호명이 다릅니다."
            )

    query = urlencode({"query": name, "display": 5})
    request = Request(
        f"{NAVER_LOCAL_SEARCH_URL}?{query}",
        headers={
            "X-NCP-APIGW-API-KEY-ID": client_id,
            "X-NCP-APIGW-API-KEY": client_secret,
            "User-Agent": "ozicmeclub-admin/1.0",
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 401:
            raise RegistrationError(
                "네이버 지역검색 API 인증에 실패했습니다(401). GitHub Secrets에는 "
                "네이버 개발자센터 키가 아니라 NAVER API HUB의 Client ID와 "
                "Client Secret을 저장해야 합니다."
            ) from exc
        raise RegistrationError(f"네이버 지역검색 API 오류({exc.code})가 발생했습니다.") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RegistrationError("네이버 지역검색 API 응답을 확인할 수 없습니다.") from exc

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list) or not items:
        raise RegistrationError(f"네이버에서 '{name}' 검색 결과를 찾지 못했습니다.")

    if place_detail:
        place_addresses = [
            place_detail.get("roadAddress"),
            place_detail.get("address"),
        ]
        for item in items:
            if normalized_name(item.get("title")) != normalized_name(name):
                continue
            item_addresses = [item.get("roadAddress"), item.get("address")]
            if any(
                addresses_match(place_address, item_address)
                for place_address in place_addresses
                for item_address in item_addresses
            ):
                return {
                    **item,
                    "title": place_detail["title"],
                    "roadAddress": place_detail.get("roadAddress")
                    or item.get("roadAddress"),
                    "address": place_detail.get("address") or item.get("address"),
                    "placeId": place_id,
                    "mainDishes": place_detail.get("mainDishes", []),
                }
        raise RegistrationError(
            "입력한 네이버 장소 ID와 상호명으로 다시 검색한 주소가 일치하지 않습니다."
        )

    exact = [item for item in items if normalized_name(item.get("title")) == normalized_name(name)]
    if len(exact) == 1:
        return exact[0]
    if len(items) == 1:
        return items[0]
    candidates = "; ".join(
        f"{strip_markup(item.get('title'))} ({clean_text(item.get('roadAddress') or item.get('address'))})"
        for item in items[:3]
    )
    raise RegistrationError(
        f"'{name}'과 정확히 일치하는 식당을 고르지 못했습니다. "
        f"상호명을 더 정확히 입력하세요. 검색 결과: {candidates}"
    )


def split_naver_categories(value: Any) -> list[str]:
    categories: list[str] = []
    for part in re.split(r"\s*>\s*", str(value or "")):
        cleaned = clean_text(part)
        if cleaned:
            categories.append(cleaned)
    if len(categories) > 1 and categories[0] == "음식점":
        categories = categories[1:]
    return categories


def infer_main_dishes(description: str, categories: list[str]) -> list[str]:
    """Use only conservative menu hints exposed by the Local Search response."""
    dishes: list[str] = []
    for part in re.split(r"[,/|·;]+", description):
        cleaned = re.sub(r"[.!?。]+$", "", clean_text(part)).strip()
        candidate = re.sub(r"\s*(?:전문점|전문)\s*$", "", cleaned).strip()
        if candidate != cleaned and 1 < len(candidate) <= 30 and candidate not in dishes:
            dishes.append(candidate)

    leaf = categories[-1] if categories else ""
    non_menu_leafs = {
        "한식", "중식", "일식", "양식", "아시아음식", "분식", "뷔페",
        "카페,디저트", "카페", "술집", "일식당", "한식당", "중식당",
    }
    if (
        leaf
        and leaf not in non_menu_leafs
        and not re.search(r"(?:식당|음식점|요리|카페)$", leaf)
        and len(leaf) <= 30
        and leaf not in dishes
    ):
        dishes.append(leaf)
    return dishes


def naver_item_to_record(item: dict[str, Any], submitted_url: str) -> dict[str, Any]:
    name = strip_markup(item.get("title"))
    address = clean_text(item.get("roadAddress") or item.get("address"))
    if not name or not address:
        raise RegistrationError("네이버 검색 결과에 상호명 또는 주소가 없습니다.")
    categories = split_naver_categories(item.get("category"))
    description = strip_markup(item.get("description"))
    main_dishes = as_list(item.get("mainDishes")) or infer_main_dishes(
        description, categories
    )
    tags: list[str] = []
    for tag in [*categories, *main_dishes, description]:
        if tag and tag not in tags:
            tags.append(tag)
    return {
        "name": name,
        "address": address,
        "naverPlaceUrl": submitted_url,
        "region": infer_region(address, {}),
        "category": categories[0] if categories else "",
        "categoryDetail": " > ".join(categories[1:]),
        "mainDishes": main_dishes,
        "searchTags": tags,
    }


def enrich_source_record(
    source: dict[str, Any],
    by_url: dict[str, dict[str, Any]],
    by_place_id: dict[str, dict[str, Any]],
    naver_lookup: Callable[[str, str, str, str], dict[str, Any]],
) -> tuple[dict[str, Any], str]:
    name = clean_text(first_value(source, "name", "상호명", "식당명"))
    if not name:
        raise RegistrationError("상호명은 필수입니다.")

    supplied_main_dishes = as_list(
        first_value(source, "mainDishes", "주요리_대표", "대표메뉴")
    )

    existing_address = clean_text(first_value(source, "address", "대표주소", "주소"))
    submitted_url = clean_naver_place_url(
        first_value(
            source,
            "naverPlaceUrl",
            "네이버플레이스",
            "네이버플레이스URL",
            "네이버플레이스링크",
        )
    )
    if existing_address:
        return source, "provided"
    if not submitted_url:
        raise RegistrationError("네이버 플레이스 URL은 필수입니다.")

    matched = by_url.get(canonical_url(submitted_url))
    place_id = place_id_from_url(submitted_url)
    if not matched and place_id:
        matched = by_place_id.get(place_id)
    if matched:
        return {
            **matched,
            **source,
            "name": clean_text(matched.get("name")) or name,
            "address": matched.get("address"),
            "naverPlaceUrl": submitted_url,
            "imageUrl": first_value(source, "imageUrl", "이미지URL", "이미지")
            or matched.get("imageUrl", ""),
            "region": matched.get("region", {}),
            "category": matched.get("category", ""),
            "categoryDetail": matched.get("categoryDetail", ""),
            "mainDishes": supplied_main_dishes or matched.get("mainDishes", []),
            "searchTags": matched.get("searchTags", []),
        }, "catalog"

    client_id = os.environ.get("NAVER_CLIENT_ID", "").strip()
    client_secret = os.environ.get("NAVER_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise RegistrationError(
            "신규 식당 자동 조회에는 NAVER API HUB에서 발급받은 값을 "
            "GitHub Secrets의 NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET에 설정해야 합니다."
        )
    item = naver_lookup(name, client_id, client_secret, submitted_url)
    automatic = naver_item_to_record(item, submitted_url)
    return {
        **automatic,
        **source,
        "name": automatic["name"],
        "address": automatic["address"],
        "naverPlaceUrl": submitted_url,
        "imageUrl": first_value(source, "imageUrl", "이미지URL", "이미지"),
        "region": automatic["region"],
        "category": automatic["category"],
        "categoryDetail": automatic["categoryDetail"],
        "mainDishes": supplied_main_dishes or automatic["mainDishes"],
        "searchTags": automatic["searchTags"],
    }, "naver-api"


def restaurant_key(name: str, address: str) -> str:
    normalized_address = clean_text(address)
    canonical_values = set(SIDO_ALIASES.values())
    if not any(normalized_address.startswith(value) for value in canonical_values):
        for alias, canonical in SIDO_ALIASES.items():
            if normalized_address.startswith(alias):
                normalized_address = canonical + normalized_address[len(alias) :]
                break
    return re.sub(r"[^0-9a-z가-힣]", "", f"{name}|{normalized_address}".lower())


def build_id(name: str, address: str) -> str:
    digest = hashlib.sha1(restaurant_key(name, address).encode("utf-8")).hexdigest()[:12]
    return f"admin-{digest}"


def normalize_record(record: dict[str, Any], today: datetime) -> dict[str, Any]:
    name = clean_text(first_value(record, "name", "상호명", "식당명"))
    address = clean_text(first_value(record, "address", "대표주소", "주소"))
    if not name or not address:
        raise RegistrationError("상호명과 대표주소는 필수입니다.")

    region_value = record.get("region") if isinstance(record.get("region"), dict) else {}
    region_input = {**record, **region_value}
    region = infer_region(address, region_input)
    if not region["sido"]:
        raise RegistrationError(f"'{name}'의 시/도를 확인할 수 없습니다.")

    registration_type = clean_text(first_value(record, "registrationType", "등록구분"))
    if registration_type:
        normalized_type = re.sub(r"\s+", "", registration_type.lower())
        if normalized_type in {"1", "ozicme", "오직미", "오직미쌀거래식당", "오직미거래식당"}:
            is_ozicme = True
        elif normalized_type in {"0", "2", "external", "외부", "외부좋은쌀식당"}:
            is_ozicme = False
        else:
            raise RegistrationError(f"'{name}'의 등록 구분을 확인하세요.")
    else:
        is_ozicme = as_bool(
            first_value(
                record,
                "isOzicmeCustomer",
                "verifiedBadge",
                "오직미거래식당",
                "오직미클럽배지",
            )
        )
    evidence_url = clean_url(first_value(record, "evidenceUrl", "근거URL"), "근거URL")
    evidence_text = clean_text(first_value(record, "evidenceText", "근거문구"))

    naver_url = clean_naver_place_url(
        first_value(
            record,
            "naverPlaceUrl",
            "네이버플레이스",
            "네이버플레이스URL",
            "네이버플레이스링크",
        )
    )
    if not naver_url:
        query = quote(f"{name} {address}")
        naver_url = f"https://map.naver.com/p/search/{query}"

    registered_at = today.astimezone(timezone.utc)
    main_dishes = as_list(first_value(record, "mainDishes", "주요리_대표", "대표메뉴"))
    search_tags = as_list(first_value(record, "searchTags", "검색태그"))
    for dish in main_dishes:
        if dish not in search_tags:
            search_tags.append(dish)

    return {
        "id": build_id(name, address),
        "name": name,
        "address": address,
        "naverPlaceUrl": naver_url,
        "imageUrl": clean_image_url(
            first_value(record, "imageUrl", "이미지", "이미지URL")
        ),
        "region": region,
        "category": clean_text(first_value(record, "category", "식당유형_대", "카테고리")),
        "categoryDetail": clean_text(
            first_value(record, "categoryDetail", "식당유형_세부", "세부업종")
        ),
        "mainDishes": main_dishes,
        "signatureMenus": main_dishes,
        "searchTags": search_tags,
        "verifiedBadge": is_ozicme,
        "badgeLabel": "오직미클럽" if is_ozicme else "",
        "verifiedMonth": registered_at.strftime("%Y-%m") if is_ozicme else "",
        "sourceType": "ozicme-admin" if is_ozicme else "external-admin",
        "evidenceUrl": evidence_url,
        "evidenceText": evidence_text,
        "registrationSource": "github-admin",
        "updatedAt": registered_at.date().isoformat(),
    }


def load_json_records(raw: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RegistrationError(f"등록 데이터가 올바른 JSON이 아닙니다: {exc}") from exc
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list) or not payload:
        raise RegistrationError("식당 데이터는 1개 이상의 JSON 배열이어야 합니다.")
    if not all(isinstance(item, dict) for item in payload):
        raise RegistrationError("각 식당 데이터는 객체 형식이어야 합니다.")
    return payload


def load_existing_keys(base_csv: Path, admin_output: Path) -> set[str]:
    keys: set[str] = set()
    if base_csv.exists():
        with base_csv.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                name = clean_text(first_value(row, "상호명", "name"))
                address = clean_text(first_value(row, "대표주소", "address"))
                if name and address:
                    keys.add(restaurant_key(name, address))
    if admin_output.exists():
        existing = json.loads(admin_output.read_text(encoding="utf-8"))
        for row in existing:
            keys.add(restaurant_key(clean_text(row.get("name")), clean_text(row.get("address"))))
    return keys


def write_json_atomic(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    ) as handle:
        json.dump(records, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_path = Path(handle.name)
    temp_path.replace(path)


def register(
    raw: str,
    base_csv: Path,
    output: Path,
    validate_only: bool = False,
    now: datetime | None = None,
    naver_lookup: Callable[[str, str, str, str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    timestamp = now or datetime.now(timezone.utc)
    submitted = load_json_records(raw)
    existing_records = json.loads(output.read_text(encoding="utf-8")) if output.exists() else []
    existing_keys = load_existing_keys(base_csv, output)
    batch_keys: set[str] = set()
    additions: list[dict[str, Any]] = []
    skipped: list[str] = []
    details: list[dict[str, str]] = []
    by_url, by_place_id = load_base_url_indexes(base_csv)
    lookup = naver_lookup or search_naver_local

    for position, source in enumerate(submitted, start=1):
        try:
            enriched, lookup_source = enrich_source_record(
                source, by_url, by_place_id, lookup
            )
            record = normalize_record(enriched, timestamp)
        except RegistrationError as exc:
            raise RegistrationError(f"{position}번째 식당: {exc}") from exc
        key = restaurant_key(record["name"], record["address"])
        if key in existing_keys or key in batch_keys:
            skipped.append(record["name"])
            details.append(
                {
                    "name": record["name"],
                    "address": record["address"],
                    "category": record["category"],
                    "lookup": lookup_source,
                    "status": "duplicate",
                }
            )
            continue
        batch_keys.add(key)
        additions.append(record)
        details.append(
            {
                "name": record["name"],
                "address": record["address"],
                "category": record["category"],
                "lookup": lookup_source,
                "status": "added" if not validate_only else "validated",
            }
        )

    if not validate_only and additions:
        write_json_atomic(output, [*existing_records, *additions])

    return {
        "submitted": len(submitted),
        "added": len(additions),
        "skipped": len(skipped),
        "skippedNames": skipped,
        "details": details,
        "totalAdminRestaurants": len(existing_records) + len(additions),
        "validateOnly": validate_only,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="오직미클럽 관리자 식당 등록")
    parser.add_argument("--input-file", type=Path, help="등록 JSON 파일")
    parser.add_argument("--base-csv", type=Path, default=DEFAULT_BASE_CSV)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    raw = (
        args.input_file.read_text(encoding="utf-8")
        if args.input_file
        else os.environ.get("RESTAURANTS_JSON", "")
    )
    if not raw.strip():
        raise SystemExit("RESTAURANTS_JSON 또는 --input-file이 필요합니다.")
    try:
        result = register(raw, args.base_csv, args.output, args.validate_only)
    except RegistrationError as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
