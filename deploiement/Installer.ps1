<#
.SYNOPSIS
    Installation du Registre RH AIFG sur Windows Server 2025.

.DESCRIPTION
    Installe et configure : Node.js, PostgreSQL, le service Windows de l'API,
    IIS en proxy inverse avec HTTPS, le pare-feu et la sauvegarde quotidienne.

.EXAMPLE
    .\Installer.ps1 -Domaine "rh.aifg.dz" -Email "informatique@aifg.dz"

.NOTES
    À exécuter dans une console PowerShell OUVERTE EN ADMINISTRATEUR,
    depuis le dossier racine du projet (celui qui contient serveur\ et client\).
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Domaine,
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$Racine = "C:\AIFG-RH",
    [int]$Port = 3001,
    [switch]$SansHttps   # pour un serveur interne sans nom de domaine public
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Etape($n, $texte) { Write-Host "`n=== $n. $texte ===" -ForegroundColor Cyan }
function Info($t) { Write-Host "  $t" -ForegroundColor Gray }
function Succes($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Avertir($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être exécuté en tant qu'administrateur."
}

function MotDePasseAleatoire([int]$longueur = 20) {
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    -join (1..$longueur | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
}

# ---------------------------------------------------------------
Etape 1 "Vérification des prérequis"
# ---------------------------------------------------------------
$sourceProjet = $PSScriptRoot | Split-Path -Parent
if (-not (Test-Path (Join-Path $sourceProjet "serveur\package.json"))) {
    throw "Lancez ce script depuis le dossier deploiement\ du projet décompressé."
}
Succes "Projet trouvé : $sourceProjet"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Avertir "winget est absent. Installez Node.js 22 LTS et PostgreSQL 16 manuellement, puis relancez."
}

# ---------------------------------------------------------------
Etape 2 "Node.js 22 LTS"
# ---------------------------------------------------------------
if (Get-Command node -ErrorAction SilentlyContinue) {
    Succes "Node.js déjà présent : $(node --version)"
} else {
    Info "Installation de Node.js…"
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    Succes "Node.js installé : $(node --version)"
}

# ---------------------------------------------------------------
Etape 3 "PostgreSQL 16"
# ---------------------------------------------------------------
$serviceSql = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $serviceSql) {
    Info "Installation de PostgreSQL (cela peut prendre plusieurs minutes)…"
    $mdpSuperUtilisateur = MotDePasseAleatoire 24
    winget install --id PostgreSQL.PostgreSQL.16 --silent --accept-source-agreements `
        --custom "--superpassword `"$mdpSuperUtilisateur`" --enable_acledit 1"
    Start-Sleep -Seconds 25
    $serviceSql = Get-Service -Name "postgresql*" | Select-Object -First 1
    Write-Host "  Mot de passe du superutilisateur postgres : $mdpSuperUtilisateur" -ForegroundColor Yellow
    Write-Host "  >>> NOTEZ-LE MAINTENANT dans votre coffre-fort de mots de passe." -ForegroundColor Yellow
}
if ($serviceSql.Status -ne "Running") { Start-Service $serviceSql.Name }
Set-Service -Name $serviceSql.Name -StartupType Automatic
Succes "PostgreSQL en service : $($serviceSql.Name)"

$psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
if (-not $psql) { throw "psql.exe introuvable. Vérifiez l'installation de PostgreSQL." }
$binSql = Split-Path $psql.FullName

# ---------------------------------------------------------------
Etape 4 "Base de données"
# ---------------------------------------------------------------
$mdpBase = MotDePasseAleatoire 24
Info "Le mot de passe du superutilisateur 'postgres' est demande pour creer la base."
Info "(c'est celui defini a l'installation de PostgreSQL, note plus haut si elle vient d'avoir lieu)"
$secure = Read-Host "  Mot de passe 'postgres'" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
try { & $psql.FullName -U postgres -h localhost -c "SELECT 1" 2>&1 | Out-Null }
catch { throw "Connexion a PostgreSQL impossible : verifiez le mot de passe 'postgres'." }

