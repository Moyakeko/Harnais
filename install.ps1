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

$repo = 'Moyakeko/Harnais'
$branch = 'main'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js est requis (les hooks du socle et l'installeur tournent avec node)."
}

# Résout le dernier tag "vX.Y" publié, avec repli sur $branch si aucun tag
# n'existe encore (bootstrap) ou si l'API est inaccessible. Invoke-RestMethod
# parse le JSON nativement et [version] compare numériquement (pas de piège de
# tri lexical façon "v1.10" < "v1.9", contrairement à install.sh en sh pur).
function Resolve-LatestRef {
  try {
    $tags = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$repo/tags"
    $best = $tags | Where-Object { $_.name -match '^v\d+\.\d+$' } |
      Sort-Object { [version]($_.name.TrimStart('v')) } -Descending |
      Select-Object -First 1
    if ($best) { return $best.name }
  }
  catch {
    # Pas de tag, API inaccessible, ou réponse inattendue : repli sur la branche.
  }
  return $branch
}

$tmp = Join-Path $env:TEMP "harnais-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  if ($env:HARNAIS_SOURCE_DIR) {
    $src = $env:HARNAIS_SOURCE_DIR
    $sha = 'local'
  }
  else {
    $ref = Resolve-LatestRef
    # Endpoint API zipball : le dossier extrait s'appelle <owner>-<repo>-<sha court>,
    # ce qui donne le sha sans requête supplémentaire (l'archive branche de codeload
    # s'extrait en <repo>-<branche>, sans sha — même nommage pour un tag). Limite non
    # authentifiée : 60/h — large. Zipball + Expand-Archive : disponibles partout,
    # pas de dépendance à tar.exe.
    $zip = Join-Path $tmp 'harnais.zip'
    Invoke-WebRequest -UseBasicParsing "https://api.github.com/repos/$repo/zipball/$ref" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $tmp
    $srcDir = Get-ChildItem -Path $tmp -Directory -Filter '*-Harnais-*' | Select-Object -First 1
    if (-not $srcDir) { throw "Archive inattendue (dossier extrait introuvable)." }
    $src = $srcDir.FullName
    # Le dossier extrait s'appelle <owner>-<repo>-<sha court> : le sha est gratuit.
    $sha = ($srcDir.Name -split '-')[-1]
  }

  $apply = Join-Path $src 'install\apply.js'
  $target = (Get-Location).Path

  # System.Diagnostics.Process direct (et non l'opérateur & ni Start-Process) pour
  # pouvoir sonder la progression sans capturer la sortie : UseShellExecute=$false
  # sans redirection hérite la console du parent, donc aucun changement de
  # comportement dans le cas normal — et .ExitCode reste lisible de façon fiable
  # après WaitForExit(), contrairement à `Start-Process -PassThru` (ExitCode vide
  # de façon intermittente une fois le process terminé, bug connu de la cmdlet).
  # Un antivirus/EDR local qui retient l'exécution d'un script fraîchement
  # téléchargé peut bloquer node.exe plusieurs minutes sans aucune sortie ni
  # activité CPU visible, avant de le laisser continuer normalement (voir
  # SKILL.md de update-harnais). Sans ce sondage, ce blocage est indiscernable
  # d'un install.ps1 qui a planté.
  function Format-NodeArg([string]$s) { '"{0}"' -f ($s -replace '"', '\"') }
  $argLine = (@($apply, '--source', $src, '--target', $target, '--commit', $sha) |
    ForEach-Object { Format-NodeArg $_ }) -join ' '

  $psi = [Diagnostics.ProcessStartInfo]::new('node', $argLine)
  $psi.UseShellExecute = $false
  $proc = [Diagnostics.Process]::Start($psi)
  $warnAfterSec = 60
  $warned = $false
  while (-not $proc.WaitForExit($warnAfterSec * 1000)) {
    if ($warned) { continue }
    $warned = $true
    Write-Warning (
      "L'installation semble bloquée depuis plus de $warnAfterSec s sans terminer, sans " +
      "sortie ni erreur. Ce n'est généralement pas une erreur d'apply.js mais un " +
      "antivirus/EDR local qui analyse les fichiers fraîchement téléchargés. Si ça " +
      "persiste, vous pouvez lancer directement (sans risque, la fusion est " +
      "idempotente) :`n  node `"$apply`" --source `"$src`" --target `"$target`" --commit $sha"
    )
  }
  if ($proc.ExitCode -ne 0) { throw "L'installation a échoué (code $($proc.ExitCode))." }
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
