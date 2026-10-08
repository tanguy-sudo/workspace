// @ts-check
// ── modal-utils.js ── Gestion de la persistance et redimensionnement des modals

const MODAL_SIZE_STORAGE_PREFIX = "workspace-modal-size-v1:";
const MODAL_MIN_WIDTH = 420;
const MODAL_MIN_HEIGHT = 280;

function _getModalViewportLimit() {
  const p = 40; // padding autour
  return {
    maxWidth: Math.max(600, window.innerWidth - p * 2),
    maxHeight: Math.max(400, window.innerHeight - p * 2),
  };
}

function _clampModalSize(width, height) {
  const limits = _getModalViewportLimit();
  return {
    width: Math.max(MODAL_MIN_WIDTH, Math.min(width, limits.maxWidth)),
    height: Math.max(MODAL_MIN_HEIGHT, Math.min(height, limits.maxHeight)),
  };
}

function _loadModalSize(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(MODAL_SIZE_STORAGE_PREFIX + storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.w !== "number" || typeof parsed.h !== "number") {
      return null;
    }
    return _clampModalSize(parsed.w, parsed.h);
  } catch (_) {
    return null;
  }
}

function _saveModalSize(storageKey, size) {
  if (!storageKey || !size) return;
  try {
    localStorage.setItem(
      MODAL_SIZE_STORAGE_PREFIX + storageKey,
      JSON.stringify({ w: Math.round(size.width), h: Math.round(size.height) }),
    );
  } catch (_) {}
}

function _clearModalSize(storageKey) {
  if (!storageKey) return;
  try {
    localStorage.removeItem(MODAL_SIZE_STORAGE_PREFIX + storageKey);
  } catch (_) {}
}

function _initResizableModal(modalEl, handleEls, storageKey) {
  const canResize = !!window.matchMedia?.("(pointer: fine)")?.matches;
  if (!canResize) return () => {};

  const handles = Array.isArray(handleEls)
    ? handleEls.filter(Boolean)
    : handleEls
      ? [handleEls]
      : [];

  const applySize = (w, h) => {
    const size = _clampModalSize(w, h);
    modalEl.style.width = size.width + "px";
    modalEl.style.height = size.height + "px";
  };

  const saved = _loadModalSize(storageKey);
  if (saved) {
    applySize(saved.width, saved.height);
  }

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;
  let activeDir = "se";

  const onMouseDown = (e, dir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isResizing = true;
    activeDir = dir || "se";
    startX = e.clientX;
    startY = e.clientY;
    const rect = modalEl.getBoundingClientRect();
    startW = rect.width;
    startH = rect.height;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const onMouseMove = (e) => {
    if (!isResizing) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const isWest = activeDir.includes("w");
    const isNorth = activeDir.includes("n");
    const nextW = startW + (isWest ? -dx : dx);
    const nextH = startH + (isNorth ? -dy : dy);
    applySize(nextW, nextH);
  };

  const onMouseUp = () => {
    isResizing = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    const rect = modalEl.getBoundingClientRect();
    _saveModalSize(storageKey, { width: rect.width, height: rect.height });
  };

  const handleListeners = handles.map((handle) => {
    const dir = handle.dataset.resizeDir || "se";
    const listener = (e) => onMouseDown(e, dir);
    handle.addEventListener("mousedown", listener);
    return { handle, listener };
  });

  return () => {
    handleListeners.forEach(({ handle, listener }) => {
      handle.removeEventListener("mousedown", listener);
    });
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}
