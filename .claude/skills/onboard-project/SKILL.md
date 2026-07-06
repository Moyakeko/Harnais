---
name: onboard-project
description: Use once at the very start of a new project built on this harness (school assignment, personal project, or real deployment for the user/friends). Sets up a short PROJECT.md capturing project nature, stack, constraints, and deployment target. Triggers on "onboard", "nouveau projet", "démarre ce projet", "configure ce repo", or when CLAUDE.md exists but no PROJECT.md does yet.
---

# onboard-project

Interview courte (one-shot, à ne pas refaire à chaque session) pour capturer le contexte
minimal d'un nouveau projet posé sur ce socle. Inspiré du principe d'onboarding d'AIS-OS,
mais volontairement réduit : pas de business context complet, juste ce qui change le
comportement de Claude sur ce repo précis.

## Quand se déclencher

- Premier tour de conversation sur un nouveau repo qui contient ce `CLAUDE.md` mais pas
  encore de `PROJECT.md` à la racine.
- L'utilisateur demande explicitement "onboard ce projet" / "configure ce repo".

Ne te redéclenche pas si `PROJECT.md` existe déjà — dans ce cas, lis-le plutôt que de
reposer les questions.

## Déroulé

1. Vérifie si `PROJECT.md` existe déjà à la racine. S'il existe, arrête-toi ici et
   contente-toi de le lire pour charger le contexte.
2. Détecte la stack automatiquement à partir des fichiers présents (`package.json`,
   `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, etc.) — ne
   demande pas à l'utilisateur ce que tu peux déduire toi-même du repo.
3. Pose au maximum ces questions (saute celles dont la réponse est évidente depuis le
   repo ou le contexte de la conversation) :
   - Nature du projet : devoir/TP noté, projet perso, ou service à faire tourner pour de
     vrais utilisateurs (toi/proches) ?
   - Contraintes spécifiques : deadline, grille de correction, exigences du cours
     (langage imposé, style imposé) ?
   - Y a-t-il déjà des utilisateurs réels ou des données réelles en jeu (change le niveau
     de prudence sur les migrations/déploiements) ?
   - Cible de déploiement envisagée, si déjà connue (sinon, laisse `à définir` — ne force
     pas une réponse, `deploy-checklist` s'en chargera le moment venu).
4. Écris un `PROJECT.md` court à la racine (10-20 lignes, pas plus) avec ces réponses.
   Ne duplique pas ce que `CLAUDE.md` couvre déjà (les règles non négociables restent
   dans `CLAUDE.md`, pas ici).
5. Propose un smoke test du socle fraîchement installé :
   `node .claude/hooks/tests/test-guard.js` — doit afficher N/N tests OK. C'est le
   smoke test décrit dans `EVOLUTION.md` ; deux minutes, et on sait que la couche de
   garde tient sur ce projet et cette machine.
6. Explique en une phrase à l'utilisateur ce que ça change concrètement pour la suite
   (ex: "comme c'est noté avec une deadline, je vais éviter les refactors non demandés
   et prioriser un code qui marche et qui respecte l'énoncé").

## Ce que cette skill ne fait pas

Ne génère pas d'arborescence `context/`/`connections/` façon AIS-OS complète — c'est trop
lourd pour un usage solo multi-projets. Un seul fichier `PROJECT.md` suffit.
