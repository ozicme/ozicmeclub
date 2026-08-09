#!/usr/bin/env python3
"""Synchronize homepage addresses with each restaurant's Naver Place page.

The stored Naver Place ID is the primary identity.  An address is changed only
when the Place page title exactly matches the current restaurant name after
normalization.  Rows that cannot be proven are reported for review instead of
being guessed.  The historical CSV is never rewritten; verified corrections
are stored through ``data/restaurant-overrides.json``.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

try:
    from scripts.add_restaurants import (
        RegistrationError,
        clean_text,
        fetch_naver_place,
        normalized_name,
        place_id_from_url,
    )
    from scripts.audit_restaurant_data import (
        AuditError,
        LocationHint,
        hint_matches_candidate,
        infer_precise_region,
        local_search_items,
        record_update_payload,
        same_candidate,
        unique_exact_candidate,
    )
    from scripts.update_restaurants import (
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
        update_restaurants,
    )
except ModuleNotFoundError:  # direct ``python scripts/...`` execution
    from add_restaurants import (  # type: ignore
        RegistrationError,
        clean_text,
        fetch_naver_place,
        normalized_name,
        place_id_from_url,
    )
    from audit_restaurant_data import (  # type: ignore
        AuditError,
        LocationHint,
        hint_matches_candidate,
        infer_precise_region,
        local_search_items,
        record_update_payload,
        same_candidate,
        unique_exact_candidate,
    )
    from update_restaurants import (  # type: ignore
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
        update_restaurants,
    )


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPORT = REPO_ROOT / "output" / "naver-address-sync.json"
DEFAULT_SUMMARY = REPO_ROOT / "output" / "naver-address-sync-summary.md"


class SyncError(RuntimeError):
    """Raised when a sync report is incomplete or internally inconsistent."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def location_hint(record: dict[str, Any]) -> LocationHint:
    region = record.get("region") if isinstance(record.get("region"), dict) else {}
    return LocationHint(
        clean_text(region.get("sido")),
        clean_text(region.get("sigungu")),
        clean_text(region.get("eupmyeondong")),
    )


def base_result(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "targetKey": clean_text(record.get("targetKey")),
        "name": clean_text(record.get("name")),
        "placeId": place_id_from_url(record.get("naverPlaceUrl")),
        "currentAddress": clean_text(record.get("address")),
        "currentRegion": record.get("region") or {},
        "naverTitle": "",
        "naverAddress": "",
        "naverJibunAddress": "",
        "naverRegion": {},
        "source": "",
        "status": "review",
        "issue": "",
    }


def exact_search_candidate(
    record: dict[str, Any],
    lookup: Callable[[str], list[dict[str, Any]]],
) -> tuple[dict[str, Any] | None, str]:
    """Return a candidate only when two strict searches prove the same branch."""
    name = clean_text(record.get("name"))
    hint = location_hint(record)
    first_items = lookup(name)
    first, first_status = unique_exact_candidate(first_items, name)
    if not first:
        return None, f"fallback-first-{first_status}"
    if not hint_matches_candidate(hint, first):
        return None, "fallback-region-mismatch"

    second_query = clean_text(f"{name} {hint.query}")
    if not hint.query:
        address_prefix = " ".join(clean_text(record.get("address")).split()[:2])
        second_query = clean_text(f"{name} {address_prefix}")
    if second_query == name:
        return None, "fallback-location-hint-missing"

    second_items = lookup(second_query)
    second, second_status = unique_exact_candidate(second_items, name)
    if not second:
        return None, f"fallback-second-{second_status}"
    if not hint_matches_candidate(hint, second):
        return None, "fallback-region-mismatch"
    if not same_candidate(first, second):
        return None, "fallback-double-check-conflict"
    return first, ""


