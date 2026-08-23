---
name: harnais-report
description: Agrège .claude/harnais-metrics.jsonl (le journal d'usage local des hooks et skills du socle) en un rapport lisible — comptage par source, hooks/skills les plus invoqués, ratio block/allow du garde-fou, fréquence des arrêts durs. Triggers on "rapport d'usage", "harnais-report", "stats du harnais", "stats d'utilisation".
---

# harnais-report

Lit `.claude/harnais-metrics.jsonl` (une ligne JSON par invocation d'un hook ou d'une
skill du socle, voir `.claude/hooks/lib/metrics.js`) et en tire un résumé exploitable —
pas un dashboard, juste "qu'est-ce qui tourne, combien de fois, avec quel résultat".

## Quand se déclencher

- Demande explicite : "rapport d'usage", "harnais-report", "stats du harnais", "stats
  d'utilisation".

## Déroulé

1. Vérifie que `.claude/harnais-metrics.jsonl` existe. S'il est absent, c'est normal si
   aucun hook/skill n'a encore tourné depuis l'installation ou depuis la dernière purge —
   dis-le simplement, ne traite pas ça comme une erreur.
2. Agrège avec une commande Node inline (pas de script dédié à maintenir) :

```
node -e '
const fs = require("fs");
const file = ".claude/harnais-metrics.jsonl";
if (!fs.existsSync(file)) { console.log("Aucune télémétrie enregistrée pour l’instant."); process.exit(0); }
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const bySource = {};
let guardBlock = 0, guardAllow = 0, hardStops = 0, malformed = 0;
for (const line of lines) {
  let e;
  try { e = JSON.parse(line); } catch (err) { malformed++; continue; }
  bySource[e.source] = (bySource[e.source] || 0) + 1;
  if (e.source === "hook:guard-dangerous-commands") {
    if (e.category === "block") guardBlock++;
    if (e.category === "allow") guardAllow++;
  }
  if (e.source === "hook:hard-stop-guard" && String(e.category).startsWith("block-")) hardStops++;
}
console.log("Total lignes :", lines.length, malformed ? `(dont ${malformed} illisibles, ignorées)` : "");
console.log("Par source (tri décroissant) :");
for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${src}: ${n}`);
console.log(`guard-dangerous-commands : ${guardBlock} bloqué(s) / ${guardAllow} autorisé(s)`);
console.log(`hard-stop-guard : ${hardStops} arrêt(s) dur(s) déclenché(s)`);
'
```

3. Restitue le résultat en prose courte à l'utilisateur : quels hooks/skills sont le plus
   sollicités, si le garde-fou a déjà bloqué quelque chose, si un arrêt dur s'est déjà
   produit. Pas d'interprétation hasardeuse au-delà de ce que les chiffres montrent.

## Ce que cette skill ne fait pas

- Ne purge ni ne fait tourner (rotation) `harnais-metrics.jsonl` — le fichier grossit,
  c'est documenté et accepté (voir `CLAUDE.md`/`EVOLUTION.md`) ; purger reste une
  décision explicite de l'utilisateur, pas un effet de bord de cette skill.
- N'agit pas automatiquement sur ce qu'elle trouve (ex: un taux de blocage élevé) —
  se contente de rapporter, l'utilisateur décide de la suite.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:harnais-report" "report" "<résumé court>"`
