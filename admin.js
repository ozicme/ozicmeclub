const WORKFLOW_URL =
  "https://github.com/ozicme/ozicmeclub/actions/workflows/add-restaurants.yml";
const UPDATE_WORKFLOW_URL =
  "https://github.com/ozicme/ozicmeclub/actions/workflows/update-restaurants.yml";
const BASE_DATA_URL =
  "./오직미_식당리스트 - 오직미_식당디렉토리_사이트개발용_최종정비.csv";
const ADMIN_DATA_URL = "./data/admin-restaurants.json";
const OVERRIDE_DATA_URL = "./data/restaurant-overrides.json";
const MAX_WORKFLOW_INPUT_LENGTH = 50000;

let preparedRecords = [];
let preparedBatches = [];
let activeBatch = 0;
let catalogPromise;
let selectedEditRecord;

const $ = (selector) => document.querySelector(selector);

const splitList = (value) =>
  String(value || "")
    .split(/[,/\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const valueOf = (record, ...keys) => {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};

const parseCsv = (content) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
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
  return rows;
};

const csvToObjects = (content) => {
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV에 식당 데이터가 없습니다.");
  const headers = rows[0].map((header) => header.trim());
  return rows
    .slice(1)
    .filter((row) => row.some((value) => String(value).trim()))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]))
    );
};

const canonicalUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
  } catch (error) {
    return String(value || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
};

const placeIdFromUrl = (value) => {
  const match = String(value || "").match(/\/(?:entry\/)?place\/(\d+)/i)
    || String(value || "").match(/\/(\d{5,})(?:\/|$|[?#])/);
  return match ? match[1] : "";
};

const recordFingerprint = (name, address) => {
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

const recordTargetKey = (record) => {
  if (record.targetKey) return String(record.targetKey);
  if (record.id) return `id:${record.id}`;
  const fingerprint = recordFingerprint(record.name, record.address);
  const placeId = placeIdFromUrl(record.naverPlaceUrl);
  if (placeId) return `place:${placeId}:${fingerprint}`;
  const canonical = canonicalUrl(record.naverPlaceUrl);
  if (canonical) return `url:${canonical}:${fingerprint}`;
  return `record:${fingerprint}`;
};

const isNaverPlaceUrl = (value) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "naver.me" || hostname === "naver.com" || hostname.endsWith(".naver.com");
  } catch (error) {
    return false;
  }
};

const catalogRecord = (row, source = "base") => {
  const regionValue = row.region && typeof row.region === "object" ? row.region : {};
  const registrationType = row.registrationType
    || (source === "base" || row.verifiedBadge !== false ? "ozicme" : "external");
  const record = {
    id: valueOf(row, "id"),
    source,
    name: valueOf(row, "상호명", "name"),
    address: valueOf(row, "대표주소", "주소", "address"),
    naverPlaceUrl: valueOf(row, "네이버플레이스", "네이버플레이스URL", "naverPlaceUrl"),
    imageUrl: valueOf(row, "이미지", "이미지URL", "imageUrl"),
    region: {
      sido: valueOf(regionValue, "sido", "지역_시도") || valueOf(row, "지역_시도", "시도", "sido"),
      sigungu: valueOf(regionValue, "sigungu", "지역_시군구") || valueOf(row, "지역_시군구", "시군구", "sigungu"),
      eupmyeondong: valueOf(regionValue, "eupmyeondong", "지역_읍면동") || valueOf(row, "지역_읍면동", "읍면동", "eupmyeondong"),
    },
    category: valueOf(row, "식당유형_대", "음식점유형", "category"),
    categoryDetail: valueOf(row, "식당유형_세부", "세부유형", "categoryDetail"),
    mainDishes: splitList(valueOf(row, "주요리_대표", "대표메뉴", "mainDishes", "signatureMenus")),
    searchTags: splitList(valueOf(row, "검색태그", "searchTags")),
    registrationType,
    isOzicmeCustomer: registrationType === "ozicme",
    evidenceUrl: valueOf(row, "근거URL", "evidenceUrl"),
    evidenceText: valueOf(row, "근거문구", "evidenceText"),
  };
  record.targetKey = recordTargetKey(record);
  return record;
};

const loadOptionalJson = async (url) => {
  const response = await fetch(url, { cache: "no-cache" });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("추가 식당 자료를 불러오지 못했습니다.");
  const value = await response.json();
  return Array.isArray(value) ? value : [];
};

const loadCatalog = () => {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      fetch(BASE_DATA_URL, { cache: "force-cache" }).then((response) => {
        if (!response.ok) throw new Error("기존 식당 자료를 불러오지 못했습니다.");
        return response.text();
      }),
      loadOptionalJson(ADMIN_DATA_URL),
      loadOptionalJson(OVERRIDE_DATA_URL),
    ]).then(([content, adminRows, overrides]) => {
        const overrideMap = new Map(
          overrides
            .filter((item) => item && item.targetKey)
            .map((item) => [String(item.targetKey), item])
        );
        const records = [
          ...csvToObjects(content).map((row) => catalogRecord(row, "base")),
          ...adminRows.map((row) => catalogRecord(row, "admin")),
        ].map((record) => {
          const override = overrideMap.get(record.targetKey);
          if (!override) return record;
          return {
            ...record,
            ...override,
            id: record.id,
            source: record.source,
            targetKey: record.targetKey,
            region: { ...record.region, ...(override.region || {}) },
          };
        });
        const byUrl = new Map();
        const byPlaceId = new Map();
        records.forEach((record) => {
          if (!record.naverPlaceUrl) return;
          byUrl.set(canonicalUrl(record.naverPlaceUrl), record);
          const placeId = placeIdFromUrl(record.naverPlaceUrl);
          if (placeId) byPlaceId.set(placeId, record);
        });
        return { records, byUrl, byPlaceId };
      });
  }
  return catalogPromise;
};

