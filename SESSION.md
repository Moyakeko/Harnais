# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

Socle V1.8 — **installable en une ligne sur n'importe quel projet** (dépôt public
`github.com/Moyakeko/Harnais`, bootstraps `install.ps1`/`install.sh` + moteur de
fusion additive `install/apply.js`), coexistence avec d'autres méthodes (BMAD/GSD)
par fusion à marqueurs. V1.6 : notifications desktop Windows (vrais toasts
« Claude Code »). V1.7 : watchdogs crédits & contexte — coupure crédits couverte
de bout en bout (checkpoint brut + reprise planifiée semi-automatique), checkpoint
forcé à 85 % de contexte. V1.8 : mise à jour du socle depuis le chat Claude Code
(skill `update-harnais`), vérifiée en E2E réel contre le commit tout juste poussé.

## Fait

- CLAUDE.md (6 règles non négociables, table de routage à 7 skills, section
  "contre-intuitif", pointeur vers `EVOLUTION.md`), SOURCES.md (4 sources + décisions
  propres V1.3/V1.4), EVOLUTION.md (invariants, auto-amélioration, adaptation aux
  modèles, usage entreprise), git initialisé (branche `main`, `.gitignore` sécurisé,
  `session-log.md` exclu).
- Hook `guard-dangerous-commands.js` V2 : 5 catégories (suppression récursive large,
  destruction de disque, git destructif, code téléchargé pipé, fichiers secrets via
  shell). V1.5 : règle git add testée sur les arguments par segment (faux positif
  message-de-commit corrigé). Batterie versionnée : 138/138.
- `permissions.deny` étendu (29 règles) + `disableBypassPermissionsMode: "disable"`.
- 7 skills : `onboard-project`, `dev-cycle`, `security-audit` (pièges du code IA +
  escalade `/security-review`), `sandbox-pretest` (nouveau — isolation Docker avant
  déploiement/code non fiable), `deploy-checklist` (étape sandbox ajoutée),
  `skill-builder`, `session-checkpoint` (entrée datée + session ID dans session-log à
  chaque checkpoint).
- 2 sous-agents : `code-reviewer`, `debugger`.
- Hooks `session-start-inject.js` (V1.4 : injecte aussi le session ID) et
  `precompact-safety-net.js`.
- V1.6 : hook `notify-desktop.js` (UserPromptSubmit/Stop/Notification) — vrais
  toasts Windows sous identité « Claude Code » (AUMID dédié auto-enregistré dans
  HKCU au premier toast, PowerShell enfant synchrone maintenu vivant 1,5s —
  cause racine des échecs : process tué/mort avant livraison du toast, PAS la
  parenté de process ; un powershell détaché+caché est tué en ~1s,
  vraisemblablement Kaspersky). Fallback `msg.exe` si le toast échoue. Config
  optionnelle `.claude/notify-config.json`, batterie 32/32. Logique toast
  factorisée dans `lib/toast.js` en V1.7.
- V1.7 : chaîne watchdog — `statusline.js` (capteur : seul canal local exposant
  ctx % et `five_hour.resets_at`, vérifié dans le binaire v2.1.204 ; snapshot
  atomique + affichage) ; `context-watchdog.js` (UserPromptSubmit/PostCompact :
  ordre de `session-checkpoint` injecté une fois à ≥85 % de contexte, ré-armé
  après compact, avertissement à ≥90 % des crédits 5h — substitut assumé au
  /clear auto, indéclenchable par hook) ; `credit-watchdog.js` (StopFailure
  matcher `billing_error|rate_limit` : checkpoint brut dans session-log +
  tâche planifiée `HarnaisResume_*` à reset+1 min) ; `resume-after-reset.js`
  (toast + terminal interactif prêt sur `claude --resume`, auto-suppression de
  la tâche). Batterie 54/54 ; chaîne coupure→toast→tâche→toast+terminal
  vérifiée live (dont piège `cmd start` corrigé via Start-Process).
