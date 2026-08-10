<#
.SYNOPSIS
    Sauvegarde quotidienne de la base Registre RH AIFG.
.DESCRIPTION
    Exécutée par la tâche planifiée « AIFG-RH Sauvegarde » tous les jours à 02h00.
    Conserve 30 jours de sauvegardes compressées et vérifie que le fichier n'est pas vide.
.EXAMPLE
    .\Sauvegarde.ps1 -Racine "C:\AIFG-RH" -BinSql "C:\Program Files\PostgreSQL\16\bin"
#>
param(
    [string]$Racine = "C:\AIFG-RH",
    [string]$BinSql = "C:\Program Files\PostgreSQL\16\bin",
    [int]$Retention = 30
)

$ErrorActionPreference = "Stop"
$dossier = Join-Path $Racine "sauvegardes"
$journal = Join-Path $Racine "logs\sauvegarde.log"
New-Item -ItemType Directory -Force -Path $dossier, (Split-Path $journal) | Out-Null

function Noter($texte) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texte" | Tee-Object -FilePath $journal -Append
}

try {
    # Mot de passe lu depuis .env : jamais écrit en clair ailleurs.
    $env:PGPASSWORD = (Select-String -Path (Join-Path $Racine "serveur\.env") -Pattern '^DATABASE_URL=' |
        ForEach-Object { $_.Line }) -replace '.*://aifg:([^@]+)@.*', '$1'

    $horodatage = Get-Date -Format "yyyyMMdd_HHmm"
    $sql = Join-Path $dossier "aifg_rh_$horodatage.sql"

    & "$BinSql\pg_dump.exe" -U aifg -h localhost -d aifg_rh -f $sql --encoding=UTF8
    if (-not (Test-Path $sql) -or (Get-Item $sql).Length -lt 1024) {
        throw "Sauvegarde vide ou absente — vérifiez l'accès à la base."
    }

    Compress-Archive -Path $sql -DestinationPath "$sql.zip" -Force
    Remove-Item $sql -Force
    Noter "Base sauvegardee : $sql.zip ($([math]::Round((Get-Item "$sql.zip").Length / 1KB)) Ko)"

    # IMPORTANT : les pieces jointes (photos, contrats signes, certificats) vivent sur le
    # disque, PAS dans la base. Une sauvegarde de la base seule ne suffit donc pas :
    # on archive aussi le dossier des fichiers.
    $dossierFichiers = Join-Path $Racine "serveur\fichiers"
    if (Test-Path $dossierFichiers) {
        $archiveFichiers = Join-Path $dossier "fichiers_$horodatage.zip"
        Compress-Archive -Path "$dossierFichiers\*" -DestinationPath $archiveFichiers -Force
        Noter "Pieces jointes sauvegardees : $archiveFichiers ($([math]::Round((Get-Item $archiveFichiers).Length / 1MB, 1)) Mo)"
    } else {
        Noter "Aucun dossier de pieces jointes a sauvegarder."
    }

    Get-ChildItem $dossier -Filter "*.zip" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Retention) } |
        ForEach-Object { Remove-Item $_.FullName -Force; Noter "Ancienne sauvegarde supprimee : $($_.Name)" }
}
catch {
    Noter "ECHEC : $_"
    # Trace dans le journal d'événements Windows pour supervision.
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists("AIFG-RH")) {
            New-EventLog -LogName Application -Source "AIFG-RH"
        }
        Write-EventLog -LogName Application -Source "AIFG-RH" -EntryType Error -EventId 900 `
            -Message "Echec de la sauvegarde du Registre RH : $_"
    } catch { }
    exit 1
}
finally { $env:PGPASSWORD = $null }

# --- RESTAURATION (procédure manuelle) ---
# 1. Stop-Service AIFG-RH
# 2. Expand-Archive C:\AIFG-RH\sauvegardes\aifg_rh_AAAAMMJJ_HHMM.sql.zip -DestinationPath C:\Temp
# 3. & "$BinSql\dropdb.exe"   -U postgres -h localhost aifg_rh
#    & "$BinSql\createdb.exe" -U postgres -h localhost -O aifg aifg_rh
#    & "$BinSql\psql.exe"     -U aifg -h localhost -d aifg_rh -f C:\Temp\aifg_rh_AAAAMMJJ_HHMM.sql
# 4. Expand-Archive C:\AIFG-RH\sauvegardes\fichiers_AAAAMMJJ_HHMM.zip -DestinationPath C:\AIFG-RH\serveur\fichiers -Force
# 5. Start-Service AIFG-RH