& $psql.FullName -U postgres -h localhost -c "DROP DATABASE IF EXISTS aifg_rh;" 2>&1 | Out-Null
& $psql.FullName -U postgres -h localhost -c "DROP ROLE IF EXISTS aifg;" 2>&1 | Out-Null
& $psql.FullName -U postgres -h localhost -c "CREATE ROLE aifg WITH LOGIN PASSWORD '$mdpBase';"
& $psql.FullName -U postgres -h localhost -c "CREATE DATABASE aifg_rh OWNER aifg ENCODING 'UTF8';"
& $psql.FullName -U postgres -h localhost -c "ALTER DATABASE aifg_rh SET timezone TO 'Africa/Algiers';"
Succes "Base aifg_rh creee (fuseau Africa/Algiers)"

# ---------------------------------------------------------------
Etape 5 "Copie de l'application"
# ---------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $Racine, "$Racine\logs", "$Racine\sauvegardes" | Out-Null
Copy-Item "$sourceProjet\serveur" -Destination $Racine -Recurse -Force
Copy-Item "$sourceProjet\deploiement" -Destination $Racine -Recurse -Force
if (Test-Path "$sourceProjet\client\dist") {
    New-Item -ItemType Directory -Force -Path "$Racine\serveur\public" | Out-Null
    Copy-Item "$sourceProjet\client\dist\*" -Destination "$Racine\serveur\public" -Recurse -Force
    Succes "Interface web copiée"
} else {
    Avertir "client\dist absent : construisez l'interface (pnpm build) puis copiez-la dans $Racine\serveur\public"
}

Push-Location "$Racine\serveur"
Info "Installation des dépendances (npm ci)…"
& npm ci --omit=dev 2>&1 | Out-Null
Succes "Dépendances installées"

# ---------------------------------------------------------------
Etape 6 "Configuration (.env)"
# ---------------------------------------------------------------
$secretJwt = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$secretRaf = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$mdpRh  = MotDePasseAleatoire 14
$mdpDir = MotDePasseAleatoire 14
$schema = if ($SansHttps) { "http" } else { "https" }

