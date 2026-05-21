# Vyhodnoceni odpisu akcnich artiklu

Prvni subaplikace OZ Dashboardu.

## Datove zdroje

- Hlavni DB sesit OZ Dashboardu:
  - list `FILIALKY` obsahuje synchronizovany referencni prehled filialek.
- Vlastni Drive slozka subaplikace:
  - ID se uklada do `ScriptProperties` pod klic `ACTION_WRITEOFFS_FOLDER_ID`.
- Vlastni spreadsheet subaplikace:
  - ID se uklada do `ScriptProperties` pod klic `ACTION_WRITEOFFS_SPREADSHEET_ID`.
- Zdrojova slozka s celkovym prehledem filialek:
  - ID se uklada do `ScriptProperties` pod klic `ACTION_WRITEOFFS_BRANCH_SOURCE_FOLDER_ID`.
  - Soubor ve slozce se pri aktualizaci nahrazuje, proto synchronizace vzdy hleda nejnovejsi Google Spreadsheet ve slozce.

## Synchronizace filialek

Serverovy modul `Branches.js` poskytuje:

- `getBranchesData()` pro nacteni zalozky Filiálky.
- `saveBranchesSourceFolder({ folderId })` pro ulozeni zdrojove slozky a zalozeni hodinoveho triggeru.
- `syncBranchesFromLatestSource()` pro rucni synchronizaci.
- `syncBranchesFromLatestSourceTrigger()` pro pravidelnou hodinovou synchronizaci.

## Poznamky

Zdrojovy soubor musi byt Google Spreadsheet. Pokud bude zdroj dodavan jako XLSX, je potreba ho pred synchronizaci konvertovat na Google Sheets nebo doplnit import pres Drive API.
