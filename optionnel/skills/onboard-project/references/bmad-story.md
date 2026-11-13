# Découpage en Stories (BMAD-style)

> Référence canonique pour `onboard-project` et `dev-cycle` — ne duplique pas ce contenu
> ailleurs. Les deux skills y renvoient plutôt que de répéter le format.

Utile pour travailler à plusieurs sur un projet : chaque Story est une unité de travail
suivable indépendamment, décrite du point de vue de l'interaction utilisateur (IHM), pas
en termes techniques.

## Critère de déclenchement

Découpe seulement si **au moins 2 fonctionnalités ou écrans distincts** sont
identifiables dans la demande. Sinon, dis-le explicitement ("un seul objectif clair, pas
de découpage nécessaire") et continue directement — même logique que la clause "ne te
déclenche pas pour" de `dev-cycle` : le découpage est un coût, pas un rituel à imposer
partout.

## Template de Story

```
### Story <n> — <titre court>
En tant que <rôle utilisateur>, je veux <action/interaction> afin de <bénéfice>.
Écrans/interactions concernés : <liste courte>
Skills candidates (via find-skills) : <liste ou "aucune trouvée">
Statut : à faire | en cours | fait
```

Reste court — une Story tient en 4-5 lignes, pas un cahier des charges.

## Règle find-skills par Story

Pour chaque Story, un appel à `find-skills` en mode **recherche seulement**
(`npx skills find <mots-clés de la Story>`) pour repérer une skill existante pertinente
avant de coder. Jamais d'installation sans confirmation explicite de l'utilisateur —
comportement déjà standard de `find-skills`, inchangé ici. Présente les candidats trouvés
(ou "aucune trouvée") dans le champ "Skills candidates" de la Story.
