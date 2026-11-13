#!/usr/bin/env node
/**
 * SessionStart hook — injecte le contenu de SESSION.md comme contexte
 * additionnel au (re)démarrage d'une session, pour que Claude sache où on en
 * est sans dépendre du fait qu'il pense à aller lire le fichier lui-même.
 * Injecte aussi le session ID courant : les entrées de .claude/session-log.md
 * le reportent, pour pouvoir retrouver la conversation d'origine d'un
 * changement (claude --resume) même des semaines plus tard.
 * Ne modifie rien, ne bloque rien : si SESSION.md est absent ou illisible, on
 * injecte seulement le session ID et la session démarre normalement.
 */

const fs = require("fs");
const path = require("path");
const { logMetric } = require("./lib/metrics");

// v2 : plafond d'injection. SESSION.md doit rester un pointeur d'état court ;
// au-delà, seul le début est injecté et Claude est prévenu (le fichier n'est
// jamais modifié par ce hook).
const MAX_INJECT_BYTES = 4096;
const MAX_LINES = 80;

function capContent(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const lineCount = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const bytes = Buffer.byteLength(content, "utf8");
  const notes = [];
  let body = content;
  if (bytes > MAX_INJECT_BYTES) {
    // Coupe sur une frontière de caractère puis de ligne, sans dépasser le plafond.
    let cut = Buffer.from(content, "utf8").subarray(0, MAX_INJECT_BYTES).toString("utf8");
    cut = cut.replace(/\uFFFD$/, "");
    const lastNl = cut.lastIndexOf("\n");
    if (lastNl > 0) cut = cut.slice(0, lastNl + 1);
    body = cut;
    notes.push(`SESSION.md tronqué à l'injection (${bytes} octets, plafond ${MAX_INJECT_BYTES}) : lis la suite seulement si tu en as besoin.`);
  }
  if (lineCount > MAX_LINES) {
    notes.push(`SESSION.md fait ${lineCount} lignes (> ${MAX_LINES}) : resserre-le à l'état courant au prochain checkpoint (skill session-checkpoint).`);
  }
  return { body, notes, truncated: bytes > MAX_INJECT_BYTES, lineCount, bytes };
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    payload = {};
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const sessionFile = path.join(projectDir, "SESSION.md");

  let content = "";
  try {
    content = fs.readFileSync(sessionFile, "utf8");
  } catch (err) {
    // Pas de SESSION.md : on injecte quand même le session ID ci-dessous.
  }

  const capped = capContent(content);
  const sessionId = payload.session_id || "inconnu";
  const header =
    `Session Claude Code courante : ${sessionId}\n` +
    `(à reporter dans toute entrée ajoutée à .claude/session-log.md pendant ` +
    `cette session — voir la skill session-checkpoint)\n\n`;

  process.stdout.write(
    JSON.stringify({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          header + capped.body + (capped.notes.length ? `\n\n[harnais] ${capped.notes.join("\n[harnais] ")}\n` : ""),
      },
    })
  );
  logMetric("hook:session-start-inject", "session-start", content
      ? `SESSION.md injecté (${capped.bytes} o, ${capped.lineCount} l.${capped.truncated ? ", tronqué" : ""})`
      : "SESSION.md absent");
  process.exit(0);
}

if (require.main === module) main();

module.exports = { capContent, MAX_INJECT_BYTES, MAX_LINES };
