(function attachImageUrlTools(root) {
  "use strict";

  const NAVER_IMAGE_HOST_PATTERN = /(^|\.)(?:pstatic\.net|naver\.net)$/i;
  const VIDEO_FILE_PATTERN = /\.(?:mp4|webm|m3u8|mov|avi)(?:$|[?#])/i;

  const textOf = (value) => String(value || "").trim();

  const parseHttpUrl = (value, baseUrl) => {
    const text = textOf(value);
    if (!text) return null;
    try {
      const url = new URL(text.startsWith("//") ? `https:${text}` : text, baseUrl);
      if (!/^https?:$/.test(url.protocol)) return null;
      return url;
    } catch (error) {
      return null;
    }
  };

  const isNaverPlaceUrl = (url) => {
    const hostname = url.hostname.toLowerCase();
    return (
      (hostname === "map.naver.com" || hostname === "place.naver.com" || hostname === "m.place.naver.com")
      && /\/(?:entry\/)?(?:place|restaurant)\//i.test(url.pathname)
    );
  };

  const invalidReason = (value, baseUrl = "https://ozicmeclub.com/") => {
    const text = textOf(value);
    if (!text) return "";
    if (text.includes("…")) {
      return "대표 이미지 URL이 중간에서 잘렸습니다(… 포함).";
    }
    if (/[<>\"']/.test(text)) {
      return "대표 이미지 URL에 사용할 수 없는 문자가 있습니다.";
    }

    const url = parseHttpUrl(text, baseUrl);
    if (!url) return "대표 이미지 URL은 http:// 또는 https:// 주소여야 합니다.";
    if (/^\/https?:\/\//i.test(url.pathname)) {
      return "대표 이미지 URL 앞부분이 중복되었습니다.";
    }
    if (isNaverPlaceUrl(url)) {
      return "네이버 플레이스 주소가 아니라 실제 이미지 주소를 입력하세요.";
    }
    if (VIDEO_FILE_PATTERN.test(`${url.pathname}${url.search}`)) {
      return "동영상 파일 대신 JPG·PNG·GIF·WebP 이미지 주소를 입력하세요.";
    }

    if (url.hostname.toLowerCase() === "search.pstatic.net" && url.pathname.startsWith("/common/")) {
      const source = url.searchParams.get("src");
      if (!source) return "네이버 이미지 URL의 원본(src) 값이 없거나 잘렸습니다.";
      const sourceUrl = parseHttpUrl(source, baseUrl);
      if (!sourceUrl) return "네이버 이미지 URL의 원본(src) 주소를 확인하세요.";
      if (VIDEO_FILE_PATTERN.test(`${sourceUrl.pathname}${sourceUrl.search}`)) {
        return "동영상 파일 대신 영상의 JPG 썸네일 주소를 입력하세요.";
      }
    }
    return "";
  };

  const normalize = (value, baseUrl = "https://ozicmeclub.com/") => {
    if (invalidReason(value, baseUrl)) return "";
    const url = parseHttpUrl(value, baseUrl);
    if (!url) return "";
    if (url.protocol === "http:" && NAVER_IMAGE_HOST_PATTERN.test(url.hostname)) {
      url.protocol = "https:";
    }
    return url.toString();
  };

  const candidateUrls = (value, baseUrl = "https://ozicmeclub.com/") => {
    const primary = normalize(value, baseUrl);
    if (!primary) return [];

    const candidates = [];
    const add = (candidate) => {
      const normalized = normalize(candidate, baseUrl);
      if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
    };

    add(primary);
    const url = new URL(primary);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "search.pstatic.net" && url.pathname.startsWith("/common/")) {
      const source = normalize(url.searchParams.get("src"), baseUrl);
      if (source) {
        add(source);
        add(`https://search.pstatic.net/common/?src=${encodeURIComponent(source)}`);
      }
    } else if (NAVER_IMAGE_HOST_PATTERN.test(hostname)) {
      add(`https://search.pstatic.net/common/?src=${encodeURIComponent(primary)}`);
    }
    return candidates;
  };

  const api = { candidateUrls, invalidReason, normalize };
  root.OzicmeImageUrls = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
