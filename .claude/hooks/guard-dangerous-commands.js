#!/usr/bin/env node
/**
 * PreToolUse hook — bloque par exit code (2) une liste fermée de catégories de
 * commandes, avant qu'elles ne s'exécutent. Ce n'est pas une règle déclarative :
 * c'est un blocage déterministe qui s'applique même en mode auto-approve.
 * Le contournement n'est pas prévu côté Claude — si l'utilisateur veut vraiment
 * exécuter une commande bloquée, il le fait dans son propre terminal, hors
 * Claude Code.
 *
 * Catégories couvertes (V2) :
 *   1. Suppression récursive à large rayon d'action — rm, Remove-Item et ses
 *      alias PowerShell (ri/del/erase/rd/rmdir), rd|del /s de cmd.exe — quand la
 *      cible est la racine, le home (ou son 1er niveau), un disque entier, une
 *      variable d'environnement (expansion non vérifiable statiquement, cf. le
 *      bug Steam `rm -rf "$STEAMROOT/"*`), `.`, `..`, `*`, ou un chemin qui
 *      sort du projet (`../qqch`).
 *   2. Destruction de disque — mkfs, dd vers un device, diskpart, format,
 *      Format-Volume, Clear-Disk.
 *   3. Git destructif — push --force/--force-with-lease/-f/--mirror/--delete/
 *      +refspec/:refspec, reset --hard, clean -f, checkout/restore qui jettent
 *      toutes les modifications locales, filter-branch/filter-repo, stash clear.
 *   4. Exécution de code téléchargé — curl|wget pipé dans un shell,
 *      iex (iwr ...), DownloadString | iex, bash <(curl ...).
 *   5. Fichiers secrets via le shell — lecture (cat/type/Get-Content/grep/... sur
 *      .env, *.pem, *.key, id_rsa, .npmrc, secrets/...), exfiltration réseau
 *      (curl/scp/rsync/... avec un de ces fichiers dans la commande), et
 *      `git add` d'un de ces fichiers. Complète `permissions.deny` de
 *      settings.json, qui ne couvre que l'outil Read, pas Bash/PowerShell.
 *
 * Limites assumées (voulues, documentées dans CLAUDE.md) :
 *   - Un contournement volontaire via un interpréteur (`python -c "open('.env')"`)
 *     ou un script écrit sur disque puis exécuté n'est pas intercepté : ce hook
 *     couvre les chemins accidentels probables, la règle n°1 de CLAUDE.md reste
 *     la défense d'intention.
 *   - Payload stdin illisible => fail-open (exit 0) : un changement de format du
 *     harnais ne doit pas bricker tous les appels d'outil (ce qui pousserait à
 *     désactiver le hook entièrement — pire pour la sécurité).
 *   - Une commande mentionnant `.gitignore` est exemptée de la catégorie 5 :
 *     nécessaire pour vérifier légitimement que `.env` y figure bien.
 */

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

