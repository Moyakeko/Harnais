#!/usr/bin/env node
/**
 * PreCompact hook — filet de sécurité brut avant qu'une compaction (auto ou
 * manuelle via /compact) ne résume/perde le détail du contexte. Ne peut pas
 * rédiger un résumé riche (un hook ne raisonne pas) : se contente de copier
 * la fin du transcript brut dans .claude/session-log.md, horodatée, pour
 * qu'aucune trace ne soit perdue même si SESSION.md n'a pas été mis à jour à
 * temps. Ne bloque jamais la compaction (exit 0 dans tous les cas).
 */

const fs = require("fs");
const path = require("path");

const TAIL_LINES = 40;

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
  const logFile = path.join(projectDir, ".claude", "session-log.md");
  const trigger = payload.trigger || "inconnu";
  const transcriptPath = payload.transcript_path;

  let tail = "(transcript introuvable ou illisible)";
  if (transcriptPath) {
    try {
      const raw = fs.readFileSync(transcriptPath, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      tail = lines.slice(-TAIL_LINES).join("\n");
    } catch (err) {
      // On ne bloque jamais la compaction pour un transcript illisible.
    }
  }

  const entry =
    `\n## Checkpoint brut — ${new Date().toISOString()} (déclencheur: ${trigger})\n\n` +
    "```\n" +
    tail +
    "\n```\n";

  try {
    fs.appendFileSync(logFile, entry, "utf8");
  } catch (err) {
    // Filet de sécurité best-effort : une erreur d'écriture ne doit pas
    // empêcher la compaction de se poursuivre.
  }

  process.exit(0);
}

main();
