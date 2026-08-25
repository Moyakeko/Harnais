/**
 * lib/latest-version.js — résolution du dernier tag vX.Y publié sur GitHub, et
 * comparaison numérique de deux versions "X.Y" (jamais une comparaison de chaîne,
 * qui classerait "v1.10" avant "v1.9" — même piège documenté dans install.ps1/sh).
 *
 * Zéro dépendance npm (module https natif), comme le reste du socle. fetchTags est
 * injectable pour les tests (voir update-check.js) : sans lui, un vrai appel réseau
 * est fait vers l'API GitHub, avec un header User-Agent explicite (l'API renvoie 403
 * sans lui — contrairement à curl/Invoke-RestMethod, https natif de Node n'en met pas
 * par défaut) et un timeout.
 */

const https = require("https");

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

function fetchTagsHttps(repo, timeoutMs) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(
        `https://api.github.com/repos/${repo}/tags`,
        { headers: { "User-Agent": "harnais-update-check" }, timeout: timeoutMs },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode !== 200) return resolve(null);
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(null);
            }
          });
        }
      );
    } catch (e) {
      return resolve(null);
    }
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

async function resolveLatestTag({ repo, timeoutMs = 3000, fetchTags } = {}) {
  const fetcher = fetchTags || (() => fetchTagsHttps(repo, timeoutMs));
  let tags;
  try {
    tags = await fetcher();
  } catch (e) {
    return null;
  }
  if (!Array.isArray(tags)) return null;
  const names = tags
    .map((t) => t && t.name)
    .filter((n) => typeof n === "string" && /^v\d+\.\d+$/.test(n));
  if (names.length === 0) return null;
  let best = names[0];
  for (const n of names.slice(1)) {
    if (compareVersions(n.slice(1), best.slice(1)) > 0) best = n;
  }
  return best;
}

module.exports = { compareVersions, resolveLatestTag };
