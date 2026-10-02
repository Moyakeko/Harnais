# LESSONS.md — mémoire project-local (pointeur, pas journal brut)

> Mémoire persistante inter-sessions, propre à ce projet et versionnée avec git (donc
> portable : elle suit le repo quand il est cloné ailleurs ou partagé). Différente de
> `.claude/session-log.md` (historique détaillé, hors git) et de la mémoire native de
> Claude Code (globale au compte, pas versionnée avec le projet).
>
> Maintenue par la skill `session-checkpoint`, qui ajoute une entrée ici uniquement
> quand quelque chose de **non-évident** a été appris pendant la session (une correction
> utilisateur, un piège contre-intuitif, une raison surprenante derrière un choix) —
> jamais à chaque checkpoint, et jamais de remplissage artificiel. Organisé par thème,
> pas par date.
>
> Format d'une entrée :
> ```markdown
> ## <Thème court>
>
> - **Règle :** <ce qu'il faut faire ou éviter>
> - **Pourquoi :** <incident/retour qui a motivé cette règle>
> - **Comment l'appliquer :** <dans quel contexte cette règle s'active>
> ```

## Mémoire persistante : LESSONS.md vs session-log.md vs mémoire native

- **Règle :** `LESSONS.md` reçoit uniquement des leçons/corrections non-évidentes qui
  doivent voyager avec le repo (git-tracké). Ne pas y mettre l'historique détaillé d'une
  session (ça va dans `.claude/session-log.md`, hors git) ni dupliquer la mémoire native
  de Claude Code (`~/.claude/projects/.../memory/`, globale au compte, pas versionnée
  avec le projet).
- **Pourquoi :** ECC (github.com/affaan-m/ecc) a inspiré l'idée d'une mémoire
  persistante inter-sessions, mais `SOURCES.md` avait initialement écarté tout le
  système ("un système de mémoire à moitié construit donne une fausse confiance — pire
  que ne pas en avoir"). Cette version V1.15 reste volontairement simple — pas de score
  de confiance, pas d'auto-promotion en skill — et scoped au projet plutôt que globale,
  pour ne pas dupliquer ce que la mémoire native couvre déjà.
- **Comment l'appliquer :** `session-checkpoint` écrit ici seulement quand quelque chose
  de vraiment non-évident a été appris ; sinon, ne rien écrire plutôt que remplir pour la
  forme.
