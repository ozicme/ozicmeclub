#!/usr/bin/env python3
"""Apply a reviewed, address-only correction manifest with drift guards.

The manifest is deliberately evidence-rich.  Every correction must still point
to the same target key, restaurant name, Naver Place ID, and current address
that were audited.  Only the address and derived region are written; menu,
image, URL, category, tags, badges, and administrator fields are preserved.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

try:
    from scripts.add_restaurants import (
        addresses_match,
        clean_text,
        normalized_name,
        place_id_from_url,
    )
    from scripts.audit_restaurant_data import infer_precise_region
    from scripts.sync_naver_addresses import SyncError, upsert_address_overrides
    from scripts.update_restaurants import (
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
    )
except ModuleNotFoundError:  # direct ``python scripts/...`` execution
    from add_restaurants import (  # type: ignore
        addresses_match,
        clean_text,
        normalized_name,
        place_id_from_url,
    )
    from audit_restaurant_data import infer_precise_region  # type: ignore
    from sync_naver_addresses import SyncError, upsert_address_overrides  # type: ignore
    from update_restaurants import (  # type: ignore
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
    )


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXES = REPO_ROOT / "data" / "verified-address-fixes-2026-08-10.json"


def load_fix_manifest(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("fixes"), list):
        raise SyncError("검증 주소 수정 파일은 fixes 배열을 포함한 JSON 객체여야 합니다.")
    fixes = [item for item in value["fixes"] if isinstance(item, dict)]
    if len(fixes) != len(value["fixes"]):
        raise SyncError("검증 주소 수정 파일에 잘못된 항목이 있습니다.")
    return value, fixes


def prepare_updates(
    manifest: dict[str, Any],
    fixes: list[dict[str, Any]],
    targets: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    if not clean_text(manifest.get("auditRunId")) or not clean_text(
        manifest.get("auditHeadSha")
    ):
        raise SyncError("감사 실행 ID와 기준 커밋 SHA가 필요합니다.")
    if not fixes:
        raise SyncError("적용할 검증 주소가 없습니다.")

    keys = [clean_text(item.get("targetKey")) for item in fixes]
    if any(not key for key in keys) or len(keys) != len(set(keys)):
        raise SyncError("수정 대상 키가 비어 있거나 중복되었습니다.")

    place_id_counts = Counter(
        place_id_from_url(record.get("naverPlaceUrl"))
        for record in targets.values()
        if place_id_from_url(record.get("naverPlaceUrl"))
    )
    updates: list[dict[str, Any]] = []
    for fix in fixes:
        key = clean_text(fix.get("targetKey"))
        current = targets.get(key)
        if not current:
            raise SyncError(f"수정 대상을 찾을 수 없습니다: {key}")
        if clean_text(current.get("updateSource")):
            raise SyncError(f"이미 검증된 대상을 다시 수정할 수 없습니다: {key}")

        expected_name = clean_text(fix.get("name"))
        detail_title = clean_text(fix.get("naverDetailTitle"))
        if (
            normalized_name(current.get("name")) != normalized_name(expected_name)
            or normalized_name(expected_name) != normalized_name(detail_title)
        ):
            raise SyncError(f"상호명이 감사 결과와 달라졌습니다: {key}")

        expected_place_id = clean_text(fix.get("placeId"))
        current_place_id = place_id_from_url(current.get("naverPlaceUrl"))
        if expected_place_id != current_place_id:
            raise SyncError(f"네이버 Place ID가 감사 결과와 달라졌습니다: {key}")
        if place_id_counts[current_place_id] != 1:
            raise SyncError(f"여러 행이 같은 Place ID를 사용합니다: {key}")

        expected_current_address = clean_text(fix.get("currentAddress"))
        if clean_text(current.get("address")) != expected_current_address:
            raise SyncError(f"현재 주소가 감사 이후 변경되었습니다: {key}")

        address = clean_text(fix.get("address"))
        detail_address = clean_text(fix.get("naverDetailAddress"))
        region = fix.get("region")
        audit_region = fix.get("auditRegion")
        if (
            not address
            or not detail_address
            or not isinstance(region, dict)
            or not isinstance(audit_region, dict)
        ):
            raise SyncError(f"주소 또는 지역 근거가 없습니다: {key}")
        if not addresses_match(address, detail_address):
            raise SyncError(f"대표주소와 네이버 상세 주소가 다릅니다: {key}")
        if region != audit_region:
            raise SyncError(f"전체 감사의 지역 판정과 수정 지역이 다릅니다: {key}")
        address_region = infer_precise_region(detail_address)
        for field in ("sido", "sigungu"):
            if clean_text(region.get(field)) != clean_text(address_region.get(field)):
                raise SyncError(f"주소에서 계산한 지역과 수정 지역이 다릅니다: {key}")
        if fix.get("menuMatched") is not True:
            raise SyncError(f"메뉴 교차 검증이 완료되지 않았습니다: {key}")

        updates.append(
            {
                "targetKey": key,
                "source": current.get("source", "base"),
                "originalName": current.get("originalName") or current.get("name", ""),
                "originalAddress": current.get("originalAddress")
                or current.get("address", ""),
                "name": current.get("name", ""),
                "address": address,
                "region": dict(region),
            }
        )
    return updates


def apply_manifest(
    fixes_path: Path,
    *,
    base_csv: Path = DEFAULT_BASE_CSV,
    admin_data: Path = DEFAULT_ADMIN_DATA,
    output: Path = DEFAULT_OUTPUT,
) -> dict[str, Any]:
    manifest, fixes = load_fix_manifest(fixes_path)
    targets, _ = load_targets(base_csv, admin_data, output)
    updates = prepare_updates(manifest, fixes, targets)
    return upsert_address_overrides(updates, output)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixes", type=Path, default=DEFAULT_FIXES)
    parser.add_argument("--base-csv", type=Path, default=DEFAULT_BASE_CSV)
    parser.add_argument("--admin-data", type=Path, default=DEFAULT_ADMIN_DATA)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = apply_manifest(
        args.fixes,
        base_csv=args.base_csv,
        admin_data=args.admin_data,
        output=args.output,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
