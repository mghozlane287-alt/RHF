<#
.SYNOPSIS
    Vérification AVANT installation : contrôle que le Registre RH peut cohabiter
    avec vos sites IIS existants sans rien casser.

.DESCRIPTION
    Ce script ne modifie RIEN. Il vérifie :
      - les sites IIS déjà présents et leurs liaisons (bindings) ;
      - qu'aucun conflit de port ou d'en-tête d'hôte n'existe ;
      - que le sous-domaine pointe bien vers ce serveur ;
      - que les modules IIS nécessaires sont là ;
      - que le port de l'API est libre.
    Lancez-le d'abord, corrigez ce qu'il signale, puis lancez Installer.ps1.

.EXAMPLE
    .\Verifier-Coexistence.ps1 -Domaine "rh.sarlaifg.dz"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Domaine,
    [int]$Port = 3001
)

$ErrorActionPreference = "Continue"
function Titre($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  [OK]      $t" -ForegroundColor Green }
function Att($t)   { Write-Host "  [ATTENTION] $t" -ForegroundColor Yellow }
function Ko($t)    { Write-Host "  [BLOQUANT]  $t" -ForegroundColor Red }

$bloquants = 0
$avertissements = 0

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Ko "Ouvrez PowerShell en tant qu'administrateur."; exit 1
}

Import-Module WebAdministration -ErrorAction SilentlyContinue

