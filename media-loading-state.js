(function attachMediaLoadingState() {
  "use strict";

  const LOADING_LABEL = "이미지 불러오는 중…";
  const UNAVAILABLE_LABEL = "이미지 준비중";

  const updateFrame = (frame) => {
    if (!(frame instanceof Element)) return;
    const label = frame.querySelector(".media-placeholder span:last-child");
    if (!label) return;

    const img = frame.querySelector("img");
    const isFallback = Boolean(
      img &&
        (img.classList.contains("is-fallback") || img.dataset.fallbackApplied === "1")
    );
    label.textContent = isFallback ? UNAVAILABLE_LABEL : LOADING_LABEL;
  };

  const scan = (root) => {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element && root.matches(".media-frame")) {
      updateFrame(root);
    }
    root.querySelectorAll?.(".media-frame").forEach(updateFrame);
  };

  const start = () => {
    scan(document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) scan(node);
          });
          return;
        }
        if (mutation.type === "attributes") {
          const frame = mutation.target.closest?.(".media-frame");
          if (frame) updateFrame(frame);
        }
      });
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "data-fallback-applied", "src"],
    });

    const refreshFromImageEvent = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const frame = target.closest(".media-frame");
      if (frame) updateFrame(frame);
    };

    document.addEventListener("load", refreshFromImageEvent, true);
    document.addEventListener("error", refreshFromImageEvent, true);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