function stripQuotes(token) {
  return token.replace(/^["']+|["']+$/g, "");
}

// Découpe une commande composée en segments simples (approximatif : ne parse
// pas les quotes — suffisant pour un garde-fou anti-accident, pas anti-adversaire).
function segments(cmd) {
  return cmd.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
}

// Cible « large » pour une suppression récursive : racine, home, disque,
// variable en tête, dossier courant/parent, wildcard nu.
const BROAD_TARGET_RES = [
  /^\.{1,2}[\\/]?$/, // . .. ./ ../
  /^(\.[\\/])?\*$/, // * ./* .\*
  /^\.\.[\\/].+/, // ../qqch : sort du dossier courant
  /^~([\\/]\*?)?$/, // ~ ~/ ~/*
  /^~[\\/][^\\/]+[\\/]?\*?$/, // ~/Desktop, ~/foo/* (1er niveau du home)
  /^(\$\{?\w+\}?|%\w+%|\$env:\w+)([\\/].*)?$/i, // commence par une variable
  /^[\\/]\*?$/, // / /*
  /^[\\/][^\\/]+[\\/]?\*?$/, // /etc /tmp /var/*
  /^[\\/](home|Users)[\\/][^\\/]+[\\/]?\*?$/i, // /home/x /Users/x
  /^[A-Za-z]:([\\/]\*?)?$/, // C: C:\ C:\*
  /^[A-Za-z]:[\\/][^\\/]+[\\/]?\*?$/, // C:\Users C:\Windows
  /^[A-Za-z]:[\\/]users[\\/][^\\/]+[\\/]?\*?$/i, // C:\Users\hp
];

function isBroadTarget(rawToken) {
  const t = stripQuotes(rawToken);
  if (!t || t.startsWith("-")) return false;
  return BROAD_TARGET_RES.some((re) => re.test(t));
}

// rm avec -r ou -f sur une cible large (ou --no-preserve-root, ou cibles
// invisibles via xargs).
function rmBroad(cmd) {
  return segments(cmd).some((seg) => {
    const tokens = seg.split(/\s+/);
    const i = tokens.findIndex((t) => /^(rm|rm\.exe)$/i.test(stripQuotes(t)));
    if (i === -1) return false;
    const args = tokens.slice(i + 1);
    if (args.some((a) => /^--no-preserve-root$/i.test(a))) return true;
    const recursive = args.some((a) => /^-[a-z]*r/i.test(a) || /^--recursive$/i.test(a));
    const force = args.some((a) => /^-[a-z]*f/i.test(a) || /^--force$/i.test(a));
    if (!recursive && !force) return false;
    // rm récursif alimenté par xargs : cibles invisibles => non vérifiable.
    if (recursive && tokens.slice(0, i).some((t) => /^xargs$/i.test(t))) return true;
    return args.filter((a) => !a.startsWith("-")).some(isBroadTarget);
  });
}

// Remove-Item et alias PowerShell (-Recurse), ou rd|rmdir|del /s de cmd.exe,
// sur une cible large.
function removeItemBroad(cmd) {
  return segments(cmd).some((seg) => {
    const tokens = seg.split(/\s+/);
    const i = tokens.findIndex((t) =>
      /^(Remove-Item|ri|del|erase|rd|rmdir)(\.exe)?$/i.test(stripQuotes(t))
    );
    if (i === -1) return false;
    const args = tokens.slice(i + 1);
    const recurse =
      args.some((a) => /^-r[ecurs]*$/i.test(a)) || args.some((a) => /^\/s$/i.test(a));
    if (!recurse) return false;
    return args
      .filter((a) => !a.startsWith("-") && !/^\/[a-z](:.*)?$/i.test(a))
      .some(isBroadTarget);
  });
}

// Fichiers secrets — mêmes familles que permissions.deny dans settings.json.
// `.env.example|sample|template|dist` sont volontairement exclus (pas de secret).
const SECRET_FILE_RES = [
  /(^|[^\w.])\.env(?!\.(example|sample|template|dist)\b)(\.[\w-]+)?(?![\w.])/i,
  /(^|[^\w.])\.envrc(?![\w.])/i,
  /(^|[^\w.])\.npmrc(?![\w.])/i,
  /(^|[^\w.])\.netrc(?![\w.])/i,
  /(^|[^\w.])\.pgpass(?![\w.])/i,
  /\.git-credentials(?![\w.])/i,
  /\bid_(rsa|dsa|ecdsa|ed25519)\b/i,
  /\.(pem|pfx|p12|jks|keystore|tfstate)(?![\w.])/i,
  /\.key(?![\w.])/i,
  /\bcredentials?\.(json|ya?ml|xml|txt|csv|ini)\b/i,
  /\.(aws|ssh|kube|gnupg|docker)[\\/][\w.-]+/i,
  /\bsecrets?[\\/]/i,
];

function mentionsSecretFile(cmd) {
  // Exemption : vérifier/compléter .gitignore doit rester possible.
  if (/\.gitignore\b/i.test(cmd)) return false;
  return SECRET_FILE_RES.some((re) => re.test(cmd));
}

const READ_CMD_RE =
  /(^|[|&;(]\s*|\b(sudo|xargs)\s+)(cat|type|more|less|head|tail|bat|nl|tac|strings|xxd|od|hexdump|base64|grep|egrep|fgrep|rg|sed|awk|cut|findstr|gc|Get-Content|Select-String|sls|Import-Csv)(\.exe)?\b/i;

const NET_CMD_RE =
  /(^|[|&;(]\s*|\b(sudo)\s+)(curl|wget|scp|sftp|rsync|nc|ncat|socat|ftp|aws|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|Send-MailMessage)(\.exe)?\b/i;

// ---------------------------------------------------------------------------
// Règles (nom affiché + prédicat)
// ---------------------------------------------------------------------------

const RULES = [
  {
    name: "rm récursif/forcé à large rayon d'action (racine, home, variable, disque, ., *)",
    test: rmBroad,
  },
  {
    name: "Remove-Item/rd/del récursif sur une cible large (PowerShell/cmd)",
    test: removeItemBroad,
  },
  {
    name: "destruction de disque (mkfs, dd vers un device, diskpart, format, Format-Volume, Clear-Disk)",
    test: (cmd) =>
      /\b(mkfs(\.\w+)?|diskpart|Format-Volume|Clear-Disk|Initialize-Disk)\b/i.test(cmd) ||
      /\bdd\b[^|;&]*\bof=[\\/]dev[\\/]/i.test(cmd) ||
      /(^|[\s;|&])format(\.com)?\s+[a-z]:/i.test(cmd),
  },
  {
    name: "git push destructif (--force, --force-with-lease, -f, --mirror, --delete, +refspec, :refspec)",
    test: (cmd) =>
      /\bgit\s+push\b/i.test(cmd) &&
      (/--force(-with-lease)?\b/i.test(cmd) ||
        /(^|\s)-f(\s|$)/i.test(cmd) ||
        /--mirror\b/i.test(cmd) ||
        /--delete\b/i.test(cmd) ||
        /\s\+[\w./-]+/.test(cmd) ||
        /\s:[\w./-]+/.test(cmd)),
  },
  {
    name: "git reset --hard",
    test: (cmd) => /\bgit\s+reset\b/i.test(cmd) && /--hard\b/i.test(cmd),
  },
  {
    name: "git clean -f (suppression forcée de fichiers non suivis)",
    test: (cmd) =>
      /\bgit\s+clean\b/i.test(cmd) && /(^|\s)-[a-z]*f[a-z]*(\s|$)|--force\b/i.test(cmd),
  },
  {
    name: "git checkout/restore qui jette toutes les modifications locales",
    test: (cmd) => {
      if (/\bgit\s+checkout\b[^|;&\n]*(\s--\s+\.|\s\.)(\s|$)/i.test(cmd)) return true;
      if (!/\bgit\s+restore\b/i.test(cmd)) return false;
      const staged = /--staged\b|\s-S\b/.test(cmd);
      const worktree = /--worktree\b|\s-W\b/.test(cmd);
      if (staged && !worktree) return false; // unstage seul : non destructif
      return /\s(\.|\*|:\/)(\s|$)/.test(cmd);
    },
  },
  {
    name: "réécriture d'historique git (filter-branch / filter-repo)",
    test: (cmd) => /\bgit\s+(filter-branch|filter-repo)\b/i.test(cmd),
  },
  {
    name: "git stash clear (perte de tous les stashes)",
    test: (cmd) => /\bgit\s+stash\s+clear\b/i.test(cmd),
  },
  {
    name: "exécution de code téléchargé (curl|wget pipé dans un shell, iex+téléchargement)",
    test: (cmd) =>
      /\|\s*(sudo\s+)?(ba|da|z|k|fi)?sh(\s|$)/i.test(cmd) ||
      /\|\s*(sudo\s+)?(pwsh|powershell(\.exe)?|cmd(\.exe)?)(\s|$)/i.test(cmd) ||
      /\|\s*(node|python\d*|perl|ruby)(\s+-)?\s*$/i.test(cmd) ||
      /\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient)\b[\s\S]*\|\s*(iex|invoke-expression)\b/i.test(cmd) ||
      /\b(iex|invoke-expression)\b[\s\S]*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient)\b/i.test(cmd) ||
      /\b(ba|da|z|k)?sh\s+<\(\s*(curl|wget)\b/i.test(cmd) ||
      /\b(ba|da|z|k)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/i.test(cmd),
  },
  {
    name: "lecture d'un fichier secret via le shell (contourne permissions.deny)",
    test: (cmd) => READ_CMD_RE.test(cmd) && mentionsSecretFile(cmd),
  },
  {
    name: "exfiltration réseau d'un fichier secret",
    test: (cmd) => NET_CMD_RE.test(cmd) && mentionsSecretFile(cmd),
  },
  {
    name: "git add d'un fichier secret",
    test: (cmd) => /\bgit\s+add\b/i.test(cmd) && mentionsSecretFile(cmd),
  },
];

// ---------------------------------------------------------------------------
// Entrée/sortie du hook
// ---------------------------------------------------------------------------

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    // Payload illisible : on ne bloque pas sur une erreur de parsing, on
    // laisse passer plutôt que de casser tous les appels d'outil.
    process.exit(0);
  }

  const command = (payload.tool_input && payload.tool_input.command) || "";

  if (!command) {
    process.exit(0);
  }

  for (const rule of RULES) {
    if (rule.test(command)) {
      process.stderr.write(
        `[guard-dangerous-commands] Commande bloquée : ${rule.name}\n` +
          `Commande interceptée : ${command}\n` +
          `Cette catégorie de commande est bloquée sans exception par le socle ` +
          `(voir CLAUDE.md, règle n°2). Si tu as vraiment besoin de l'exécuter, ` +
          `fais-le toi-même dans ton propre terminal, hors Claude Code.\n`
      );
      process.exit(2);
    }
  }

  process.exit(0);
}

main();
