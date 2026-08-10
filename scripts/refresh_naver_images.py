#!/usr/bin/env python3
"""Refresh OZICME Club representative images from exact Naver Place pages.

Selection rule:
1. Read the exact Naver Place ID already stored for each public restaurant.
2. Walk Naver Place media in its stored order.
3. Skip videos and animated GIFs.
4. Pick the first usable static JPG/JPEG/PNG/WebP-like image.
5. If Naver temporarily fails or the page format cannot be read, preserve the
   current image instead of clearing it.
6. When the initial Naver payload has no static image, preserve the existing
   image because visible Place media can be injected only after browser rendering.

The script is shardable so GitHub Actions can keep each Naver session small.
Shard jobs only emit JSON results. A later merge step applies image-only partial
overrides to data/restaurant-overrides.json, preserving every non-image field.
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlsplit
from urllib.request import Request, urlopen

try:
    from scripts.add_restaurants import (
        NAVER_PLACE_DETAIL_URL,
        clean_text,
        normalized_name,
        place_id_from_url,
        strip_markup,
    )
    from scripts.image_urls import ImageUrlError, normalize_image_url
    from scripts.update_restaurants import (
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
    )
except ModuleNotFoundError:  # direct script execution
    from add_restaurants import (  # type: ignore
        NAVER_PLACE_DETAIL_URL,
        clean_text,
        normalized_name,
        place_id_from_url,
        strip_markup,
    )
    from image_urls import ImageUrlError, normalize_image_url  # type: ignore
    from update_restaurants import (  # type: ignore
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
    )


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHARD_OUTPUT = REPO_ROOT / "output" / "naver-image-refresh.json"
STATIC_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
ANIMATED_OR_VIDEO_EXTENSIONS = {
    "gif",
    "mp4",
    "webm",
    "m3u8",
    "mov",
    "avi",
    "mkv",
    "flv",
}
MEDIA_TYPE_KEYS = {
    "mediatype",
    "media_type",
    "contenttype",
    "content_type",
    "mimetype",
    "mime_type",
    "type",
    "format",
    "extension",
    "ext",
}
VIDEO_URL_KEYS = {
    "videourl",
    "video_url",
    "movieurl",
    "movie_url",
    "playurl",
    "play_url",
    "streamurl",
    "stream_url",
}
IMAGE_CONTAINER_KEYS = (
    "images",
    "imageUrls",
    "imageURLs",
    "photos",
    "photoList",
    "imageList",
    "representativeImage",
    "representativeImageUrl",
    "imageUrl",
    "imageURL",
    "thumbnailUrl",
    "photoUrl",
)
DIRECT_URL_KEYS = (
    "originalUrl",
    "originalURL",
    "imageUrl",
    "imageURL",
    "url",
    "src",
    "thumbnailUrl",
    "photoUrl",
)


class RefreshError(RuntimeError):
    """Raised when a Place page cannot be confidently read."""


def _normalize_candidate(value: Any) -> str:
    try:
        return normalize_image_url(value)
    except ImageUrlError:
        return ""


def _query_extension(parsed) -> str:
    query = parse_qs(parsed.query)
    for key in ("format", "type", "ext", "extension", "imageType", "fileType"):
        for value in query.get(key, []):
            candidate = str(value).strip().lower().lstrip(".")
            if candidate in STATIC_EXTENSIONS | ANIMATED_OR_VIDEO_EXTENSIONS:
                return candidate
    return ""


def _embedded_source_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return ""
    if (parsed.hostname or "").lower() != "search.pstatic.net":
        return ""
    if not parsed.path.startswith("/common/"):
        return ""
    source = parse_qs(parsed.query).get("src", [""])[0]
    return unquote(source).strip()


def is_static_image_url(value: Any) -> bool:
    """Return True for a URL that is safe to use as a static representative image."""

    normalized = _normalize_candidate(value)
    if not normalized:
        return False
    embedded = _embedded_source_url(normalized)
    if embedded:
        return is_static_image_url(embedded)

    try:
        parsed = urlsplit(normalized)
    except ValueError:
        return False
    path = parsed.path.lower()
    suffix = path.rsplit("/", 1)[-1].rsplit(".", 1)
    extension = suffix[1].lower() if len(suffix) == 2 else ""
    query_extension = _query_extension(parsed)
    if extension in ANIMATED_OR_VIDEO_EXTENSIONS:
        return False
    if query_extension in ANIMATED_OR_VIDEO_EXTENSIONS:
        return False

    lowered = f"{path}?{parsed.query}".lower()
    if re.search(r"(?:^|[?&_/.-])(?:video|movie|motion|clip)(?:[?&_/.-]|$)", lowered):
        return False

    # Naver image CDN URLs often omit a conventional extension. They are still
    # accepted unless the URL or its media metadata says they are animated/video.
    return True


def _mapping_is_excluded_media(value: dict[str, Any]) -> bool:
    lowered = {str(key).lower(): item for key, item in value.items()}
    for key in VIDEO_URL_KEYS:
        if lowered.get(key):
            return True
    for key in ("isvideo", "is_video", "video", "movie"):
        item = lowered.get(key)
        if item is True or str(item).strip().lower() in {"1", "true", "yes", "video", "movie"}:
            return True
    for key in MEDIA_TYPE_KEYS:
        item = lowered.get(key)
        if not item:
            continue
        text = str(item).strip().lower()
        if any(token in text for token in ("video", "movie", "motion", "clip", "gif")):
            return True
        if text.lstrip(".") in ANIMATED_OR_VIDEO_EXTENSIONS:
            return True
    return False


def extract_static_image_urls(
    base: dict[str, Any], state: dict[str, Any] | None = None, place_id: str = ""
) -> list[str]:
    """Resolve ordered Place media references and return static-image URLs only."""

    state = state or {}
    found: list[str] = []
    visited_refs: set[str] = set()
    visited_objects: set[int] = set()

    def add_url(value: Any) -> None:
        if not isinstance(value, str):
            return
        normalized = _normalize_candidate(value)
        if normalized and is_static_image_url(normalized) and normalized not in found:
            found.append(normalized)

    def visit(value: Any) -> None:
        if isinstance(value, str):
            add_url(value)
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        object_id = id(value)
        if object_id in visited_objects:
            return
        visited_objects.add(object_id)
        if _mapping_is_excluded_media(value):
            return

        reference = value.get("__ref")
        if isinstance(reference, str) and reference and reference not in visited_refs:
            visited_refs.add(reference)
            linked = state.get(reference)
            if linked is not None:
                visit(linked)

        for key in DIRECT_URL_KEYS:
            if key in value:
                add_url(value.get(key))
        for key in IMAGE_CONTAINER_KEYS:
            if key in value and key not in DIRECT_URL_KEYS:
                visit(value.get(key))

    # Ordered media arrays come first. Singular representative/thumbnail values
    # are only fallbacks. This lets us skip a first video/GIF and move to the
    # next static photograph.
    for key in IMAGE_CONTAINER_KEYS:
        if key in base:
            visit(base.get(key))

    # Some Place payloads keep photo entities outside PlaceDetailBase and expose
    # them through Apollo references inconsistently. Only scan image/photo keys
    # associated with this Place ID as a conservative fallback.
    if not found and place_id:
        for key, value in state.items():
            key_text = str(key)
            if place_id not in key_text:
                continue
            if not re.search(r"(?:image|photo|media)", key_text, re.IGNORECASE):
                continue
            visit(value)
    return found


def _find_place_base(state: dict[str, Any], place_id: str) -> dict[str, Any]:
    base = state.get(f"PlaceDetailBase:{place_id}")
    if isinstance(base, dict):
        return base
    for value in state.values():
        if not isinstance(value, dict):
            continue
        if str(value.get("id", "")) != place_id:
            continue
        if value.get("name") and (value.get("roadAddress") or value.get("address")):
            return value
    raise RefreshError("네이버 플레이스에서 해당 식당을 찾지 못했습니다.")


def fetch_place_media(place_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"\d{5,}", place_id):
        raise RefreshError("네이버 플레이스 장소 ID를 확인할 수 없습니다.")
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
        raise RefreshError("네이버 플레이스 상세 정보를 확인할 수 없습니다.") from last_error

    state_match = re.search(
        r"^\s*window\.__APOLLO_STATE__\s*=\s*(\{.*\})\s*;?\s*$",
        page,
        re.MULTILINE,
    )
    if not state_match:
        raise RefreshError("네이버 플레이스 상세 정보 형식이 변경되었습니다.")
    try:
        state = json.loads(state_match.group(1))
    except json.JSONDecodeError as exc:
        raise RefreshError("네이버 플레이스 상세 정보를 읽을 수 없습니다.") from exc

    base = _find_place_base(state, place_id)
    return {
        "title": strip_markup(base.get("name")),
        "roadAddress": clean_text(base.get("roadAddress")),
        "address": clean_text(base.get("address")),
        "imageUrls": extract_static_image_urls(base, state, place_id),
    }


def names_compatible(current: Any, naver: Any) -> bool:
    left = normalized_name(current)
    right = normalized_name(naver)
    if not left or not right:
        return False
    if left == right:
        return True
    shorter, longer = sorted((left, right), key=len)
    return len(shorter) >= 3 and shorter in longer


def shard_records(records: list[dict[str, Any]], shard_index: int, shard_count: int):
    ordered = sorted(records, key=lambda item: str(item.get("targetKey", "")))
    return [item for index, item in enumerate(ordered) if index % shard_count == shard_index]


def refresh_shard(
    shard_index: int,
    shard_count: int,
    base_csv: Path = DEFAULT_BASE_CSV,
    admin_data: Path = DEFAULT_ADMIN_DATA,
    override_output: Path = DEFAULT_OUTPUT,
) -> dict[str, Any]:
    targets, _ = load_targets(base_csv, admin_data, override_output)
    records = shard_records(list(targets.values()), shard_index, shard_count)
    updates: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    stats = Counter()

    for record in records:
        stats["processed"] += 1
        place_id = place_id_from_url(record.get("naverPlaceUrl"))
        if not place_id:
            stats["missing_place_id"] += 1
            continue
        try:
            detail = fetch_place_media(place_id)
        except RefreshError as exc:
            stats["fetch_failed"] += 1
            failures.append(
                {
                    "targetKey": str(record.get("targetKey", "")),
                    "name": clean_text(record.get("name")),
                    "reason": str(exc),
                }
            )
            continue

        if not names_compatible(record.get("name"), detail.get("title")):
            stats["name_mismatch"] += 1
            failures.append(
                {
                    "targetKey": str(record.get("targetKey", "")),
                    "name": clean_text(record.get("name")),
                    "reason": f"네이버 상호 불일치: {detail.get('title', '')}",
                }
            )
            continue

        candidates = detail.get("imageUrls") or []
        current = clean_text(record.get("imageUrl"))
        selected = candidates[0] if candidates else ""

        if selected:
            stats["static_found"] += 1
            if selected != current:
                updates.append(
                    {
                        "targetKey": str(record["targetKey"]),
                        "imageUrl": selected,
                        "placeId": place_id,
                    }
                )
                stats["changed"] += 1
            else:
                stats["already_current"] += 1
        else:
            # The first HTML/Apollo payload does not always contain the media
            # visible after the Naver Place page renders. Never clear a stored
            # image solely because this lightweight fetch found no static media.
            stats["no_static_found_preserved"] += 1

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "shardIndex": shard_index,
        "shardCount": shard_count,
        "targetCount": len(records),
        "updates": updates,
        "stats": dict(stats),
        "failures": failures,
    }


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    ) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_name = handle.name
    Path(temp_name).replace(path)


def merge_results(merge_dir: Path, override_output: Path = DEFAULT_OUTPUT) -> dict[str, Any]:
    result_files = sorted(merge_dir.glob("**/result.json"))
    if not result_files:
        raise RefreshError(f"병합할 shard 결과가 없습니다: {merge_dir}")

    update_by_key: dict[str, dict[str, Any]] = {}
    aggregate = Counter()
    failures: list[dict[str, str]] = []
    shard_indexes: set[int] = set()
    shard_count = None

    for path in result_files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise RefreshError(f"잘못된 shard 결과: {path}")
        current_count = int(payload.get("shardCount", 0))
        if shard_count is None:
            shard_count = current_count
        elif current_count != shard_count:
            raise RefreshError("shardCount가 서로 다릅니다.")
        shard_indexes.add(int(payload.get("shardIndex", -1)))
        aggregate.update(payload.get("stats") or {})
        failures.extend(payload.get("failures") or [])
        for update in payload.get("updates") or []:
            key = str(update.get("targetKey", "")).strip()
            if not key:
                continue
            previous = update_by_key.get(key)
            if previous and previous.get("imageUrl") != update.get("imageUrl"):
                raise RefreshError(f"동일 식당에 상충하는 이미지 결과가 있습니다: {key}")
            update_by_key[key] = update

    expected = set(range(shard_count or 0))
    if shard_indexes != expected:
        raise RefreshError(
            f"shard 결과가 완전하지 않습니다: expected={sorted(expected)}, actual={sorted(shard_indexes)}"
        )

    existing: list[dict[str, Any]] = []
    if override_output.exists():
        parsed = json.loads(override_output.read_text(encoding="utf-8"))
        if not isinstance(parsed, list):
            raise RefreshError(f"{override_output.name}은 JSON 배열이어야 합니다.")
        existing = [item for item in parsed if isinstance(item, dict)]

    by_key = {
        str(item.get("targetKey", "")).strip(): item
        for item in existing
        if str(item.get("targetKey", "")).strip()
    }
    today = datetime.now(timezone.utc).date().isoformat()
    applied = 0
    for key, update in update_by_key.items():
        current = by_key.get(key)
        if current is None:
            current = {"targetKey": key}
            existing.append(current)
            by_key[key] = current
        new_url = str(update.get("imageUrl", ""))
        if str(current.get("imageUrl", "")) == new_url and current.get("updateSource") == "github-naver-image-refresh":
            continue
        current["imageUrl"] = new_url
        current["updatedAt"] = today
        current["updateSource"] = "github-naver-image-refresh"
        applied += 1

    write_json_atomic(override_output, existing)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "shards": shard_count,
        "updatesCollected": len(update_by_key),
        "updatesApplied": applied,
        "stats": dict(aggregate),
        "failureCount": len(failures),
        "failures": failures,
    }
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shard-index", type=int)
    parser.add_argument("--shard-count", type=int, default=16)
    parser.add_argument("--output", type=Path, default=DEFAULT_SHARD_OUTPUT)
    parser.add_argument("--merge-dir", type=Path)
    parser.add_argument("--override-output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.merge_dir:
        report = merge_results(args.merge_dir, args.override_output)
        write_json_atomic(args.output, report)
        print(json.dumps({key: value for key, value in report.items() if key != "failures"}, ensure_ascii=False))
        return

    if args.shard_index is None:
        raise SystemExit("--shard-index 또는 --merge-dir가 필요합니다.")
    if args.shard_count <= 0 or not 0 <= args.shard_index < args.shard_count:
        raise SystemExit("shard 범위를 확인하세요.")
    result = refresh_shard(
        args.shard_index,
        args.shard_count,
        override_output=args.override_output,
    )
    write_json_atomic(args.output, result)
    print(json.dumps({"shard": args.shard_index, **result["stats"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
