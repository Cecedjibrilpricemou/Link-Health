# Sauvegarde de DB_ENCRYPTION_KEY dans un gestionnaire de mots de passe.
#
# Tout se fait en une seule execution, parce que copier une commande depuis
# une page web ecrase le presse-papiers : une procedure en plusieurs etapes
# copiees une par une detruit la valeur qu'elle vient d'y mettre.
#
# La cle n'est jamais affichee a l'ecran. Seules des empreintes de douze
# caracteres le sont : elles permettent de comparer sans rien reveler.
#
# Usage, depuis n'importe ou :
#   & <racine du depot>\scripts\sauvegarder-cle.ps1
# Pour un autre fichier que apps/api/.env :
#   & ...\sauvegarder-cle.ps1 -FichierEnv D:\chemin\vers\.env

param(
  # Par defaut, le .env de l'API, relatif a ce script : le depot peut etre
  # clone n'importe ou, et la procedure doit marcher sans etre reecrite.
  [string]$FichierEnv = (Join-Path $PSScriptRoot '..\apps\api\.env')
)

function Empreinte([string]$texte) {
  $h = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($texte))
  return ([BitConverter]::ToString($h) -replace '-', '').Substring(0, 12).ToLower()
}

if (-not (Test-Path $FichierEnv)) {
  Write-Host "Fichier introuvable : $FichierEnv" -ForegroundColor Red
  Write-Host "Indiquez-le avec -FichierEnv si l'API est ailleurs." -ForegroundColor Red
  exit 1
}

$ligne = (Select-String -Path $FichierEnv -Pattern '^DB_ENCRYPTION_KEY=' | Select-Object -First 1).Line
if (-not $ligne) {
  Write-Host "Aucune ligne DB_ENCRYPTION_KEY dans $FichierEnv" -ForegroundColor Red
  exit 1
}
$cle = ($ligne -split '=', 2)[1].Trim()
if ($cle -notmatch '^[0-9a-fA-F]{64}$') {
  Write-Host "La valeur trouvee ne ressemble pas a une cle : il faut 64 caracteres hexadecimaux, celle-ci en a $($cle.Length)." -ForegroundColor Red
  exit 1
}
$attendue = Empreinte $cle

Write-Host ""
Write-Host "Cle lue dans $FichierEnv" -ForegroundColor Cyan
Write-Host "  longueur  : $($cle.Length) caracteres"
Write-Host "  empreinte : $attendue"
Write-Host ""

$cle | Set-Clipboard
Write-Host "La cle est maintenant dans le presse-papiers." -ForegroundColor Green
Write-Host ""
Write-Host "1. Ouvre ton gestionnaire de mots de passe."
Write-Host "2. Cree une entree nommee : KENEYA - DB_ENCRYPTION_KEY (production)"
Write-Host "3. Colle la valeur (Ctrl+V) dans le champ du mot de passe."
Write-Host "4. Dans les notes, ecris :"
Write-Host "   Chiffre les donnees medicales des patients. Perdue, ces donnees"
Write-Host "   sont illisibles definitivement. Ne jamais la changer sur une base"
Write-Host "   qui contient deja des donnees."
Write-Host "5. Enregistre."
Write-Host ""
Write-Host "Ne copie rien d'autre entre-temps : cela effacerait la cle du presse-papiers." -ForegroundColor Yellow
Read-Host "Quand c'est enregistre, appuie sur Entree"

Write-Host ""
Write-Host "Verification de la copie." -ForegroundColor Cyan
Write-Host "Retourne dans ton gestionnaire et copie la valeur que tu viens d'enregistrer"
Write-Host "(bouton Copier de l'entree), sans rien copier d'autre."
Read-Host "Puis reviens ici et appuie sur Entree"

$relu = ([string](Get-Clipboard)).Trim()
Set-Clipboard -Value " "

Write-Host ""
if ($relu.Length -eq 0) {
  Write-Host "ECHEC : le presse-papiers est vide. Recommence." -ForegroundColor Red
  exit 1
}

$obtenue = Empreinte $relu
Write-Host "  empreinte attendue : $attendue"
Write-Host "  empreinte obtenue  : $obtenue"
Write-Host ""

if ($obtenue -eq $attendue) {
  Write-Host "CORRECT. La copie dans ton gestionnaire est fidele." -ForegroundColor Green
  Write-Host "Le presse-papiers a ete vide." -ForegroundColor Green
  exit 0
}

Write-Host "ECHEC : la copie ne correspond pas a la cle." -ForegroundColor Red
if ($relu.Length -ne $cle.Length) {
  Write-Host "  La valeur copiee fait $($relu.Length) caracteres au lieu de $($cle.Length)." -ForegroundColor Red
} else {
  Write-Host "  Meme longueur, mais contenu different : un caractere a ete change." -ForegroundColor Red
}
Write-Host "  Corrige l'entree du gestionnaire et relance ce script." -ForegroundColor Red
exit 1
