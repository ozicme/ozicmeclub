const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

const fakeElement = () => ({
  value: "",
  textContent: "",
  hidden: false,
  disabled: false,
  checked: false,
  files: [],
  classList: { add() {}, remove() {}, toggle() {} },
  setAttribute() {},
  addEventListener() {},
  replaceChildren() {},
  append() {},
  click() {},
  focus() {},
  select() {},
  scrollIntoView() {},
});

const elements = new Map();
const elementFor = (selector) => {
  if (!elements.has(selector)) elements.set(selector, fakeElement());
  const element = elements.get(selector);
  if (selector === "input[name='storeType']:checked") element.value = "ozicme";
  if (selector === "input[name='editStoreType']:checked") element.value = "ozicme";
  return element;
};

const context = vm.createContext({
  Blob,
  Date,
  Map,
  Set,
  String,
  TextEncoder,
  URL,
  console,
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout,
  clearTimeout,
  document: {
    baseURI: "https://ozicmeclub.com/admin.html",
    querySelector: elementFor,
    querySelectorAll: () => [],
    createElement: fakeElement,
  },
  fetch: async (url) => {
    const relative = String(url).replace(/^\.\//, "");
    const filePath = path.join(root, relative);
    if (!fs.existsSync(filePath)) {
      return { ok: false, status: 404, text: async () => "", json: async () => [] };
    }
    return {
      ok: true,
      status: 200,
      text: async () => fs.readFileSync(filePath, "utf8"),
      json: async () => JSON.parse(fs.readFileSync(filePath, "utf8")),
    };
  },
});

const source = `${fs.readFileSync(path.join(root, "admin.js"), "utf8")}
globalThis.__adminTest = {
  EDIT_CSV_HEADERS,
  buildBatches,
  buildEditBatches,
  comparableEditPayload,
  csvToObjects,
  fullCatalogCsv,
  loadCatalog,
  normalizeBulkRecord,
  normalizeEditCsvRow,
  prepareFullCatalogEdits,
  registrationTypeOf,
  validateEditPayload,
};`;
vm.runInContext(source, context, { filename: "admin.js" });

(async () => {
  const api = context.__adminTest;
  const catalog = await api.loadCatalog();
  assert.ok(
    catalog.records.length >= 6045,
    "기존 6,045개와 관리자 신규 등록 식당이 모두 포함되어야 합니다."
  );
  assert.equal(
    new Set(catalog.records.map((record) => record.targetKey)).size,
    catalog.records.length,
    "전체 목록의 수정대상키는 모두 달라야 합니다."
  );

  const csv = api.fullCatalogCsv(catalog.records);
  assert.ok(csv.startsWith("\uFEFF"), "엑셀 한글 호환을 위한 UTF-8 BOM이 필요합니다.");
  const rows = api.csvToObjects(csv);
  assert.equal(rows.length, catalog.records.length);
  assert.deepEqual(Object.keys(rows[0]), Array.from(api.EDIT_CSV_HEADERS));
  assert.ok(
    rows.every(
      (row, index) =>
        row["등록구분"] ===
        (catalog.records[index].registrationType === "external" ? "2" : "1")
    ),
    "다운로드한 등록구분은 각 식당의 실제 등록구분과 같아야 합니다."
  );
  assert.equal(api.registrationTypeOf("1"), "ozicme");
  assert.equal(api.registrationTypeOf("2"), "external");
  const bulkExternal = api.normalizeBulkRecord({
    상호명: "외부예시",
    네이버플레이스URL: "https://map.naver.com/p/entry/place/123456789",
    대표메뉴: "솥밥, 제육볶음",
    등록구분: "2",
  });
  assert.equal(bulkExternal.registrationType, "external");
  assert.deepEqual(Array.from(bulkExternal.mainDishes), ["솥밥", "제육볶음"]);
  const registrationBatch = api.buildBatches([bulkExternal]);
  assert.deepEqual(Array.from(registrationBatch[0][0].mainDishes), ["솥밥", "제육볶음"]);
  const externalCsvRow = api.csvToObjects(
    api.fullCatalogCsv([{ ...catalog.records[0], registrationType: "external" }])
  )[0];
  assert.equal(externalCsvRow["등록구분"], "2");

  const currentByKey = new Map(catalog.records.map((record) => [record.targetKey, record]));
  rows.forEach((row) => {
    const current = currentByKey.get(row["수정대상키(수정금지)"]);
    assert.ok(current, "내려받은 행은 현재 목록에서 다시 찾을 수 있어야 합니다.");
    const imported = api.normalizeEditCsvRow(row, current);
    assert.equal(
      api.comparableEditPayload(imported),
      api.comparableEditPayload(current),
      `${current.name} 행이 수정하지 않았는데 변경으로 인식되었습니다.`
    );
  });

  const editableIndex = rows.findIndex((row) => row["대표주소"] && row["네이버플레이스URL"]);
  assert.ok(editableIndex >= 0);
  const editedRow = { ...rows[editableIndex], 상호명: `${rows[editableIndex].상호명} 수정테스트` };
  const current = currentByKey.get(editedRow["수정대상키(수정금지)"]);
  const changed = api.normalizeEditCsvRow(editedRow, current);
  assert.notEqual(api.comparableEditPayload(changed), api.comparableEditPayload(current));
  assert.equal(api.validateEditPayload(changed), "");
  assert.equal(api.buildEditBatches([changed]).length, 1);

  const editedRecords = catalog.records.map((record, index) =>
    index === editableIndex ? { ...record, name: changed.name } : record
  );
  await api.prepareFullCatalogEdits({
    name: "전체목록_수정테스트.csv",
    text: async () => api.fullCatalogCsv(editedRecords),
  });
  assert.match(elementFor("#edit-file-status").textContent, /변경된 1개/);
  const prepared = JSON.parse(elementFor("#edit-json-output").value);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].name, changed.name);

  const externalWithoutEvidence = {
    ...changed,
    registrationType: "external",
    evidenceUrl: "",
    evidenceText: "",
  };
  assert.equal(api.validateEditPayload(externalWithoutEvidence), "");

  console.log(
    `관리자 전체 CSV 테스트 통과: ${catalog.records.length.toLocaleString()}개, 고유 식별값, 무변경 왕복, 변경 감지`
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
