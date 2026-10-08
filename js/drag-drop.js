// @ts-check
// ── drag-drop.js ── upload drag & drop réutilisable ──

const MAX_FILE_SIZE_MB = 4;

/**
 * Initialise une zone de drag & drop
 * @param {HTMLElement} zone  - L'élément drop zone
 * @param {Function} onFile   - Callback ({ name, type, size, base64 })
 */
function initDragDrop(zone, onFile) {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) _processFile(file, onFile);
  });
  // Clic aussi
  zone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => {
      if (input.files[0]) _processFile(input.files[0], onFile);
    };
    input.click();
  });
}

function _processFile(file, onFile) {
  const sizeMB = file.size / 1024 / 1024;
  if (sizeMB > MAX_FILE_SIZE_MB) {
    showToast(`Fichier trop lourd (max ${MAX_FILE_SIZE_MB}MB)`, "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    onFile({
      name: file.name,
      mime: file.type,
      size: file.size,
      base64: e.target.result, // data:...;base64,...
    });
  };
  reader.readAsDataURL(file);
}

function _fileIcon(mime) {
  if (mime && mime.includes("pdf"))
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V6l-4-4.5z"/><path d="M9 1.5V6h4"/></svg>`;
  if (mime && mime.includes("image"))
    return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 10l3-3 3 3 2.5-2.5L14 12"/><circle cx="5" cy="6" r="1"/></svg>`;
  return `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V6l-4-4.5z"/><path d="M9 1.5V6h4M5.5 8h5M5.5 10.5h3"/></svg>`;
}

function _formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function _previewFileKind(file) {
  const mime = (file?.mime || "").toLowerCase().split(";", 1)[0];
  const encoded = file?.base64?.split(",", 2)[1] || "";
  if (mime === "image/png" && encoded.startsWith("iVBORw0KGgo")) return "image";
  if (mime === "image/gif" && encoded.startsWith("R0lGOD")) return "image";
  if (mime === "image/jpeg" && encoded.startsWith("/9j/")) return "image";
  if (mime === "image/webp" && encoded.startsWith("UklGR")) return "image";
  if (mime === "application/pdf" && encoded.startsWith("JVBERi0")) return "pdf";
  return null;
}

function _safeFilename(value) {
  const name = String(value || "download")
    .replace(/[\\/\0\u0000-\u001f\u007f]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .trim();
  return name && name !== "." && name !== ".." ? name : "download";
}

/** Ouvre un viewer pour image ou PDF */
function openFileViewer(file) {
  if (!file?.base64) return;
  const kind = _previewFileKind(file);
  const isImage = kind === "image";
  const isPDF = kind === "pdf";

  if (!isImage && !isPDF) {
    // Télécharger directement
    const a = document.createElement("a");
    a.href = file.base64;
    a.download = _safeFilename(file.name);
    a.click();
    return;
  }

  const content = document.createElement("div");
  content.style.cssText = "text-align:center;";

  if (isImage) {
    const img = document.createElement("img");
    img.src = file.base64;
    img.style.cssText =
      "max-width:100%;max-height:60vh;border-radius:8px;object-fit:contain;";
    content.appendChild(img);
  } else if (isPDF) {
    const iframe = document.createElement("iframe");
    iframe.src = file.base64;
    iframe.setAttribute("sandbox", "");
    iframe.style.cssText =
      "width:100%;height:60vh;border:none;border-radius:8px;";
    content.appendChild(iframe);
  }

  const footer = document.createElement("div");
  footer.style.cssText =
    "display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap;";

  const dlBtn = document.createElement("a");
  dlBtn.href = file.base64;
  dlBtn.download = _safeFilename(file.name);
  dlBtn.className = "btn btn-ghost btn-sm";
  dlBtn.innerHTML = IC.upload + " Télécharger";

  if (isImage || isPDF) {
    const newTabBtn = document.createElement("a");
    newTabBtn.className = "btn btn-ghost btn-sm";
    newTabBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9"/><path d="M10 2h4v4M14 2L8 8"/></svg> Ouvrir dans un nouvel onglet`;
    newTabBtn.style.cursor = "pointer";
    newTabBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // Convertir le base64 en Blob URL pour l'ouverture dans un nouvel onglet
      const byteString = atob(file.base64.split(",")[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++)
        ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: file.mime });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      // Le navigateur a déjà commencé à charger le blob — on peut révoquer rapidement.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    });
    footer.appendChild(newTabBtn);
  }
  footer.appendChild(dlBtn);
  content.appendChild(footer);

  createModal({
    title: file.name,
    content,
    onConfirm: () => {},
    confirmLabel: "Fermer",
    hideCancel: true,
  });
}

