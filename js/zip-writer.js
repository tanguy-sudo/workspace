// @ts-check
// ── zip-writer.js ──
// Petit générateur de ZIP "store" (sans compression) en JavaScript pur.
// Utilisation :
//   const blob = createZip([
//     { name: "todo.json", content: '{"a":1}' },
//     { name: "notes/readme.md", content: "# Hello" },
//   ]);
//
// Aucune dépendance externe. Adapté à des fichiers texte UTF-8 ;
// suffisant pour des sauvegardes JSON / Markdown.

(function (global) {
  // CRC-32 (table pré-calculée) ────────────────────────────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }

  function writeU16(view, off, val) {
    view.setUint16(off, val, true);
  }
  function writeU32(view, off, val) {
    view.setUint32(off, val, true);
  }

  // Convertit Date → champs DOS (date + time, little-endian) ─
  function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    const dosTime =
      ((d.getHours() & 0x1f) << 11) |
      ((d.getMinutes() & 0x3f) << 5) |
      ((d.getSeconds() / 2) & 0x1f);
    const dosDate =
      (((year - 1980) & 0x7f) << 9) |
      (((d.getMonth() + 1) & 0xf) << 5) |
      (d.getDate() & 0x1f);
    return { dosTime, dosDate };
  }

  /**
   * @param {Array<{name:string,content:string|Uint8Array}>} files
   * @returns {Blob} application/zip
   */
  function createZip(files) {
    const now = new Date();
    const { dosTime, dosDate } = dosDateTime(now);

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    let centralSize = 0;

    files.forEach((f) => {
      const nameBytes = utf8Encode(f.name);
      const dataBytes =
        typeof f.content === "string" ? utf8Encode(f.content) : f.content;
      const crc = crc32(dataBytes);

      // Local file header (30 bytes + name + data)
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lv = new DataView(localHeader);
      writeU32(lv, 0, 0x04034b50); // signature
      writeU16(lv, 4, 20); // version needed
      writeU16(lv, 6, 0x0800); // general purpose (UTF-8 names)
      writeU16(lv, 8, 0); // method = store
      writeU16(lv, 10, dosTime);
      writeU16(lv, 12, dosDate);
      writeU32(lv, 14, crc);
      writeU32(lv, 18, dataBytes.length); // compressed size
      writeU32(lv, 22, dataBytes.length); // uncompressed size
      writeU16(lv, 26, nameBytes.length);
      writeU16(lv, 28, 0); // extra field length
      new Uint8Array(localHeader, 30).set(nameBytes);

      localParts.push(new Uint8Array(localHeader));
      localParts.push(dataBytes);

      // Central directory header (46 bytes + name)
      const central = new ArrayBuffer(46 + nameBytes.length);
      const cv = new DataView(central);
      writeU32(cv, 0, 0x02014b50);
      writeU16(cv, 4, 20); // version made by
      writeU16(cv, 6, 20); // version needed
      writeU16(cv, 8, 0x0800);
      writeU16(cv, 10, 0);
      writeU16(cv, 12, dosTime);
      writeU16(cv, 14, dosDate);
      writeU32(cv, 16, crc);
      writeU32(cv, 20, dataBytes.length);
      writeU32(cv, 24, dataBytes.length);
      writeU16(cv, 28, nameBytes.length);
      writeU16(cv, 30, 0);
      writeU16(cv, 32, 0);
      writeU16(cv, 34, 0);
      writeU16(cv, 36, 0);
      writeU32(cv, 38, 0); // external attrs
      writeU32(cv, 42, offset); // local header offset
      new Uint8Array(central, 46).set(nameBytes);

      centralParts.push(new Uint8Array(central));

      offset += 30 + nameBytes.length + dataBytes.length;
      centralSize += 46 + nameBytes.length;
    });

    // End of central directory record (22 bytes)
    const end = new ArrayBuffer(22);
    const ev = new DataView(end);
    writeU32(ev, 0, 0x06054b50);
    writeU16(ev, 4, 0); // disk number
    writeU16(ev, 6, 0);
    writeU16(ev, 8, files.length);
    writeU16(ev, 10, files.length);
    writeU32(ev, 12, centralSize);
    writeU32(ev, 16, offset); // central dir offset
    writeU16(ev, 20, 0); // comment length

    return new Blob([...localParts, ...centralParts, new Uint8Array(end)], {
      type: "application/zip",
    });
  }

  global.createZip = createZip;
})(window);
