---
name: harnais-stats
description: Tient MONITORING.csv à jour — journal daté, par projet, des incidents/
  problèmes rencontrés avec le socle et de la pertinence perçue des skills, pensé pour
  être collecté et comparé entre plusieurs projets. Deux modes : automatique (Claude
  remarque un fait concret en cours de travail — annonce puis écrit directement, sans
  confirmation bloquante) et interactif (demande ouverte explicite — "stats du projet",
  "harnais-stats", "documente l'usage du harnais", "fais le point sur le harnais" —
  propose une note de pertinence par skill et confirme avant d'écrire).
---

# harnais-stats

Alimente `MONITORING.csv` — un journal d'événements, par projet (une ligne = un fait
daté, jamais réécrite), à propos de l'usage réel du socle : incidents rencontrés,
retours libres, relevés de pertinence par skill. Pensé pour être collecté et comparé
entre plusieurs projets, d'où une colonne `projet` sur chaque ligne et un schéma de
colonnes fixe (voir `templates/MONITORING.csv`) à ne pas faire dériver sans bonne
raison.

Deux modes de déclenchement, avec des règles d'écriture différentes — ne pas les
confondre.

## Mode automatique — Claude remarque quelque chose en cours de travail

Dès que, pendant le travail normal (pas une demande explicite de l'utilisateur), un
fait concret se présente : un bug du socle (comme le hang `install.ps1` découvert et
corrigé en V1.13), un faux positif du hook de garde, un blocage, une skill qui n'a pas
couvert le besoin réel, ou à l'inverse quelque chose qui a fait gagner du temps de
façon notable — **annonce en une phrase ce qui est consigné, puis écris directement la
ligne**. Pas de confirmation bloquante pour ce mode : c'est un constat factuel, pas un
jugement à valider. Jamais silencieux non plus — l'annonce reste obligatoire, même
courte.

Colonnes à remplir pour cette ligne (voir schéma complet plus bas) : `type=incident`
(problème) ou `type=feedback` (remarque libre sans problème précis), et
`statut_ou_pertinence` = `corrigé` / `en cours` / `non reproductible` selon le cas.

## Mode interactif — demande ouverte explicite

Sur "stats du projet", "harnais-stats", "documente l'usage du harnais", "fais le point
sur le harnais" — même déroulé qu'avant :

1. **Proposer, jamais imposer.** Annonce en une phrase ce qui serait ajouté (ex:
   "onboard-project et security-audit ont servi depuis le dernier relevé, je peux noter
   ton avis dessus dans MONITORING.csv — ok ?") et attends une confirmation explicite
   avant d'écrire quoi que ce soit. Un refus ou un silence = ne rien écrire.
2. **Quantitatif automatique** — une fois l'accord obtenu : agrège
   `.claude/harnais-metrics.jsonl` par `source` (`skill:<nom>`), même approche que la
   skill `harnais-report` (ne réinvente pas le parsing, réutilise cette logique) — sert
   à savoir quelles skills ont servi depuis le dernier relevé (dernière date `type=usage`
   dans `MONITORING.csv` pour ce projet).
3. **Qualitatif** — pour chaque skill utilisée depuis le dernier relevé : proposer une
   pertinence (1-5 ou « pas d'avis ») et des problèmes rencontrés, en s'appuyant
   d'abord sur ce qui s'est réellement passé dans la session plutôt que de tout
   redemander si c'est déjà observable. Demander à l'utilisateur de confirmer/ajuster
   plutôt que d'inventer un jugement.
4. **Écrire** (seulement après l'accord de l'étape 1) : ajouter une ligne
   `type=usage` par skill notée (jamais de réécriture d'une ligne existante — c'est un
   journal, l'historique complet reste visible).
5. Confirmer à l'utilisateur ce qui a été écrit, en une ou deux phrases.

## Schéma de `MONITORING.csv`

```
date,projet,version_socle,type,skill_ou_composant,description,statut_ou_pertinence,notes
```

- `date` : `YYYY-MM-DD`.
- `projet` : nom du dossier du projet courant — dérivé automatiquement, jamais demandé.
- `version_socle` : valeur de `.claude/harnais.version` au moment de la ligne (vide si
  absent, comme sur le dépôt source du socle lui-même).
- `type` : `incident` / `usage` / `feedback`.
- `skill_ou_composant` : nom de la skill/hook concerné, vide si généraliste.
- `description` : ce qui s'est passé, en une phrase.
- `statut_ou_pertinence` : `corrigé`/`en cours`/`non reproductible` pour un incident ;
  score 1-5 ou `pas d'avis` pour une ligne `usage` ; libre pour un `feedback`.
- `notes` : libre, optionnel.

Toujours **ajouter** une ligne à la fin du fichier, jamais réécrire une ligne
existante. Champ contenant une virgule ou un guillemet : l'entourer de guillemets
doubles et doubler les guillemets internes (CSV standard).

## Ce que cette skill ne fait pas

- Ne remplace pas `harnais-report` (rapport quantitatif à la demande, jamais persisté
  dans un fichier).
- Ne remplace pas `session-checkpoint` (état du travail en cours, pas usage du socle).
- Ne compare pas plusieurs projets entre eux — l'utilisateur fait cette comparaison
  lui-même en collectant les `MONITORING.csv` de ses différents projets.
- En mode interactif, n'écrit jamais de contenu sans accord explicite préalable — cette
  garantie ne s'applique qu'à ce mode, pas au mode automatique décrit plus haut.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:harnais-stats" "stats" "<résumé court>"`
