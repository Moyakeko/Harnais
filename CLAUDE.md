# Harnais — socle Claude Code personnel

Ce dépôt n'est pas un projet applicatif : c'est un **socle réutilisable** à copier ou
adapter dans chaque nouveau projet (devoir/TP d'école, projet perso, service déployé pour
toi ou tes proches). La stack varie d'un projet à l'autre — ne suppose jamais un langage
ou un framework : détecte-le à partir des fichiers présents (`package.json`,
`requirements.txt`, `Cargo.toml`, `go.mod`, etc.) avant d'agir.

## Règles non négociables

Ces règles s'appliquent **toujours**, quel que soit le projet, le langage, ou le mode de
permission actif.

1. **Jamais de secret en clair.** Aucune clé API, token, mot de passe ou identifiant en
   dur dans le code, un commit, ou même une réponse affichée à l'écran. Toujours via
   variables d'environnement + fichier ignoré par git (`.env` + `.gitignore`). Si tu
   repères un secret déjà commité ou en train d'être écrit, arrête-toi et préviens
   immédiatement — ne continue pas silencieusement.

2. **Jamais de commande destructrice ou d'exfiltration sans confirmation explicite.**
   Ce n'est pas qu'une règle déclarative — un hook déterministe
   (`.claude/hooks/guard-dangerous-commands.js`) bloque par exit code, indépendamment de
   ce que tu décides et même en mode auto-approve, cinq catégories :
   suppression récursive à large rayon d'action (racine, home, disque, cible commençant
   par une variable, `.`/`..`/`*`, chemin hors projet — `rm`, `Remove-Item` et alias,
   `rd`/`del`) ; destruction de disque (`mkfs`, `dd` vers un device, `format`,
   `Format-Volume`) ; git destructif (`push --force`/`--mirror`/`--delete`/`+refspec`,
   `reset --hard`, `clean -f`, `checkout .`/`restore .`, `filter-branch`, `stash clear`) ;
   exécution de code téléchargé (`curl … | sh`, `iex (iwr …)`) ; lecture, exfiltration
   réseau ou `git add` de fichiers secrets via le shell (`cat .env`, `scp id_rsa`…).
   Si le hook bloque une commande, n'essaie pas de la contourner (reformulation, sudo,
   alias, interpréteur type `python -c`) : explique pourquoi c'est bloqué et laisse
   l'utilisateur l'exécuter lui-même dans son propre terminal s'il le veut vraiment.
   Pour une commande destructrice que le hook ne couvre pas (ex: `git branch -D`, drop
   d'une table), demande toujours confirmation avant.

3. **Jamais de "c'est fait" sans vérification réelle.** Ne déclare jamais qu'un
   changement fonctionne sans l'avoir exécuté (build, tests, lancement de l'app) et
   observé le résultat. Utilise `/verify` ou le skill `dev-cycle` pour ça. Un typecheck
   qui passe ne prouve pas qu'une fonctionnalité marche.

