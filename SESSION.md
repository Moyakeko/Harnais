# SESSION.md — état actuel (pointeur, pas journal)

> Injecté automatiquement au démarrage de chaque session (hook `SessionStart` —
> `.claude/hooks/session-start-inject.js`, qui injecte aussi le session ID courant).
> Mis à jour par Claude via la skill `session-checkpoint` après chaque étape
> significative. Reste court : c'est une table des matières de l'état actuel, pas un
> journal qui s'accumule. L'historique détaillé (daté + session ID) vit dans
> `.claude/session-log.md`, non chargé par défaut et hors git.

## Niveau / statut actuel

Socle V1.6 — **installable en une ligne sur n'importe quel projet** (dépôt public
`github.com/Moyakeko/Harnais`, bootstraps `install.ps1`/`install.sh` + moteur de
fusion additive `install/apply.js`), coexistence avec d'autres méthodes (BMAD/GSD)
par fusion à marqueurs. Nouveau en V1.6 : notifications desktop Windows (vrais
toasts « Claude Code ») sur fin de tâche et attente d'action, vérifiées
visuellement sur la machine cible.

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
  optionnelle `.claude/notify-config.json`, batterie 32/32.
- `README.md` (notice d'utilisation orientée humain) ; dépôt `github.com/Moyakeko/
  Harnais` **public** (audit de l'historique complet passé avant publication).
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
- Un hook ne peut pas rédiger un résumé riche, ni intercepter une coupure brutale de
  crédit, ni déclencher `/clear`/`/compact`.

## Dernier checkpoint

2026-07-08 — V1.6 : notifications desktop réglées — le hook `notify-desktop.js`
passe de la fenêtre modale `msg.exe` aux vrais toasts Windows (AUMID dédié,
PowerShell synchrone), vérifié visuellement, 2 commits poussés. Détail dans
`.claude/session-log.md`.
