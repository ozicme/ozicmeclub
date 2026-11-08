const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const SITE_URL = "https://ozicmeclub.com";
const BASE_CSV = path.join(
  ROOT,
  "오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비.csv"
);
const ADMIN_JSON = path.join(ROOT, "data", "admin-restaurants.json");
const OVERRIDES_JSON = path.join(ROOT, "data", "restaurant-overrides.json");
const CLEANUP_JSON = path.join(ROOT, "data", "naver-place-cleanup-2026-08-10.json");
const SEO_MANUAL_OVERRIDES_JSON = path.join(
  ROOT,
  "data",
  "seo-manual-overrides-2026-11-08.json"
);
const RESTAURANTS_DIR = path.join(ROOT, "restaurants");
const REGIONS_DIR = path.join(ROOT, "regions");
const CATEGORIES_DIR = path.join(ROOT, "categories");
const MENUS_DIR = path.join(ROOT, "menus");
const VERIFIED_DIR = path.join(ROOT, "verified");
const LASTMOD = process.env.SEO_LASTMOD || new Date().toISOString().slice(0, 10);
const GOOD_RICE_LABEL = "좋은 쌀로 정성을 다하는 식당";
const GOOD_RICE_DESCRIPTION =
  "메뉴는 식당마다 다르지만 좋은 쌀로 밥을 제공하며 정성을 다하는 식당입니다.";
const VERIFIED_RICE_LABEL = "좋은 쌀로 정성을 다하는 오직미클럽 인증 식당";
const VERIFIED_RICE_DESCRIPTION =
  "좋은 쌀로 정성을 다하는 식당이며, 오직미가 판매하는 단일품종 맛있는 쌀로 밥하는 오직미클럽 인증 식당입니다.";

const MIN_CATEGORY_RESTAURANTS = 15;
const POPULAR_MENU_PAGES = [
  { label: "솥밥", terms: ["솥밥", "가마솥밥", "돌솥밥"] },
  { label: "장어", terms: ["장어"] },
  { label: "갈비", terms: ["갈비"] },
  { label: "국밥", terms: ["국밥"] },
  { label: "순대국", terms: ["순대국", "순댓국"] },
  { label: "초밥", terms: ["초밥"] },
  { label: "샤브샤브", terms: ["샤브샤브"] },
  { label: "삼계탕", terms: ["삼계탕"] },
  { label: "비빔밥", terms: ["비빔밥"] },
  { label: "백반", terms: ["백반"] },
  { label: "보리밥", terms: ["보리밥"] },
  { label: "해물요리", terms: ["해물", "해산물"] },
  { label: "고기구이", terms: ["고기구이"] },
  { label: "오리요리", terms: ["오리"] },
  { label: "게장", terms: ["게장"] },
];

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const parseCsv = (content) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const text = String(content || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows
    .slice(1)
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
    );
};

const rawValueOf = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};

const canonicalRestaurantUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch (error) {
    return String(value || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
};

const restaurantPlaceId = (value) => {
  const text = String(value || "");
  const match =
    text.match(/\/(?:entry\/)?place\/(\d+)/i) || text.match(/\/(\d{5,})(?:\/|$|[?#])/);
  return match ? match[1] : "";
};

const restaurantFingerprint = (name, address) => {
  const normalized = `${name || ""}|${address || ""}`
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
  let value = 0x811c9dc5;
  for (const character of normalized) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
};

const restaurantTargetKey = (record) => {
  if (record?.targetKey) return String(record.targetKey);
  if (record?.id) return `id:${record.id}`;
  const naverUrl = rawValueOf(record, [
    "naverPlaceUrl",
    "naver_place_url",
    "네이버플레이스",
    "네이버플레이스URL",
    "네이버플레이스링크",
  ]);
  const name = rawValueOf(record, ["name", "상호명", "식당명"]);
  const address = rawValueOf(record, ["address", "대표주소", "주소"]);
  const fingerprint = restaurantFingerprint(name, address);
  const placeId = restaurantPlaceId(naverUrl);
  if (placeId) return `place:${placeId}:${fingerprint}`;
  const canonical = canonicalRestaurantUrl(naverUrl);
  if (canonical) return `url:${canonical}:${fingerprint}`;
  return `record:${fingerprint}`;
};

const mergeRestaurantOverrides = (
  baseStores,
  adminStores,
  overrides,
  cleanupOverrides,
  seoManualOverrides
) => {
  const overrideMap = [...overrides, ...cleanupOverrides, ...seoManualOverrides]
    .filter((item) => item && item.targetKey)
    .reduce((map, item) => {
      const key = String(item.targetKey);
      const current = map.get(key) || {};
      map.set(key, {
        ...current,
        ...item,
        region: { ...(current.region || {}), ...(item.region || {}) },
      });
      return map;
    }, new Map());
  const occurrences = new Map();
  return [
    ...baseStores.map((item) => ({ ...item, dataSource: "base" })),
    ...adminStores.map((item) => ({ ...item, dataSource: "admin" })),
  ]
    .map((item) => {
      const baseKey = restaurantTargetKey(item);
      const occurrence = (occurrences.get(baseKey) || 0) + 1;
      occurrences.set(baseKey, occurrence);
      const targetKey = occurrence === 1 ? baseKey : `${baseKey}:duplicate:${occurrence}`;
      const override = overrideMap.get(targetKey);
      if (!override) return { ...item, targetKey };
      if (override.deleted === true) return null;
      return {
        ...item,
        ...override,
        id: item.id || override.id,
        targetKey,
        dataSource: item.dataSource,
        region: { ...(item.region || {}), ...(override.region || {}) },
      };
    })
    .filter(Boolean);
};

const splitList = (value) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/[\/,+]/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const valueOf = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
};

const normalizeStore = (row) => {
  const name = String(valueOf(row, ["name", "store_name", "상호", "상호명", "식당명"])).trim();
  const address = String(
    valueOf(row, ["address", "addr", "도로명주소", "주소", "대표주소"])
  ).trim();
  const naverPlaceUrl = String(
    valueOf(row, [
      "naver_place_url",
      "naverPlaceUrl",
      "naverPlace",
      "네이버플레이스",
      "네이버플레이스URL",
      "네이버플레이스링크",
      "네이버 플레이스",
      "플레이스링크",
    ])
  ).trim();
  const region = row.region || {
    sido: row.sido || row.지역_시도 || row.지역시도 || "",
    sigungu: row.sigungu || row.지역_시군구 || row.지역시군구 || "",
    eupmyeondong: row.eupmyeondong || row.지역_읍면동 || row.지역읍면동 || "",
  };
  const category = String(
    valueOf(row, ["category", "식당유형_대", "식당유형대", "카테고리"])
  ).trim();
  const categoryDetail = String(
    valueOf(row, ["categoryDetail", "category_detail", "식당유형_세부", "식당유형세부"])
  ).trim();
  const signatureMenus = splitList(
    valueOf(row, ["signatureMenus", "mainDishes", "주요리_대표", "대표메뉴", "메뉴"])
  );
  const imageUrl = String(
    valueOf(row, [
      "imageUrl",
      "image_url",
      "image",
      "thumbnail",
      "thumb",
      "img",
      "photo",
      "대표이미지",
      "이미지",
      "이미지링크",
    ])
  ).trim();
  const verifiedBadge = row.verifiedBadge === true || String(row.registrationType || "") === "ozicme";
  const placeId = restaurantPlaceId(naverPlaceUrl);
  const fingerprint = restaurantFingerprint(name, address);
  const seoId = placeId ? `p-${placeId}-${fingerprint}` : `r-${fingerprint}`;
  return {
    name,
    address,
    naverPlaceUrl,
    region: {
      sido: String(region?.sido || "").trim(),
      sigungu: String(region?.sigungu || "").trim(),
      eupmyeondong: String(region?.eupmyeondong || "").trim(),
    },
    category,
    categoryDetail,
    signatureMenus,
    imageUrl,
    verifiedBadge,
    badgeLabel: verifiedBadge ? "오직미클럽" : "",
    verifiedMonth: String(row.verifiedMonth || "").trim(),
    seoId,
    seoPath: `/restaurants/${seoId}/`,
  };
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const slugify = (value) => {
  const slug = String(value || "")
    .normalize("NFC")
    .replace(/[^0-9a-zA-Z가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "기타";
};

const publicUrl = (pathname) =>
  `${SITE_URL}${pathname
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;

const pageFilePath = (pathname) => {
  if (pathname === "/") return path.join(ROOT, "index.html");
  return path.join(ROOT, pathname.replace(/^\/+|\/+$/g, ""), "index.html");
};

const fileHash = (filePath) => {
  if (!fs.existsSync(filePath)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
};

const readPreviousPageState = () => {
  const sitemapPath = path.join(ROOT, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) return new Map();
  const xml = fs.readFileSync(sitemapPath, "utf8");
  const state = new Map();
  for (const match of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<\/url>/g)) {
    try {
      const pathname = decodeURIComponent(new URL(match[1]).pathname);
      state.set(pathname, {
        lastmod: match[2],
        hash: fileHash(pageFilePath(pathname)),
      });
    } catch (error) {
      // 잘못된 이전 항목은 새 항목으로 다시 기록합니다.
    }
  }
  return state;
};

const menuText = (item) => item.signatureMenus.slice(0, 5).join(" · ") || "대표 메뉴 정보 준비 중";
const regionText = (item) =>
  [item.region.sido, item.region.sigungu, item.region.eupmyeondong].filter(Boolean).join(" ");

const searchableText = (item) =>
  [item.name, item.category, item.categoryDetail, ...item.signatureMenus]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const regionPath = (item) => {
  if (item.region.sido && item.region.sigungu) {
    return `/regions/${slugify(item.region.sido)}/${slugify(item.region.sigungu)}/`;
  }
  if (item.region.sido) return `/regions/${slugify(item.region.sido)}/`;
  return "/restaurants/";
};

const hasFinalConsonant = (value) => {
  const characters = Array.from(String(value || "").trim());
  if (!characters.length) return false;
  const code = characters.at(-1).codePointAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
};

const topicName = (name) => `${name}${hasFinalConsonant(name) ? "은" : "는"}`;

const restaurantSummary = (item) => {
  const area = regionText(item) || "등록된 지역";
  const category = [item.category, item.categoryDetail].filter(Boolean).join("·") || "음식";
  const menuSentence = item.signatureMenus.length
    ? `대표 메뉴로 ${item.signatureMenus.slice(0, 5).join(", ")} 등을 안내하고 있습니다.`
    : "대표 메뉴와 최신 영업 정보는 방문 전에 확인해 주세요.";
  const statusSentence = item.verifiedBadge
    ? VERIFIED_RICE_DESCRIPTION
    : GOOD_RICE_DESCRIPTION;
  return `${area}에 위치한 ${topicName(item.name)} ${category} 식당입니다. ${menuSentence} ${statusSentence}`;
};

const restaurantRelatedLinks = (item, availableCategories) => {
  const links = [];
  if (item.region.sigungu || item.region.sido) {
    links.push({
      label: `${item.region.sigungu || item.region.sido} 식당`,
      url: regionPath(item),
    });
  }
  if (item.category && availableCategories.has(item.category)) {
    links.push({ label: `${item.category} 식당`, url: `/categories/${slugify(item.category)}/` });
  }
  const text = searchableText(item);
  for (const { label, terms } of POPULAR_MENU_PAGES) {
    if (terms.some((term) => text.includes(term.toLowerCase()))) {
      links.push({ label: `${label} 식당`, url: `/menus/${slugify(label)}/` });
    }
  }
  if (item.verifiedBadge) {
    links.push({ label: "오직미클럽 인증 식당", url: "/verified/" });
  }
  const seenLabels = new Set();
  return links
    .filter((link) => {
      if (seenLabels.has(link.label)) return false;
      seenLabels.add(link.label);
      return true;
    })
    .slice(0, 6);
};

const structuredDataWithBreadcrumbs = (jsonLd, breadcrumbs = []) => {
  if (!breadcrumbs.length) return jsonLd;
  const entity = { ...jsonLd };
  delete entity["@context"];
  return {
    "@context": "https://schema.org",
    "@graph": [
      entity,
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: item.url,
        })),
      },
    ],
  };
};

const baseHeader = () => `
  <header class="seo-header">
    <a class="seo-logo" href="/">OZICME</a>
    <nav aria-label="주요 메뉴">
      <a href="/">식당 찾기</a>
      <a href="/verified/">인증 식당</a>
      <a href="/restaurants/">전체 식당 목록</a>
      <a href="https://ozicme.com" target="_blank" rel="noopener">오직미 공식 사이트</a>
    </nav>
  </header>`;

const pageShell = ({ title, description, canonical, image, jsonLd, breadcrumbs = [], body }) => `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:site_name" content="오직미클럽">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image || `${SITE_URL}/assets/ozicmeclub-share.jpg`)}">
  <meta name="theme-color" content="#1f6b4e">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="stylesheet" href="/seo-pages.css?v=20261108-3">
  <script type="application/ld+json">${JSON.stringify(
    structuredDataWithBreadcrumbs(jsonLd, breadcrumbs)
  ).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <div class="seo-page">
    ${baseHeader()}
    <main>${body}</main>
    <footer class="seo-footer">© 2026 OZICME · 오직미클럽 식당 정보</footer>
  </div>
</body>
</html>
`;

const restaurantTitleBase = (item) => {
  const titleArea = [item.region.sigungu, item.region.eupmyeondong, item.category]
    .filter(Boolean)
    .join(" ");
  return item.verifiedBadge
    ? `${item.name} | ${titleArea || item.region.sido} 오직미클럽 인증 식당`
    : `${item.name} | ${titleArea || item.region.sido} 식당 정보`;
};

const renderRestaurantPage = (item, availableCategories, duplicatedTitles) => {
  const verifiedLabel = item.verifiedBadge
    ? VERIFIED_RICE_LABEL
    : GOOD_RICE_LABEL;
  const area = regionText(item) || "지역 정보 준비 중";
  const baseTitle = restaurantTitleBase(item);
  const addressDetail = item.address.split(/\s+/).slice(2).join(" ");
  const title = duplicatedTitles.has(baseTitle)
    ? `${item.name} | ${addressDetail || item.address} 식당 정보`
    : baseTitle;
  const description = `${area} ${item.category || "식당"} ${item.name}. 대표 메뉴: ${menuText(
    item
  )}. ${verifiedLabel}.`;
  const canonical = publicUrl(item.seoPath);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: item.name,
    url: canonical,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    ...(item.imageUrl ? { image: [item.imageUrl] } : {}),
    ...(item.category ? { servesCuisine: item.category } : {}),
    ...(item.signatureMenus.length
      ? {
          hasMenu: {
            "@type": "Menu",
            name: `${item.name} 대표 메뉴`,
            hasMenuSection: {
              "@type": "MenuSection",
              name: "대표 메뉴",
              hasMenuItem: item.signatureMenus.slice(0, 5).map((name) => ({
                "@type": "MenuItem",
                name,
              })),
            },
          },
        }
      : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: item.address,
      addressRegion: item.region.sido,
      addressLocality: item.region.sigungu,
      addressCountry: "KR",
    },
    ...(item.naverPlaceUrl ? { sameAs: [item.naverPlaceUrl] } : {}),
    isPartOf: { "@type": "WebSite", name: "오직미클럽", url: SITE_URL },
    additionalProperty: item.verifiedBadge
      ? {
          "@type": "PropertyValue",
          name: "오직미클럽 등록 안내",
          value: VERIFIED_RICE_LABEL,
        }
      : {
          "@type": "PropertyValue",
          name: "식당 안내",
          value: GOOD_RICE_LABEL,
        },
  };
  const badgeClass = item.verifiedBadge ? "is-verified" : "is-external";
  const summary = restaurantSummary(item);
  const relatedLinks = restaurantRelatedLinks(item, availableCategories);
  const image = item.imageUrl
    ? `<img class="restaurant-image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(
        item.name
      )} 대표 이미지" referrerpolicy="no-referrer" loading="eager">`
    : `<div class="restaurant-image image-placeholder" aria-label="이미지 준비 중">🍚</div>`;
  const body = `
    <article class="restaurant-detail">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / <a href="/restaurants/">전체 식당</a> / ${escapeHtml(
        item.name
      )}</p>
      <div class="restaurant-hero">
        ${image}
        <div class="restaurant-copy">
          <span class="verification ${badgeClass}">${escapeHtml(verifiedLabel)}</span>
          <h1>${escapeHtml(item.name)}</h1>
          <p class="lead">${escapeHtml(area)} · ${escapeHtml(item.category || "업종 정보 준비 중")}</p>
          <dl class="facts">
            <div><dt>주소</dt><dd>${escapeHtml(item.address || "주소 정보 준비 중")}</dd></div>
            <div><dt>업종</dt><dd>${escapeHtml(
              [item.category, item.categoryDetail].filter(Boolean).join(" · ") || "정보 준비 중"
            )}</dd></div>
            <div><dt>대표 메뉴</dt><dd>${escapeHtml(menuText(item))}</dd></div>
            <div><dt>등록 구분</dt><dd>${escapeHtml(verifiedLabel)}</dd></div>
          </dl>
          <div class="detail-actions">
            ${
              item.naverPlaceUrl
                ? `<a class="seo-button primary" href="${escapeHtml(
                    item.naverPlaceUrl
                  )}" target="_blank" rel="noopener">네이버 지도에서 보기</a>`
                : ""
            }
            <a class="seo-button" href="${escapeHtml(regionPath(item))}">같은 지역 식당 찾기</a>
          </div>
        </div>
      </div>
      <section class="restaurant-summary">
        <h2>${escapeHtml(item.name)} 식당 안내</h2>
        <p>${escapeHtml(summary)}</p>
      </section>
      ${
        item.verifiedBadge
          ? `<section class="verification-note">
        <h2>오직미클럽 인증 안내</h2>
        <p>${VERIFIED_RICE_DESCRIPTION} 오직미 쌀 거래가 확인되어 초록 배지가 표시됩니다.${
              item.verifiedMonth ? ` 최근 확인 월은 ${escapeHtml(item.verifiedMonth)}입니다.` : ""
            }</p>
      </section>`
          : ""
      }
      ${
        relatedLinks.length
          ? `<nav class="related-links" aria-label="관련 식당 더 보기">
        <h2>관련 식당 더 보기</h2>
        <div>${relatedLinks
          .map(
            (link) =>
              `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`
          )
          .join("\n")}</div>
      </nav>`
          : ""
      }
    </article>`;
  return pageShell({
    title,
    description,
    canonical,
    image: item.imageUrl,
    jsonLd,
    breadcrumbs: [
      { name: "식당 찾기", url: `${SITE_URL}/` },
      { name: "전체 식당", url: `${SITE_URL}/restaurants/` },
      { name: item.name, url: canonical },
    ],
    body,
  });
};

const groupBy = (items, keyOf) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item) || "기타";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
};

const restaurantList = (items) => `
  <ul class="restaurant-link-list">
    ${items
      .map(
        (item) => `<li>
          <a href="${escapeHtml(item.seoPath)}">${escapeHtml(item.name)}</a>
          ${item.verifiedBadge ? '<span class="mini-badge">오직미클럽</span>' : ""}
          <small>${escapeHtml(
            [item.region.sigungu, item.region.eupmyeondong, item.category].filter(Boolean).join(" · ")
          )}</small>
        </li>`
      )
      .join("\n")}
  </ul>`;

const facetGrid = (entries) => `<div class="region-grid">
    ${entries
      .map(
        ({ label, url, count }) =>
          `<a href="${escapeHtml(url)}"><strong>${escapeHtml(label)}</strong><span>${count.toLocaleString(
            "ko-KR"
          )}곳</span></a>`
      )
      .join("\n")}
  </div>`;

const renderIndexPage = (stores, regionEntries, categoryEntries, menuEntries) => {
  const title = `전체 식당 ${stores.length.toLocaleString("ko-KR")}곳 | 오직미클럽`;
  const description = `좋은 쌀로 정성을 다하는 식당을 지역별로 확인하세요. 오직미가 판매하는 단일품종 맛있는 쌀로 밥하는 오직미클럽 인증 식당은 초록 배지로 구분합니다.`;
  const canonical = `${SITE_URL}/restaurants/`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: canonical,
    description,
  };
  const body = `
    <section class="directory-page">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / 전체 식당</p>
      <h1>전체 식당 목록</h1>
      <p class="lead">총 ${stores.length.toLocaleString("ko-KR")}곳 · 오직미클럽 인증 ${stores
        .filter((item) => item.verifiedBadge)
        .length.toLocaleString("ko-KR")}곳</p>
      <div class="status-legend">
        <a class="verification is-verified" href="/verified/">${VERIFIED_RICE_LABEL}</a>
        <span class="verification is-external">${GOOD_RICE_LABEL}</span>
      </div>
      <h2>지역별 찾기</h2>
      ${facetGrid(regionEntries)}
      <h2>많이 찾는 메뉴</h2>
      ${facetGrid(menuEntries)}
      <h2>업종별 찾기</h2>
      ${facetGrid(categoryEntries)}
      <h2>식당명으로 찾기</h2>
      ${restaurantList(stores).trimStart()}
    </section>`;
  return pageShell({
    title,
    description,
    canonical,
    jsonLd,
    breadcrumbs: [
      { name: "식당 찾기", url: `${SITE_URL}/` },
      { name: "전체 식당", url: canonical },
    ],
    body,
  });
};

const renderFacetPage = ({ label, kind, stores, pathname }) => {
  const verifiedCount = stores.filter((item) => item.verifiedBadge).length;
  const isMenu = kind === "메뉴";
  const title = isMenu
    ? `${label} 식당 ${stores.length.toLocaleString("ko-KR")}곳 | 오직미클럽`
    : `${label} 식당 ${stores.length.toLocaleString("ko-KR")}곳 | 업종별 식당 찾기`;
  const description = `${label} 관련 식당 ${stores.length.toLocaleString(
    "ko-KR"
  )}곳을 지역과 대표 메뉴로 비교해 보세요. 오직미 쌀 거래 확인 식당 ${verifiedCount.toLocaleString(
    "ko-KR"
  )}곳은 초록 배지로 구분됩니다.`;
  const canonical = publicUrl(pathname);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: canonical,
    description,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: stores.length,
      itemListElement: stores.slice(0, 100).map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: publicUrl(item.seoPath),
      })),
    },
  };
  const regionEntries = Array.from(groupBy(stores, (item) => item.region.sido))
    .map(([region, regionStores]) => ({
      label: region,
      url: `/regions/${slugify(region)}/`,
      count: regionStores.length,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
  const body = `
    <section class="directory-page">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / <a href="/restaurants/">전체 식당</a> / ${escapeHtml(
        label
      )}</p>
      <h1>${escapeHtml(label)} ${isMenu ? "식당" : "업종 식당"} 찾기</h1>
      <p class="lead">전체 ${stores.length.toLocaleString(
        "ko-KR"
      )}곳 · 오직미클럽 인증 ${verifiedCount.toLocaleString("ko-KR")}곳</p>
      <div class="verification-note facet-note">
        <h2>${escapeHtml(label)} 식당 안내</h2>
        <p>식당명, 업종 및 등록된 대표 메뉴에 ${escapeHtml(
          label
        )} 관련 정보가 있는 식당을 모았습니다. 방문 전 최신 메뉴와 영업 정보는 네이버 지도에서 확인해 주세요.</p>
      </div>
      <h2>지역별 보기</h2>
      ${facetGrid(regionEntries)}
      <h2>${escapeHtml(label)} 식당 목록</h2>
      ${restaurantList(stores).trimStart()}
    </section>`;
  return pageShell({
    title,
    description,
    canonical,
    jsonLd,
    breadcrumbs: [
      { name: "식당 찾기", url: `${SITE_URL}/` },
      { name: "전체 식당", url: `${SITE_URL}/restaurants/` },
      { name: label, url: canonical },
    ],
    body,
  });
};

const renderVerifiedPage = (stores) => {
  const title = `오직미클럽 인증 식당 ${stores.length.toLocaleString("ko-KR")}곳 | 단일품종 맛있는 쌀로 밥하는 식당`;
  const description = `좋은 쌀로 정성을 다하며 오직미가 판매하는 단일품종 맛있는 쌀로 밥하는 오직미클럽 인증 식당 ${stores.length.toLocaleString(
    "ko-KR"
  )}곳을 지역별로 확인하세요. 인증 식당은 초록색 오직미클럽 배지로 구분합니다.`;
  const pathname = "/verified/";
  const canonical = `${SITE_URL}${pathname}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: canonical,
    description,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: stores.length,
      itemListElement: stores.slice(0, 100).map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: publicUrl(item.seoPath),
      })),
    },
  };
  const regionEntries = Array.from(groupBy(stores, (item) => item.region.sido))
    .map(([region, regionStores]) => ({
      label: region,
      url: `/regions/${slugify(region)}/`,
      count: regionStores.length,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
  const body = `
    <section class="directory-page">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / 오직미클럽 인증 식당</p>
      <span class="verification is-verified">${VERIFIED_RICE_LABEL}</span>
      <h1>오직미클럽 인증 식당</h1>
      <p class="lead">오직미 쌀 거래가 확인된 식당 ${stores.length.toLocaleString("ko-KR")}곳</p>
      <div class="verification-note facet-note">
        <h2>초록 배지의 의미</h2>
        <p>${VERIFIED_RICE_DESCRIPTION} 오직미 쌀 거래가 확인된 식당에는 초록 배지가 표시됩니다.</p>
      </div>
      <h2>지역별 인증 식당</h2>
      ${facetGrid(regionEntries)}
      <h2>인증 식당 전체 목록</h2>
      ${restaurantList(stores).trimStart()}
    </section>`;
  return pageShell({
    title,
    description,
    canonical,
    jsonLd,
    breadcrumbs: [
      { name: "식당 찾기", url: `${SITE_URL}/` },
      { name: "오직미클럽 인증 식당", url: canonical },
    ],
    body,
  });
};

const renderRegionPage = ({ label, stores, pathname, childRegions = [] }) => {
  const verifiedCount = stores.filter((item) => item.verifiedBadge).length;
  const title = `${label} 오직미클럽·식당 목록 ${stores.length.toLocaleString("ko-KR")}곳`;
  const description = `${label} 식당 ${stores.length.toLocaleString(
    "ko-KR"
  )}곳을 확인하세요. 오직미 쌀 거래 확인 식당 ${verifiedCount.toLocaleString(
    "ko-KR"
  )}곳은 초록 배지로 구분됩니다.`;
  const canonical = publicUrl(pathname);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: canonical,
    description,
  };
  const body = `
    <section class="directory-page">
      <p class="breadcrumb"><a href="/">식당 찾기</a> / <a href="/restaurants/">전체 식당</a> / ${escapeHtml(
        label
      )}</p>
      <h1>${escapeHtml(label)} 식당 찾기</h1>
      <p class="lead">전체 ${stores.length.toLocaleString(
        "ko-KR"
      )}곳 · 오직미클럽 인증 ${verifiedCount.toLocaleString("ko-KR")}곳</p>
      ${
        childRegions.length
          ? `<div class="region-grid">${childRegions
              .map(
                ({ label: childLabel, url, count }) =>
                  `<a href="${escapeHtml(url)}"><strong>${escapeHtml(
                    childLabel
                  )}</strong><span>${count.toLocaleString("ko-KR")}곳</span></a>`
              )
              .join("\n")}</div>`
          : ""
      }
      ${restaurantList(stores)}
    </section>`;
  return pageShell({
    title,
    description,
    canonical,
    jsonLd,
    breadcrumbs: [
      { name: "식당 찾기", url: `${SITE_URL}/` },
      { name: "전체 식당", url: `${SITE_URL}/restaurants/` },
      { name: label, url: canonical },
    ],
    body,
  });
};

const ensureCleanDirectory = (directory) => {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
};

const writePage = (directory, content) => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), content, "utf8");
};