const findCatalogMatch = (catalog, naverPlaceUrl) => {
  const direct = catalog.byUrl.get(canonicalUrl(naverPlaceUrl));
  if (direct) return direct;
  const placeId = placeIdFromUrl(naverPlaceUrl);
  return placeId ? catalog.byPlaceId.get(placeId) : undefined;
};

const enrichForPreview = async (record) => {
  try {
    const match = findCatalogMatch(await loadCatalog(), record.naverPlaceUrl);
    if (!match) {
      return { ...record, lookupStatus: "신규 · GitHub 자동조회 예정" };
    }
    return {
      ...match,
      ...record,
      imageUrl: record.imageUrl || match.imageUrl,
      address: match.address,
      region: match.region,
      category: match.category,
      categoryDetail: match.categoryDetail,
      mainDishes: match.mainDishes,
      searchTags: match.searchTags,
      lookupStatus: "자동 입력 완료 · 기존 등록 확인",
    };
  } catch (error) {
    return { ...record, lookupStatus: "GitHub 자동조회 예정" };
  }
};

const registrationTypeOf = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (["오직미", "오직미쌀거래식당", "오직미거래식당", "ozicme", "y", "yes", "1"].includes(normalized)) {
    return "ozicme";
  }
  if (["외부", "외부좋은쌀식당", "external", "n", "no", "0"].includes(normalized)) {
    return "external";
  }
  return "";
};

const normalizeBulkRecord = (row) => {
  const registrationType = registrationTypeOf(
    valueOf(row, "등록구분", "오직미거래식당", "오직미클럽배지", "registrationType")
  );
  return {
    name: valueOf(row, "상호명", "식당명", "name"),
    naverPlaceUrl: valueOf(row, "네이버플레이스URL", "네이버플레이스", "naverPlaceUrl"),
    imageUrl: valueOf(row, "대표이미지URL", "이미지URL", "이미지", "imageUrl"),
    registrationType,
    isOzicmeCustomer: registrationType === "ozicme",
    evidenceUrl: valueOf(row, "근거URL", "evidenceUrl"),
    evidenceText: valueOf(row, "근거문구", "evidenceText"),
  };
};

const validateRecords = (records) => {
  const errors = [];
  const seen = new Set();
  records.forEach((record, index) => {
    const label = `${index + 1}행`;
    if (!record.name) errors.push(`${label}: 상호명이 없습니다.`);
    if (!record.naverPlaceUrl) {
      errors.push(`${label}: 네이버 플레이스 URL이 없습니다.`);
    } else if (!isNaverPlaceUrl(record.naverPlaceUrl)) {
      errors.push(`${label}: 네이버 플레이스 URL을 확인하세요.`);
    }
    if (!record.registrationType) errors.push(`${label}: 등록 구분이 없습니다.`);
    if (record.registrationType === "external" && (!record.evidenceUrl || !record.evidenceText)) {
      errors.push(`${label}: 외부 식당은 근거URL과 근거문구가 모두 필요합니다.`);
    }
    const key = placeIdFromUrl(record.naverPlaceUrl)
      || canonicalUrl(record.naverPlaceUrl)
      || record.name.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) errors.push(`${label}: 같은 입력 안에 중복된 식당입니다.`);
    seen.add(key);
  });
  return errors;
};

