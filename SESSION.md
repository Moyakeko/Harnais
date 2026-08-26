# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

**V1.12 commitée (`c5608bc`), taguée (`v1.12`) et poussée** (les cinq chantiers de la
session précédente : `graphify`, `update-check.js`, `STATS.md`/`harnais-stats`,
rattrapage README, `checkpoint-pause`/`checkpoint-resume`).

**Post-V1.12 ("V1.13" en cours, pas encore tagué)** — deux chantiers cette session,
partis d'un rapport d'incident utilisateur réel :
1. **Fix du hang `install.ps1`** — commité et poussé (`70a0681`).
2. **Refonte `STATS.md` → `MONITORING.csv`** — fait et vérifié, **pas encore commité**.

## Fait

- **Fix hang `install.ps1`** : un rapport d'incident décrivait `install.ps1` bloqué
  indéfiniment (`node.exe` à 0% CPU, aucune sortie) lors d'un `update-harnais` réel.
  L'investigation a écarté les deux hypothèses du rapport (pas d'auto-suppression du
  script, pas de capture de sortie interne — `install.ps1` héritait déjà la console) ;
  cause probable non confirmable à distance (antivirus/EDR local). L'invocation node
  passe de l'opérateur `&` à `System.Diagnostics.Process` direct (après avoir écarté
  `Start-Process -PassThru`, dont l'`.ExitCode` s'est révélé peu fiable une fois le
  process terminé), qui sonde la progression et affiche après 60s un avertissement avec
  la commande de contournement exacte. `update-harnais/SKILL.md` documente ce problème
  connu. **Vérifié** bout-en-bout (chemin heureux + chemin d'erreur) sur un dossier de
  test. Détail complet dans `SOURCES.md` § "V1.13".
- **`STATS.md` → `MONITORING.csv`** : deux défauts remontés par l'utilisateur à l'usage —
  format markdown à table réécrite peu adapté à un journal d'événements, et
  déclenchement de `harnais-stats` sans règle claire pour le cas où Claude remarque un
  problème de lui-même. Nouveau fichier CSV **append-only** (une ligne = un événement
  daté, jamais réécrite — même idiome que `.claude/harnais-metrics.jsonl`), même statut
  create-only que l'ancien `STATS.md` dans `apply.js`. `harnais-stats` gagne deux modes :
  **automatique** (Claude remarque un incident/succès notable en cours de travail —
  annonce en une phrase puis écrit directement, sans confirmation bloquante) et
  **interactif** (demande ouverte explicite — déroulé inchangé : proposer, agréger,
  noter la pertinence, confirmer avant d'écrire). Colonne `projet` dérivée
  automatiquement du nom de dossier, jamais demandée. Anciens `STATS.md`/
  `templates/STATS.md` supprimés (squelettes vides, aucune perte). `CLAUDE.md`,
  `README.md` (3 endroits), `SOURCES.md` (nouvelle entrée "V1.13") mis à jour. **Vérifié**
  via `apply.js` sur un dossier de test (création + idempotence) et
  `test-guard.js` (138/138, non affecté).

## En cours / bloqué

`MONITORING.csv`/`harnais-stats` pas encore commité/poussé — en attente de confirmation
utilisateur.

## Prochaines étapes

1. Commit + push du chantier `MONITORING.csv`, si l'utilisateur le confirme (garder
   V1.13 non tagué tant que d'autres chantiers post-V1.12 sont possibles, comme pour
   V1.12 avant son tag).
2. Une fois `MONITORING.csv` en place, la skill `harnais-stats` peut être utilisée en
   mode automatique dès qu'un incident se présente — pas d'action à planifier, ça se
   déclenche seul en contexte.
3. Test manuel réel de `update-check.js` en conditions réelles (session fraîche sur un
   projet avec un vrai `.claude/harnais.version` en retard) — seule la batterie
   automatisée (mocks) l'a été jusqu'ici.
4. Test manuel réel de la skill `graphify` le jour où le besoin se présente.
5. Test manuel du fix de staleness du watchdog (V1.11) en conditions quasi réelles —
   toujours pas fait.
6. Futur skill "checkpoint" (retour arrière inter-sessions) : cadrage dans
   `EVOLUTION.md`, à construire via `skill-builder` quand le besoin se présente.
7. Optimisation des tokens : chantier volontairement reporté par l'utilisateur.

## Problèmes rencontrés / limites connues

- Le hook de garde est un anti-accident, pas un anti-adversaire — la règle n°1 de
  CLAUDE.md reste la défense d'intention ; pour du code réellement suspect,
  `sandbox-pretest` est la réponse, pas le hook.
- La skill `find-skills` peut faire exécuter `npx skills add ...` sans être interceptée
  par le hook de garde — vigilance normale requise, documenté dans CLAUDE.md (le cas
  `graphify` en est un exemple concret).
- `update-check.js` est le seul hook du socle qui fait un appel réseau — throttlé,
  fail-open, jamais bloquant, mais c'est un changement de nature (aucun hook existant
  n'en faisait avant V1.12) à garder en tête si un futur hook réseau est envisagé.
- Support de `hookSpecificOutput.additionalContext` sur `PostToolUse` (utilisé par
  `hard-stop-guard.js`) toujours non confirmé en conditions réelles — voir "Prochaines
  étapes" du chantier V1.11 précédent, non repris ici pour rester court.
- Les patterns `**/` de `permissions.deny` sont relatifs au projet : un fichier secret
  hors projet reste lisible, sauf les chemins home couverts par des règles `~/` explicites.
- `disableBypassPermissionsMode` neutralise silencieusement `--dangerously-skip-permissions`
  sans message d'erreur explicite.
- `PostToolUse` s'exécute après l'outil : celui qui fait franchir un seuil s'est déjà
  exécuté, impossible à annuler.
- Whitelist du hard-stop : seuls les appels d'outil `Write`/`Edit` sur SESSION.md/
  session-log.md passent — un `Bash` qui redirige vers ces mêmes fichiers reste bloqué.
- Éditer `.claude/settings.json`/des messages de commit heredoc contenant `.env`+`cat`
  peut être bloqué par le classificateur de sécurité d'Anthropic (faux positif observé en
  V1.10) — contournement : `Write` du fichier complet, ou `git commit -F <fichier>`.
