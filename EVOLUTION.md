# EVOLUTION.md — auto-amélioration, adaptation aux modèles, montée en gamme

Non chargé par défaut. À lire quand on veut : faire évoluer le socle, écrire des
scripts d'auto-amélioration, dériver un socle pour un autre contexte, passer le socle
sur un autre modèle, ou le durcir pour un usage entreprise. Complète `SOURCES.md`
(le pourquoi des choix passés) — ici c'est le comment des évolutions futures.

## Invariants — ce qu'aucune évolution ne doit affaiblir

1. **La couche de garde est le plancher.** `guard-dangerous-commands.js`,
   `permissions.deny` et `disableBypassPermissionsMode` ne se contournent pas, ne se
   désactivent pas "temporairement", et ne s'assouplissent qu'après décision humaine
   explicite documentée dans `SOURCES.md`.
2. **Toute modification du hook de garde passe par sa batterie de tests**
   (`.claude/hooks/tests/test-guard.js`, ~140 cas). Un cas de test par nouveau pattern
   bloqué ET par faux positif corrigé — la batterie ne rétrécit jamais.
3. **Aucun script d'auto-amélioration n'écrit dans la couche de garde.** Un script
   peut *proposer* un diff sur `.claude/hooks/`, `settings.json` ou les règles de
   `CLAUDE.md` — il ne l'applique jamais lui-même. Un socle qui peut réécrire ses
   propres garde-fous automatiquement n'a pas de garde-fous.
4. **Un changement = un commit.** Git est le mécanisme de checkpoint/rollback du
   socle (voir plus bas) ; un changement non commité est un changement non protégé.

## Processus pour toute évolution du socle

1. Une seule évolution à la fois, motivée par un besoin réel constaté (friction dans
   `session-log.md`, faux positif du hook, nouveau type de projet) — jamais par
   anticipation.
2. Passer par `skill-builder` (nouvelle skill) ou modifier l'existant chirurgicalement.
3. Tester : batterie du hook si le hook change ; session fraîche si `settings.json`
   change (les permissions ne se rechargent pas à chaud) ; `sandbox-pretest` pour tout
   script exécutable ajouté.
4. Documenter : entrée datée dans `.claude/session-log.md` (avec session ID), décision
   de conception dans `SOURCES.md` si le "pourquoi" n'est pas évident, `SESSION.md` via
   `session-checkpoint`.
5. Commit git avec un message qui dit le pourquoi.

## Couche distribution — les installeurs font partie du socle

Depuis V1.5, le socle s'installe sur un projet via `install.ps1`/`install.sh`
(bootstraps de téléchargement) et `install/apply.js` (toute la logique : copie,
fusion additive, idempotence). Cette couche porte les mêmes exigences que la couche
de garde :

