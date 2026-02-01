const DATA_URL = "./public-restaurants.json";
const PLACEHOLDER_IMAGE_URL = new URL(
  "./assets/placeholder-image.svg",
  document.baseURI
).toString();

const formatValue = (value, fallback = "미등록") =>
  value && String(value).trim().length > 0 ? value : fallback;

const isNaverPlaceUrl = (value) => {
  if (!value) return false;
  return /(^https?:\/\/(map|place)\.naver\.com)|(\.naver\.com\/place)/i.test(
    value
  );
};

const resolveImageUrl = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (isNaverPlaceUrl(trimmed)) return "";
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  try {
    return new URL(trimmed, document.baseURI).toString();
  } catch (error) {
    return "";
  }
};

const pickImageUrl = (value) => {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = pickImageUrl(entry);
      if (candidate) return candidate;
    }
    return "";
  }
  if (typeof value === "object") {
    const keys = ["url", "src", "imageUrl", "image_url", "image"];
    for (const key of keys) {
      if (value && value[key]) {
        const candidate = pickImageUrl(value[key]);
        if (candidate) return candidate;
      }
    }
    return "";
  }
  if (typeof value === "string") {
    return resolveImageUrl(value);
  }
  return "";
};

const buildSearchText = (item) =>
  [
    item.name,
    item.type,
    item.region?.sido,
    item.region?.sigungu,
    item.addressPublic,
    ...(item.signatureMenus || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const getReservationUrl = (item) =>
  item.naverReservationUrl || item.naverPlaceUrl || "";

const getDirectionsUrl = (item) => item.naverMapUrl || item.naverPlaceUrl || "";

const normalizeRestaurant = (item, index) => {
  const type =
    formatValue(item.type || item.category, "기타") === "미등록"
      ? "기타"
      : item.type || item.category;

  return {
    id: item.id || item.slug || `restaurant-${index + 1}`,
    name: formatValue(item.name),
    type: type || "기타",
    region: item.region || {},
    addressPublic: formatValue(item.addressPublic),
    signatureMenus: Array.isArray(item.signatureMenus)
      ? item.signatureMenus
      : item.signatureMenus
      ? String(item.signatureMenus)
          .split(/[,/]/g)
          .map((menu) => menu.trim())
          .filter(Boolean)
      : [],
    thumbnail: item.thumbnail || item.imageUrl || "",
    images: item.images || [],
    naverReservationUrl: item.naverReservationUrl || "",
    naverPlaceUrl: item.naverPlaceUrl || "",
    naverMapUrl: item.naverMapUrl || "",
  };
};

const buildMediaFrame = ({ src, alt }) => {
  const frame = document.createElement("div");
  frame.className = "media-frame";
  const placeholder = document.createElement("div");
  placeholder.className = "media-placeholder";
  placeholder.innerHTML = `<span aria-hidden="true">🍚</span><span>이미지 준비중</span>`;
  frame.appendChild(placeholder);

  const img = document.createElement("img");
  img.alt = alt;
  img.loading = "lazy";
  img.decoding = "async";
  img.width = 400;
  img.height = 300;
  img.src = src || PLACEHOLDER_IMAGE_URL;
  if (!src) {
    img.classList.add("is-fallback");
  }
  img.addEventListener("load", () => {
    frame.classList.add("media-loaded");
  });
  img.addEventListener("error", () => {
    if (img.dataset.fallbackApplied === "1") return;
    img.dataset.fallbackApplied = "1";
    img.src = PLACEHOLDER_IMAGE_URL;
    img.classList.add("is-fallback");
    frame.classList.add("media-loaded");
  });
  frame.appendChild(img);
  return frame;
};

const buildActionButton = ({ label, href, primary, disabled }) => {
  const element = document.createElement(href ? "a" : "button");
  element.className = `btn ${primary ? "btn-primary" : "btn-outline"} btn-sm`;
  element.textContent = label;
  if (href) {
    element.href = href;
    element.target = "_blank";
    element.rel = "noopener";
  } else {
    element.type = "button";
  }
  if (disabled) {
    element.classList.add("btn-disabled");
    element.setAttribute("aria-disabled", "true");
  }
  return element;
};

const renderCard = (item) => {
  const card = document.createElement("article");
  card.className = "restaurant-card";

  const mediaFrame = buildMediaFrame({
    src: pickImageUrl(item.thumbnail || item.images),
    alt: `${item.name} 대표 이미지`,
  });

  const typeBadge = `<span class="badge">${formatValue(item.type, "기타")}</span>`;
  const menuList = item.signatureMenus?.length
    ? item.signatureMenus.slice(0, 2).join(" · ")
    : "대표 메뉴 미등록";

  const cardBody = document.createElement("div");
  cardBody.className = "card-body";
  cardBody.innerHTML = `
    <div class="card-header">
      <h3 class="card-title">${item.name}</h3>
      ${typeBadge}
    </div>
    <p class="card-meta">${formatValue(item.region?.sido)} · ${formatValue(
    item.region?.sigungu
  )}</p>
    <p class="card-meta">${formatValue(item.addressPublic)}</p>
    <p class="menu-list">${menuList}</p>
  `;

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const reservationUrl = getReservationUrl(item);
  const directionsUrl = getDirectionsUrl(item);

  actions.appendChild(
    reservationUrl
      ? buildActionButton({
          label: "예약",
          href: reservationUrl,
          primary: true,
        })
      : buildActionButton({
          label: "예약 준비중",
          primary: true,
          disabled: true,
        })
  );

  actions.appendChild(
    directionsUrl
      ? buildActionButton({
          label: "길찾기",
          href: directionsUrl,
          primary: false,
        })
      : buildActionButton({
          label: "길찾기 준비중",
          primary: false,
          disabled: true,
        })
  );

  cardBody.appendChild(actions);
  card.append(mediaFrame, cardBody);
  return card;
};

const renderEmptyState = (container, message) => {
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "list-empty";
  empty.textContent = message;
  container.appendChild(empty);
};

const initFilters = (restaurants) => {
  const searchInput = document.getElementById("search-input");
  const resultCount = document.getElementById("result-count");
  const sidoSelect = document.getElementById("sido-select");
  const sigunguSelect = document.getElementById("sigungu-select");
  const typeChips = document.getElementById("type-chips");
  const reservableToggle = document.getElementById("reservable-only");
  const grid = document.getElementById("restaurant-grid");
  const listState = document.getElementById("list-state");

  if (!searchInput || !resultCount || !sidoSelect || !sigunguSelect || !typeChips || !grid) {
    return;
  }

  const uniqueSido = Array.from(
    new Set(restaurants.map((item) => item.region?.sido).filter(Boolean))
  ).sort();

  const renderSidoOptions = () => {
    sidoSelect.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "전체 시/도";
    sidoSelect.appendChild(allOption);

    uniqueSido.forEach((sido) => {
      const option = document.createElement("option");
      option.value = sido;
      option.textContent = sido;
      sidoSelect.appendChild(option);
    });
  };

  const renderSigunguOptions = (selectedSido) => {
    sigunguSelect.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "전체 시/군/구";
    sigunguSelect.appendChild(allOption);

    const sigunguList = restaurants
      .filter((item) => !selectedSido || item.region?.sido === selectedSido)
      .map((item) => item.region?.sigungu)
      .filter(Boolean);

    Array.from(new Set(sigunguList))
      .sort()
      .forEach((sigungu) => {
        const option = document.createElement("option");
        option.value = sigungu;
        option.textContent = sigungu;
        sigunguSelect.appendChild(option);
      });
  };

  const renderTypeChips = () => {
    const types = restaurants.map((item) => item.type || "기타");
    const uniqueTypes = Array.from(new Set(types)).sort();
    typeChips.innerHTML = "";

    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "chip is-active";
    allButton.dataset.value = "";
    allButton.textContent = "전체";
    typeChips.appendChild(allButton);

    uniqueTypes.forEach((type) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.value = type;
      button.textContent = type;
      typeChips.appendChild(button);
    });
  };

  const renderList = (filtered) => {
    grid.innerHTML = "";
    if (!filtered.length) {
      renderEmptyState(grid, "조건에 맞는 매장이 없습니다.");
      if (listState) {
        listState.textContent = "다른 필터 조건을 선택해 보세요.";
        listState.style.display = "block";
      }
      resultCount.textContent = "검색 결과 0개";
      return;
    }
    if (listState) listState.style.display = "none";

    const fragment = document.createDocumentFragment();
    filtered.forEach((item) => fragment.appendChild(renderCard(item)));
    grid.appendChild(fragment);
    resultCount.textContent = `검색 결과 ${filtered.length.toLocaleString()}개`;
  };

  const applyFilters = () => {
    const query = searchInput.value.trim().toLowerCase();
    const selectedSido = sidoSelect.value;
    const selectedSigungu = sigunguSelect.value;
    const activeChip = typeChips.querySelector(".chip.is-active");
    const selectedType = activeChip?.dataset.value || "";
    const reservableOnly = !!reservableToggle?.checked;

    const filtered = restaurants.filter((item) => {
      if (selectedSido && item.region?.sido !== selectedSido) return false;
      if (selectedSigungu && item.region?.sigungu !== selectedSigungu) return false;
      if (selectedType && item.type !== selectedType) return false;
      if (reservableOnly && !getReservationUrl(item)) return false;
      if (query && !item.searchText.includes(query)) return false;
      return true;
    });

    renderList(filtered);
  };

  renderSidoOptions();
  renderSigunguOptions("");
  renderTypeChips();
  applyFilters();

  searchInput.addEventListener("input", applyFilters);
  sidoSelect.addEventListener("change", () => {
    renderSigunguOptions(sidoSelect.value);
    applyFilters();
  });
  sigunguSelect.addEventListener("change", applyFilters);
  reservableToggle?.addEventListener("change", applyFilters);

  typeChips.addEventListener("click", (event) => {
    const target = event.target.closest(".chip");
    if (!target) return;
    typeChips.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.remove("is-active");
    });
    target.classList.add("is-active");
    applyFilters();
  });
};

