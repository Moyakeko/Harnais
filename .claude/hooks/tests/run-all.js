#!/usr/bin/env node
// Lance toutes les suites de tests du socle (hooks + installeur) et totalise.
// Pose HARNAIS_NO_METRICS=1 : aucune suite n'écrit dans le journal du projet.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

process.env.HARNAIS_NO_METRICS = "1";
const dir = __dirname;
const listSuites = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((n) => /^test-.*\.js$/.test(n)).sort().map((n) => path.join(d, n)) : []);
// Dans le dépôt du socle, les tests de l'installeur vivent dans install/tests/ (absents des projets).
const suites = [...listSuites(dir), ...listSuites(path.join(dir, "..", "..", "..", "install", "tests"))];
let ok = 0;
let total = 0;
let failedSuites = 0;
for (const s of suites) {
  const res = spawnSync(process.execPath, [s], { encoding: "utf8", env: process.env });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const m = out.match(/(\d+)\/(\d+) tests OK/);
  if (m) {
    ok += Number(m[1]);
    total += Number(m[2]);
  }
  const good = res.status === 0 && m && m[1] === m[2];
  if (!good) failedSuites++;
  const skips = (out.match(/^SKIP .*/gm) || []).join(" ; ");
  console.log(`${good ? "OK" : "KO"}  ${path.basename(s)}  ${m ? `${m[1]}/${m[2]}` : "(pas de total)"}${skips ? `  [${skips}]` : ""}`);
  if (!good) console.log(out.split("\n").filter((l) => /ÉCHEC|Error|error/.test(l)).slice(0, 15).join("\n"));
}
console.log(`\nTOTAL ${ok}/${total} tests OK, ${suites.length - failedSuites}/${suites.length} suites OK`);
process.exit(failedSuites ? 1 : 0);
