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
contexte de chaque session.

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
