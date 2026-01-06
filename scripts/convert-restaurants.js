const fs = require("fs");
const path = require("path");

const defaultSource = path.resolve(
  __dirname,
  "..",
  "오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비.csv"
);
const defaultOutput = path.resolve(__dirname, "..", "public-restaurants.json");

const sourcePath = path.resolve(process.argv[2] || defaultSource);
const outputPath = path.resolve(process.argv[3] || defaultOutput);

const parseCsv = (content) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        const nextChar = content[i + 1];
        if (nextChar === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const normalizeText = (value) => (value || "").trim();

const uniqueList = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
};

const splitList = (value, delimiterRegex) =>
  uniqueList(
    normalizeText(value)
      .split(delimiterRegex)
      .map((item) => item.trim())
      .filter(Boolean)
  );

const buildNaverMapLink = (query) =>
  `https://map.naver.com/v5/search/${encodeURIComponent(query)}`;

const inferReservationLinks = (link) => {
  const trimmed = normalizeText(link);
  if (!trimmed) {
    return { naverReservationUrl: "", naverPlaceUrl: "" };
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes("booking.naver.com")) {
    return { naverReservationUrl: trimmed, naverPlaceUrl: "" };
  }

  return { naverReservationUrl: "", naverPlaceUrl: trimmed };
};

const content = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
const rows = parseCsv(content);

const headers = rows[0].map((header) => header.trim());
const headerIndex = Object.fromEntries(
  headers.map((header, index) => [header, index])
);

const getValue = (row, key) => row[headerIndex[key]] || "";
const getValueByKeys = (row, keys) => {
  for (const key of keys) {
    if (headerIndex[key] !== undefined) {
      const value = row[headerIndex[key]];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
  }
  return "";
};

const restaurants = rows
  .slice(1)
  .map((row) => {
    const displayName = normalizeText(getValue(row, "공개표시명"));
    const originalName = normalizeText(getValue(row, "상호명"));
    const fallbackName = normalizeText(getValue(row, "네이버검색어"));
    const name = displayName || originalName || fallbackName;

    if (!name) {
      return null;
    }

    const sido = normalizeText(getValue(row, "지역_시도"));
    const sigungu = normalizeText(getValue(row, "지역_시군구"));
    const eupmyeondong = normalizeText(getValue(row, "지역_읍면동"));

    const category = normalizeText(getValue(row, "식당유형_대"));
    const categoryDetail = normalizeText(getValue(row, "식당유형_세부"));
    const mainDishRaw = normalizeText(getValue(row, "주요리_대표"));
    const mainDishes = splitList(mainDishRaw, /[\/,+]/g);

    const tagRaw =
      normalizeText(getValue(row, "검색태그")) ||
      normalizeText(getValue(row, "검색키워드"));
    const searchTags = splitList(tagRaw, /[,/]/g);

    const mapLink = normalizeText(getValue(row, "네이버지도검색링크"));
    const naverQuery =
      normalizeText(getValue(row, "네이버검색어")) ||
      [name, sigungu].filter(Boolean).join(" ");
    const naverMapUrl = mapLink || buildNaverMapLink(naverQuery);

    const reservationLink = normalizeText(
      getValue(row, "네이버예약/플레이스검색링크")
    );
    const reservationLinks = inferReservationLinks(reservationLink);
    const naverPlaceColumn = normalizeText(
      getValueByKeys(row, [
        "naver_place_url",
        "네이버플레이스",
        "네이버플레이스링크",
        "네이버 플레이스",
      ])
    );
    const imageUrl = normalizeText(
      getValueByKeys(row, ["image_url", "이미지", "이미지URL", "이미지 링크"])
    );
    const naverPlaceUrl = naverPlaceColumn || reservationLinks.naverPlaceUrl;

    return {
      name,
      region: {
        sido,
        sigungu,
        eupmyeondong,
      },
      category,
      categoryDetail,
      mainDishes,
      searchTags,
      signatureMenus: mainDishes,
      address: normalizeText(getValue(row, "대표주소")),
      naverReservationUrl: reservationLinks.naverReservationUrl,
      naverPlaceUrl,
      naverMapUrl,
      priceRange: "",
      phone: "",
      imageUrl,
      thumbnail: imageUrl,
      images: imageUrl ? [imageUrl] : [],
      verifiedBadge: true,
      verifiedMonth: "",
    };
  })
  .filter(Boolean);

fs.writeFileSync(outputPath, JSON.stringify(restaurants, null, 2));

console.log(
  `Converted ${restaurants.length} restaurants -> ${path.relative(
    process.cwd(),
    outputPath
  )}`
);