@"
NODE_ENV=production
PORT=$Port
HOTE=127.0.0.1
DATABASE_URL=postgresql://aifg:$mdpBase@localhost:5432/aifg_rh
JWT_SECRET=$secretJwt
JWT_SECRET_RAFRAICHISSEMENT=$secretRaf
JWT_DUREE=8h
ORIGINE_FRONTEND=$schema`://$Domaine
EMAIL_RH=rh@aifg.dz
MDP_INITIAL_RH=$mdpRh
MDP_INITIAL_DIRECTION=$mdpDir

# E-mail automatique (vide = liens mailto préparés)
SMTP_HOTE=
SMTP_PORT=587
SMTP_SECURISE=false
SMTP_UTILISATEUR=
SMTP_MDP=
SMTP_EXPEDITEUR=rh@aifg.dz

# WhatsApp Business Cloud API (vide = liens wa.me préparés)
WHATSAPP_TOKEN=
WHATSAPP_TELEPHONE_ID=

# Interface web compilee (vide = serveur\public)
DOSSIER_CLIENT=

# Pieces jointes : photos, contrats signes, certificats.
# CE DOSSIER DOIT ETRE SAUVEGARDE (Sauvegarde.ps1 s'en charge).
DOSSIER_FICHIERS=$Racine\serveur\fichiers
TAILLE_MAX_FICHIER=10485760
"@ | ForEach-Object {
    # UTF-8 SANS BOM : PowerShell 5.1 ajoute un BOM avec -Encoding UTF8,
    # ce qui casserait la lecture de la premiere variable du fichier .env.
    [System.IO.File]::WriteAllText("$Racine\serveur\.env", $_, (New-Object System.Text.UTF8Encoding($false)))
}

# Le fichier .env contient les secrets : accès restreint aux administrateurs et au service.
$acl = Get-Acl "$Racine\serveur\.env"
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    "BUILTIN\Administrators", "FullControl", "Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    "NT AUTHORITY\NETWORK SERVICE", "Read", "Allow")))
Set-Acl "$Racine\serveur\.env" $acl
Succes "Configuration écrite et protégée"

# ---------------------------------------------------------------
Etape 7 "Migration de la base"
# ---------------------------------------------------------------
Get-Content "$Racine\serveur\.env" | Where-Object { $_ -match '^\s*([^#][^=]*)=(.*)$' } | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)=(.*)$') { Set-Item -Path "env:$($Matches[1].Trim())" -Value $Matches[2].Trim() }
}
& node src\lib\migrate.js
Succes "Schéma et données initiales en place"
Pop-Location

# ---------------------------------------------------------------
Etape 8 "Service Windows"
# ---------------------------------------------------------------
Info "Installation du gestionnaire de service (NSSM)…"
$nssmExe = "$Racine\nssm.exe"
# Si le serveur n'a pas d'acces Internet, deposez nssm.exe dans deploiement\outils\ au prealable.
$nssmLocal = Join-Path $PSScriptRoot "outils\nssm.exe"
if (Test-Path $nssmLocal) { Copy-Item $nssmLocal $nssmExe -Force }
if (-not (Test-Path $nssmExe)) {
    $zip = "$env:TEMP\nssm.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath "$env:TEMP\nssm" -Force
    Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" $nssmExe -Force
}

$nomService = "AIFG-RH"
& $nssmExe stop $nomService 2>&1 | Out-Null
& $nssmExe remove $nomService confirm 2>&1 | Out-Null
$nodeExe = (Get-Command node).Source
& $nssmExe install $nomService $nodeExe "src\index.js"
& $nssmExe set $nomService AppDirectory "$Racine\serveur"
& $nssmExe set $nomService DisplayName "Registre RH AIFG"
& $nssmExe set $nomService Description "API du Registre RH AIFG (Node.js + PostgreSQL)"
& $nssmExe set $nomService Start SERVICE_AUTO_START
& $nssmExe set $nomService ObjectName "NT AUTHORITY\NetworkService"
& $nssmExe set $nomService AppStdout "$Racine\logs\serveur.log"
& $nssmExe set $nomService AppStderr "$Racine\logs\erreurs.log"
& $nssmExe set $nomService AppRotateFiles 1
& $nssmExe set $nomService AppRotateBytes 10485760      # rotation à 10 Mo
& $nssmExe set $nomService AppStopMethodConsole 15000   # arrêt propre : 15 s
& $nssmExe set $nomService AppExit Default Restart
& $nssmExe set $nomService AppRestartDelay 5000
& $nssmExe set $nomService DependOnService $serviceSql.Name
# Fuseau horaire explicite : sans cela, les dates de pointage suivraient l'heure UTC
# du serveur et non l'heure algerienne (UTC+1).
& $nssmExe set $nomService AppEnvironmentExtra "TZ=Africa/Algiers" "NODE_ENV=production"

# Dossier des pieces jointes : accessible en ecriture au service, jamais expose par le web.
New-Item -ItemType Directory -Force -Path "$Racine\serveur\fichiers" | Out-Null
icacls "$Racine\serveur\fichiers" /inheritance:r /grant "BUILTIN\Administrators:(OI)(CI)F" "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M" | Out-Null
icacls "$Racine\logs" /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)M" | Out-Null
icacls "$Racine\serveur" /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)RX" | Out-Null

Start-Service $nomService
Start-Sleep -Seconds 6
$sante = try { Invoke-RestMethod "http://127.0.0.1:$Port/api/sante" -TimeoutSec 10 } catch { $null }
if ($sante.ok) { Succes "Service démarré — base $($sante.base), version $($sante.version)" }
else { Avertir "Le service ne répond pas encore. Consultez $Racine\logs\erreurs.log" }

# ---------------------------------------------------------------
Etape 9 "IIS en proxy inverse"
# ---------------------------------------------------------------
Info "Activation d'IIS…"
Install-WindowsFeature -Name Web-Server, Web-Http-Redirect, Web-Mgmt-Console `
    -IncludeManagementTools -WarningAction SilentlyContinue | Out-Null
Import-Module WebAdministration