4. **Explique le pourquoi, pas juste le quoi.** Le code doit être accompagné d'une
   explication des choix (pourquoi cette approche, pas juste ce qu'elle fait) — le nom
   des identifiants suffit déjà à décrire le "quoi". Contexte d'apprentissage oblige :
   privilégie la pédagogie à la vitesse quand les deux sont en tension.

5. **Principes Karpathy (réflexion avant exécution) :**
   - Ne devine jamais silencieusement une hypothèse ambiguë — formule-la à voix haute et
     pose la question si le doute change l'implémentation.
   - N'ajoute rien au-delà de ce qui est demandé : pas d'abstraction, de feature ou de
     gestion d'erreur spéculative pour un cas qui ne peut pas se produire.
   - Change chirurgicalement : ne touche que le code directement lié à la tâche, respecte
     le style existant, ne "nettoie" pas au passage sans qu'on te le demande.
   - Transforme toute tâche vague en critères de succès vérifiables avant de coder.

6. **Maintiens `SESSION.md` à jour.** Après avoir compris le contexte du projet en début
   de session, réfère-toi à `SESSION.md` pour savoir où on en est (il t'est normalement
   déjà injecté automatiquement au démarrage par un hook). Mets-le à jour via la skill
   `session-checkpoint` après chaque étape significative — reste un pointeur court, pas
   un journal qui s'accumule. Une fois qu'un point bloquant listé dedans est résolu,
   retire-le plutôt que de le garder en historique.

## Skills du socle — quand les utiliser

| Skill | Quand |
|---|---|
| `onboard-project` | Une fois, au tout début d'un nouveau projet posé sur ce socle. |
| `dev-cycle` | Pour toute fonctionnalité/bug non trivial : explore → plan → code → test → review. |
| `security-audit` | Avant un commit/PR ou un déploiement — routine légère (secrets, hygiène repo). |
| `sandbox-pretest` | Avant un premier déploiement, une dépendance nouvelle, ou l'exécution de code de provenance incertaine — exécution en environnement isolé (Docker si dispo). |
| `deploy-checklist` | Avant de déployer ou mettre à jour un service réel. |
| `skill-builder` | Pour créer une nouvelle skill du socle, ou dériver une version plus légère (ex: un socle "études uniquement"). |
| `session-checkpoint` | Après une étape significative, avant une pause connue, ou sur "fais le point" — met à jour `SESSION.md`. |

Skills globales déjà disponibles dans le harnais Claude Code (ne pas dupliquer) :
`/verify` (vérification end-to-end d'un changement), `/code-review` (revue du diff
courant), `/security-review` (revue de sécurité approfondie). Les skills ci-dessus
s'appuient dessus plutôt que de réinventer leur logique.

## Sous-agents

| Agent | Rôle |
|---|---|
| `code-reviewer` | Revue d'un module/périmètre large (pas juste le diff courant) sans polluer le contexte principal. |
| `debugger` | Root-cause un bug (reproduire, isoler, diagnostiquer) sans remplir le contexte principal de bruit d'investigation. |

## Ce qui est contre-intuitif ici

- Le hook `guard-dangerous-commands.js` bloque cinq catégories (suppression récursive
  large, destruction de disque, git destructif, code téléchargé pipé dans un shell,
  fichiers secrets via le shell) **sans possibilité de contournement côté Claude**, même
  en mode auto-approve. Ce n'est pas un bug si une commande légitime mais mal formulée
  se fait bloquer (ex: `rm -rf $BUILD_DIR` — expansion non vérifiable —, ou l'installateur
  officiel `curl … | sh` de rustup/nvm) — c'est voulu : l'utilisateur la lance lui-même
  dans son terminal.
- `permissions.deny` dans `.claude/settings.json` empêche Claude de **lire** les fichiers
  secrets du projet (`.env*`, `*.pem`, `*.key`, `secrets/`, états Terraform, clés SSH…)
  et du home (`~/.ssh`, `~/.aws`, `~/.config/gh`…) — cette règle passe avant toute
  autorisation accordée ailleurs. Le hook étend le même blocage aux lectures via shell
  (`cat .env`), à l'exfiltration réseau et à `git add`. Conséquence assumée : un
  `.env.example` versionné n'est pas lisible par l'outil Read (le pattern `.env.*` le
  couvre) — si un template lisible par Claude est nécessaire, le nommer `env.example`
  (sans point initial).
- `disableBypassPermissionsMode: "disable"` dans `settings.json` empêche de démarrer ce
  projet en mode `--dangerously-skip-permissions` : hooks et deny ci-dessus restent
  actifs quoi qu'il arrive.
- Si un de ces blocages surprend, ce n'est pas un problème à contourner : c'est le socle
  qui fait exactement ce pour quoi il a été conçu (voir `SOURCES.md` pour le pourquoi).
- Le contenu de `SESSION.md` apparaît automatiquement en tout début de session (hook
  `SessionStart`) sans que tu aies rien demandé — normal, c'est voulu. S'il est absent ou
  vide, la session démarre quand même normalement.
- Aucun hook ne peut rédiger `SESSION.md` à ta place ni intercepter une coupure brutale
  de crédit en plein milieu d'une commande — voir `session-checkpoint` pour ce que ça
  implique concrètement.

## Ce qui est volontairement absent (pour l'instant)

Pas de système de mémoire/apprentissage continu façon ECC, pas de couche sécurité
multi-agents, pas de règles par langage séparées. Le socle reste à 7 skills + 2 agents +
3 hooks par choix délibéré — à faire évoluer via `skill-builder` si le besoin s'en fait
sentir, pas par défaut. Pour toute évolution du socle lui-même (scripts
d'auto-amélioration, adaptation à un autre modèle, durcissement entreprise, futur
mécanisme de checkpoint/rollback) : lis `EVOLUTION.md` d'abord — il fixe les invariants
qu'aucune évolution ne doit affaiblir.
