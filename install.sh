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

if [ -n "${HARNAIS_SOURCE_DIR:-}" ]; then
  SRC="$HARNAIS_SOURCE_DIR"
  SHA="local"
else
  # codeload : archive directe, pas d'API GitHub donc pas de rate-limit.
  URL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$TMP/harnais.tar.gz"
  else
    wget -qO "$TMP/harnais.tar.gz" "$URL"
  fi
  tar -xzf "$TMP/harnais.tar.gz" -C "$TMP"
  # Le dossier extrait s'appelle <owner>-<repo>-<sha court> : le sha est gratuit.
  SRC="$(find "$TMP" -maxdepth 1 -type d -name '*-Harnais-*' | head -n 1)"
  [ -n "$SRC" ] || { echo "ERREUR : archive inattendue (dossier extrait introuvable)." >&2; exit 1; }
  SHA="${SRC##*-}"
fi

node "$SRC/install/apply.js" --source "$SRC" --target "$PWD" --commit "$SHA"
