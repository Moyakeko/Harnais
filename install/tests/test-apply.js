#!/usr/bin/env node
// Tests de install/apply.js (v2) : dry-run, idempotence, budget de descriptions,
// préservation des fichiers du projet, manifeste (plugins, skills isolés, hooks
// optionnels) et migration d'un projet installé en v1.16.
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.HARNAIS_NO_METRICS = "1";
const REPO = path.join(__dirname, "..", "..");
const APPLY = path.join(REPO, "install", "apply.js");

let pass = 0;
const fails = [];
function check(label, ok) {
  if (ok) pass++;
  else fails.push(`ÉCHEC: ${label}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harnais-apply-test-"));
process.on("exit", () => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let n = 0;
function mkProject() {
  const d = path.join(tmpRoot, `p${n++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function apply(target, extra = [], source = REPO, applyPath = APPLY) {
  return spawnSync(process.execPath, [applyPath, "--source", source, "--target", target, "--commit", "t", ...extra], { encoding: "utf8" });
}
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex") + ":" + fs.statSync(full).mtimeMs;
    }
  };
  walk(dir);
  return out;
}
const read = (p) => fs.readFileSync(p, "utf8");
const readJson = (p) => JSON.parse(read(p));
const settingsCmds = (dir) =>
  Object.values(readJson(path.join(dir, ".claude", "settings.json")).hooks || {})
    .flat()
    .flatMap((e) => (e.hooks || []).map((h) => h.command));
function writeSkill(dir, name, description, extraFm = "") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${extraFm}---\n\n# ${name}\nCorps.\n`);
}

// --- 1. Dry-run sur projet neuf : aucune écriture ---
{
  const p = mkProject();
  const r = apply(p, ["--dry-run"]);
  check("dry-run neuf => exit 0", r.status === 0);
  check("dry-run neuf => annonce le mode", r.stdout.includes("--dry-run"));
  check("dry-run neuf => liste ce qui serait créé", r.stdout.includes("[créé] CLAUDE.md"));
  check("dry-run neuf => aucun fichier écrit", fs.readdirSync(p).length === 0);
}