const initRestaurantsPage = async () => {
  const grid = document.getElementById("restaurant-grid");
  const listState = document.getElementById("list-state");
  if (!grid) return;

  try {
    const response = await fetch(new URL(DATA_URL, document.baseURI).toString());
    if (!response.ok) throw new Error("DATA_LOAD_FAILED");
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("DATA_INVALID");

    const restaurants = data.map(normalizeRestaurant).map((item) => ({
      ...item,
      searchText: buildSearchText(item),
    }));

    initFilters(restaurants);
  } catch (error) {
    if (listState) {
      listState.textContent = "데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.";
      listState.style.display = "block";
    }
    grid.innerHTML = "";
  }
};

const initRestaurantDetail = async () => {
  const detailPage = document.getElementById("detail-page");
  if (!detailPage) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) return;

  const detailHero = document.getElementById("detail-hero");
  const detailSummary = document.getElementById("detail-summary");
  const detailInfo = document.getElementById("detail-info");

  try {
    const response = await fetch(new URL(DATA_URL, document.baseURI).toString());
    const data = await response.json();
    const restaurants = data.map(normalizeRestaurant);
    const item = restaurants.find((restaurant) => restaurant.id === id);

    if (!item || !detailHero) return;

    detailHero.innerHTML = "";
    const frame = buildMediaFrame({
      src: pickImageUrl(item.thumbnail || item.images),
      alt: `${item.name} 대표 이미지`,
    });

    const titleWrap = document.createElement("div");
    titleWrap.className = "detail-title";
    titleWrap.innerHTML = `
      <span class="badge">${formatValue(item.type, "기타")}</span>
      <h1>${item.name}</h1>
      <p class="card-meta">${formatValue(item.region?.sido)} · ${formatValue(
      item.region?.sigungu
    )}</p>
      <p class="card-meta">${formatValue(item.addressPublic)}</p>
    `;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const reservationUrl = getReservationUrl(item);
    const directionsUrl = getDirectionsUrl(item);

    actions.appendChild(
      reservationUrl
        ? buildActionButton({ label: "예약", href: reservationUrl, primary: true })
        : buildActionButton({ label: "예약 준비중", primary: true, disabled: true })
    );
    actions.appendChild(
      directionsUrl
        ? buildActionButton({ label: "길찾기", href: directionsUrl })
        : buildActionButton({ label: "길찾기 준비중", disabled: true })
    );

    titleWrap.appendChild(actions);
    detailHero.append(frame, titleWrap);

    if (detailSummary) {
      detailSummary.innerHTML = `
        <div class="summary-card">
          <span>식당 유형</span>
          <strong>${formatValue(item.type, "기타")}</strong>
        </div>
        <div class="summary-card">
          <span>지역</span>
          <strong>${formatValue(item.region?.sido)} ${formatValue(
        item.region?.sigungu
      )}</strong>
        </div>
        <div class="summary-card">
          <span>대표 메뉴</span>
          <strong>${
            item.signatureMenus?.length
              ? item.signatureMenus.join(" · ")
              : "미등록"
          }</strong>
        </div>
      `;
    }

    if (detailInfo) {
      detailInfo.innerHTML = `
        <div class="info-card">
          <h3>네이버 예약/플레이스</h3>
          <div class="info-list">
            <span>예약 링크: ${
              reservationUrl
                ? `<a class="link" href="${reservationUrl}" target="_blank" rel="noopener">바로가기</a>`
                : "예약 준비중"
            }</span>
            <span>길찾기 링크: ${
              directionsUrl
                ? `<a class="link" href="${directionsUrl}" target="_blank" rel="noopener">바로가기</a>`
                : "길찾기 준비중"
            }</span>
          </div>
        </div>
        <div class="info-card">
          <h3>대표 메뉴</h3>
          <div class="info-list">
            ${(item.signatureMenus || ["미등록"])
              .map((menu) => `<span>${menu}</span>`)
              .join("")}
          </div>
        </div>
      `;
    }
  } catch (error) {
    if (detailHero) {
      detailHero.innerHTML = `<h1>식당 정보를 불러올 수 없습니다.</h1>`;
    }
  }
};

const init = () => {
  initRestaurantsPage();
  initRestaurantDetail();
};

document.addEventListener("DOMContentLoaded", init);
