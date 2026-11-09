const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const restaurantRoot = path.join(root, "restaurants");
const homeHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const aboutHtml = fs.readFileSync(path.join(root, "about", "index.html"), "utf8");
const applicationHtml = fs.readFileSync(path.join(root, "apply", "index.html"), "utf8");
const sitemapXml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const rssXml = fs.readFileSync(path.join(root, "rss.xml"), "utf8");

if (!homeHtml.includes('"@type": "SearchAction"')) {
  throw new Error("홈페이지 WebSite 구조화 정보에 SearchAction이 없습니다.");
}
if (!homeHtml.includes('href="/regions/서울특별시/"')) {
  throw new Error("홈페이지에 시도별 정적 탐색 링크가 없습니다.");
}
if (!homeHtml.includes('type="application/rss+xml"') || !rssXml.includes("/restaurants/")) {
  throw new Error("홈페이지의 RSS 발견 링크 또는 식당 목록 RSS 항목이 없습니다.");
}

if (!aboutHtml.includes('"@type":"AboutPage"')) {
  throw new Error("소개·운영기준 페이지에 AboutPage 구조화 정보가 없습니다.");
}
if (!sitemapXml.includes("https://ozicmeclub.kr/about/")) {
  throw new Error("사이트맵에 소개·운영기준 페이지가 없습니다.");
}
if (!applicationHtml.includes('action="https://formsubmit.co/ozic@ozicme.com"')) {
  throw new Error("등재 요청 페이지의 오직미 접수 주소가 올바르지 않습니다.");
}
if (!applicationHtml.includes('name="사용_쌀_품종"')) {
  throw new Error("등재 요청 페이지에 쌀 품종 입력란이 없습니다.");
}
if (
  !applicationHtml.includes(
    "<h1><span>좋은 쌀로 밥하는 식당</span><span>오직미클럽에</span><span>등재해드립니다.</span></h1>"
  )
) {
  throw new Error("등재 요청 페이지 제목이 지정된 3줄 문구가 아닙니다.");
}
if (applicationHtml.includes('name="담당자명"') || applicationHtml.includes('name="연락처"')) {
  throw new Error("등재 요청 페이지에 삭제한 담당자명 또는 전화번호 입력란이 남아 있습니다.");
}
if (!sitemapXml.includes("https://ozicmeclub.kr/apply/")) {
  throw new Error("사이트맵에 식당 등재 요청 페이지가 없습니다.");
}

const restaurantDirectories = fs
  .readdirSync(restaurantRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^(?:p-|r-)/.test(entry.name))
  .map((entry) => entry.name);

const directoryHtml = fs.readFileSync(path.join(restaurantRoot, "index.html"), "utf8");
if (!directoryHtml.includes('"@type":"ItemList"')) {
  throw new Error("전체 식당 첫 페이지에 ItemList 구조화 정보가 없습니다.");
}
const directoryPageDirectories = fs
  .readdirSync(restaurantRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^page-\d+$/.test(entry.name))
  .map((entry) => entry.name);
const expectedDirectoryPages = Math.ceil(restaurantDirectories.length / 200);
if (directoryPageDirectories.length !== Math.max(0, expectedDirectoryPages - 1)) {
  throw new Error("전체 식당 페이지 분할 수가 식당 수와 맞지 않습니다.");
}
if (
  expectedDirectoryPages > 1 &&
  !sitemapXml.includes(`https://ozicmeclub.kr/restaurants/page-${expectedDirectoryPages}/`)
) {
  throw new Error("사이트맵에 마지막 식당 목록 페이지가 없습니다.");
}

let menuPageCount = 0;
for (const directory of restaurantDirectories) {
  const html = fs.readFileSync(path.join(restaurantRoot, directory, "index.html"), "utf8");
  const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (!match) throw new Error(`${directory}: JSON-LD가 없습니다.`);

  const structuredData = JSON.parse(match[1]);
  const graph = structuredData["@graph"] || [structuredData];
  const restaurant = graph.find((item) => item["@type"] === "Restaurant");
  const breadcrumb = graph.find((item) => item["@type"] === "BreadcrumbList");
  if (!restaurant) throw new Error(`${directory}: Restaurant 구조화 정보가 없습니다.`);
  if (!breadcrumb) throw new Error(`${directory}: BreadcrumbList 구조화 정보가 없습니다.`);
  if (!restaurant.mainEntityOfPage?.["@id"]) {
    throw new Error(`${directory}: mainEntityOfPage가 없습니다.`);
  }
  if (!restaurant.dateModified) {
    throw new Error(`${directory}: dateModified가 없습니다.`);
  }
  if (!restaurant.hasMenu?.hasMenuSection?.hasMenuItem?.length) {
    throw new Error(`${directory}: 대표 메뉴 구조화 정보가 없습니다.`);
  }
  menuPageCount += 1;
}

console.log(
  `검색 구조 검증 통과: 식당 ${restaurantDirectories.length.toLocaleString("ko-KR")}곳, 대표 메뉴 구조화 ${menuPageCount.toLocaleString("ko-KR")}곳`
);