# ---------------------------------------------------------------
Titre "1. Sites IIS déjà hébergés (ils ne seront pas modifiés)"
# ---------------------------------------------------------------
$sites = Get-Website
if (-not $sites) { Att "Aucun site IIS trouvé. Est-ce bien le serveur qui héberge sarlaifg.dz ?"; $avertissements++ }
foreach ($s in $sites) {
    Write-Host "  • $($s.Name)  [$($s.State)]  -> $($s.PhysicalPath)" -ForegroundColor Gray
    foreach ($b in $s.Bindings.Collection) {
        Write-Host "      liaison : $($b.protocol) $($b.bindingInformation)" -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------
Titre "2. Conflit d'en-tête d'hôte"
# ---------------------------------------------------------------
$conflit = $false
foreach ($s in $sites) {
    foreach ($b in $s.Bindings.Collection) {
        $hote = ($b.bindingInformation -split ':')[2]
        if ($hote -eq $Domaine) { $conflit = $true; Ko "Le domaine $Domaine est déjà utilisé par le site « $($s.Name) »." }
        if ([string]::IsNullOrEmpty($hote) -and $b.protocol -eq 'http') {
            Att "Le site « $($s.Name) » écoute sur le port 80 SANS en-tête d'hôte (toutes les adresses)."
            Write-Host "         Cela n'empêche pas la cohabitation : IIS donne la priorité à la liaison" -ForegroundColor DarkGray
            Write-Host "         qui correspond exactement à $Domaine. Aucune action requise." -ForegroundColor DarkGray
            $avertissements++
        }
    }
}
if ($conflit) { $bloquants++ } else { Ok "Aucun conflit : $Domaine est libre." }

# ---------------------------------------------------------------
Titre "3. Résolution DNS de $Domaine"
# ---------------------------------------------------------------
$ipPublique = try { (Invoke-RestMethod "https://api.ipify.org?format=json" -TimeoutSec 10).ip } catch { $null }
if ($ipPublique) { Write-Host "  Adresse publique de ce serveur : $ipPublique" -ForegroundColor Gray }

$resolution = try { (Resolve-DnsName $Domaine -Type A -ErrorAction Stop).IPAddress } catch { $null }
if (-not $resolution) {
    Ko "$Domaine ne résout pas encore."
    Write-Host "         >>> Ajoutez chez votre registrar un enregistrement :" -ForegroundColor Yellow
    Write-Host "             Type A   Nom: rh   Valeur: $ipPublique   TTL: 3600" -ForegroundColor Yellow
    Write-Host "             (gratuit, propagation de quelques minutes à 24 h)" -ForegroundColor Yellow
    $bloquants++
} elseif ($ipPublique -and ($resolution -notcontains $ipPublique)) {
    Ko "$Domaine pointe vers $resolution au lieu de $ipPublique."
    $bloquants++
} else {
    Ok "$Domaine pointe bien vers ce serveur ($resolution)."
}

# ---------------------------------------------------------------
Titre "4. Certificat du site existant (il ne sera pas touché)"
# ---------------------------------------------------------------
$certs = Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue
if ($certs) {
    foreach ($c in $certs) {
        $reste = ($c.NotAfter - (Get-Date)).Days
        $couleur = if ($reste -lt 20) { "Yellow" } else { "Gray" }
        Write-Host "  • $($c.Subject) — expire dans $reste jours" -ForegroundColor $couleur
    }
    Ok "Le Registre RH obtiendra SON PROPRE certificat, sans modifier les vôtres (SNI)."
} else { Att "Aucun certificat trouvé dans le magasin local."; $avertissements++ }

# ---------------------------------------------------------------
Titre "5. Modules IIS nécessaires"
# ---------------------------------------------------------------
$rewrite = Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll"
$arr     = Test-Path "$env:ProgramFiles\IIS\Application Request Routing\requestRouter.dll"
if ($rewrite) { Ok "URL Rewrite est installé." }
else { Att "URL Rewrite absent — Installer.ps1 le téléchargera (redémarrage IIS de quelques secondes)."; $avertissements++ }
if ($arr) { Ok "Application Request Routing (ARR) est installé." }
else { Att "ARR absent — Installer.ps1 le téléchargera (redémarrage IIS de quelques secondes)."; $avertissements++ }

if ($rewrite -and $arr) {
    $proxy = & "$env:SystemRoot\System32\inetsrv\appcmd.exe" list config -section:system.webServer/proxy 2>$null
    if ($proxy -match 'enabled="true"') { Ok "Le proxy ARR est déjà activé (sans effet sur vos sites actuels)." }
    else { Write-Host "  Le proxy ARR sera activé — cela n'ajoute aucune règle à vos sites existants." -ForegroundColor Gray }
}

# ---------------------------------------------------------------
Titre "6. Port interne de l'API ($Port)"
# ---------------------------------------------------------------
$occupe = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($occupe) {
    $proc = (Get-Process -Id $occupe[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Ko "Le port $Port est déjà utilisé par « $proc ». Relancez avec -Port 3002."
    $bloquants++
} else { Ok "Le port $Port est libre." }

# ---------------------------------------------------------------
Titre "7. Ports publics"
# ---------------------------------------------------------------
foreach ($p in 80, 443) {
    $regle = Get-NetFirewallRule -Enabled True -Direction Inbound -ErrorAction SilentlyContinue |
        Where-Object { ($_ | Get-NetFirewallPortFilter).LocalPort -eq $p }
    if ($regle) { Ok "Port $p autorisé dans le pare-feu Windows." }
    else { Att "Aucune règle explicite pour le port $p (peut-être ouvert autrement)."; $avertissements++ }
}

# ---------------------------------------------------------------
Titre "8. Ressources disponibles"
# ---------------------------------------------------------------
$ram = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)
$disque = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
if ($ram -lt 1) { Att "Seulement $ram Go de RAM libre — l'API + PostgreSQL demandent ~1 Go."; $avertissements++ }
else { Ok "$ram Go de RAM libre." }
if ($disque -lt 10) { Att "Seulement $disque Go libres sur C: (base + sauvegardes)."; $avertissements++ }
else { Ok "$disque Go libres sur C:." }

# ---------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Cyan
if ($bloquants -eq 0) {
    Write-Host " PRÊT POUR L'INSTALLATION" -ForegroundColor Green
    Write-Host " $avertissements avertissement(s) — aucun n'empêche l'installation." -ForegroundColor Gray
    Write-Host ""
    Write-Host " Commande suivante :" -ForegroundColor Cyan
    Write-Host "   .\Installer.ps1 -Domaine `"$Domaine`" -Email `"votre@email.dz`" -Port $Port" -ForegroundColor White
} else {
    Write-Host " $bloquants POINT(S) BLOQUANT(S) — corrigez-les avant d'installer." -ForegroundColor Red
}
Write-Host "============================================================" -ForegroundColor Cyan
exit $bloquants
