# Harnais — socle Claude Code personnel

Socle réutilisable pour démarrer n'importe quel projet avec Claude Code (devoir/TP
d'école, projet perso, service déployé pour soi ou ses proches) avec des garde-fous de
sécurité et une méthode de travail déjà en place. Ce dépôt n'est **pas** un projet
applicatif : c'est le moule que l'on copie au départ de chaque nouveau projet.

Version courante : **V1.4 (stable)** — vérifiée en session fraîche le 2026-07-06.

## À qui s'adressent les fichiers

| Fichier | Lecteur | Rôle |
|---|---|---|
| `README.md` (ce fichier) | Toi (humain) | Notice d'utilisation du socle. |
| `CLAUDE.md` | Claude | Règles non négociables + routage des skills, chargé à chaque session. |
| `SESSION.md` | Les deux | État courant du travail, injecté automatiquement au démarrage de session. |
| `SOURCES.md` | Toi | D'où viennent les choix de conception (sources + décisions propres). |
| `EVOLUTION.md` | Les deux | Invariants à respecter pour toute évolution du socle lui-même. |

## Démarrer un nouveau projet sur ce socle

1. **Copier le socle** dans le dossier du nouveau projet :
   - le dossier `.claude/` complet (settings, hooks, skills, agents) ;
   - `CLAUDE.md`, `EVOLUTION.md`, `.gitignore` ;
   - `SESSION.md` vidé de son contenu spécifique (garder les titres de sections).
   - Ne PAS copier : `SOURCES.md` (documentation du socle, pas du projet),
     `.claude/session-log.md` (historique local, hors git de toute façon).
2. **Ouvrir Claude Code** dans le dossier et lancer la skill `onboard-project` : elle
   crée un `PROJECT.md` court (nature du projet, stack, contraintes, cible de
   déploiement).
3. Travailler normalement — le socle fait le reste (voir la notice ci-dessous).

## Ce que contient le socle

- **6 règles non négociables** (`CLAUDE.md`) : pas de secret en clair, pas de commande
  destructrice sans confirmation, pas de « c'est fait » sans vérification réelle,
  pédagogie du pourquoi, principes Karpathy (réflexion avant exécution), `SESSION.md`
  maintenu à jour.
- **3 hooks** (`.claude/hooks/`) :
  - `guard-dangerous-commands.js` — bloque par exit code, même en auto-approve,
    5 catégories : suppression récursive large, destruction de disque, git destructif,
    code téléchargé pipé dans un shell, fichiers secrets via le shell. Batterie de
    tests versionnée dans `.claude/hooks/tests/test-guard.js` (127 cas).
  - `session-start-inject.js` — injecte `SESSION.md` + l'ID de session au démarrage.
  - `precompact-safety-net.js` — filet de sécurité avant compactage du contexte.
- **29 règles `permissions.deny`** (`.claude/settings.json`) : Claude ne peut pas lire
  les fichiers secrets (`.env*`, `*.pem`, clés SSH, états Terraform, `~/.ssh`,
  `~/.aws`…), et `disableBypassPermissionsMode` neutralise le mode
  `--dangerously-skip-permissions`.
- **7 skills** : `onboard-project`, `dev-cycle`, `security-audit`, `sandbox-pretest`,
  `deploy-checklist`, `skill-builder`, `session-checkpoint` — le routage détaillé est
  dans `CLAUDE.md`.
- **2 sous-agents** : `code-reviewer` (revue large sans polluer le contexte principal),
  `debugger` (root-cause d'un bug, idem).

## Notice d'utilisation au quotidien

### Une session type

1. **Ouverture** : `SESSION.md` s'affiche tout seul en début de session (hook
   `SessionStart`) — Claude sait où on en est sans qu'on lui réexplique.
2. **Travail** : pour toute tâche non triviale, demander (ou laisser Claude déclencher)
   `dev-cycle` : explorer → planifier → coder → tester → revoir. Pour un bug obscur,
   le sous-agent `debugger` ; pour relire un module entier, `code-reviewer`.
3. **Avant un commit ou un déploiement** : `security-audit` (routine légère secrets +
   hygiène repo). Avant un premier déploiement ou du code de provenance douteuse :
   `sandbox-pretest`. Avant la mise en prod : `deploy-checklist`.
4. **Après chaque étape significative** (ou avant de fermer) : « fais le point » —
   la skill `session-checkpoint` réécrit `SESSION.md` et ajoute une entrée datée +
   ID de session dans `.claude/session-log.md`.

### Quand une commande est bloquée

Si le hook de garde bloque une commande, **c'est voulu, même si la commande était
légitime** (ex. `rm -rf $BUILD_DIR`, installateur `curl … | sh` de rustup). Claude a
pour instruction de ne pas la contourner : si tu en as vraiment besoin, lance-la
toi-même dans ton propre terminal, hors Claude Code. Même logique pour les fichiers
secrets : Claude ne peut ni les lire ni les `git add` — c'est toi qui les manipules.

### Retrouver le pourquoi d'un changement passé

Chaque checkpoint enregistre l'ID de session dans `.claude/session-log.md`. Pour
rouvrir la conversation d'origine d'un changement : `claude --resume <id>` (si elle
existe encore). Le retour arrière sur le code passe par git (un commit par évolution).

### Limites connues (assumées)

- Le hook de garde est un **anti-accident, pas un anti-adversaire** : un contournement
  via interpréteur reste possible. Pour du code réellement suspect, la réponse est
  `sandbox-pretest`, pas le hook.
- Les patterns `**/` de `permissions.deny` sont relatifs au projet : un secret posé
  **hors projet** (dossier temp…) reste lisible, hors chemins home couverts par les
  règles `~/`.
- `--dangerously-skip-permissions` n'est pas refusé avec une erreur : le flag est
  silencieusement neutralisé et la session tourne en mode permissions normal.
- `.env.example` n'est pas lisible par Claude (pattern `.env.*`) — nommer le template
  `env.example` si Claude doit pouvoir le lire.

## Faire évoluer le socle

Toute modification du socle lui-même (nouvelle skill, durcissement, dérivation d'une
variante plus légère) passe par la skill `skill-builder` et doit respecter les
invariants de `EVOLUTION.md`. Le périmètre actuel (7 skills, 2 agents, 3 hooks) est un
choix délibéré : on n'ajoute que si le besoin est démontré.