const toPayloadRecord = (record) => ({
  name: record.name,
  naverPlaceUrl: record.naverPlaceUrl,
  imageUrl: record.imageUrl || "",
  registrationType: record.registrationType,
  isOzicmeCustomer: record.registrationType === "ozicme",
  evidenceUrl: record.evidenceUrl || "",
  evidenceText: record.evidenceText || "",
});

const buildBatches = (records) => {
  const batches = [];
  let current = [];
  const payloadSize = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  records.map(toPayloadRecord).forEach((record) => {
    const candidate = [...current, record];
    if (payloadSize(candidate) > MAX_WORKFLOW_INPUT_LENGTH && current.length) {
      batches.push(current);
      current = [record];
    } else {
      current = candidate;
    }
    if (payloadSize(current) > MAX_WORKFLOW_INPUT_LENGTH) {
      throw new Error(`'${record.name}'의 입력 내용이 너무 깁니다.`);
    }
  });
  if (current.length) batches.push(current);
  return batches;
};

const updateBatchOutput = () => {
  const hasMultiple = preparedBatches.length > 1;
  $("#batch-nav").hidden = !hasMultiple;
  $("#previous-batch").disabled = activeBatch === 0;
  $("#next-batch").disabled = activeBatch >= preparedBatches.length - 1;
  $("#batch-info").textContent = hasMultiple
    ? `${activeBatch + 1} / ${preparedBatches.length} 묶음`
    : "";
  $("#json-output").value = preparedBatches.length
    ? JSON.stringify(preparedBatches[activeBatch])
    : "";
  $("#copy-button").textContent = hasMultiple
    ? `① ${activeBatch + 1}/${preparedBatches.length} 묶음 복사`
    : "① 등록 데이터 복사";
};

const setGitHubButtonReady = (ready) => {
  const button = $("#github-button");
  button.classList.toggle("is-disabled", !ready);
  button.setAttribute("aria-disabled", String(!ready));
  button.textContent = ready
    ? "② GitHub 등록 화면 열기"
    : "② 먼저 등록 데이터를 복사하세요";
};

