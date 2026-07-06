# install.ps1 — installe le socle Harnais sur le projet du répertoire courant.
#
#   iwr -useb https://raw.githubusercontent.com/Moyakeko/Harnais/main/install.ps1 | iex
#
# Bootstrap mince : vérifie Node, télécharge l'archive zip de main, extrait
# dans un répertoire temporaire, puis délègue tout à install/apply.js (fusion
# additive, idempotente — voir README.md). Compatible PowerShell 5.1 et 7 :
# TLS 1.2 forcé, -UseBasicParsing, aucune syntaxe PS7, et aucune écriture de
# fichier côté PowerShell (Node écrit tout en UTF-8 sans BOM).
#
# Pour tester une copie locale du socle sans passer par GitHub :
#   $env:HARNAIS_SOURCE_DIR = "C:\chemin\vers\Harnais"; iex (Get-Content install.ps1 -Raw)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js est requis (les hooks du socle et l'installeur tournent avec node)."
}

$tmp = Join-Path $env:TEMP "harnais-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  if ($env:HARNAIS_SOURCE_DIR) {
    $src = $env:HARNAIS_SOURCE_DIR
    $sha = 'local'
  }
  else {
    # Endpoint API zipball : le dossier extrait s'appelle <owner>-<repo>-<sha court>,
    # ce qui donne le sha sans requête supplémentaire (l'archive branche de codeload
    # s'extrait en <repo>-<branche>, sans sha). Limite non authentifiée : 60/h — large.
    # Zipball + Expand-Archive : disponibles partout, pas de dépendance à tar.exe.
    $zip = Join-Path $tmp 'harnais.zip'
    Invoke-WebRequest -UseBasicParsing 'https://api.github.com/repos/Moyakeko/Harnais/zipball/main' -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $tmp
    $srcDir = Get-ChildItem -Path $tmp -Directory -Filter '*-Harnais-*' | Select-Object -First 1
    if (-not $srcDir) { throw "Archive inattendue (dossier extrait introuvable)." }
    $src = $srcDir.FullName
    # Le dossier extrait s'appelle <owner>-<repo>-<sha court> : le sha est gratuit.
    $sha = ($srcDir.Name -split '-')[-1]
  }

  & node (Join-Path $src 'install\apply.js') --source $src --target (Get-Location).Path --commit $sha
  if ($LASTEXITCODE -ne 0) { throw "L'installation a échoué (code $LASTEXITCODE)." }
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
