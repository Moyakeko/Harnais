# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

**V1.12 complète et vérifiée, pas encore commitée/poussée.** Cinq chantiers dans la
même version (rien n'a encore été tagué, donc tout reste V1.12) : (1) skill `graphify`,
(2) vérification automatique de mise à jour au démarrage de session, (3) `STATS.md` par
projet + skill `harnais-stats`, (4) rattrapage complet de la documentation utilisateur
(`README.md` était resté à V1.8), (5) `checkpoint-pause`/`checkpoint-resume` (arrêt
manuel + reprise explicite, sans perte de contexte, y compris entre sessions).

Sous ce chantier : V1.11 (BMAD Stories, Perplexity optionnelle, vérification CVE de
dépendance, déploiement piloté par find-skills, fix watchdog) reste stable, commitée
(`6ba4bd7`), taguée (`v1.11`) et poussée.

## Fait

- **Skill `graphify`** (12e→13e skill au fil de la session) : construit un graphe de
  connaissances d'un codebase via le CLI tiers `Graphify-Labs/graphify` (source
  officielle retenue après avoir trouvé plusieurs dépôts clones du même nom). Route vers
  `security-audit`/`sandbox-pretest` avant toute installation réelle, n'installe rien
  elle-même.
- **Hook `update-check.js`** (nouveau, `SessionStart`, 9e hook) + **`lib/latest-version.js`** :
  compare `.claude/harnais.version` au dernier tag GitHub publié, au plus 1×/24h par
  projet (état dans `.claude/harnais-update-check.json`, gitignored). N'informe que via
  `additionalContext` — ne lance jamais `update-harnais` lui-même. Fail-open total
  (absence de `harnais.version`, timeout, erreur réseau → silence ; ce dépôt source n'a
  pas ce fichier, donc jamais concerné). Header `User-Agent` explicite requis pour l'API
  GitHub (piège du module `https` natif de Node, contrairement à curl/PowerShell).
  **Vérifié** : nouveau `test-update-check.js`, 21/21 (fail-open, comparaison de version,
  throttle, `FORCE`, robustesse payloads malformés) — env `HARNAIS_UPDATE_CHECK_MOCK_TAGS`/
  `_MOCK_ERROR`/`_FORCE` pour rester déterministe et hors-ligne dans les tests.
- **`STATS.md` par projet** (template `templates/STATS.md`, catégorie "create-only" dans
  `apply.js` comme `SESSION.md`) + **skill `harnais-stats`** (13e skill) : relevé
  d'usage du socle par projet (skills utilisées, pertinence, problèmes), pensé pour être
  comparé entre plusieurs projets — structure fixe (tableau à colonnes stables).
  Contrairement à `session-checkpoint`/`onboard-project`, **n'écrit jamais sans accord
  explicite préalable** de l'utilisateur (nouvelle convention dans ce socle). Réutilise
  l'agrégation de `harnais-report` pour la partie quantitative. Squelette `STATS.md`
  créé dans ce dépôt aussi (structure vide, pas de contenu — le contenu attend l'accord
  de l'utilisateur, pas fait automatiquement).
- **Rattrapage `README.md`** : bandeau V1.8 → V1.12, liste des 13 skills complétée,
  hooks 6 → 9 (avec description des 3 manquants), `permissions.deny` 29 → 39 (recompté
  depuis `.claude/settings.json`), section "Faire évoluer le socle" mise à jour, et une
  affirmation devenue fausse depuis V1.10 corrigée (`.env.example` était décrit comme
  illisible, alors que la liste énumérée le rend lisible). `EVOLUTION.md` étape 4
  ("Documenter") étend désormais explicitement à `README.md`.
- `CLAUDE.md`/`SOURCES.md` : table de routage à jour (`graphify`, `harnais-stats`, note
  sur `update-harnais` déclenchable par `update-check.js`), compte "11→13 skills, 8→9
  hooks", puce "contre-intuitif" sur le seul hook du socle qui fait un appel réseau.
  Entrée `SOURCES.md` V1.12 étendue avec les 3 chantiers (pas de nouvelle section — même
  version tant que rien n'est tagué).
- `.gitignore` (racine du dépôt, distinct du gabarit propagé par `apply.js`) : ajout de
  `.claude/harnais-update-check.json`.
- **Skills `checkpoint-pause`/`checkpoint-resume`** (14e/15e skill, dernier ajout avant
  commit) : arrêt manuel volontaire sans perte de contexte. `checkpoint-pause` capture
  vite l'état dans `SESSION.md` § "En cours / bloqué" (+ ligne "Dernier checkpoint",
  marquée "checkpoint d'urgence") et s'arrête — ne peut pas s'auto-interrompre, Échap/
  Ctrl+C (natif Claude Code) reste le geste pour stopper une action en cours.
  `checkpoint-resume` relit cet état et reprend directement, même dans une nouvelle
  session, sans redemander où on en était. Distinctes de `session-checkpoint`
  (checkpoint réfléchi de fin d'étape, réécrit toutes les sections) — celle-ci reste la
  bonne skill hors urgence. `CLAUDE.md`/`README.md`/`SOURCES.md` mis à jour (compte
  13→15 skills, nouvelle sous-section "Arrêt manuel / reprise" dans README).

## En cours / bloqué

Rien de bloqué. En attente de confirmation utilisateur pour commit + tag v1.12 + push.

## Prochaines étapes

1. Commit + tag `v1.12` + push, si l'utilisateur le confirme.
2. Proposer à l'utilisateur de peupler le contenu de `STATS.md` de ce dépôt via
   `harnais-stats` (avec son accord explicite avant tout contenu, comme prévu par la
   skill) — pas fait automatiquement.
3. Test manuel réel de `update-check.js` en conditions réelles (session fraîche sur un
   projet avec un vrai `.claude/harnais.version` en retard) — seule la batterie
   automatisée (mocks) l'a été jusqu'ici.
4. Test manuel réel de la skill `graphify` le jour où le besoin se présente (voir
   checkpoint précédent).
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

## Dernier checkpoint

2026-08-25 — **V1.12 complète, pas commitée/poussée** : graphify + update-check.js +
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
