---
name: sandbox-pretest
description: Exécute un changement, une app ou du code de provenance incertaine dans un environnement isolé (Docker de préférence, fallback dégradé sinon) AVANT un déploiement réel ou une exécution sur la machine. Triggers on "sandbox", "pré-test", "teste en isolation", "sandbox-pretest", avant l'étape de déploiement de deploy-checklist (premier déploiement ou changement à risque), à l'installation de dépendances avec scripts d'install de source peu familière, ou avant d'exécuter du code généré/cloné que l'utilisateur n'a pas relu.
---

# sandbox-pretest

Pré-test en isolation : on exécute d'abord dans un environnement jetable et contraint,
on observe, et seulement ensuite on touche la machine réelle ou la cible de déploiement.
Complète `/verify` (qui vérifie que ça *marche*) en vérifiant que ça ne fait *rien
d'autre* que prévu. Terminé = un rapport court : niveau d'isolation utilisé, ce qui a
été exécuté, comportement observé (réseau, écritures disque, erreurs), et verdict
go/no-go pour l'exécution ou le déploiement réel.

## 0. Évaluer si la skill est utile ici

- Changement trivial sur du code déjà maîtrisé, sans nouvelle dépendance : `/verify`
  suffit, ne sur-isole pas.
- Déclencheurs légitimes : premier déploiement, dépendance nouvelle (surtout avec
  scripts d'installation), script généré par IA non relu, code cloné d'un tiers,
  changement touchant au système de fichiers ou au réseau.

## 1. Détecter l'isolation disponible

Dans l'ordre de préférence : `docker --version` → `podman --version` → rien.
Annonce le niveau retenu dès le début du rapport — ne laisse jamais croire à une
isolation forte quand c'est le fallback qui tourne.

## 2. Niveau fort — conteneur jetable

Image adaptée à la stack détectée (`node:lts-slim`, `python:3-slim`, etc.), et par
défaut **tout est fermé**, on n'ouvre que ce qui est justifié :

```
docker run --rm --network none --memory 512m --cpus 1 \
  --read-only --tmpfs /tmp -v "<projet>:/app:ro" -w /app <image> <commande>
```

- `--network none` d'abord : si le build/les tests réclament le réseau, c'est une
  information en soi — note *quoi* essaie de sortir et *vers où* avant de relancer
  avec réseau si c'est légitime (ex: installation de dépendances).
- Installation de dépendances : première passe avec les scripts désactivés
  (`npm ci --ignore-scripts`, `pip install --no-build-isolation` selon la stack), et
  n'active les scripts d'install que si le build en a réellement besoin.
- **Jamais le vrai `.env` monté dans le conteneur** : fournis des placeholders
  (`API_KEY=fake-for-sandbox`). Le hook du socle bloque de toute façon sa lecture.
- Exécute build + tests + un lancement court de l'app ; observe stdout/stderr, les
  tentatives réseau, les écritures hors `/tmp` (elles échoueront grâce à
  `--read-only` — chaque échec de ce type est un signal à rapporter).

## 3. Niveau faible — fallback sans conteneur

Copie jetable du projet dans un dossier temporaire + environnement de langage isolé
(`python -m venv`, install locale node, etc.), scripts d'install désactivés, variables
d'environnement factices. **Dis explicitement dans le rapport que cette isolation ne
bloque ni le réseau ni le système de fichiers** — elle évite seulement de polluer le
projet et l'environnement global. Si le code est réellement suspect (provenance
inconnue, obfuscation), ne l'exécute pas en fallback : recommande à l'utilisateur
d'installer Docker ou de le lire ligne à ligne d'abord.

## 4. Rapport et nettoyage

- Rapport : niveau d'isolation, commandes exécutées, comportement observé, verdict
  go/no-go, et ce qui reste non couvert par le test.
- Nettoyage : `--rm` supprime le conteneur ; supprime l'image de test si tu en as
  construit une, et la copie temporaire du fallback.

## Ce que cette skill ne fait pas

- Pas un labo d'analyse de malware : si le code semble volontairement malveillant,
  on ne l'exécute pas du tout, même en conteneur — on le signale.
- Ne remplace ni `/verify` (vérification fonctionnelle), ni `security-audit`
  (secrets/hygiène), ni `deploy-checklist` (dont elle est une étape) — elle s'insère
  avant eux quand le risque le justifie.
- Ne déploie rien.