// --- 2. Installation puis idempotence ---
const base = mkProject();
{
  const r = apply(base);
  check("install => exit 0", r.status === 0);
  const claude = read(path.join(base, "CLAUDE.md"));
  const block = claude.slice(claude.indexOf("<!-- harnais:core"), claude.indexOf("<!-- harnais:core end -->") + 25);
  check("bloc core ≤ 60 lignes", block.split("\n").length <= 60);
  check("bloc core sans « pas un projet applicatif »", !/pas un projet applicatif/i.test(claude));
  check("skills du socle = 3", fs.readdirSync(path.join(base, ".claude", "skills")).sort().join(",") === "deploy-checklist,session-checkpoint,update-harnais");
  check("aucun agent par défaut", !fs.existsSync(path.join(base, ".claude", "agents")));
  check("règle de maintenance posée", fs.existsSync(path.join(base, ".claude", "rules", "harnais-maintenance.md")));
  const cmds = settingsCmds(base);
  check("checkpoint-nudge enregistré (Stop + PreCompact)", cmds.filter((c) => c.includes("checkpoint-nudge")).length === 2);
  check("graphify-check non enregistré par défaut", !cmds.some((c) => c.includes("graphify-check")));
  check("hard-stop-guard actif par défaut", cmds.some((c) => c.includes("hard-stop-guard")));
  check("pas de MONITORING.csv en v2", !fs.existsSync(path.join(base, "MONITORING.csv")));
  const before = snapshot(base);
  const r2 = apply(base);
  check("2e passage => exit 0", r2.status === 0);
  check("2e passage => aucun changement annoncé", !/\[(créé|remplacé|mis à jour|retiré|bloc)/.test(r2.stdout));
  check("2e passage => aucun fichier modifié (contenu et date)", JSON.stringify(snapshot(base)) === JSON.stringify(before));
  check("2e passage => pas de dossier de sauvegarde", !fs.existsSync(path.join(base, ".claude", "harnais-backups")));
}

// --- 3. Préservation : SESSION.md, LESSONS.md, skills locaux, CLAUDE.md hors bloc ---
{
  const p = mkProject();
  fs.writeFileSync(path.join(p, "SESSION.md"), "# état réel\nNE PAS TOUCHER\n");
  fs.writeFileSync(path.join(p, "LESSONS.md"), "# leçons\npiège 1\n");
  fs.writeFileSync(path.join(p, "CLAUDE.md"), "# Mon projet\nRègle maison.\n");
  writeSkill(path.join(p, ".claude", "skills", "local-fetch"), "local-fetch", "Use when fetching project data.");
  writeSkill(path.join(p, ".claude", "skills", "ma-skill"), "ma-skill", "Locale.");
  const srcSkills = path.join(p, "src-skills");
  writeSkill(path.join(srcSkills, "ma-skill"), "ma-skill", "Venue du manifeste.");
  fs.writeFileSync(
    path.join(p, "harnais.manifest.json"),
    JSON.stringify({ harnais: "2.0", skills: [{ name: "ma-skill", from: "./src-skills", path: "ma-skill", description: "Use when X." }] })
  );
  const keep = snapshot(path.join(p, ".claude", "skills"));
  const r = apply(p);
  check("préservation => exit 0", r.status === 0);
  check("SESSION.md existant intact", read(path.join(p, "SESSION.md")).includes("NE PAS TOUCHER"));
  check("LESSONS.md existant intact", read(path.join(p, "LESSONS.md")).includes("piège 1"));
  check("CLAUDE.md : contenu du projet conservé", read(path.join(p, "CLAUDE.md")).startsWith("# Mon projet\nRègle maison.\n"));
  check("CLAUDE.md : bloc ajouté", read(path.join(p, "CLAUDE.md")).includes("<!-- harnais:core v"));
  check("CLAUDE.md d'origine sauvegardé", fs.readdirSync(path.join(p, ".claude", "harnais-backups")).length === 1);
  const after = snapshot(path.join(p, ".claude", "skills"));
  check("skill local local-fetch intact", after["local-fetch/SKILL.md"] === keep["local-fetch/SKILL.md"]);
  check("skill hors manifeste de même nom jamais écrasé", after["ma-skill/SKILL.md"] === keep["ma-skill/SKILL.md"]);
  check("conflit de nom signalé", r.stdout.includes("ma-skill") && r.stdout.includes("laissé intact"));
}

// --- 4. Budget de descriptions ---
{
  const p = mkProject();
  const src = path.join(p, "vendor");
  const skills = [];
  for (let i = 0; i < 5; i++) {
    writeSkill(path.join(src, `s${i}`), `s${i}`, "x");
    skills.push({ name: `gros-${i}`, from: "./vendor", path: `s${i}`, description: `Use when ${"y".repeat(1400)}` });
  }
  fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify({ skills }));
  const r = apply(p, ["--dry-run"]);
  check("budget dépassé => avertissement (dry-run)", /ATTENTION : budget de descriptions dépassé/.test(r.stdout));
  check("budget dépassé => dry-run n'écrit rien", fs.readdirSync(p).sort().join(",") === "harnais.manifest.json,vendor");
  fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify({ skills: skills.slice(0, 2) }));
  const r2 = apply(p);
  check("budget sous le seuil => pas d'avertissement", !/budget de descriptions dépassé/.test(r2.stdout));
  const m = r2.stdout.match(/Budget descriptions : (\d+)/);
  check("budget compte socle + skills isolés (≈ 474 + 2×1409)", m && Number(m[1]) === 474 + 2 * 1409);
  check("skill manuel (update-harnais) compté 0", r2.stdout.includes("update-harnais=manuel"));
}

