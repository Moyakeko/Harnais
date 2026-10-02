---
name: session-checkpoint
description: Use to update SESSION.md after a significant step of work, before a known pause, when context feels like it's filling up, or when the user asks "où on en est", "fais le point", "checkpoint". Keeps SESSION.md as a short current-state pointer, not a growing log.
---

# session-checkpoint

Maintient `SESSION.md` à jour — le fichier injecté automatiquement au démarrage de
chaque session par le hook `SessionStart` (`.claude/hooks/session-start-inject.js`).
Sans cette skill utilisée régulièrement, l'injection automatique ne sert à rien : elle
ne fait qu'exposer un fichier qui n'a pas été mis à jour.

## Quand se déclencher

- À la fin d'une étape significative (ex: fin d'une phase de `dev-cycle`, une skill
  entière terminée, un bug résolu).
- Avant une pause connue (l'utilisateur annonce qu'il va fermer la session).
- Quand le contexte de la conversation devient long et qu'un point de repère clair
  aiderait une reprise ultérieure.
- Sur demande explicite : "où on en est ?", "fais le point", "checkpoint".
- Systématiquement avant de terminer une session/une tâche — pas seulement sur les cas
  ci-dessus (V1.15 : c'est ce qui permet à `LESSONS.md`, voir plus bas, de capter une
  leçon même si personne n'a pensé à demander explicitement un checkpoint).

Ne te déclenche pas après chaque message — seulement après un progrès réel. Un
checkpoint après une simple question/réponse n'apporte rien.

## Ce qui va dans `SESSION.md` (court, toujours à jour)

Réécris (n'accumule pas) les sections :
- **Niveau / statut actuel** : une ou deux phrases sur où en est le projet dans son
  ensemble.
- **Fait** : liste courte, à haut niveau — pas le détail de comment, juste le quoi.
- **En cours / bloqué** : si une tâche est interrompue en plein milieu, le point exact où
  ça s'est arrêté (quel fichier, quelle étape) — c'est la partie la plus utile en cas de
  coupure imprévue.
- **Prochaines étapes** : ce qu'il reste à faire, dans l'ordre.
- **Problèmes rencontrés / limites connues** : uniquement ce qui reste pertinent
  maintenant — une fois un problème résolu, retire-le plutôt que de le garder en
  historique.
- **Dernier checkpoint** : une ligne datée résumant ce changement.

## Historique des modifications : `.claude/session-log.md`

À chaque checkpoint, ajoute aussi une entrée courte **à la fin** de
`.claude/session-log.md` (crée la section si besoin) :

```markdown
## YYYY-MM-DD — <titre en une ligne>
- Session : <session ID injecté en début de session par le hook SessionStart>
- Fichiers touchés : <liste courte>
- Quoi/pourquoi : <2-4 lignes — la décision et sa raison, pas le déroulé>
- Vérifié par : <tests exécutés et résultat, ou "non vérifié" si c'est le cas>
```

Le session ID permet de retrouver la conversation d'origine d'un changement
(`claude --resume <id>`) si elle existe encore — précieux pour comprendre un
changement problématique des semaines plus tard, ou pour un futur retour à un
checkpoint. Le retour arrière lui-même passe par git (un commit par évolution),
jamais par une reconstruction manuelle.

Répartition des rôles : `SESSION.md` = état courant, **réécrit** à chaque fois ;
`session-log.md` = historique qui **s'accumule**, jamais chargé par défaut — c'est là
qu'on retrouve le "pourquoi" d'un changement des semaines plus tard sans alourdir le
contexte de chaque session ; `LESSONS.md` (ci-dessous) = leçons qui s'accumulent aussi,
mais organisées par thème et **suivies par git** (contrairement à `session-log.md`).

## Mémoire project-local : `LESSONS.md` (V1.15)

`LESSONS.md`, à la racine du projet, est une mémoire persistante **versionnée avec
git** — contrairement à `session-log.md` (hors git), elle voyage avec le repo quand il
est cloné ailleurs ou partagé avec un collaborateur. Inspirée du "Memory Vault" d'ECC
(github.com/affaan-m/ecc), mais volontairement plus simple : pas de score de confiance,
pas d'auto-génération de skill à partir des leçons accumulées (voir `SOURCES.md` pour le
pourquoi de ce périmètre réduit).

**Quand y ajouter une entrée** : uniquement si quelque chose de non-évident a été appris
pendant la session — une correction explicite de l'utilisateur, un piège contre-intuitif
rencontré, une raison surprenante derrière un choix. **Si rien de tel ne s'est produit,
n'écris rien** — un remplissage artificiel juste pour "faire automatique" est exactement
le genre de fausse confiance qu'une mémoire à moitié construite donne.

**Format** (append — ajoute une section, ne réécris pas les sections existantes) :

```markdown
## <Thème court>

- **Règle :** <ce qu'il faut faire ou éviter>
- **Pourquoi :** <incident/retour qui a motivé cette règle>
- **Comment l'appliquer :** <dans quel contexte cette règle s'active>
```

Si une entrée existante sur le même thème est devenue fausse ou obsolète, corrige-la ou
retire-la plutôt que d'empiler une contradiction — même logique que pour les sections de
`SESSION.md` : ce fichier reste fiable parce qu'il est tenu à jour, pas parce qu'il
grossit.

## Ce qui ne va PAS dans `SESSION.md`

Le détail d'exploration, le raisonnement intermédiaire, le contenu de fichiers lus, les
essais/erreurs — tout ça doit sortir du contexte une fois le problème résolu, pas
s'accumuler dans le fichier de suivi. Si un historique complet est vraiment nécessaire,
il vit dans `.claude/session-log.md` (non chargé par défaut, alimenté aussi par le hook
`precompact-safety-net.js`) — jamais dans `SESSION.md` lui-même.

## Ce que cette skill ne fait pas

Ne remplace pas un vrai système de gestion de projet (`ROADMAP.md`/tickets) pour des
builds de plusieurs jours — pour ce socle volontairement léger, un seul fichier pointeur
suffit. Si un projet dérivé grossit au point d'avoir besoin de plus, c'est une décision à
prendre via `skill-builder`, pas une extension automatique de cette skill.

`LESSONS.md` n'est pas non plus un système d'apprentissage continu à score de confiance
façon ECC : chaque entrée est écrite avec jugement par Claude, jamais par un mécanisme
qui "décide" tout seul qu'une leçon est valide ou qui la transforme automatiquement en
nouvelle skill.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:session-checkpoint" "checkpoint" "<résumé court>"`
