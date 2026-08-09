"""Shared representative-image URL validation and fallback helpers."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit


NAVER_IMAGE_HOST_PATTERN = re.compile(r"(^|\.)(?:pstatic\.net|naver\.net)$", re.IGNORECASE)
VIDEO_FILE_PATTERN = re.compile(r"\.(?:mp4|webm|m3u8|mov|avi)(?:$|[?#])", re.IGNORECASE)


class ImageUrlError(ValueError):
    """Raised when a submitted representative-image URL is unsafe or incomplete."""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _parse_http_url(value: Any):
    text = _text(value)
    if text.startswith("//"):
        text = f"https:{text}"
    try:
        parsed = urlsplit(text)
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    return parsed


def image_url_error(value: Any) -> str:
    """Return a Korean validation message, or an empty string for a valid/blank URL."""

    text = _text(value)
    if not text:
        return ""
    if "…" in text:
        return "대표 이미지 URL이 중간에서 잘렸습니다(… 포함)."
    if re.search(r"[<>\"']", text):
        return "대표 이미지 URL에 사용할 수 없는 문자가 있습니다."

    parsed = _parse_http_url(text)
    if not parsed:
        return "대표 이미지 URL은 http:// 또는 https:// 주소여야 합니다."
    if re.match(r"^/https?://", parsed.path, re.IGNORECASE):
        return "대표 이미지 URL 앞부분이 중복되었습니다."

    hostname = (parsed.hostname or "").lower()
    if hostname in {"map.naver.com", "place.naver.com", "m.place.naver.com"} and re.search(
        r"/(?:entry/)?(?:place|restaurant)/", parsed.path, re.IGNORECASE
    ):
        return "네이버 플레이스 주소가 아니라 실제 이미지 주소를 입력하세요."
    if VIDEO_FILE_PATTERN.search(f"{parsed.path}?{parsed.query}"):
        return "동영상 파일 대신 JPG·PNG·GIF·WebP 이미지 주소를 입력하세요."

    if hostname == "search.pstatic.net" and parsed.path.startswith("/common/"):
        source = parse_qs(parsed.query).get("src", [""])[0]
        if not source:
            return "네이버 이미지 URL의 원본(src) 값이 없거나 잘렸습니다."
        source_parsed = _parse_http_url(source)
        if not source_parsed:
            return "네이버 이미지 URL의 원본(src) 주소를 확인하세요."
        if VIDEO_FILE_PATTERN.search(f"{source_parsed.path}?{source_parsed.query}"):
            return "동영상 파일 대신 영상의 JPG 썸네일 주소를 입력하세요."
    return ""


def normalize_image_url(value: Any) -> str:
    """Validate and normalize an optional representative-image URL."""

    error = image_url_error(value)
    if error:
        raise ImageUrlError(error)
    text = _text(value)
    if not text:
        return ""
    if text.startswith("//"):
        text = f"https:{text}"
    parsed = _parse_http_url(text)
    if not parsed:
        return ""
    if parsed.scheme.lower() == "http" and NAVER_IMAGE_HOST_PATTERN.search(
        (parsed.hostname or "").lower()
    ):
        parsed = parsed._replace(scheme="https")
    return urlunsplit(parsed)


def image_candidate_urls(value: Any) -> list[str]:
    """Return browser retry candidates, ordered from preferred to fallback."""

    try:
        primary = normalize_image_url(value)
    except ImageUrlError:
        return []
    if not primary:
        return []

    candidates: list[str] = []

    def add(candidate: Any) -> None:
        try:
            normalized = normalize_image_url(candidate)
        except ImageUrlError:
            return
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    add(primary)
    parsed = urlsplit(primary)
    hostname = (parsed.hostname or "").lower()
    if hostname == "search.pstatic.net" and parsed.path.startswith("/common/"):
        source = parse_qs(parsed.query).get("src", [""])[0]
        try:
            source = normalize_image_url(source)
        except ImageUrlError:
            source = ""
        if source:
            add(source)
            add(f"https://search.pstatic.net/common/?src={quote(source, safe='')}")
    elif NAVER_IMAGE_HOST_PATTERN.search(hostname):
        add(f"https://search.pstatic.net/common/?src={quote(primary, safe='')}")
    return candidates