// --- 5. Manifeste : skill isolé, description réécrite, paths ---
{
  const p = mkProject();
  const src = path.join(p, "ecc");
  fs.mkdirSync(path.join(src, "skills", "frontend"), { recursive: true });
  fs.writeFileSync(
    path.join(src, "skills", "frontend", "SKILL.md"),
    "---\nname: frontend-patterns\ndescription: >\n  Longue description d'origine\n  sur deux lignes.\norigin: ECC\n---\n\n# Corps intact\n"
  );
  fs.writeFileSync(path.join(src, "skills", "frontend", "ref.md"), "référence\n");
  fs.writeFileSync(
    path.join(p, "harnais.manifest.json"),
    JSON.stringify({ skills: [{ name: "ecc-frontend", from: "./ecc", path: "skills/frontend", ref: "v1", description: "Use when styling a page.", paths: ["src/**/*.tsx"] }] })
  );
  const r = apply(p);
  const md = read(path.join(p, ".claude", "skills", "ecc-frontend", "SKILL.md"));
  check("skill isolé => exit 0", r.status === 0);
  check("skill isolé : name réécrit", /^name: ecc-frontend$/m.test(md));
  check("skill isolé : description réécrite", md.includes('description: "Use when styling a page."') && !md.includes("Longue description"));
  check("skill isolé : paths posé", md.includes('paths: "src/**/*.tsx"'));
  check("skill isolé : autres clés et corps conservés", md.includes("origin: ECC") && md.includes("# Corps intact"));
  check("skill isolé : fichiers annexes copiés", fs.existsSync(path.join(p, ".claude", "skills", "ecc-frontend", "ref.md")));
  check("skill isolé : suivi dans harnais.version", readJson(path.join(p, ".claude", "harnais.version")).applied.skills.includes("ecc-frontend"));
  // Mise à jour de la source => resynchronisé, ancien fichier annexe retiré et sauvegardé.
  fs.rmSync(path.join(src, "skills", "frontend", "ref.md"));
  const r2 = apply(p);
  check("source modifiée => skill resynchronisé", r2.stdout.includes("ecc-frontend/ (manifeste)") && !fs.existsSync(path.join(p, ".claude", "skills", "ecc-frontend", "ref.md")));
  check("source modifiée => ancien fichier sauvegardé", fs.readdirSync(path.join(p, ".claude", "harnais-backups")).length >= 1);
  check("source modifiée => 3e passage idempotent", !/\[(créé|remplacé|mis à jour)/.test(apply(p).stdout));
}

// --- 6. Plugins ---
{
  const p = mkProject();
  fs.mkdirSync(path.join(p, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(p, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "perso@ailleurs": true }, permissions: { deny: ["Read(perso)"] } }));
  const man = {
    plugins: [
      { name: "caveman", marketplace: "caveman", source: "github:JuliusBrussee/caveman", ref: "v4.1.0" },
      { name: "ponytail", marketplace: "ponytail", source: "github:DietrichGebert/ponytail", ref: "v5.3.3" },
    ],
  };
  fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify(man));
  const r = apply(p);
  let s = readJson(path.join(p, ".claude", "settings.json"));
  check("plugins => exit 0", r.status === 0);
  check("extraKnownMarketplaces au format github + ref", JSON.stringify(s.extraKnownMarketplaces.caveman) === JSON.stringify({ source: { source: "github", repo: "JuliusBrussee/caveman", ref: "v4.1.0" } }));
  check("enabledPlugins name@marketplace", s.enabledPlugins["caveman@caveman"] === true && s.enabledPlugins["ponytail@ponytail"] === true);
  check("plugin perso conservé", s.enabledPlugins["perso@ailleurs"] === true);
  check("deny perso conservé + deny socle ajouté", s.permissions.deny.includes("Read(perso)") && s.permissions.deny.includes("Read(.env)"));
  check("commandes d'installation affichées", r.stdout.includes("claude plugin install caveman@caveman --scope project"));
  man.plugins = man.plugins.slice(1);
  fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify(man));
  apply(p);
  s = readJson(path.join(p, ".claude", "settings.json"));
  check("plugin retiré du manifeste => retiré de settings", !("caveman@caveman" in s.enabledPlugins) && !("caveman" in s.extraKnownMarketplaces));
  check("plugin perso toujours conservé", s.enabledPlugins["perso@ailleurs"] === true && s.enabledPlugins["ponytail@ponytail"] === true);
}

// --- 7. Hooks optionnels ---
{
  const p = mkProject();
  fs.mkdirSync(path.join(p, ".claude"), { recursive: true });
  const userHook = 'node "$CLAUDE_PROJECT_DIR/tools/mon-hook.js"';
  fs.writeFileSync(path.join(p, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: userHook }] }] } }));
  fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify({ optional_hooks: { "hard-stop-guard": false, "resume-after-reset": false, "graphify-check": true } }));
  apply(p);
  let cmds = settingsCmds(p);
  check("hard-stop-guard désactivé => retiré", !cmds.some((c) => c.includes("hard-stop-guard")));
  check("graphify-check activé => enregistré", cmds.some((c) => c.includes("graphify-check")));
  check("hook du projet conservé", cmds.includes(userHook));
  const hj = readJson(path.join(p, ".claude", "harnais.hooks.json")).hooks;
  check("harnais.hooks.json reflète le manifeste", hj["resume-after-reset"] === false && hj["hard-stop-guard"] === false && hj["context-watchdog"] === true);
  fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify({ optional_hooks: ["hard-stop-guard"] }));
  apply(p);
  cmds = settingsCmds(p);
  check("réactivation => hard-stop-guard de retour (3 entrées)", cmds.filter((c) => c.includes("hard-stop-guard")).length === 3);
  check("forme tableau => graphify-check revient à son défaut (off)", !cmds.some((c) => c.includes("graphify-check")));
}

// --- 8. Manifeste invalide ---
{
  const p = mkProject();
  fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify({ optional_hooks: { inconnu: true }, plugins: [{ name: "x" }] }));
  const r = apply(p);
  check("manifeste invalide => exit 1", r.status === 1);
  check("manifeste invalide => erreurs listées", r.stderr.includes("hook inconnu") && r.stderr.includes("marketplace manquant"));
  check("manifeste invalide => rien écrit", fs.readdirSync(p).length === 1);
}