foreach ($m in @(
    @{ Nom = "URL Rewrite";       Url = "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi" },
    @{ Nom = "ARR";               Url = "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi" })) {
    Info "Installation du module IIS : $($m.Nom)…"
    $msi = "$env:TEMP\$($m.Nom -replace ' ','_').msi"
    try {
        Invoke-WebRequest -Uri $m.Url -OutFile $msi -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait
    } catch { Avertir "Téléchargement de $($m.Nom) impossible — installez-le manuellement depuis iis.net" }
}

# Activation du proxy ARR
& "$env:SystemRoot\System32\inetsrv\appcmd.exe" set config -section:system.webServer/proxy `
    /enabled:"True" /preserveHostHeader:"True" /reverseRewriteHostInResponseHeaders:"False" /commit:apphost | Out-Null

$siteChemin = "$Racine\site"
New-Item -ItemType Directory -Force -Path $siteChemin | Out-Null
Copy-Item "$Racine\deploiement\web.config" "$siteChemin\web.config" -Force
(Get-Content "$siteChemin\web.config") -replace 'PORT_API', $Port | Set-Content "$siteChemin\web.config"

# IMPORTANT : on ne touche JAMAIS aux sites deja heberges sur ce serveur.
# Le site AIFG-RH cohabite grace a son en-tete d hote (host header).
$sitesExistants = Get-Website | Where-Object { $_.Name -ne "AIFG-RH" }
if ($sitesExistants) {
    Info "Sites deja presents (ils ne seront pas modifies) :"
    $sitesExistants | ForEach-Object { Info "   - $($_.Name) [$($_.State)]" }
    & "$env:SystemRoot\System32\inetsrv\appcmd.exe" add backup "avant-aifg-rh-$(Get-Date -Format yyyyMMdd-HHmmss)" | Out-Null
    Succes "Sauvegarde de la configuration IIS effectuee"
}
if (Get-Website -Name "AIFG-RH" -ErrorAction SilentlyContinue) { Remove-Website -Name "AIFG-RH" }
if (Test-Path "IIS:\AppPools\AIFG-RH") { Remove-WebAppPool "AIFG-RH" }
New-WebAppPool -Name "AIFG-RH" | Out-Null
Set-ItemProperty "IIS:\AppPools\AIFG-RH" -Name managedRuntimeVersion -Value ""
New-Website -Name "AIFG-RH" -Port 80 -HostHeader $Domaine -PhysicalPath $siteChemin -ApplicationPool "AIFG-RH" -Force | Out-Null
Start-Website -Name "AIFG-RH" -ErrorAction SilentlyContinue
Succes "Site IIS cree (proxy vers 127.0.0.1:$Port), vos autres sites sont inchanges"

# Controle de non-regression : tous les sites qui tournaient avant doivent toujours tourner.
foreach ($s0 in $sitesExistants) {
    $apres = Get-Website -Name $s0.Name -ErrorAction SilentlyContinue
    if ($s0.State -eq "Started" -and $apres.State -ne "Started") {
        Avertir "Le site « $($s0.Name) » n est plus demarre — redemarrage…"
        Start-Website -Name $s0.Name
    }
}
Succes "Verification : les sites existants fonctionnent toujours"

# ---------------------------------------------------------------
Etape 10 "HTTPS"
# ---------------------------------------------------------------
if ($SansHttps) {
    Avertir "HTTPS ignoré (-SansHttps). N'utilisez ce mode QUE sur un réseau interne isolé."
} else {
    Info "Obtention du certificat via win-acme (Let's Encrypt)…"
    $wacsDossier = "$Racine\win-acme"
    if (-not (Test-Path "$wacsDossier\wacs.exe")) {
        New-Item -ItemType Directory -Force -Path $wacsDossier | Out-Null
        $zip = "$env:TEMP\wacs.zip"
        Invoke-WebRequest -Uri "https://github.com/win-acme/win-acme/releases/download/v2.2.9.1701/win-acme.v2.2.9.1701.x64.pluggable.zip" -OutFile $zip
        Expand-Archive $zip -DestinationPath $wacsDossier -Force
    }
    try {
        # --sslport 443 + SNI : indispensable pour partager le port 443 avec vos autres sites.
        & "$wacsDossier\wacs.exe" --target manual --host $Domaine `
            --validation filesystem --webroot $siteChemin `
            --installation iis --installationsiteid (Get-Website "AIFG-RH").Id `
            --emailaddress $Email --accepttos
        Start-Sleep -Seconds 3

        # Verification : la liaison HTTPS doit exister AVEC le drapeau SNI (valeur 1).
        $liaisonSsl = Get-WebBinding -Name "AIFG-RH" -Protocol https -ErrorAction SilentlyContinue
        if ($liaisonSsl) {
            $sni = $liaisonSsl.sslFlags
            if ($sni -ne 1) {
                Info "Activation du SNI sur la liaison HTTPS…"
                $liaisonSsl.sslFlags = 1
                $liaisonSsl | Set-WebBinding -PropertyName sslFlags -Value 1 -ErrorAction SilentlyContinue
            }
            Succes "Certificat HTTPS installe avec SNI (vos autres sites HTTPS restent intacts)"
        } else {
            Avertir "Liaison HTTPS non creee. Verifiez que $Domaine est joignable depuis Internet sur le port 80."
        }
    } catch {
        Avertir "Certificat non obtenu : $_"
        Avertir "Verifiez que $Domaine pointe vers ce serveur et que le port 80 est joignable depuis Internet."
    }
}