const generate = () => {
  const previousPageState = readPreviousPageState();
  const baseStores = parseCsv(fs.readFileSync(BASE_CSV, "utf8"));
  const merged = mergeRestaurantOverrides(
    baseStores,
    readJson(ADMIN_JSON),
    readJson(OVERRIDES_JSON),
    readJson(CLEANUP_JSON),
    readJson(SEO_MANUAL_OVERRIDES_JSON)
  );
  const seen = new Set();
  const stores = merged
    .map(normalizeStore)
    .filter((item) => {
      const key = `${item.name}|${item.address}`.replace(/\s+/g, "").toLowerCase();
      if (!item.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  ensureCleanDirectory(RESTAURANTS_DIR);
  ensureCleanDirectory(REGIONS_DIR);
  ensureCleanDirectory(CATEGORIES_DIR);
  ensureCleanDirectory(MENUS_DIR);
  ensureCleanDirectory(VERIFIED_DIR);

  const availableCategories = new Set(
    Array.from(groupBy(stores, (item) => item.category))
      .filter(
        ([category, categoryStores]) =>
          category && category !== "기타" && categoryStores.length >= MIN_CATEGORY_RESTAURANTS
      )
      .map(([category]) => category)
  );
  const titleCounts = stores.reduce((counts, item) => {
    const title = restaurantTitleBase(item);
    counts.set(title, (counts.get(title) || 0) + 1);
    return counts;
  }, new Map());
  const duplicatedTitles = new Set(
    Array.from(titleCounts).filter(([, count]) => count > 1).map(([title]) => title)
  );

  for (const item of stores) {
    writePage(
      path.join(RESTAURANTS_DIR, item.seoId),
      renderRestaurantPage(item, availableCategories, duplicatedTitles)
    );
  }

  const sitemapPaths = ["/", "/restaurants/"];
  const sidoGroups = groupBy(stores, (item) => item.region.sido);
  const regionEntries = [];
  for (const [sido, sidoStores] of Array.from(sidoGroups).sort(([a], [b]) => a.localeCompare(b, "ko"))) {
    const sidoSlug = slugify(sido);
    const sidoPath = `/regions/${sidoSlug}/`;
    const sigunguGroups = groupBy(sidoStores, (item) => item.region.sigungu);
    const childRegions = [];
    for (const [sigungu, sigunguStores] of Array.from(sigunguGroups).sort(([a], [b]) =>
      a.localeCompare(b, "ko")
    )) {
      const sigunguSlug = slugify(sigungu);
      const sigunguPath = `/regions/${sidoSlug}/${sigunguSlug}/`;
      writePage(
        path.join(REGIONS_DIR, sidoSlug, sigunguSlug),
        renderRegionPage({ label: `${sido} ${sigungu}`, stores: sigunguStores, pathname: sigunguPath })
      );
      childRegions.push({ label: sigungu, url: sigunguPath, count: sigunguStores.length });
      sitemapPaths.push(sigunguPath);
    }
    writePage(
      path.join(REGIONS_DIR, sidoSlug),
      renderRegionPage({ label: sido, stores: sidoStores, pathname: sidoPath, childRegions })
    );
    regionEntries.push({ label: sido, url: sidoPath, count: sidoStores.length });
    sitemapPaths.push(sidoPath);
  }

  const categoryEntries = Array.from(groupBy(stores, (item) => item.category))
    .filter(
      ([category, categoryStores]) =>
        category && category !== "기타" && categoryStores.length >= MIN_CATEGORY_RESTAURANTS
    )
    .map(([category, categoryStores]) => {
      const categoryPath = `/categories/${slugify(category)}/`;
      writePage(
        path.join(CATEGORIES_DIR, slugify(category)),
        renderFacetPage({ label: category, kind: "업종", stores: categoryStores, pathname: categoryPath })
      );
      sitemapPaths.push(categoryPath);
      return { label: category, url: categoryPath, count: categoryStores.length };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));

  const menuEntries = POPULAR_MENU_PAGES.map(({ label, terms }) => {
    const menuStores = stores.filter((item) => {
      const text = searchableText(item);
      return terms.some((term) => text.includes(term.toLowerCase()));
    });
    const menuPath = `/menus/${slugify(label)}/`;
    writePage(
      path.join(MENUS_DIR, slugify(label)),
      renderFacetPage({ label, kind: "메뉴", stores: menuStores, pathname: menuPath })
    );
    sitemapPaths.push(menuPath);
    return { label, url: menuPath, count: menuStores.length };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));

  const verifiedStores = stores.filter((item) => item.verifiedBadge);
  writePage(VERIFIED_DIR, renderVerifiedPage(verifiedStores));
  sitemapPaths.push("/verified/");

  writePage(RESTAURANTS_DIR, renderIndexPage(stores, regionEntries, categoryEntries, menuEntries));
  fs.writeFileSync(
    path.join(ROOT, "restaurants-data.json"),
    `${JSON.stringify(stores)}\n`,
    "utf8"
  );
  sitemapPaths.push(...stores.map((item) => item.seoPath));
  let changedSitemapUrls = 0;
  const sitemapEntries = sitemapPaths.map((pathname) => {
    const previous = previousPageState.get(pathname);
    const currentHash = fileHash(pageFilePath(pathname));
    const changed = !previous || !previous.hash || previous.hash !== currentHash;
    if (changed) changedSitemapUrls += 1;
    return { pathname, lastmod: changed ? LASTMOD : previous.lastmod };
  });
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPaths
    .map(
      (_, index) => `  <url>\n    <loc>${escapeHtml(
        publicUrl(sitemapEntries[index].pathname)
      )}</loc>\n    <lastmod>${sitemapEntries[index].lastmod}</lastmod>\n  </url>`
    )
    .join("\n")}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemap, "utf8");

  const stats = {
    generatedAt: LASTMOD,
    totalRestaurants: stores.length,
    verifiedRestaurants: stores.filter((item) => item.verifiedBadge).length,
    goodRiceRestaurants: stores.filter((item) => !item.verifiedBadge).length,
    regionPages: sitemapPaths.filter((item) => item.startsWith("/regions/")).length,
    categoryPages: categoryEntries.length,
    menuPages: menuEntries.length,
    verifiedPages: 1,
    sitemapUrls: sitemapPaths.length,
    changedSitemapUrls,
  };
  fs.writeFileSync(path.join(ROOT, "seo-build-stats.json"), `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(stats, null, 2));
};

generate();
