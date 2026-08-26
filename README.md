# Harnais — socle Claude Code personnel

Socle réutilisable pour démarrer n'importe quel projet avec Claude Code (devoir/TP
d'école, projet perso, service déployé pour soi ou ses proches) avec des garde-fous de
sécurité et une méthode de travail déjà en place. Ce dépôt n'est **pas** un projet
applicatif : c'est le moule que l'on copie au départ de chaque nouveau projet.

Version courante : **V1.12** — installable en une ligne (voir ci-dessous) et mettable à
jour depuis le chat Claude Code lui-même (skill `update-harnais`, voir plus bas), avec
un rappel automatique en début de session si une version plus récente est publiée
(hook `update-check.js`, jamais d'application automatique).

## À qui s'adressent les fichiers

| Fichier | Lecteur | Rôle |
|---|---|---|
| `README.md` (ce fichier) | Toi (humain) | Notice d'utilisation du socle. |
| `CLAUDE.md` | Claude | Règles non négociables + routage des skills, chargé à chaque session. |
| `SESSION.md` | Les deux | État courant du travail, injecté automatiquement au démarrage de session. |
| `MONITORING.csv` | Toi | Journal daté des incidents/pertinence du socle sur ce projet — comparable entre projets, alimenté automatiquement (incidents) ou avec ton accord (relevés de pertinence sur demande, skill `harnais-stats`). |
| `SOURCES.md` | Toi | D'où viennent les choix de conception (sources + décisions propres). |
| `EVOLUTION.md` | Les deux | Invariants à respecter pour toute évolution du socle lui-même. |

## Installer le socle sur un nouveau projet (une ligne)

Dans le dossier du projet (nouveau ou existant), **dans ton terminal** — prérequis :
Node.js installé.

PowerShell (Windows) :

```powershell
iwr -useb https://raw.githubusercontent.com/Moyakeko/Harnais/main/install.ps1 | iex
```

Bash/sh (Linux, macOS, Git Bash) :

```sh
curl -fsSL https://raw.githubusercontent.com/Moyakeko/Harnais/main/install.sh | sh
```

> **Note contre-intuitive assumée** : cette commande « code téléchargé pipé dans un
> shell » est précisément ce que le hook du socle bloquera *ensuite* dans Claude Code.
> C'est cohérent : tu la lances toi-même, dans ton terminal, avant que le socle
> n'existe sur le projet — c'est la philosophie du socle (les installateurs, c'est
> l'humain qui les lance).

Ce que fait l'installeur (`install/apply.js`, invoqué par les deux scripts) :

| Fichier | Traitement |
|---|---|
| `.claude/hooks/`, `.claude/skills/`, `.claude/agents/`, `EVOLUTION.md` | Copiés (possédés par le socle). En cas de mise à jour d'un fichier modifié : sauvegarde `.harnais-bak` puis remplacement. |
| `SESSION.md`, `MONITORING.csv` | Créés vierges depuis un template — **jamais touchés** s'ils existent déjà. |
| `CLAUDE.md`, `.gitignore` | Fusion additive entre marqueurs `harnais:` — un CLAUDE.md existant (BMAD, GSD…) est conservé intact, le bloc socle s'ajoute à la fin. |
| `.claude/settings.json` | Fusion JSON : hooks ajoutés à côté des existants, `permissions.deny` par union, anti-bypass forcé — jamais de retrait. |
| `README.md`, `SOURCES.md`, `SESSION.md`/`MONITORING.csv` du socle, `install.*` | Jamais installés (documentation du socle, pas du projet). |

L'installation est **idempotente** : relancer le one-liner met à jour le socle
(remplacement entre marqueurs) sans dupliquer ni écraser ce qui appartient au projet.
La version installée est dans `.claude/harnais.version`. Les `.harnais-bak` gardent
l'état d'origine d'avant la première installation.

Sur un **projet déjà entamé**, l'installeur le détecte et te rappelle de lancer
`security-audit` dans Claude Code : le `.gitignore` posé par le socle n'agit que pour
l'avenir — un secret commité avant l'installation est toujours dans l'historique git,
et aucun installeur ne peut l'en retirer.

Puis :

1. **Ouvrir Claude Code** dans le dossier et dire « onboard ce projet » : la skill
   `onboard-project` crée un `PROJECT.md` court (nature du projet, stack, contraintes,
   cible de déploiement) — c'est là que le socle s'adapte au projet, sans modifier les
   règles non négociables.
2. Smoke test : `node .claude/hooks/tests/test-guard.js` (doit afficher `138/138`).
3. Travailler normalement — le socle fait le reste (voir la notice ci-dessous).

## Mettre à jour un projet existant

Deux façons d'obtenir la dernière version sur un projet qui a **déjà** le socle —
les deux sont additives et idempotentes (aucune n'écrase `SESSION.md` ni le travail
en cours) :

- **Depuis le chat Claude Code (recommandé)** : ouvre une session sur le projet et dis
  « mets à jour le harnais » — la skill `update-harnais` télécharge et applique la
  dernière version elle-même, puis te rappelle de redémarrer la session (les hooks et
  `settings.json` ne se rechargent qu'au démarrage).
- **Depuis un terminal**, si aucune session n'est ouverte : relance exactement le même
  one-liner que pour l'installation initiale (voir plus haut) — il détecte que le
  socle est déjà là et met à jour au lieu d'installer.

## Ce que contient le socle

- **6 règles non négociables** (`CLAUDE.md`) : pas de secret en clair, pas de commande
  destructrice sans confirmation, pas de « c'est fait » sans vérification réelle,
  pédagogie du pourquoi, principes Karpathy (réflexion avant exécution), `SESSION.md`
  maintenu à jour.
- **9 hooks** (`.claude/hooks/`) + une **statusline** :
  - `guard-dangerous-commands.js` — bloque par exit code, même en auto-approve,
    5 catégories : suppression récursive large, destruction de disque, git destructif,
    code téléchargé pipé dans un shell, fichiers secrets via le shell. Batterie de
    tests versionnée dans `.claude/hooks/tests/test-guard.js` (138 cas).
  - `session-start-inject.js` — injecte `SESSION.md` + l'ID de session au démarrage.
  - `update-check.js` — vérifie (1×/24h max, jamais bloquant) si une version plus
    récente du socle est publiée sur GitHub ; propose seulement, n'applique jamais.
  - `precompact-safety-net.js` — filet de sécurité avant compactage du contexte.
  - `notify-desktop.js` — vrais toasts Windows (fin de tâche, attente d'action).
  - `statusline.js` — capteur du % de contexte et des crédits, alimente les deux
    watchdogs ci-dessous.
  - `context-watchdog.js` — rappel doux à 70 % de contexte (checkpoint anticipé).
  - `hard-stop-guard.js` — arrêt dur à 85 % de contexte / 95 % de crédits 5h (pas de
    `/clear` automatique possible : c'est le substitut). Pendant l'arrêt, en plus du
    checkpoint SESSION.md, la session principale prévient (SendMessage) puis stoppe
    (TaskStop) les agents en arrière-plan encore actifs — sinon invisibles à ce hook.
  - `credit-watchdog.js` — sauvegarde l'état à la coupure de crédits et prépare la
    reprise à l'heure de réinitialisation (avec `resume-after-reset.js`).
- **39 règles `permissions.deny`** (`.claude/settings.json`) : Claude ne peut pas lire
  les fichiers secrets (`.env*`, `*.pem`, clés SSH, états Terraform, `~/.ssh`,
  `~/.aws`…), et `disableBypassPermissionsMode` neutralise le mode
  `--dangerously-skip-permissions`.
- **15 skills** : `onboard-project`, `dev-cycle`, `security-audit`, `sandbox-pretest`,
  `deploy-checklist`, `skill-builder`, `session-checkpoint`, `checkpoint-pause`,
  `checkpoint-resume`, `update-harnais`, `find-skills`, `harnais-report`,
  `harnais-stats`, `perplexity-research`, `graphify` — le routage détaillé est dans
  `CLAUDE.md`.
- **2 sous-agents** : `code-reviewer` (revue large sans polluer le contexte principal),
  `debugger` (root-cause d'un bug, idem).

## Notice d'utilisation au quotidien

### Une session type

1. **Ouverture** : `SESSION.md` s'affiche tout seul en début de session (hook
   `SessionStart`) — Claude sait où on en est sans qu'on lui réexplique. Le même
   événement vérifie aussi (au plus 1×/24h, silencieux si rien de neuf) qu'une version
   plus récente du socle n'est pas parue — si oui, Claude le signale et propose
   `update-harnais`, sans jamais l'appliquer seul.
2. **Travail** : pour toute tâche non triviale, demander (ou laisser Claude déclencher)
   `dev-cycle` : explorer → planifier → coder → tester → revoir. Pour un bug obscur,
   le sous-agent `debugger` ; pour relire un module entier, `code-reviewer`.
3. **Avant un commit ou un déploiement** : `security-audit` (routine légère secrets +
   hygiène repo). Avant un premier déploiement ou du code de provenance douteuse :
   `sandbox-pretest`. Avant la mise en prod : `deploy-checklist`.
4. **Après chaque étape significative** (ou avant de fermer) : « fais le point » —
   la skill `session-checkpoint` réécrit `SESSION.md` et ajoute une entrée datée +
   ID de session dans `.claude/session-log.md`. Séparément, `harnais-stats` alimente
   `MONITORING.csv` (incidents constatés en cours de route, ou relevés de pertinence sur
   demande avec ton accord explicite) — pensé pour être comparé entre plusieurs projets.

### Arrêt manuel / reprise

Besoin de partir sans perdre le fil (la tâche a pris plus de temps que prévu, un
imprévu) ? Si Claude est en plein milieu d'une action, interromps d'abord avec
**Échap/Ctrl+C** (natif à Claude Code — une commande ne peut pas s'auto-interrompre),
puis tape `/checkpoint-pause` : l'état est capturé dans `SESSION.md` § "En cours /
bloqué" et Claude s'arrête, sans finir la tâche. Pour reprendre — même dans une
nouvelle session — tape `/checkpoint-resume` : Claude relit cet état et continue
directement, sans qu'on ait besoin de le réexpliquer.

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
- Seules les vraies variantes sensibles de `.env` sont bloquées en lecture (liste
  énumérée depuis V1.10, pas un wildcard `.env.*`) — un `.env.example` versionné reste
  donc lisible tel quel ; une variante d'environnement maison non énumérée devrait être
  ajoutée à cette liste au cas par cas.

## Faire évoluer le socle

Toute modification du socle lui-même (nouvelle skill, durcissement, dérivation d'une
variante plus légère) passe par la skill `skill-builder` et doit respecter les
invariants de `EVOLUTION.md` — y compris tenir cette notice à jour (`README.md`) quand
un changement touche à l'usage visible du socle. Le périmètre actuel (15 skills, 2
agents, 9 hooks) est un choix délibéré : on n'ajoute que si le besoin est démontré.
