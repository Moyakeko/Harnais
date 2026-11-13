/**
 * lib/atomic-write.js — écriture d'un fichier d'état JSON (tmp + rename).
 *
 * Sous Windows, renameSync échoue parfois en EPERM/EACCES/EBUSY quand un autre
 * processus (antivirus, indexeur, hook concurrent) tient le fichier cible ouvert.
 * v1 laissait remonter l'erreur (11 erreurs relevées sur hard-stop-guard). Ici :
 * quelques nouvelles tentatives courtes, puis repli sur une écriture directe
 * (non atomique, mais la lecture des états est déjà tolérante). Le fichier
 * temporaire est toujours nettoyé. `fsImpl` est injectable pour les tests.
 */

const realFs = require("fs");
const path = require("path");

const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
const RETRIES = 3;
const RETRY_DELAY_MS = 15;

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
    // Pas de sommeil possible : on réessaie tout de suite.
  }
}

function writeFileAtomic(file, text, fsImpl) {
  const fs = fsImpl || realFs;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text);
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return "renamed";
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE.has(e && e.code)) break;
      if (attempt < RETRIES) sleepSync(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  try {
    if (!RETRYABLE.has(lastErr && lastErr.code)) throw lastErr;
    fs.writeFileSync(file, text);
    return "direct";
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      // déjà absent
    }
  }
}

function writeJsonAtomic(file, data, fsImpl) {
  return writeFileAtomic(file, JSON.stringify(data), fsImpl);
}

module.exports = { writeFileAtomic, writeJsonAtomic };