# ---------------------------------------------------------------
Etape 11 "Pare-feu"
# ---------------------------------------------------------------
Get-NetFirewallRule -DisplayName "AIFG-RH*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
# Les ports 80/443 sont deja ouverts pour votre site existant : on ne les retouche pas.
Info "Ports 80/443 : deja ouverts pour vos sites — aucune modification"
# L'API et PostgreSQL ne doivent JAMAIS être joignables depuis l'extérieur.
New-NetFirewallRule -DisplayName "AIFG-RH API (bloque l'exterieur)" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Block -RemoteAddress Internet | Out-Null
New-NetFirewallRule -DisplayName "AIFG-RH PostgreSQL (bloque l'exterieur)" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Block -RemoteAddress Internet | Out-Null
Succes "Règles de pare-feu appliquées"

# ---------------------------------------------------------------
Etape 12 "Sauvegarde quotidienne"
# ---------------------------------------------------------------
Copy-Item "$Racine\deploiement\Sauvegarde.ps1" "$Racine\Sauvegarde.ps1" -Force
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Racine\Sauvegarde.ps1`" -Racine `"$Racine`" -BinSql `"$binSql`""
$declencheur = New-ScheduledTaskTrigger -Daily -At 2am
$parametres = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
Register-ScheduledTask -TaskName "AIFG-RH Sauvegarde" -Action $action -Trigger $declencheur `
    -Settings $parametres -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Succes "Sauvegarde planifiée tous les jours à 02h00"

# ---------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " INSTALLATION TERMINÉE" -ForegroundColor Green
# Verification finale : le service repond-il reellement a travers IIS ?
$verif = try { Invoke-WebRequest "http://127.0.0.1/api/sante" -Headers @{Host=$Domaine} -TimeoutSec 10 -UseBasicParsing } catch { $null }
if ($verif -and $verif.StatusCode -eq 200) { Succes "Chaine complete verifiee : IIS -> API -> PostgreSQL" }
else { Avertir "IIS ne relaie pas encore l API. Verifiez que les modules URL Rewrite et ARR sont installes." }

Write-Host "============================================================" -ForegroundColor Green
Write-Host " Adresse    : $schema`://$Domaine"
Write-Host " Service    : $nomService  (Get-Service $nomService)"
Write-Host " Journaux   : $Racine\logs\"
Write-Host " Sauvegardes: $Racine\sauvegardes\"
Write-Host ""
Write-Host " IDENTIFIANTS INITIAUX (à changer dès la première connexion) :" -ForegroundColor Yellow
Write-Host "   RH        : rh@aifg.dz        / $mdpRh" -ForegroundColor Yellow
Write-Host "   Direction : direction@aifg.dz / $mdpDir" -ForegroundColor Yellow
Write-Host ""
Write-Host " Notez-les dans votre coffre-fort, puis effacez cet écran (Clear-Host)." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