def result_from_place(
    record: dict[str, Any],
    detail: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    result = base_result(record)
    title = clean_text(detail.get("title"))
    road_address = clean_text(detail.get("roadAddress"))
    jibun_address = clean_text(detail.get("address"))
    address = road_address or jibun_address
    result.update(
        {
            "naverTitle": title,
            "naverAddress": address,
            "naverJibunAddress": jibun_address,
            "naverRegion": infer_precise_region(road_address, jibun_address),
            "source": source,
        }
    )
    if not title or not address:
        result["issue"] = "naver-place-missing-name-or-address"
        return result
    if normalized_name(title) != normalized_name(record.get("name")):
        result["issue"] = "naver-place-title-mismatch"
        return result
    result["status"] = (
        "unchanged"
        if address == clean_text(record.get("address"))
        else f"ready-{source}"
    )
    return result


def sync_one(
    record: dict[str, Any],
    detail_lookup: Callable[[str], dict[str, Any]],
    search_lookup: Callable[[str], list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Validate one record, preferring its exact Place ID over search."""
    result = base_result(record)
    place_id = result["placeId"]
    if place_id:
        try:
            detail = detail_lookup(place_id)
        except (RegistrationError, AuditError, OSError, TimeoutError) as exc:
            result["issue"] = f"naver-place-fetch-failed: {clean_text(exc)}"
        else:
            return result_from_place(record, detail, source="direct")
    else:
        result["issue"] = "naver-place-id-missing"

    if search_lookup is None:
        return result
    try:
        candidate, issue = exact_search_candidate(record, search_lookup)
    except AuditError as exc:
        result["issue"] = f"naver-search-failed: {clean_text(exc)}"
        return result
    if not candidate:
        result["issue"] = issue
        return result
    fallback = result_from_place(record, candidate, source="search")
    if fallback["status"] == "review" and not fallback["issue"]:
        fallback["issue"] = issue or "fallback-not-proven"
    return fallback


def with_retries(
    lookup: Callable[[str], dict[str, Any]],
    *,
    attempts: int,
    retry_wait: float,
) -> Callable[[str], dict[str, Any]]:
    def wrapped(place_id: str) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                return lookup(place_id)
            except (RegistrationError, AuditError, OSError, TimeoutError) as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    time.sleep(retry_wait * (attempt + 1))
        if isinstance(last_error, RegistrationError):
            raise last_error
        raise RegistrationError("네이버 플레이스 상세 정보를 확인할 수 없습니다.") from last_error

    return wrapped


def select_shard(
    records: Iterable[dict[str, Any]], shard_index: int, shard_count: int
) -> list[dict[str, Any]]:
    if shard_count < 1 or shard_index < 0 or shard_index >= shard_count:
        raise SyncError("샤드 번호를 확인하세요.")
    return [record for index, record in enumerate(records) if index % shard_count == shard_index]


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def collect(
    records: list[dict[str, Any]],
    *,
    shard_index: int,
    shard_count: int,
    detail_lookup: Callable[[str], dict[str, Any]],
    search_lookup: Callable[[str], list[dict[str, Any]]] | None,
    delay: float,
    checkpoint: Callable[[list[dict[str, Any]]], None] | None = None,
) -> list[dict[str, Any]]:
    selected = select_shard(records, shard_index, shard_count)
    results: list[dict[str, Any]] = []
    for index, record in enumerate(selected, start=1):
        results.append(sync_one(record, detail_lookup, search_lookup))
        if checkpoint and (index % 25 == 0 or index == len(selected)):
            checkpoint(results)
        if delay and index < len(selected):
            time.sleep(delay)
    return results


def report_payload(
    results: list[dict[str, Any]], shard_index: int, shard_count: int
) -> dict[str, Any]:
    counts = Counter(result.get("status", "review") for result in results)
    return {
        "generatedAt": utc_now(),
        "shardIndex": shard_index,
        "shardCount": shard_count,
        "summary": {"total": len(results), **dict(sorted(counts.items()))},
        "results": results,
    }


def load_reports(paths: Iterable[Path]) -> list[dict[str, Any]]:
    combined: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in paths:
        value = json.loads(path.read_text(encoding="utf-8"))
        results = value.get("results") if isinstance(value, dict) else None
        if not isinstance(results, list):
            raise SyncError(f"{path}: results 배열이 없습니다.")
        for result in results:
            if not isinstance(result, dict):
                raise SyncError(f"{path}: 잘못된 결과 항목이 있습니다.")
            key = clean_text(result.get("targetKey"))
            if not key or key in seen:
                raise SyncError(f"{path}: 중복되거나 비어 있는 대상 키가 있습니다: {key}")
            seen.add(key)
            combined.append(result)
    return combined


def apply_verified_results(
    results: list[dict[str, Any]],
    *,
    base_csv: Path,
    admin_data: Path,
    output: Path,
    expected_total: int | None = None,
) -> dict[str, Any]:
    if expected_total is not None and len(results) != expected_total:
        raise SyncError(
            f"전체 결과 수가 맞지 않습니다: 예상 {expected_total}, 실제 {len(results)}"
        )

    targets, _ = load_targets(base_csv, admin_data, output)
    updates: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []
    for result in results:
        if result.get("status") not in {"ready-direct", "ready-search"}:
            continue
        key = clean_text(result.get("targetKey"))
        current = targets.get(key)
        if not current:
            rejected.append({"targetKey": key, "reason": "target-missing"})
            continue
        if normalized_name(current.get("name")) != normalized_name(result.get("naverTitle")):
            rejected.append({"targetKey": key, "reason": "title-changed"})
            continue
        report_place_id = clean_text(result.get("placeId"))
        current_place_id = place_id_from_url(current.get("naverPlaceUrl"))
        if result.get("source") == "direct" and report_place_id != current_place_id:
            rejected.append({"targetKey": key, "reason": "place-id-changed"})
            continue
        address = clean_text(result.get("naverAddress"))
        region = result.get("naverRegion")
        if not address or not isinstance(region, dict):
            rejected.append({"targetKey": key, "reason": "address-or-region-missing"})
            continue
        if address == clean_text(current.get("address")) and region == (current.get("region") or {}):
            continue
        updates.append(record_update_payload(current, {"address": address, "region": region}))

    update_result = {
        "submitted": 0,
        "updated": 0,
        "updatedNames": [],
        "totalOverrides": len(json.loads(output.read_text(encoding="utf-8"))) if output.exists() else 0,
    }
    if updates:
        update_result = update_restaurants(
            json.dumps(updates, ensure_ascii=False), base_csv, admin_data, output
        )

    status_counts = Counter(result.get("status", "review") for result in results)
    issue_counts = Counter(
        clean_text(result.get("issue")) for result in results if clean_text(result.get("issue"))
    )
    return {
        "generatedAt": utc_now(),
        "checked": len(results),
        "statusCounts": dict(sorted(status_counts.items())),
        "issueCounts": dict(sorted(issue_counts.items())),
        "applied": update_result["updated"],
        "totalOverrides": update_result["totalOverrides"],
        "rejected": rejected,
        "review": [result for result in results if result.get("status") == "review"],
    }


def summary_markdown(summary: dict[str, Any]) -> str:
    counts = summary.get("statusCounts") or {}
    lines = [
        "# 네이버 플레이스 주소 동기화 결과",
        "",
        f"- 전체 확인: {summary.get('checked', 0):,}개",
        f"- 주소 반영: {summary.get('applied', 0):,}개",
        f"- 이미 일치: {int(counts.get('unchanged', 0)):,}개",
        f"- 자동 판단 보류: {int(counts.get('review', 0)):,}개",
        f"- 전체 수정 이력: {summary.get('totalOverrides', 0):,}개",
    ]
    rejected = summary.get("rejected") or []
    if rejected:
        lines.append(f"- 반영 직전 안전검사 제외: {len(rejected):,}개")
    review = summary.get("review") or []
    if review:
        lines.extend(["", "## 수동 확인 대상"])
        for item in review[:200]:
            lines.append(
                f"- {item.get('name', '')} (`{item.get('targetKey', '')}`): "
                f"{item.get('issue', '확인 필요')}"
            )
        if len(review) > 200:
            lines.append(f"- 그 외 {len(review) - 200:,}개는 JSON 보고서 참조")
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="네이버 플레이스 주소 전체 동기화")
    subparsers = parser.add_subparsers(dest="command", required=True)

    collect_parser = subparsers.add_parser("collect", help="플레이스 주소 수집")
    collect_parser.add_argument("--base-csv", type=Path, default=DEFAULT_BASE_CSV)
    collect_parser.add_argument("--admin-data", type=Path, default=DEFAULT_ADMIN_DATA)
    collect_parser.add_argument("--overrides", type=Path, default=DEFAULT_OUTPUT)
    collect_parser.add_argument("--output", type=Path, default=DEFAULT_REPORT)
    collect_parser.add_argument("--shard-index", type=int, default=0)
    collect_parser.add_argument("--shard-count", type=int, default=1)
    collect_parser.add_argument("--delay", type=float, default=0.25)
    collect_parser.add_argument("--attempts", type=int, default=2)
    collect_parser.add_argument("--retry-wait", type=float, default=1.2)
    collect_parser.add_argument("--names", default="")

    apply_parser = subparsers.add_parser("apply", help="검증 결과 반영")
    apply_parser.add_argument("--reports", type=Path, nargs="+", required=True)
    apply_parser.add_argument("--base-csv", type=Path, default=DEFAULT_BASE_CSV)
    apply_parser.add_argument("--admin-data", type=Path, default=DEFAULT_ADMIN_DATA)
    apply_parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    apply_parser.add_argument("--summary-output", type=Path, default=DEFAULT_SUMMARY)
    apply_parser.add_argument("--result-output", type=Path, default=DEFAULT_REPORT)
    apply_parser.add_argument("--expected-total", type=int)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "collect":
        targets, _ = load_targets(args.base_csv, args.admin_data, args.overrides)
        records = list(targets.values())
        names = {clean_text(value) for value in args.names.split(",") if clean_text(value)}
        if names:
            records = [record for record in records if clean_text(record.get("name")) in names]

        client_id = os.environ.get("NAVER_CLIENT_ID", "").strip()
        client_secret = os.environ.get("NAVER_CLIENT_SECRET", "").strip()
        search_lookup = None
        if client_id and client_secret:
            search_lookup = lambda query: local_search_items(query, client_id, client_secret)
        detail_lookup = with_retries(
            fetch_naver_place, attempts=max(1, args.attempts), retry_wait=max(0, args.retry_wait)
        )

        def checkpoint(results: list[dict[str, Any]]) -> None:
            write_json(args.output, report_payload(results, args.shard_index, args.shard_count))

        results = collect(
            records,
            shard_index=args.shard_index,
            shard_count=args.shard_count,
            detail_lookup=detail_lookup,
            search_lookup=search_lookup,
            delay=max(0, args.delay),
            checkpoint=checkpoint,
        )
        payload = report_payload(results, args.shard_index, args.shard_count)
        write_json(args.output, payload)
        print(json.dumps(payload["summary"], ensure_ascii=False))
        return 0

    results = load_reports(args.reports)
    summary = apply_verified_results(
        results,
        base_csv=args.base_csv,
        admin_data=args.admin_data,
        output=args.output,
        expected_total=args.expected_total,
    )
    write_json(args.result_output, summary)
    args.summary_output.parent.mkdir(parents=True, exist_ok=True)
    args.summary_output.write_text(summary_markdown(summary), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "review"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