1. **`apply.js` ne peut jamais produire un état cible plus faible que le socle** :
   `permissions.deny` fusionné par union (jamais de retrait),
   `disableBypassPermissionsMode` forcé à `"disable"` même si le projet cible avait
   une autre valeur (signalé dans le résumé d'installation).
2. **La fusion est additive, jamais destructrice** : l'existant d'un projet (CLAUDE.md
   d'une autre méthode type BMAD/GSD, hooks propres, permissions propres) n'est ni
   supprimé ni réécrit — le socle s'ajoute entre marqueurs `harnais:` idempotents,
   avec sauvegarde `.harnais-bak` unique avant toute première fusion. Seuls les
   fichiers possédés par le socle (hooks, skills, agents, EVOLUTION.md) sont
   remplacés lors d'une mise à jour, avec backup.
3. **Toute modification des installeurs est revérifiée** sur les deux scénarios
   end-to-end (répertoire vierge, répertoire avec CLAUDE.md + settings.json +
   .gitignore préexistants) et en double exécution (le 2e run ne doit rien changer,
   ni créer de nouveau backup) — avant commit, comme la batterie du hook.
4. **Bump de version** : `VERSION` dans `apply.js` (reportée dans
   `.claude/harnais.version` du projet cible) suit la version du socle ; les
   marqueurs restent détectés quel que soit le numéro (mise à jour possible depuis
   n'importe quelle version antérieure).

## Scripts d'auto-amélioration — cadre

- **Signal d'entrée** : `session-log.md` (frictions récurrentes, commandes bloquées à
  tort, étapes refaites à la main), sorties de la batterie de tests, prompts de
  permission fréquents.
- **Sortie autorisée** : un rapport + un diff proposé, posés dans un dossier de
  travail — jamais une écriture directe (invariant n°3). L'humain relit, Claude
  applique, les tests valident, git commite.
- **Un script généré est du code non fiable par défaut** : il passe par
  `sandbox-pretest` et `security-audit` avant sa première exécution réelle, comme
  n'importe quel code tiers.
- Commencer par le plus simple : un script qui *compte* (combien de blocages du hook,
  combien de checkpoints oubliés) vaut mieux qu'un script qui *décide*.

## Adaptation aux différents modèles

Le socle a deux couches, et c'est ce qui le rend portable :

- **Couche déterministe** (hooks, `permissions.deny`, anti-bypass) : strictement
  identique quel que soit le modèle — c'est elle qui porte les garanties.
- **Couche interprétée** (`CLAUDE.md`, skills, agents) : sa fiabilité dépend du modèle
  qui la lit. Un modèle plus petit suit moins bien les règles longues et implicites.

Règles pratiques qui en découlent :

1. **Tout ce qui est critique descend dans la couche déterministe.** Si une règle de
   `CLAUDE.md` devient vitale, elle doit gagner un hook ou une entrée deny — la prose
   est un vœu, le hook est une garantie. C'est déjà le motif des règles n°1 et n°2.
2. **Écrire les skills pour le modèle le plus faible qui les utilisera** : étapes
   courtes, déclencheurs concrets dans la `description`, critère de fin explicite,
   sections "ne fait pas". Un gros modèle n'est pas gêné par l'explicite ; un petit
   modèle est perdu sans lui.
3. **Smoke test à chaque changement de modèle** : demander au modèle de lire `.env`
   et d'exécuter `rm -rf /` (les deux doivent être bloqués), puis lui demander "où en
   est le projet" (il doit répondre depuis `SESSION.md` injecté). Trois questions,
   deux minutes, et on sait si le socle tient sur ce modèle.
4. **Ne rien écrire de spécifique à un modèle** dans les skills (pas de référence à
   des capacités ou outils propres à une version) ; si un jour le socle sert un outil
   non-Claude-Code, les hooks n'existeront plus — ce sont alors git + la CI (voir
   ci-dessous) qui doivent porter les garanties.

## Usage entreprise — ce que le socle ne couvre pas seul

Le socle protège **cette machine, cette session**. Pour un projet d'entreprise sérieux,
il devient la couche 1 d'une défense qui doit exister aussi côté serveur, car les hooks
locaux ne s'appliquent ni aux collègues, ni à la CI, ni à un poste mal configuré :

- **Protection de branche** (pas de push direct sur main, revue obligatoire) — c'est
  l'équivalent serveur de `git push --force` bloqué localement.
- **CI comme gate faisant autorité** : scan de secrets (gitleaks/trufflehog), audit de
  dépendances, tests — les mêmes contrôles que `security-audit`, mais imposés à tous.
- **Secrets dans un gestionnaire dédié** (vault/secret manager de la plateforme), pas
  dans des `.env` distribués aux développeurs.
- **Revue humaine systématique du code généré par IA** avant merge — le socle réduit
  les accidents, il ne remplace pas la responsabilité de relecture.

Dériver via `skill-builder` un socle "entreprise" qui ajoute ces exigences dans
`deploy-checklist` et `dev-cycle` plutôt que d'alourdir ce socle-ci par défaut.

## Checkpoint / rollback — fondation pour la future skill "checkpoint"

- **Git est le mécanisme de retour arrière** : un commit par évolution = un point de
  restauration nommé, quel que soit le moment ou la session. Une skill "checkpoint"
  future doit être une surcouche fine de git (tag/`git revert` — pas `reset --hard`,
  bloqué par le socle et destructeur d'historique), pas un système maison.
- **La traçabilité vers la session d'origine existe déjà** : chaque entrée de
  `.claude/session-log.md` est datée et porte le session ID (injecté au démarrage par
  `session-start-inject.js`). En cas de problème sur un changement : `git log` donne
  le commit, `session-log.md` donne le pourquoi et le session ID, et le session ID
  permet de retrouver la conversation dans Claude Code (`claude --resume`) si elle
  existe encore.
- `session-log.md` reste **hors git** (`.gitignore`) : le filet PreCompact y copie des
  extraits bruts de transcript qui peuvent contenir des informations sensibles — il ne
  doit jamais partir sur un remote.