- `Start-Process -PassThru` en PowerShell : `.ExitCode` s'est révélé peu fiable une fois
  le process terminé (vide au lieu du vrai code) — préférer
  `[Diagnostics.Process]::Start(...)` direct (`New-Object`/`::new` sur `ProcessStartInfo`)
  dès qu'un script PowerShell doit lire un code de sortie fiable après une attente
  (découvert en corrigeant le hang `install.ps1`).

## Dernier checkpoint

2026-08-26 — **Post-V1.12 ("V1.13")** : fix hang `install.ps1` (commité/poussé,
`70a0681`) + refonte `STATS.md` → `MONITORING.csv`/`harnais-stats` (fait, vérifié, pas
commité). Partis tous les deux d'un rapport d'incident réel de l'utilisateur (bug
`update-harnais` + retour d'usage sur `STATS.md`). Détail complet dans `SOURCES.md`
§ "Décisions propres — V1.13". Session : 84685b68-10db-43f1-8dbf-65e2346d91a6.

2026-08-25 — **V1.12 complète, commitée/taguée/poussée depuis** : graphify + update-check.js +
STATS.md/harnais-stats + rattrapage doc + checkpoint-pause/checkpoint-resume, dans la
même session (recherche via 3 agents Explore pour les chantiers F/G/H, un plan par
chantier écrit et approuvé en mode plan). 15 skills, 9 hooks au total désormais. Tests :
6 suites, 405/405 au total (nouveau test-update-check.js 21/21). Plan détaillé dans
`C:\Users\hp\.claude\plans\je-souhaiterais-installer-graphify-ancient-wolf.md`. Session :
9d4a541f-3d3f-43e0-8258-336003ac8184.

2026-08-24 — **V1.11 terminée** : les 5 chantiers (BMAD Stories, Perplexity optionnelle,
vérification CVE de dépendance + anti-swap-aveugle, déploiement piloté par find-skills,
fix du watchdog crédits/contexte) faits et vérifiés. Plan détaillé dans
`C:\Users\hp\.claude\plans\sharded-booping-toast.md`. Tests : 5 suites, 384/384 au
total. Commit (`6ba4bd7`), tag (`v1.11`) et push confirmés par l'utilisateur et
exécutés. Session : 58e33e41-469f-4f91-bc2e-4319038c86ec. Détail dans
`.claude/session-log.md`.
