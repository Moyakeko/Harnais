#!/bin/sh
# install.sh — installe le socle Harnais sur le projet du répertoire courant.
#
#   curl -fsSL https://raw.githubusercontent.com/Moyakeko/Harnais/main/install.sh | sh
#
# Bootstrap mince : vérifie Node, télécharge l'archive de main, extrait dans
# un répertoire temporaire, puis délègue tout à install/apply.js (fusion
# additive, idempotente — voir README.md). POSIX strict (dash-compatible).
#
# Pour tester une copie locale du socle sans passer par GitHub :
#   HARNAIS_SOURCE_DIR=/chemin/vers/Harnais sh install.sh

set -eu

REPO="Moyakeko/Harnais"
BRANCH="main"

command -v node >/dev/null 2>&1 || {
  echo "ERREUR : Node.js est requis (les hooks du socle et l'installeur tournent avec node)." >&2
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {
  # $1 = URL, $2 = fichier de sortie (ou vide pour stdout)
  if command -v curl >/dev/null 2>&1; then
    if [ -n "$2" ]; then curl -fsSL "$1" -o "$2"; else curl -fsSL "$1"; fi
  else
    if [ -n "$2" ]; then wget -qO "$2" "$1"; else wget -qO- "$1"; fi
  fi
}

# Résout le dernier tag "vX.Y" publié (api.github.com/repos/.../tags), avec
# repli sur $BRANCH si aucun tag n'existe encore (bootstrap, ou API
# inaccessible). Comparaison NUMÉRIQUE volontaire, pas un tri : ni l'ordre de
# l'API (non garanti) ni un tri lexical ("v1.10" < "v1.9" en chaînes) ne
# suffisent, et `sort -V` (GNU) est absent du `sort` BSD de macOS. Pas de
# dépendance nouvelle (pas de jq, pas de git) — juste grep/sed sur le JSON.
latest_ref() {
  tags="$(fetch "https://api.github.com/repos/$REPO/tags" "" 2>/dev/null \
    | grep -o '"name": *"v[0-9][0-9]*\.[0-9][0-9]*"' \
    | sed -E 's/.*"(v[0-9]+\.[0-9]+)".*/\1/')" || true
  [ -n "$tags" ] || return 1
  best="" best_maj=-1 best_min=-1
  for t in $tags; do
    maj="$(echo "$t" | sed -E 's/^v([0-9]+)\.([0-9]+)$/\1/')"
    min="$(echo "$t" | sed -E 's/^v([0-9]+)\.([0-9]+)$/\2/')"
    if [ "$maj" -gt "$best_maj" ] || { [ "$maj" -eq "$best_maj" ] && [ "$min" -gt "$best_min" ]; }; then
      best="$t"; best_maj="$maj"; best_min="$min"
    fi
  done
  [ -n "$best" ] || return 1
  echo "$best"
}

if [ -n "${HARNAIS_SOURCE_DIR:-}" ]; then
  SRC="$HARNAIS_SOURCE_DIR"
  SHA="local"
else
  REF="$(latest_ref)" || REF="$BRANCH"
  # Endpoint API tarball : le dossier extrait s'appelle <owner>-<repo>-<sha court>,
  # ce qui donne le sha sans requête supplémentaire (l'archive branche de codeload
  # s'extrait en <repo>-<branche>, sans sha) — même nommage pour un tag.
  # Limite non authentifiée : 60/h — large.
  URL="https://api.github.com/repos/$REPO/tarball/$REF"
  fetch "$URL" "$TMP/harnais.tar.gz"
  tar -xzf "$TMP/harnais.tar.gz" -C "$TMP"
  # Le dossier extrait s'appelle <owner>-<repo>-<sha court> : le sha est gratuit.
  SRC="$(find "$TMP" -maxdepth 1 -type d -name '*-Harnais-*' | head -n 1)"
  [ -n "$SRC" ] || { echo "ERREUR : archive inattendue (dossier extrait introuvable)." >&2; exit 1; }
  SHA="${SRC##*-}"
fi

node "$SRC/install/apply.js" --source "$SRC" --target "$PWD" --commit "$SHA"
