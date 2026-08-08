const WORKFLOW_URL =
  "https://github.com/ozicme/ozicmeclub/actions/workflows/add-restaurants.yml";

let preparedRecords = [];
let preparedBatches = [];
let activeBatch = 0;
const MAX_WORKFLOW_INPUT_LENGTH = 50000;

const $ = (selector) => document.querySelector(selector);

const splitList = (value) =>
  String(value || "")
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const asBoolean = (value) =>
  ["1", "true", "y", "yes", "예", "네", "오직미", "오직미거래식당"].includes(
    String(value || "").trim().toLowerCase()
  );

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

const normalizeBulkRecord = (row) => ({
  name: valueOf(row, "상호명", "식당명", "name"),
  address: valueOf(row, "대표주소", "주소", "address"),
  naverPlaceUrl: valueOf(row, "네이버플레이스", "네이버플레이스URL", "naverPlaceUrl"),
  imageUrl: valueOf(row, "이미지", "이미지URL", "imageUrl"),
  region: {
    sido: valueOf(row, "지역_시도", "시도", "sido"),
    sigungu: valueOf(row, "지역_시군구", "시군구", "sigungu"),
    eupmyeondong: valueOf(row, "지역_읍면동", "읍면동", "eupmyeondong"),
  },
  category: valueOf(row, "식당유형_대", "음식점유형", "category"),
  categoryDetail: valueOf(row, "식당유형_세부", "세부유형", "categoryDetail"),
  mainDishes: splitList(valueOf(row, "주요리_대표", "대표메뉴", "mainDishes")),
  searchTags: splitList(valueOf(row, "검색태그", "searchTags")),
  isOzicmeCustomer: asBoolean(
    valueOf(row, "오직미거래식당", "오직미클럽배지", "isOzicmeCustomer")
  ),
  evidenceUrl: valueOf(row, "근거URL", "evidenceUrl"),
  evidenceText: valueOf(row, "근거문구", "evidenceText"),
});

const validateRecords = (records) => {
  const errors = [];
  const seen = new Set();
  records.forEach((record, index) => {
    const label = `${index + 1}행`;
    if (!record.name) errors.push(`${label}: 상호명이 없습니다.`);
    if (!record.address) errors.push(`${label}: 대표주소가 없습니다.`);
    if (!record.region?.sido) errors.push(`${label}: 시·도가 없습니다.`);
    if (!record.isOzicmeCustomer && (!record.evidenceUrl || !record.evidenceText)) {
      errors.push(`${label}: 외부 식당은 근거URL과 근거문구가 모두 필요합니다.`);
    }
    const key = `${record.name}|${record.address}`.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) errors.push(`${label}: 같은 파일 안에 중복된 식당입니다.`);
    seen.add(key);
  });
  return errors;
};

const buildBatches = (records) => {
  const batches = [];
  let current = [];
  const payloadSize = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  records.forEach((record) => {
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
      [record.region?.sido, record.region?.sigungu].filter(Boolean).join(" "),
      record.category || "미등록",
      record.isOzicmeCustomer ? "오직미클럽" : "없음",
      record.address,
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
  reviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
};

const collectSingleRecord = () => {
  const isOzicmeCustomer = $("input[name='storeType']:checked").value === "ozicme";
  return {
    name: $("#name").value.trim(),
    address: $("#address").value.trim(),
    naverPlaceUrl: $("#naver-url").value.trim(),
    imageUrl: $("#image-url").value.trim(),
    region: {
      sido: $("#sido").value,
      sigungu: $("#sigungu").value.trim(),
      eupmyeondong: $("#eupmyeondong").value.trim(),
    },
    category: $("#category").value.trim(),
    categoryDetail: $("#category-detail").value.trim(),
    mainDishes: splitList($("#main-dishes").value),
    searchTags: splitList($("#search-tags").value),
    isOzicmeCustomer,
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
    "상호명", "대표주소", "네이버플레이스", "이미지", "지역_시도", "지역_시군구",
    "지역_읍면동", "식당유형_대", "식당유형_세부", "주요리_대표", "검색태그",
    "오직미거래식당", "근거URL", "근거문구",
  ];
  const example = [
    "예시식당", "서울특별시 강남구 테헤란로 1", "", "", "서울특별시", "강남구",
    "역삼동", "한식", "솥밥/한정식", "솥밥,제육볶음", "한식,좋은쌀,솥밥", "Y", "", "",
  ];
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = `\uFEFF${headers.map(escape).join(",")}\r\n${example.map(escape).join(",")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "오직미클럽_식당등록양식.csv";
  link.click();
  URL.revokeObjectURL(url);
};

$("#single-tab").addEventListener("click", () => setActiveTab("single"));
$("#bulk-tab").addEventListener("click", () => setActiveTab("bulk"));
document.querySelectorAll("input[name='storeType']").forEach((radio) =>
  radio.addEventListener("change", updateEvidenceFields)
);

$("#single-form").addEventListener("submit", (event) => {
  event.preventDefault();
  showPreparedRecords([collectSingleRecord()]);
});

$("#reset-button").addEventListener("click", () => {
  setTimeout(updateEvidenceFields, 0);
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
    $("#file-status").textContent = `${rows.length.toLocaleString()}개 식당을 읽었습니다.`;
    showPreparedRecords(rows);
  } catch (error) {
    $("#file-status").textContent = error.message;
  }
});

$("#copy-button").addEventListener("click", async () => {
  if (!preparedRecords.length || !preparedBatches.length) return;
  const payload = JSON.stringify(preparedBatches[activeBatch]);
  try {
    await navigator.clipboard.writeText(payload);
    $("#copy-status").textContent = "등록 데이터를 복사했습니다. 이제 GitHub 등록 화면을 여세요.";
  } catch (error) {
    $("#json-output").focus();
    $("#json-output").select();
    $("#copy-status").textContent = "자동 복사가 제한되었습니다. 아래 내용을 직접 복사하세요.";
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

document.querySelector("a.github").href = WORKFLOW_URL;
updateEvidenceFields();