- `README.md` (notice d'utilisation orientée humain) ; dépôt `github.com/Moyakeko/
  Harnais` **public** (audit de l'historique complet passé avant publication).
- V1.8 : skill `update-harnais` (8e skill) — invocable depuis le chat (« mets à jour
  le harnais »), télécharge `install.ps1`/`install.sh` en fichier puis l'exécute
  directement (jamais pipé, exception déjà sanctionnée par CLAUDE.md règle n°2),
  zéro nouvelle logique d'installation. `apply.js` enrichi (VERSION 1.8) : bannière
  consciente de la transition (`mise à jour vX → vY` / `déjà à jour`) + rappel de
  redémarrage de session quand c'est pertinent. Vérifié en E2E réel : téléchargement
  + extraction du commit `abcbfbe` tout juste poussé, `apply.js` exécuté contre un
  projet simulé en v1.5 → bannière et fichiers corrects.
- V1.5 : installeur one-liner (`install.ps1`/`install.sh` → `install/apply.js` :
  fusion additive à marqueurs `harnais:`, deny par union, anti-bypass forcé,
  `.harnais-bak`, idempotent, `.claude/harnais.version`) ; `templates/SESSION.md`
  vierge ; E2E validé depuis GitHub (sh + PowerShell, scénarios vierge et
  pseudo-BMAD, double exécution) ; section « Couche distribution » dans EVOLUTION.md.

## En cours / bloqué

Rien de bloquant.

## Prochaines étapes

- Futur skill "checkpoint" (retour arrière inter-sessions) : à construire comme
  surcouche fine de git — cadrage déjà écrit dans `EVOLUTION.md`, passer par
  `skill-builder`.
- Optimisation des tokens : chantier volontairement reporté par l'utilisateur.

## Problèmes rencontrés / limites connues

- Le hook de garde est un anti-accident, pas un anti-adversaire (contournement via
  interpréteur possible) — la règle n°1 de CLAUDE.md reste la défense d'intention ;
  pour du code réellement suspect, `sandbox-pretest` est la réponse, pas le hook.
- Blocages volontairement agressifs assumés : `rm -rf $VAR/...`, installateurs
  `curl | sh`, `git clean -f` — l'utilisateur les lance lui-même si besoin.
- `.env.example` non lisible par l'outil Read (pattern `.env.*`) ; nommer un template
  `env.example` si Claude doit pouvoir le lire.
- Les patterns `**/` de `permissions.deny` sont relatifs au projet : un fichier secret
  **hors projet** (ex: dans un dossier temp) reste lisible, sauf les chemins home
  couverts par les règles `~/` explicites. Limite constatée au test du 2026-07-06.
- `disableBypassPermissionsMode` ne refuse pas le démarrage en
  `--dangerously-skip-permissions` (mode `-p` testé) : il neutralise silencieusement le
  flag et la session tourne en mode permissions normal. La protection tient, mais sans
  message d'erreur explicite.
- Un hook ne peut pas rédiger un résumé riche ni déclencher `/clear`/`/compact`
  (le checkpoint riche reste le rôle de la skill `session-checkpoint`, poussée par
  le context-watchdog). La coupure crédits en cours de session est désormais
  interceptée (StopFailure → credit-watchdog) — mais pas un CLI fermé/PC éteint
  avant la coupure, ni les sessions headless `-p` (pas de statusline, donc pas de
  snapshot pour les watchdogs).
- La tâche planifiée de reprise suppose la machine allumée à l'heure de reset
  (sinon rattrapage au réveil via StartWhenAvailable).

## Dernier checkpoint

2026-07-09 — V1.8 : skill `update-harnais` (mise à jour du socle depuis le chat,
zéro duplication avec install.ps1/sh), `apply.js` conscient des transitions de
version, vérifié en E2E réel depuis GitHub contre le commit tout juste poussé,
2 commits poussés. Détail dans `.claude/session-log.md`.
