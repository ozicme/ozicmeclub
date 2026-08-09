#!/usr/bin/env python3
"""Audit effective restaurant representative-image URLs.

Structural checks always run. With --network, each unique URL is requested in
the same fallback order used by the browser, so a working original source can
recover a failed Naver image-proxy URL.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

try:
    from scripts.image_urls import image_candidate_urls, image_url_error
    from scripts.update_restaurants import (
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
    )
except ModuleNotFoundError:  # direct `python scripts/audit_image_urls.py` execution
    from image_urls import image_candidate_urls, image_url_error
    from update_restaurants import (
        DEFAULT_ADMIN_DATA,
        DEFAULT_BASE_CSV,
        DEFAULT_OUTPUT,
        load_targets,
    )


IMAGE_MAGIC = (
    b"\xff\xd8\xff",
    b"\x89PNG\r\n\x1a\n",
    b"GIF87a",
    b"GIF89a",
)


def is_image_response(content_type: str, first_bytes: bytes) -> bool:
    if content_type.lower().split(";", 1)[0].strip().startswith("image/"):
        return True
    if any(first_bytes.startswith(prefix) for prefix in IMAGE_MAGIC):
        return True
    if first_bytes.startswith(b"RIFF") and first_bytes[8:12] == b"WEBP":
        return True
    return first_bytes.lstrip().lower().startswith(b"<svg")


def request_image(url: str, timeout: float) -> tuple[bool, str]:
    request = Request(
        url,
        headers={
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Range": "bytes=0-1023",
            "Referer": "https://ozicmeclub.com/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36"
            ),
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            first_bytes = response.read(128)
            content_type = response.headers.get("Content-Type", "")
            status = getattr(response, "status", 200)
        if status not in {200, 206}:
            return False, f"HTTP {status}"
        if not is_image_response(content_type, first_bytes):
            return False, f"이미지 아님 ({content_type or 'Content-Type 없음'})"
        return True, f"HTTP {status} {content_type.split(';', 1)[0]}"
    except HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except URLError as exc:
        return False, f"연결 실패: {exc.reason}"
    except TimeoutError:
        return False, "시간 초과"
    except Exception as exc:  # keep the scheduled audit reporting instead of crashing
        return False, f"{type(exc).__name__}: {exc}"


def network_result(image_url: str, timeout: float) -> dict[str, Any]:
    attempts = []
    for candidate in image_candidate_urls(image_url):
        ok, detail = request_image(candidate, timeout)
        attempts.append({"url": candidate, "ok": ok, "detail": detail})
        if ok:
            return {"ok": True, "workingUrl": candidate, "attempts": attempts}
    return {"ok": False, "workingUrl": "", "attempts": attempts}


def write_github_summary(report: dict[str, Any]) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY", "").strip()
    if not summary_path:
        return
    summary = report["summary"]
    lines = [
        "## 오직미클럽 대표 이미지 점검",
        "",
        f"- 전체 식당: {summary['restaurants']:,}개",
        f"- 이미지 URL 있음: {summary['withImage']:,}개",
        f"- 이미지 URL 없음(대체 이미지 표시): {summary['withoutImage']:,}개",
        f"- 구조 오류: {summary['structuralFailures']:,}개",
    ]
    if summary["networkTested"]:
        lines.extend(
            [
                f"- 실제 로딩 점검: {summary['networkTested']:,}개 URL",
                f"- 실제 로딩 실패: {summary['networkFailures']:,}개 URL",
            ]
        )
    failures = report["structuralFailures"] + report["networkFailures"]
    if failures:
        lines.extend(["", "### 확인이 필요한 식당", ""])
        for failure in failures[:100]:
            lines.append(f"- {failure.get('name') or '(상호명 없음)'}: {failure.get('error') or '이미지 로딩 실패'}")
        if len(failures) > 100:
            lines.append(f"- 외 {len(failures) - 100:,}개는 JSON 보고서를 확인하세요.")
    else:
        lines.extend(["", "구조 오류와 실제 로딩 실패가 없습니다."])
    with Path(summary_path).open("a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def audit(args: argparse.Namespace) -> dict[str, Any]:
    targets, _ = load_targets(args.base_csv, args.admin_data, args.overrides)
    records = list(targets.values())
    structural_failures = []
    url_records: dict[str, list[dict[str, str]]] = {}
    source_hosts = Counter()

    for record in records:
        image_url = str(record.get("imageUrl") or "").strip()
        if not image_url:
            continue
        error = image_url_error(image_url)
        if error:
            structural_failures.append(
                {
                    "targetKey": record.get("targetKey", ""),
                    "name": record.get("name", ""),
                    "imageUrl": image_url,
                    "error": error,
                }
            )
            continue
        url_records.setdefault(image_url, []).append(
            {"targetKey": record.get("targetKey", ""), "name": record.get("name", "")}
        )
        parsed = urlsplit(image_url)
        source = parse_qs(parsed.query).get("src", [""])[0]
        source_host = urlsplit(source).hostname if source else parsed.hostname
        source_hosts[source_host or "(unknown)"] += 1

    network_by_url: dict[str, dict[str, Any]] = {}
    if args.network and url_records:
        unique_urls = list(url_records)
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            results = executor.map(
                lambda url: network_result(url, args.timeout),
                unique_urls,
            )
            network_by_url = dict(zip(unique_urls, results))

    network_failures = []
    repaired_by_fallback = 0
    for image_url, result in network_by_url.items():
        if result["ok"]:
            if result["workingUrl"] != image_candidate_urls(image_url)[0]:
                repaired_by_fallback += 1
            continue
        attempted = ", ".join(attempt["detail"] for attempt in result["attempts"])
        for record in url_records[image_url]:
            network_failures.append(
                {
                    **record,
                    "imageUrl": image_url,
                    "error": attempted or "시도할 수 있는 이미지 주소가 없습니다.",
                    "attempts": result["attempts"],
                }
            )

    report = {
        "summary": {
            "restaurants": len(records),
            "withImage": sum(bool(str(record.get("imageUrl") or "").strip()) for record in records),
            "withoutImage": sum(not str(record.get("imageUrl") or "").strip() for record in records),
            "structuralFailures": len(structural_failures),
            "networkTested": len(network_by_url),
            "networkFailures": sum(not result["ok"] for result in network_by_url.values()),
            "restaurantsWithNetworkFailures": len(network_failures),
            "repairedByFallback": repaired_by_fallback,
        },
        "sourceHosts": dict(source_hosts.most_common()),
        "structuralFailures": structural_failures,
        "networkFailures": network_failures,
    }
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-csv", type=Path, default=DEFAULT_BASE_CSV)
    parser.add_argument("--admin-data", type=Path, default=DEFAULT_ADMIN_DATA)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--network", action="store_true")
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--json-output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = audit(args)
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    write_github_summary(report)
    return 1 if report["structuralFailures"] or report["networkFailures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
