---
name: update-harnais
description: Met à jour le socle Harnais déjà installé sur ce projet vers la dernière version publiée sur GitHub — ajoute les nouveaux hooks/skills/agents, fusionne CLAUDE.md/.gitignore/settings.json, sans jamais toucher SESSION.md ni le travail en cours. Triggers on "mets à jour le harnais", "update le socle", "update-harnais", "nouvelle version du harnais", "récupère les dernières skills du socle".
---

# update-harnais

Rejoue le mécanisme d'installation additif et idempotent (`install/apply.js`) depuis le
chat, sur un projet qui a **déjà** le socle — pour ne pas dépendre de se souvenir
d'ouvrir un terminal et de retaper le one-liner à chaque nouvelle version. Terminé =
le résumé fichier-par-fichier d'`apply.js` restitué à l'utilisateur, et le rappel de
redémarrer la session.

## Quand se déclencher

- Demande explicite de mise à jour du socle lui-même.
- Ne se déclenche PAS pour mettre à jour des dépendances de projet (npm, pip…) — ça,
  c'est le travail normal du projet, pas de ce socle.

## 0. Vérifier que c'est bien une mise à jour, pas une installation

Cherche `.claude/harnais.version` ou un bloc `<!-- harnais:core ... -->` dans
`CLAUDE.md`. Absent des deux → ce projet n'a pas encore le socle : ne improvise pas une
installation depuis cette skill, redirige vers le one-liner du `README.md` du socle
(`install.ps1`/`install.sh`), qui gère aussi bien le cas neuf que la mise à jour.

## 1. Annoncer avant d'agir

Dis explicitement ce qui va se passer : téléchargement du script officiel
`install.ps1`/`install.sh` depuis `github.com/Moyakeko/Harnais` (en deux étapes
séparées, jamais pipées — c'est le contournement documenté dans `CLAUDE.md` pour ce cas
précis, pas une entorse au hook de garde), puis exécution locale, qui va fusionner les
mises à jour dans ce projet sans toucher `SESSION.md` ni au travail en cours.

## 2. Résoudre la dernière version taguée

Même logique que `install.sh`/`install.ps1` : résous le dernier tag `vX.Y` publié sur
`api.github.com/repos/Moyakeko/Harnais/tags` (comparaison **numérique** — un tri
lexical classerait `v1.10` avant `v1.9`), avec repli sur `main` si aucun tag n'existe
encore ou si l'API est inaccessible.

- **Windows (PowerShell)** :
  ```powershell
  $ref = 'main'
  try {
    $tags = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/Moyakeko/Harnais/tags"
    $best = $tags | Where-Object { $_.name -match '^v\d+\.\d+$' } |
      Sort-Object { [version]($_.name.TrimStart('v')) } -Descending | Select-Object -First 1
    if ($best) { $ref = $best.name }
  } catch {}
  ```
- **macOS/Linux/Git Bash** :
  ```sh
  tags="$(curl -fsSL "https://api.github.com/repos/Moyakeko/Harnais/tags" 2>/dev/null \
    | grep -o '"name": *"v[0-9][0-9]*\.[0-9][0-9]*"' | sed -E 's/.*"(v[0-9]+\.[0-9]+)".*/\1/')"
  ref="main"; best_maj=-1; best_min=-1
  for t in $tags; do
    maj="$(echo "$t" | sed -E 's/^v([0-9]+)\.([0-9]+)$/\1/')"
    min="$(echo "$t" | sed -E 's/^v([0-9]+)\.([0-9]+)$/\2/')"
    if [ "$maj" -gt "$best_maj" ] || { [ "$maj" -eq "$best_maj" ] && [ "$min" -gt "$best_min" ]; }; then
      ref="$t"; best_maj="$maj"; best_min="$min"
    fi
  done
  ```

Garde `$ref` sous la main pour les deux étapes suivantes.

## 3. Télécharger le script (jamais de pipe)

Selon la plateforme, en substituant `$ref` résolu à l'étape 2 :

- **Windows (PowerShell)** :
  ```powershell
  Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/Moyakeko/Harnais/$ref/install.ps1" -OutFile "$env:TEMP\harnais-update.ps1"
  ```
- **macOS/Linux/Git Bash** :
  ```sh
  curl -fsSL "https://raw.githubusercontent.com/Moyakeko/Harnais/$ref/install.sh" -o /tmp/harnais-update.sh
  ```

Un simple téléchargement vers un fichier (`-OutFile`/`-o`) n'est jamais bloqué par
`guard-dangerous-commands.js` — seul un pipe vers un interpréteur l'est.

## 4. Exécuter le fichier téléchargé directement (toujours pas de pipe)