// --- 9. Migration v1.16 -> v2 ---
{
  const v1 = path.join(tmpRoot, "socle-v1.16");
  fs.mkdirSync(v1);
  const arch = spawnSync("sh", ["-c", `git -C "${REPO}" archive v1.16 | tar -x -C "${v1}"`], { encoding: "utf8" });
  if (arch.status !== 0) {
    console.log("SKIP migration v1.16 (tag v1.16 indisponible)");
  } else {
    const p = mkProject();
    fs.writeFileSync(path.join(p, "CLAUDE.md"), "# Projet exemple\nRègle du projet.\n");
    fs.writeFileSync(path.join(p, "SESSION.md"), "# état v1\n");
    writeSkill(path.join(p, ".claude", "skills", "local-draft"), "local-draft", "Use when drafting a report.");
    const r1 = apply(p, ["--tag", "v1.16"], v1, path.join(v1, "install", "apply.js"));
    check("v1.16 installée (préparation)", r1.status === 0 && fs.existsSync(path.join(p, ".claude", "skills", "dev-cycle")));
    fs.writeFileSync(path.join(p, "README.md.harnais-bak"), "vieux\n");
    const r2 = apply(p, ["--dry-run"]);
    check("migration dry-run => annonce v1.16 → v2.0", r2.stdout.includes("v1.16 → v2.0"));
    check("migration dry-run => dev-cycle serait retiré", /retiré du socle.*dev-cycle/.test(r2.stdout));
    check("migration dry-run => rien modifié", fs.existsSync(path.join(p, ".claude", "skills", "dev-cycle")) && !fs.existsSync(path.join(p, ".claude", "harnais-backups")));
    fs.writeFileSync(path.join(p, "harnais.manifest.json"), JSON.stringify({ optional_skills: ["security-audit"], optional_agents: ["debugger"] }));
    const r = apply(p);
    check("migration => exit 0", r.status === 0);
    const claude = read(path.join(p, "CLAUDE.md"));
    check("migration : partie projet du CLAUDE.md conservée", claude.startsWith("# Projet exemple\nRègle du projet.\n"));
    check("migration : texte v1 retiré du bloc", !/pas un projet applicatif/i.test(claude) && !claude.includes("V1.14"));
    check("migration : bloc v2.0", claude.includes("<!-- harnais:core v2.0 start -->"));
    check("migration : un seul bloc harnais", (claude.match(/harnais:core v/g) || []).length === 1);
    const skills = fs.readdirSync(path.join(p, ".claude", "skills")).sort();
    check("migration : skill local local-draft conservé", skills.includes("local-draft"));
    check("migration : skill optionnel demandé conservé", skills.includes("security-audit"));
    check("migration : skills v1 non retenus retirés", !skills.includes("dev-cycle") && !skills.includes("harnais-stats") && !skills.includes("graphify"));
    check("migration : skills retirés récupérables dans la sauvegarde", (() => {
      const b = path.join(p, ".claude", "harnais-backups");
      const stamp = fs.readdirSync(b)[0];
      return fs.existsSync(path.join(b, stamp, ".claude", "skills", "dev-cycle", "SKILL.md"));
    })());
    check("migration : agent demandé gardé, l'autre retiré", fs.existsSync(path.join(p, ".claude", "agents", "debugger.md")) && !fs.existsSync(path.join(p, ".claude", "agents", "code-reviewer.md")));
    const cmds = settingsCmds(p);
    check("migration : graphify-check désenregistré", !cmds.some((c) => c.includes("graphify-check")));
    check("migration : checkpoint-nudge enregistré", cmds.some((c) => c.includes("checkpoint-nudge")));
    check("migration : pas de doublon de hooks", new Set(cmds).size === cmds.length);
    check("migration : SESSION.md intact", read(path.join(p, "SESSION.md")) === "# état v1\n");
    check("migration : .harnais-bak listés", r.stdout.includes("README.md.harnais-bak"));
    check("migration : .harnais-bak non supprimés", fs.existsSync(path.join(p, "README.md.harnais-bak")));
    check("migration : MONITORING.csv laissé en place et signalé", fs.existsSync(path.join(p, "MONITORING.csv")) && r.stdout.includes("MONITORING.csv"));
    check("migration : 2e passage idempotent", !/\[(créé|remplacé|mis à jour|retiré|bloc)/.test(apply(p).stdout));
  }
}

console.log(`${pass}/${pass + fails.length} tests OK`);
if (fails.length) {
  console.log(fails.join("\n"));
  process.exit(1);
}
