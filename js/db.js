// @ts-check
// ── db.js ── Couche IndexedDB via Dexie ──
// Doit être chargé AVANT storage.js dans chaque page.
// Fournit un cache mémoire synchrone (WorkspaceDB.cache) alimenté au boot
// et persisté en arrière-plan dans IndexedDB par WorkspaceDB.persist().

(function () {
  const DB_NAME = "workspace";
  const DB_VERSION = 1;
  // Une seule "ligne" KV : { key:'data', value:<tout l'état> }
  // C'est volontairement simple — on garde la même forme qu'avant pour
  // un changement minimal du code applicatif.
  const ROW_KEY = "data";
  const LEGACY_LS_KEY = "workspace_data";

  if (typeof Dexie === "undefined") {
    console.error(
      "[WorkspaceDB] Dexie introuvable. Vérifie que assets/vendor/dexie.min.js est chargé avant js/db.js.",
    );
    return;
  }

  const db = new Dexie(DB_NAME);
  db.version(DB_VERSION).stores({
    kv: "key",
  });
  const BACKUP_DIR_HANDLE_KEY = "backupDirHandle";

  const WorkspaceDB = {
    ready: false,
    cache: null,
    _persistTimer: null,
    _persistPending: false,
    _flushPromise: null,

    /** Charge l'état depuis IndexedDB (ou migre depuis localStorage la 1re fois). */
    async init() {
      try {
        const row = await db.table("kv").get(ROW_KEY);
        if (row && row.value) {
          this.cache = row.value;
        } else {
          // Migration éventuelle depuis l'ancien localStorage
          const legacy = localStorage.getItem(LEGACY_LS_KEY);
          if (legacy) {
            try {
              this.cache = JSON.parse(legacy);
              await db.table("kv").put({ key: ROW_KEY, value: this.cache });
              console.info(
                "[WorkspaceDB] Migration localStorage → IndexedDB effectuée.",
              );
            } catch {
              this.cache = null;
            }
          }
        }
      } catch (e) {
        console.error("[WorkspaceDB] Erreur init:", e);
      }
      this.ready = true;
      return this.cache;
    },

    /** Lecture synchrone du cache. */
    getSync() {
      return this.cache;
    },

    /** Écriture synchrone du cache + persistance différée vers IndexedDB. */
    setSync(value) {
      this.cache = value;
      this._schedulePersist();
    },

    _schedulePersist() {
      this._persistPending = true;
      if (this._persistTimer) return;
      this._persistTimer = setTimeout(() => {
        this._persistTimer = null;
        this._flush().catch(() => undefined);
      }, 80); // micro-debounce pour regrouper les écritures successives
    },

    async _flush() {
      if (this._flushPromise) return this._flushPromise;
      if (!this._persistPending) return;
      const pending = (async () => {
        while (this._persistPending) {
          this._persistPending = false;
          try {
            await db.table("kv").put({ key: ROW_KEY, value: this.cache });
          } catch (e) {
            this._persistPending = true;
            console.error("[WorkspaceDB] Persistance échouée:", e);
            throw e;
          }
        }
      })();
      this._flushPromise = pending;
      try {
        await pending;
      } finally {
        if (this._flushPromise === pending) this._flushPromise = null;
      }
    },

    /** Force un flush immédiat (utilisé avant export). */
    async flush() {
      if (this._persistTimer) {
        clearTimeout(this._persistTimer);
        this._persistTimer = null;
      }
      await this._flush();
    },

    /** Estimation de l'espace utilisé en bytes (taille JSON sérialisée). */
    bytesUsed() {
      try {
        return new Blob([JSON.stringify(this.cache || {})]).size;
      } catch {
        return 0;
      }
    },

    /** Efface tout (debug). */
    async clear() {
      this.cache = null;
      await db.table("kv").clear();
    },

    async getBackupDirectoryHandle() {
      try {
        const row = await db.table("kv").get(BACKUP_DIR_HANDLE_KEY);
        return row ? row.value : null;
      } catch (e) {
        console.warn("[WorkspaceDB] getBackupDirectoryHandle:", e);
        return null;
      }
    },

    async setBackupDirectoryHandle(handle) {
      try {
        if (handle) {
          await db.table("kv").put({ key: BACKUP_DIR_HANDLE_KEY, value: handle });
        } else {
          await db.table("kv").delete(BACKUP_DIR_HANDLE_KEY);
        }
      } catch (e) {
        console.warn("[WorkspaceDB] setBackupDirectoryHandle:", e);
      }
    },
  };

  // Flush à la fermeture / mise en arrière-plan pour ne rien perdre.
  // "pagehide" et "visibilitychange" sont plus fiables que "beforeunload"
  // pour les navigateurs modernes (bfcache, mobile, onglets masqués).
  window.addEventListener("beforeunload", () => { WorkspaceDB.flush().catch(() => undefined); });
  window.addEventListener("pagehide", () => { WorkspaceDB.flush().catch(() => undefined); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") WorkspaceDB.flush().catch(() => undefined);
  });

  // Promise globale que les pages attendent avant de démarrer.
  window.WorkspaceDB = WorkspaceDB;
  window.WorkspaceDB_READY = WorkspaceDB.init();

  /**
   * Helper d'amorçage : exécute `fn` quand le DOM ET la base IndexedDB
   * sont prêts. Remplace les `document.addEventListener('DOMContentLoaded', …)`.
   */
  window.bootPage = function bootPage(fn) {
    const domReady =
      document.readyState === "loading"
        ? new Promise((r) =>
            document.addEventListener("DOMContentLoaded", r, { once: true }),
          )
        : Promise.resolve();
    Promise.all([domReady, window.WorkspaceDB_READY]).then(() => {
      if (typeof _ensureDefaultTemplates === "function") {
        try { _ensureDefaultTemplates(); } catch (e) { /* silencieux */ }
      }
      // Purge automatique de la corbeille (éléments > 30 jours)
      if (typeof purgeOldTrash === "function") {
        try { purgeOldTrash(); } catch (e) { /* silencieux */ }
      }
      try {
        fn();
      } catch (e) {
        console.error("[bootPage]", e);
      }
    });
  };
})();