/** Construit l'élément d'affichage cliquable pour un fichier */
function renderFileAttachment(file) {
  if (!file) return null;
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-3);border-radius:6px;border:1px solid var(--border);margin-top:8px;cursor:pointer;transition:border-color .12s;";
  wrap.addEventListener(
    "mouseenter",
    () => (wrap.style.borderColor = "var(--border-hi)"),
  );
  wrap.addEventListener(
    "mouseleave",
    () => (wrap.style.borderColor = "var(--border)"),
  );

  const kind = _previewFileKind(file);
  const isImage = kind === "image";
  const isPDF = kind === "pdf";

  const icon = document.createElement("span");
  icon.innerHTML = _fileIcon(file.mime);
  icon.style.color = "var(--text-2)";

  const name = document.createElement("span");
  name.textContent = file.name;
  name.style.cssText =
    "font-size:.78rem;font-family:var(--font-mono);color:var(--link-color);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

  const size = document.createElement("span");
  size.textContent = _formatSize(file.size);
  size.style.cssText =
    "font-size:.68rem;font-family:var(--font-mono);color:var(--text-3);flex-shrink:0;";

  const action = document.createElement("span");
  action.style.cssText =
    "font-size:.68rem;color:var(--text-3);flex-shrink:0;font-family:var(--font-mono);";
  action.textContent = isImage || isPDF ? "👁 Aperçu" : "⬇ Télécharger";

  wrap.appendChild(icon);
  wrap.appendChild(name);
  wrap.appendChild(size);
  wrap.appendChild(action);
  wrap.addEventListener("click", () => openFileViewer(file));
  return wrap;
}

// ═══════════════════════════════════════════════════════════
// DRAG & DROP ARBRE — API générique (nœuds, snippets, dossiers)
// ═══════════════════════════════════════════════════════════

/** ID et type du nœud en cours de glissement (session globale). */
let _dndCurrentId   = null;
let _dndCurrentType = null;

/**
 * Rend un élément draggable.
 * @param {HTMLElement} element
 * @param {string}      id    Identifiant du nœud
 * @param {string}      [type="any"]  Type ("folder"|"item"|"doc"|"link"|"snippet"|"any")
 */
function makeDraggable(element, id, type = "any") {
  element.draggable = true;
  element.addEventListener("dragstart", (e) => {
    _dndCurrentId   = id;
    _dndCurrentType = type;
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => element.classList.add("dragging"), 0);
  });
  element.addEventListener("dragend", () => {
    _dndCurrentId   = null;
    _dndCurrentType = null;
    element.classList.remove("dragging");
    document
      .querySelectorAll(".drag-over, .drop-before, .drop-after")
      .forEach((n) => n.classList.remove("drag-over", "drop-before", "drop-after"));
  });
}

/**
 * Rend un élément drop-target.
 *
 * @param {HTMLElement} element
 * @param {string}      targetId
 * @param {Function}    onDrop   Callback(draggedId, position?)
 *   - position = "before"|"after"  → réordonnancement
 *   - position = undefined         → déplacement dans le dossier
 * @param {object} [opts]
 *   opts.reorder      {boolean}    Toujours afficher indicateurs avant/après
 *   opts.reorderTypes {string[]}   Afficher avant/après SI le type glissé est dans la liste,
 *                                   sinon drag-over (mouvement dans dossier)
 *   opts.canDrop      {(id)=>bool} Prédicat optionnel
 */
function makeDropTarget(element, targetId, onDrop, opts = {}) {
  element.addEventListener("dragover", (e) => {
    const id   = _dndCurrentId;
    const type = _dndCurrentType;
    if (!id || id === targetId) return;
    if (opts.canDrop && !opts.canDrop(id)) return;
    e.preventDefault();

    if (opts.reorder) {
      // Mode réordonnancement pur (snippets, items) : 2 zones haut/bas
      const rect = element.getBoundingClientRect();
      const mid  = rect.top + rect.height / 2;
      element.classList.toggle("drop-before", e.clientY < mid);
      element.classList.toggle("drop-after",  e.clientY >= mid);
    } else if (opts.reorderTypes && opts.reorderTypes.includes(type)) {
      // Mode mixte (dossiers) : 3 zones — haut=avant, milieu=dans, bas=après
      const rect    = element.getBoundingClientRect();
      const zone    = rect.height * 0.25;
      const relY    = e.clientY - rect.top;
      const inBefore = relY < zone;
      const inAfter  = relY > rect.height - zone;
      element.classList.toggle("drop-before", inBefore);
      element.classList.toggle("drop-after",  inAfter && !inBefore);
      element.classList.toggle("drag-over",   !inBefore && !inAfter);
    } else {
      element.classList.remove("drop-before", "drop-after");
      element.classList.add("drag-over");
    }
  });

  element.addEventListener("dragleave", (e) => {
    if (!element.contains(e.relatedTarget))
      element.classList.remove("drag-over", "drop-before", "drop-after");
  });

  element.addEventListener("drop", (e) => {
    e.preventDefault();
    const draggedId  = _dndCurrentId || e.dataTransfer.getData("text/plain");
    const type       = _dndCurrentType;
    const wasBefore  = element.classList.contains("drop-before");
    const wasAfter   = element.classList.contains("drop-after");
    const wasInto    = element.classList.contains("drag-over");
    element.classList.remove("drag-over", "drop-before", "drop-after");
    if (!draggedId || draggedId === targetId) return;
    if (opts.canDrop && !opts.canDrop(draggedId)) return;

    if (opts.reorder) {
      // Réordonnancement pur
      onDrop(draggedId, wasBefore ? "before" : "after");
    } else if (opts.reorderTypes && opts.reorderTypes.includes(type)) {
      // Mode mixte 3 zones : avant/après = reorder, milieu = move into
      if (wasBefore) onDrop(draggedId, "before");
      else if (wasAfter) onDrop(draggedId, "after");
      else onDrop(draggedId, undefined); // move into
    } else {
      onDrop(draggedId, undefined);
    }
  });
}