const showPreparedRecords = (records) => {
  const errors = validateRecords(records);
  const reviewCard = $("#review-card");
  const publishCard = $("#publish-card");
  const errorBox = $("#error-box");
  const body = $("#preview-body");

  reviewCard.hidden = false;
  errorBox.hidden = errors.length === 0;
  errorBox.textContent = errors.join("\n");
  publishCard.hidden = errors.length > 0;
  $("#review-count").textContent = `${records.length.toLocaleString()}개`;
  body.replaceChildren();

  records.slice(0, 100).forEach((record) => {
    const row = document.createElement("tr");
    [
      record.name,
      record.lookupStatus || "확인 전",
      record.address || "GitHub 실행 시 자동 입력",
      [record.category, record.categoryDetail].filter(Boolean).join(" · ") || "자동 입력 예정",
      record.registrationType === "ozicme" ? "오직미 쌀 거래식당" : "외부 좋은 쌀 식당",
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });

  preparedRecords = errors.length ? [] : records;
  try {
    preparedBatches = errors.length ? [] : buildBatches(records);
  } catch (error) {
    preparedRecords = [];
    preparedBatches = [];
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    publishCard.hidden = true;
  }
  activeBatch = 0;
  updateBatchOutput();
  $("#copy-status").hidden = true;
  $("#copy-status").textContent = "";
  setGitHubButtonReady(false);
  reviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
};

const collectSingleRecord = () => {
  const registrationType = $("input[name='storeType']:checked").value;
  return {
    name: $("#name").value.trim(),
    naverPlaceUrl: $("#naver-url").value.trim(),
    imageUrl: $("#image-url").value.trim(),
    registrationType,
    isOzicmeCustomer: registrationType === "ozicme",
    evidenceUrl: $("#evidence-url").value.trim(),
    evidenceText: $("#evidence-text").value.trim(),
  };
};

const setActiveTab = (mode) => {
  const single = mode === "single";
  $("#single-tab").classList.toggle("is-active", single);
  $("#bulk-tab").classList.toggle("is-active", !single);
  $("#single-tab").setAttribute("aria-selected", String(single));
  $("#bulk-tab").setAttribute("aria-selected", String(!single));
  $("#single-panel").hidden = !single;
  $("#bulk-panel").hidden = single;
};

const updateEvidenceFields = () => {
  const isExternal = $("input[name='storeType']:checked").value === "external";
  $("#evidence-fields").hidden = !isExternal;
  $("#evidence-url").required = isExternal;
  $("#evidence-text").required = isExternal;
};

const downloadTemplate = () => {
  const headers = [
    "상호명", "네이버플레이스URL", "대표이미지URL", "등록구분", "근거URL", "근거문구",
  ];
  const example = [
    "예시식당", "https://map.naver.com/p/entry/place/123456789", "", "오직미", "", "",
  ];
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = `\uFEFF${headers.map(escape).join(",")}\r\n${example.map(escape).join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "오직미클럽_간편_식당등록양식.csv";
  link.click();
  URL.revokeObjectURL(url);
};

const setAdminMode = (mode) => {
  const editing = mode === "edit";
  document.querySelectorAll(".register-section").forEach((section) =>
    section.classList.toggle("mode-hidden", editing)
  );
  document.querySelectorAll(".edit-section").forEach((section) =>
    section.classList.toggle("mode-hidden", !editing)
  );
  $("#register-mode-button").classList.toggle("is-active", !editing);
  $("#edit-mode-button").classList.toggle("is-active", editing);
  $("#register-mode-button").setAttribute("aria-pressed", String(!editing));
  $("#edit-mode-button").setAttribute("aria-pressed", String(editing));
  if (editing) {
    $("#edit-card").hidden = false;
    $("#edit-search-status").textContent = "상호명이나 주소를 2글자 이상 입력하세요.";
    $("#edit-search-input").focus();
    loadCatalog()
      .then((catalog) => {
        $("#edit-catalog-count").textContent = `전체 ${catalog.records.length.toLocaleString()}개`;
      })
      .catch(() => {
        $("#edit-catalog-count").textContent = "전체 목록";
      });
  }
};

const setEditGitHubButtonReady = (ready) => {
  const button = $("#edit-github-button");
  button.classList.toggle("is-disabled", !ready);
  button.setAttribute("aria-disabled", String(!ready));
  button.textContent = ready
    ? "② GitHub 수정 화면 열기"
    : "② 먼저 수정 데이터를 복사하세요";
};

const updateEditEvidenceFields = () => {
  const isExternal = $("input[name='editStoreType']:checked").value === "external";
  $("#edit-evidence-fields").hidden = !isExternal;
  $("#edit-evidence-url").required = isExternal;
  $("#edit-evidence-text").required = isExternal;
};

const editSearchText = (record) =>
  [
    record.name,
    record.address,
    record.naverPlaceUrl,
    record.region?.sido,
    record.region?.sigungu,
    record.region?.eupmyeondong,
    record.category,
    record.categoryDetail,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const fillEditForm = (record) => {
  selectedEditRecord = record;
  $("#edit-target-key").value = record.targetKey;
  $("#edit-source").value = record.source;
  $("#edit-name").value = record.name || "";
  $("#edit-address").value = record.address || "";
  $("#edit-naver-url").value = record.naverPlaceUrl || "";
  $("#edit-image-url").value = record.imageUrl || "";
  $("#edit-sido").value = record.region?.sido || "";
  $("#edit-sigungu").value = record.region?.sigungu || "";
  $("#edit-eupmyeondong").value = record.region?.eupmyeondong || "";
  $("#edit-category").value = record.category || "";
  $("#edit-category-detail").value = record.categoryDetail || "";
  $("#edit-main-dishes").value = (record.mainDishes || []).join(", ");
  $("#edit-search-tags").value = (record.searchTags || []).join(", ");
  $("#edit-evidence-url").value = record.evidenceUrl || "";
  $("#edit-evidence-text").value = record.evidenceText || "";
  const registrationType = record.registrationType === "external" ? "external" : "ozicme";
  $(`input[name='editStoreType'][value='${registrationType}']`).checked = true;
  $("#selected-record").textContent = `선택: ${record.name} · ${record.address}`;
  $("#edit-form-message").textContent = "수정할 항목만 고친 뒤 ‘수정 내용 검토’를 누르세요.";
  $("#edit-form").hidden = false;
  $("#edit-publish-card").hidden = true;
  updateEditEvidenceFields();
  $("#edit-form").scrollIntoView({ behavior: "smooth", block: "start" });
};

const renderEditSearchResults = (records) => {
  const container = $("#edit-search-results");
  container.replaceChildren();
  records.forEach((record) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result-item";
    const title = document.createElement("strong");
    title.textContent = record.name;
    const address = document.createElement("span");
    address.textContent = record.address || "주소 미등록";
    const detail = document.createElement("small");
    detail.textContent = [record.category, record.categoryDetail].filter(Boolean).join(" · ") || "업종 미등록";
    button.append(title, address, detail);
    button.addEventListener("click", () => fillEditForm(record));
    container.appendChild(button);
  });
};

const splitEditList = (value) =>
  String(value || "")
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const collectEditPayload = () => {
  const registrationType = $("input[name='editStoreType']:checked").value;
  return {
    targetKey: $("#edit-target-key").value,
    source: $("#edit-source").value,
    name: $("#edit-name").value.trim(),
    address: $("#edit-address").value.trim(),
    naverPlaceUrl: $("#edit-naver-url").value.trim(),
    imageUrl: $("#edit-image-url").value.trim(),
    region: {
      sido: $("#edit-sido").value.trim(),
      sigungu: $("#edit-sigungu").value.trim(),
      eupmyeondong: $("#edit-eupmyeondong").value.trim(),
    },
    category: $("#edit-category").value.trim(),
    categoryDetail: $("#edit-category-detail").value.trim(),
    mainDishes: splitEditList($("#edit-main-dishes").value),
    searchTags: splitEditList($("#edit-search-tags").value),
    registrationType,
    evidenceUrl: $("#edit-evidence-url").value.trim(),
    evidenceText: $("#edit-evidence-text").value.trim(),
  };
};

const validateEditPayload = (record) => {
  if (!record.targetKey) return "수정할 기존 식당을 다시 선택하세요.";
  if (!record.name || !record.address) return "상호명과 대표주소는 필수입니다.";
  if (record.naverPlaceUrl && !isNaverPlaceUrl(record.naverPlaceUrl)) {
    return "네이버 플레이스 URL을 확인하세요.";
  }
  if (record.imageUrl && !/^https?:\/\//i.test(record.imageUrl)) {
    return "대표 이미지 URL을 확인하세요.";
  }
  if (record.registrationType === "external" && (!record.evidenceUrl || !record.evidenceText)) {
    return "외부 좋은 쌀 식당은 근거URL과 근거문구가 모두 필요합니다.";
  }
  return "";
};

$("#single-tab").addEventListener("click", () => setActiveTab("single"));
$("#bulk-tab").addEventListener("click", () => setActiveTab("bulk"));
$("#register-mode-button").addEventListener("click", () => setAdminMode("register"));
$("#edit-mode-button").addEventListener("click", () => setAdminMode("edit"));
document.querySelectorAll("input[name='storeType']").forEach((radio) =>
  radio.addEventListener("change", updateEvidenceFields)
);
document.querySelectorAll("input[name='editStoreType']").forEach((radio) =>
  radio.addEventListener("change", updateEditEvidenceFields)
);

$("#edit-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("#edit-search-input").value.trim().toLowerCase();
  if (query.length < 2) return;
  $("#edit-search-status").textContent = "전체 식당 목록을 검색하고 있습니다...";
  $("#edit-search-results").replaceChildren();
  try {
    const catalog = await loadCatalog();
    const tokens = query.split(/\s+/).filter(Boolean);
    const allMatches = catalog.records.filter((record) => {
        const text = editSearchText(record);
        return tokens.every((token) => text.includes(token));
      });
    const matches = allMatches.slice(0, 30);
    $("#edit-search-status").textContent = allMatches.length
      ? `${allMatches.length.toLocaleString()}개 중 최대 30개를 표시합니다. 수정할 식당을 선택하세요.`
      : "일치하는 식당이 없습니다. 상호명이나 주소를 줄여서 검색해 보세요.";
    renderEditSearchResults(matches);
  } catch (error) {
    $("#edit-search-status").textContent = error.message;
  }
});

$("#edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = collectEditPayload();
  const error = validateEditPayload(payload);
  if (error) {
    $("#edit-form-message").textContent = error;
    return;
  }
  $("#edit-json-output").value = JSON.stringify([payload]);
  $("#edit-summary").textContent = `${selectedEditRecord.name} → ${payload.name}\n${payload.address}\n${payload.category || "업종 미등록"}${payload.categoryDetail ? ` · ${payload.categoryDetail}` : ""}`;
  $("#edit-copy-status").hidden = true;
  $("#edit-publish-card").hidden = false;
  setEditGitHubButtonReady(false);
  $("#edit-publish-card").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("#edit-cancel-button").addEventListener("click", () => {
  selectedEditRecord = undefined;
  $("#edit-form").hidden = true;
  $("#edit-publish-card").hidden = true;
  $("#edit-search-input").focus();
});

$("#edit-copy-button").addEventListener("click", async () => {
  const payload = $("#edit-json-output").value;
  if (!payload) return;
  try {
    await navigator.clipboard.writeText(payload);
    $("#edit-copy-button").textContent = "✓ 수정 데이터 복사 완료";
    $("#edit-copy-status").textContent = "JSON 전체를 복사했습니다. 이제 ② GitHub 수정 화면 열기를 누르세요.";
  } catch (error) {
    $("#edit-json-output").focus();
    $("#edit-json-output").select();
    $("#edit-copy-status").textContent = "자동 복사가 제한되었습니다. 선택된 JSON 전체를 Ctrl+C로 복사하세요.";
  }
  $("#edit-copy-status").hidden = false;
  setEditGitHubButtonReady(true);
});

$("#single-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = collectSingleRecord();
  if (validateRecords([input]).length) {
    showPreparedRecords([input]);
    return;
  }
  const button = $("#lookup-button");
  button.disabled = true;
  button.textContent = "자동 정보 확인 중...";
  $("#lookup-message").textContent = "현재 등록 자료와 네이버 플레이스 URL을 확인하고 있습니다.";
  const record = await enrichForPreview(input);
  $("#lookup-message").textContent = record.lookupStatus;
  button.disabled = false;
  button.textContent = "자동 정보 불러오기";
  showPreparedRecords([record]);
});

$("#reset-button").addEventListener("click", () => {
  setTimeout(updateEvidenceFields, 0);
  $("#lookup-message").textContent = "";
  $("#review-card").hidden = true;
  $("#publish-card").hidden = true;
});

$("#template-button").addEventListener("click", downloadTemplate);
$("#csv-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("#file-status").textContent = `${file.name} 읽는 중...`;
  try {
    const rows = csvToObjects(await file.text()).map(normalizeBulkRecord);
    const preliminaryErrors = validateRecords(rows);
    if (preliminaryErrors.length) {
      $("#file-status").textContent = `${rows.length.toLocaleString()}개 식당을 읽었습니다.`;
      showPreparedRecords(rows);
      return;
    }
    $("#file-status").textContent = `${rows.length.toLocaleString()}개 식당 자동 확인 중...`;
    const enriched = await Promise.all(rows.map(enrichForPreview));
    const completed = enriched.filter((row) => row.address).length;
    $("#file-status").textContent = `${rows.length.toLocaleString()}개 중 ${completed.toLocaleString()}개를 기존 자료에서 자동 입력했습니다.`;
    showPreparedRecords(enriched);
  } catch (error) {
    $("#file-status").textContent = error.message;
  }
});

$("#copy-button").addEventListener("click", async () => {
  if (!preparedRecords.length || !preparedBatches.length) return;
  const payload = JSON.stringify(preparedBatches[activeBatch]);
  try {
    await navigator.clipboard.writeText(payload);
    $("#copy-button").textContent = "✓ 등록 데이터 복사 완료";
    $("#copy-status").hidden = false;
    $("#copy-status").textContent = "JSON 전체를 복사했습니다. 이제 ② GitHub 등록 화면 열기를 누르세요.";
    setGitHubButtonReady(true);
  } catch (error) {
    $("#json-output").focus();
    $("#json-output").select();
    $("#copy-status").hidden = false;
    $("#copy-status").textContent = "자동 복사가 제한되었습니다. 선택된 JSON 전체를 Ctrl+C로 복사한 뒤 ②를 누르세요.";
    setGitHubButtonReady(true);
  }
});

$("#previous-batch").addEventListener("click", () => {
  if (activeBatch === 0) return;
  activeBatch -= 1;
  updateBatchOutput();
});

$("#next-batch").addEventListener("click", () => {
  if (activeBatch >= preparedBatches.length - 1) return;
  activeBatch += 1;
  updateBatchOutput();
});

$("#github-button").href = WORKFLOW_URL;
$("#edit-github-button").href = UPDATE_WORKFLOW_URL;
setGitHubButtonReady(false);
setEditGitHubButtonReady(false);
updateEvidenceFields();
updateEditEvidenceFields();
