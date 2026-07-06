# Harnais — socle Claude Code personnel

Socle réutilisable pour démarrer n'importe quel projet avec Claude Code (devoir/TP
d'école, projet perso, service déployé pour soi ou ses proches) avec des garde-fous de
sécurité et une méthode de travail déjà en place. Ce dépôt n'est **pas** un projet
applicatif : c'est le moule que l'on copie au départ de chaque nouveau projet.

Version courante : **V1.5** — installable en une ligne (voir ci-dessous) ; V1.4
vérifiée en session fraîche le 2026-07-06.

## À qui s'adressent les fichiers

| Fichier | Lecteur | Rôle |
|---|---|---|
| `README.md` (ce fichier) | Toi (humain) | Notice d'utilisation du socle. |
| `CLAUDE.md` | Claude | Règles non négociables + routage des skills, chargé à chaque session. |
| `SESSION.md` | Les deux | État courant du travail, injecté automatiquement au démarrage de session. |
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
| `SESSION.md` | Créé vierge depuis un template — **jamais touché** s'il existe déjà. |
| `CLAUDE.md`, `.gitignore` | Fusion additive entre marqueurs `harnais:` — un CLAUDE.md existant (BMAD, GSD…) est conservé intact, le bloc socle s'ajoute à la fin. |
| `.claude/settings.json` | Fusion JSON : hooks ajoutés à côté des existants, `permissions.deny` par union, anti-bypass forcé — jamais de retrait. |
| `README.md`, `SOURCES.md`, `SESSION.md` du socle, `install.*` | Jamais installés (documentation du socle, pas du projet). |

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

## Ce que contient le socle

- **6 règles non négociables** (`CLAUDE.md`) : pas de secret en clair, pas de commande
  destructrice sans confirmation, pas de « c'est fait » sans vérification réelle,
  pédagogie du pourquoi, principes Karpathy (réflexion avant exécution), `SESSION.md`
  maintenu à jour.
- **3 hooks** (`.claude/hooks/`) :
  - `guard-dangerous-commands.js` — bloque par exit code, même en auto-approve,
    5 catégories : suppression récursive large, destruction de disque, git destructif,
    code téléchargé pipé dans un shell, fichiers secrets via le shell. Batterie de
    tests versionnée dans `.claude/hooks/tests/test-guard.js` (138 cas).
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