Depuis la **racine du projet** (pas un sous-dossier) :

- Windows : `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\harnais-update.ps1"`
- macOS/Linux : `sh /tmp/harnais-update.sh`

Ce script télécharge l'archive de la référence résolue à l'étape 2 (tag le plus
récent, ou `main` en repli) et délègue toute la fusion à `install/apply.js` — le même
mécanisme qu'une première installation, rejoué sur un projet qui a déjà le socle : il
n'ajoute/fusionne que ce qui doit l'être, jamais d'écrasement du travail en cours (voir
garanties ci-dessous).

## Problème connu — blocage silencieux (Windows)

Il est arrivé que `install.ps1` bloque plusieurs minutes à l'étape 4 : le process
`node.exe` démarre avec les bons arguments mais reste à 0 % CPU, mémoire figée, sans
la moindre sortie ni écriture de fichier — ce n'est **pas** un bug d'`apply.js` (il
s'exécute normalement en moins d'une seconde en invocation directe), et **pas** un
deadlock de pipe interne à `install.ps1` (celui-ci n'a jamais capturé sa sortie —
`& node ...` hérite directement la console). La cause la plus probable est un
antivirus/EDR local qui retient l'exécution d'un script fraîchement téléchargé le
temps d'une vérification de réputation — invérifiable et non corrigible depuis Claude
Code. Depuis V1.13, `install.ps1` sonde lui-même la progression et affiche un
avertissement après 60 s d'inactivité, avec la commande de contournement exacte à
copier-coller. Si le blocage survient quand même sans que cet avertissement soit
visible (sortie non affichée, tool en arrière-plan…), le contournement manuel est :
repérer le dossier source déjà extrait (`%TEMP%\harnais-install-<guid>\...`, visible
via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` sur le process bloqué)
puis invoquer directement `node <src>\install\apply.js --source <src> --target <projet> --commit <sha>` — sans risque, la fusion est idempotente.

## 5. Nettoyer

Supprime le fichier temporaire téléchargé à l'étape 3.

## 6. Restituer le résumé

`apply.js` imprime une ligne par fichier (`créé` / `remplacé` / `identique` /
`fusionné` / `mis à jour`) et annonce la transition de version
(`mise à jour vX.X → vY.Y`, ou `déjà à jour`). Restitue ce résumé à l'utilisateur —
c'est la réponse concrète à « qu'est-ce qui a changé ? ».

## 7. Rappel obligatoire : redémarrer la session

**Ce n'est jamais optionnel.** Les hooks et `.claude/settings.json` ne se chargent
qu'au démarrage d'une session Claude Code — rien ne les recharge à chaud, y compris
dans la session courante qui vient de lancer cette mise à jour. Dis explicitement à
l'utilisateur qu'il doit `/exit` puis relancer `claude` (ou fermer/rouvrir son IDE) une
fois qu'il a fini ce qu'il faisait dans la session en cours, pour que la mise à jour
prenne effet.

## 8. Suggérer un smoke test

Après redémarrage : `node .claude/hooks/tests/test-guard.js` (doit passer), et les
autres batteries présentes dans `.claude/hooks/tests/` si le projet en a accumulé.

## Ce que cette skill garantit (hérité d'`apply.js`, ne pas re-décider au cas par cas)

- `SESSION.md` n'est jamais touché s'il existe déjà.
- `CLAUDE.md`/`.gitignore` : fusion additive entre marqueurs `harnais:` — tout ce que
  le projet a ajouté en dehors de ces marqueurs reste intact.
- `.claude/settings.json` : hooks ajoutés à côté des existants (pas de doublon, clé =
  commande), `permissions.deny` par union, jamais de retrait.
- Avant tout remplacement d'un fichier possédé par le socle (un hook modifié
  localement, par exemple), une sauvegarde `.harnais-bak` est créée si elle n'existe
  pas déjà.

## Ce que cette skill ne fait pas

- Ne met à jour aucun autre logiciel/dépendance du projet — uniquement les fichiers
  possédés par le socle.
- Ne redémarre pas la session elle-même (impossible depuis l'intérieur d'une
  session) — c'est à l'utilisateur de le faire, voir étape 6.
- Ne fonctionne pas hors ligne : nécessite un accès réseau à GitHub. Si indisponible,
  dis-le et propose de réessayer plus tard, ou de lancer le one-liner soi-même.
- N'installe rien sur un projet qui n'a pas encore le socle — voir étape 0.

## Télémétrie

En fin de skill, journalise une ligne (best-effort, n'affecte jamais le déroulé si la
commande échoue) :
`node .claude/hooks/lib/metrics.js "skill:update-harnais" "update" "<résumé court>"`
