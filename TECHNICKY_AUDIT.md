# Technicky audit Google Apps Script projektu OZ Dashboard

## 1. INVENTAR PROJEKTU

- Souboru celkem: 12, z toho 11 textovych souboru a 1 archiv `icons.zip`.
- Textovych radku celkem: 6 525.
- Hlavni kod:
  - `Kod.js`: 940 radku, serverova GAS logika.
  - `scripts.html`: 1 198 radku, klientska aplikace.
  - `styles.html`: 3 141 radku CSS.
  - `index.html`: 404 radku UI sablony.
  - `Config.js`: globalni konfigurace.
  - `appsscript.json`: manifest.
- Typ projektu: Google Apps Script web app, V8 runtime, standalone clasp projekt bez `parentId`; neni container-bound knihovna.
- Trigger-based jen neprime pres HTTP `doGet`; `onOpen`, `onEdit`, `doPost` ani instalovane triggery v kodu nejsou.

### Hlavni moduly

- Bootstrap/rendering: `doGet`, `renderPage`, `include`, `getAppBootstrap`.
- Autentizace/autorizace: `getCurrentUserContext_`, `requirePermission_`, `hasPermission_`.
- Databaze ve Spreadsheetu: `ensureDatabase_`, `setupDatabaseSheets_`, `ensureSheet_`, `seedInitialUserIfNeeded_`.
- Administrace uzivatelu: `getUsersAdminData`, `saveUser`, `deleteUser`.
- Ciselniky: `getLocationsData/saveLocation/deleteLocation`, `getDepartmentsData/saveDepartment/deleteDepartment`.
- Dlazdice dashboardu: `getSubAppsData/saveSubApp/deleteSubApp/listDashboardSubApps_`.
- Klientska SPA: objekt `App` v `scripts.html`.

## 2. ARCHITEKTURA A NAVAZNOSTI

### Zavislostni graf serveru

- `doGet -> getAppBootstrap -> getCurrentUserContext_ -> ensureDatabase_, findUserByEmail_, updateUserLastVisit_, getRolePermissions_, getUserSubAppAccess_`.
- `doGet -> renderPage -> index.html -> include(styles/icons/iconCatalog/scripts)`.
- `getHomeData -> getCurrentUserContext_, listDashboardSubApps_ -> listSubApps_, isAdminAuth_, subAppStatusLabel_`.
- `getUsersAdminData -> requirePermission_, listUsers_, listRoles_, listLocations_, listDepartments_, listSubApps_`.
- `saveUser -> requirePermission_, normalizeUserPayload_, validateUserPayload_, assertLastSuperadminIsProtected_, buildUserRow_, getUsersAdminData`.
- `deleteUser -> requirePermission_, assertLastSuperadminIsProtected_, getUsersAdminData`.
- `saveSubApp -> requirePermission_, normalizeSubAppPayload_, validateSubAppPayload_, makeUniqueSubAppKey_, getNextSubAppSortOrder_, buildSubAppRow_, getUsersAdminData`.
- `saveLocation/deleteLocation -> requirePermission_, getLocationsData`.
- `saveDepartment/deleteDepartment -> requirePermission_, getDepartmentsData`.

### Datove toky

- UI formular -> `save*FromForm` v `scripts.html` -> `google.script.run` -> server `save*` -> Spreadsheet tabulky `USERS`, `LOCATIONS`, `DEPARTMENTS`, `SUBAPPS`.
- `doGet/getHomeData/getUsersAdminData` ctou Spreadsheet pres `getDataRange().getValues()` a posilaji JSON do klienta.
- Spreadsheet se vytvari automaticky pres `SpreadsheetApp.create` v `ensureDatabase_`.

### Trigger mapa

- `doGet`: web app HTTP GET, prava podle nastaveni deploymentu mimo repo.
- `doPost`: chybi.
- `onOpen/onEdit`: chybi.
- Casove triggery: zadny `ScriptApp.newTrigger`.

### Sdileny stav

- `APP_CONFIG` globalne v `Config.js`.
- `PropertiesService`: `DATABASE_SPREADSHEET_ID`, `DATABASE_SPREADSHEET_URL` v `Kód.js / ensureDatabase_`.
- `LockService`: jen v `ensureDatabase_`, ne pri beznych zapisech.
- `CacheService`: nepouzito.
- Klient: `localStorage.sidebarCollapsed` v `scripts.html`.

### Externi zavislosti

- GAS sluzby: `HtmlService`, `Session`, `Utilities`, `LockService`, `PropertiesService`, `SpreadsheetApp`.
- `UrlFetchApp`, Gmail, Calendar, DriveApp ani AdminDirectory se v kodu nepouzivaji.
- Manifest deklaruje navic `script.external_request` a `directory.readonly`, ktere nejsou pouzite.

## 3. ANALYZA CHYB

### A) Kriticke chyby

| Nalez | Soubor/Funkce | Riziko | Doporucena akce |
|---|---|---|---|
| `ensureSheet_` pri zmene hlavicek provede `sheet.clear()` | `Kód.js / ensureSheet_` | Pri jakekoli zmene poradi/sloupcu smaze produkcni data listu. | Nahradit migracni logikou: doplnovat chybejici sloupce, nikdy necistit cely list. |
| `getSignedInUser_` pada na `Session.getEffectiveUser()` fallback | `Kód.js / getSignedInUser_` | Pri deploymentu "execute as me" se uzivatele mohou vyhodnocovat jako vlastnik skriptu; autorizace se zhrouti. | Nepouzivat `EffectiveUser` pro identitu navstevnika; vyzadovat `ActiveUser` a explicitne odmitnout prazdny email. |
| Prvni uzivatel se seeduje z aktualni identity pri prvni navsteve | `Kód.js / seedInitialUserIfNeeded_` | Prvni navstevnik noveho deploymentu muze ziskat `SUPERADMIN`. | Seed admina ridit explicitni konfiguraci nebo instalacni funkci mimo verejny `doGet`. |
| Chybny/odstraneny Spreadsheet ID neni osetren | `Kód.js / ensureDatabase_` | `SpreadsheetApp.openById` vyhodi vyjimku a cela aplikace prestane bezet. | Zachytit chybu, zalogovat ID, nabidnout recovery nebo znovuvytvoreni jen rizene. |
| `lock.waitLock(30000)` nema obsluhu timeoutu | `Kód.js / ensureDatabase_` | Pri soubehu muze kazde nacteni web appu skoncit vyjimkou. | Osetrit vyjimku a vratit uzivatelsky srozumitelnou chybu; inicializaci nevolat pri kazdem requestu. |

### B) Logicke chyby

| Nalez | Soubor/Funkce | Dopad | Doporucena akce |
|---|---|---|---|
| Per-user `SUBAPP_PERMISSIONS` se pocitaji, ale nikde nepouziji | `Kód.js / getUserSubAppAccess_`, `Kód.js / listDashboardSubApps_` | Kazdy aktivni uzivatel vidi vsechny aktivni dlazdice. | Ve `listDashboardSubApps_` filtrovat podle `auth.subApps` nebo odstranit falesny model opravneni. |
| `getHomeData` neoveruje `dashboard.view` | `Kód.js / getHomeData` | Aktivni uzivatel bez teto permission dostane dashboard. | Pouzit `hasPermission_(context.auth, 'dashboard.view')`. |
| Zapisy nemaji lock | `saveUser`, `saveSubApp`, `saveLocation`, `saveDepartment`, delete funkce | Duplicitni email/klic, race pri poslednim superadminovi, ztrata zmen pri soubeznem zapisu. | Obalit write sekce `LockService.getScriptLock()` nebo document lockem. |
| `saveLocation` dovoli duplicitni LC kody i vice central | `Kód.js / saveLocation` | Ciselnik se stane nejednoznacny, uzivatele se paruji podle display name. | Validovat unikatni `type+code`, omezit `CENTRALA` na jeden aktivni zaznam. |
| Smazani location/department nekontroluje uzivatele | `Kód.js / deleteLocation`, `Kód.js / deleteDepartment` | `USERS.locationName` a `USERS.department` zustanou odkazovat na neexistujici hodnoty. | Pred delete kontrolovat reference v `USERS`, pripadne soft-delete. |
| Dlazdice ma `targetUrl`, ale UI ho neumi zadat | `index.html / subAppForm`, `scripts.html / saveSubAppFromForm` | Aktivni dlazdice nelze z administrace skutecne propojit na aplikaci. | Doplnit pole `targetUrl` a validaci URL. |
| Dashboard render ignoruje katalogove ikony | `scripts.html / renderModules` | Subaplikace s ikonou z katalogu se na dashboardu zobrazi jako fallback. | Pouzit `iconSymbol(item.icon)` misto `iconId(item.icon)`. |
| Navigace do admin sekci jen renderuje stary stav | `scripts.html / bindEvents` | Kdyz `loadAllSettings` selze nebo data zestarnou, uzivatel vidi prazdnou/stale administraci. | Pri kliknuti volat prislusne `loadUsers/loadLocations/loadDepartments` nebo zpracovat stav opravneni. |
| `loadAllSettings` spolyká chybu | `scripts.html / loadAllSettings` | Non-admin ani admin pri chybe nevidi duvod, jen prazdne tabulky. | Logovat a zobrazit chybovy stav; prazdny catch odstranit. |

### C) Chyby zpracovani chyb

- `ensureDatabase_` ma `finally`, ale nema `catch`; chyby `openById`, `create`, `setupDatabaseSheets_` jdou primo uzivateli bez kontextu.
- V `scripts.html / loadAllSettings` je prazdny `catch(() => {})`.
- Server nevaliduje `targetUrl`, `icon`, `locationIds`, `systemRole` proti povolenym hodnotam.
- `validateUserPayload_` overuje jen `accessRole`, ne `systemRole`.
- Delete funkce nemaji referencni kontroly vuci navazanym listum.

### D) GAS-specificke problemy

- `getCurrentUserContext_` zapisuje `lastVisitAt` pri kazdem serverovem volani; jeden start klienta vola minimalne `doGet`, `getAppBootstrap`, `getHomeData`, `getUsersAdminData`, tedy zbytecne opakovane zapisy.
- `ensureDatabase_` vola `setupDatabaseSheets_` pri kazdem requestu; to dela mnoho `getSheetByName/getRange/set*` operaci i po inicializaci.
- `getDataRange().getValues()` se pouziva pro cele listy pri kazdem save/list; pro jednotky tisic radku jeste prijatelne, pro desetitisice uz hrozi timeout.
- Bezny zapis nepouziva `LockService`, ale zaroven dela read-modify-write validace.

## 4. BEZPECNOSTNI AUDIT

- OAuth scopes v `appsscript.json`:
  - Potrebne: `userinfo.email`, `spreadsheets`.
  - Zbytecne v aktualnim kodu: `script.external_request`, `directory.readonly`.
  - Chybi explicitni zduvodneni pro vytvareni Spreadsheetu; realne se pouziva `SpreadsheetApp.create`.
- Citliva data:
  - API klice/hesla/tokeny v kodu nejsou.
  - Hardcoded Drive file ID loga je v `Config.js`.
- Vstupy:
  - Klient escapuje HTML pres `escape`, coz snizuje XSS v tabulkach.
  - `targetUrl` z dat se otevíra pres `window.open` bez serverove whitelist validace.
- Pristupova kontrola:
  - Admin operace chrani `requirePermission_`.
  - Dashboard dlazdice nejsou chranene podle `SUBAPP_PERMISSIONS`.
  - Deployment nastaveni "Execute as / Who has access" neni v repu; vzhledem k `getEffectiveUser` fallbacku je to kriticka neznama.
- Logy:
  - Server nepouziva zadny vlastni audit log pro admin operace; `exceptionLogging` je Stackdriver, ale business akce nejsou dohledatelne.

## 5. VYKON A SKALOVATELNOST

- Nejvetsi bottleneck: `ensureDatabase_ -> setupDatabaseSheets_` pri kazdem requestu.
- Druhy bottleneck: `updateUserLastVisit_` zapisuje dva `setValue` na skoro kazde serverove volani.
- Odhad kapacity: pri soucasnem modelu cele listy pres `getDataRange` zvladnou rozumne stovky az nizke tisice uzivatelu/dlazdic; kolem 5-10 tisic radku v `USERS` zacne byt odezva znatelne horsi.
- CacheService by konkretne pomohl pro `ROLES`, `ROLE_PERMISSIONS`, `SUBAPPS`, `LOCATIONS`, `DEPARTMENTS`.
- Limity: riziko trigger limitu neni, protoze triggery se nevytvareji; UrlFetch/Gmail/Calendar kvoty nerelevantni, protoze sluzby nejsou pouzite.

## 6. KVALITA KODU

- Duplicity: mapovani ciselniku location/department/subapp je opakovane mezi `list*`, `get*Data` a klientskymi optimistic objekty.
- Mrtvy/nevyuzity kod: server `getSubAppsData` neni volan klientem; klient `loadUsers/loadLocations/loadDepartments` existuji, ale navigace je nepouziva.
- Konzistence: server strida `const/let` a `var`, cestinu s ASCII texty bez diakritiky, mix `function` callbacku a arrow funkci.
- Dlouhe funkce: `setupDatabaseSheets_`, `bindEvents`, `renderIconPicker`, `renderUsers`, `saveUserFromForm` by mely byt rozdelene.
- Logovani: server nema konzistentni business logging; klient ma jen toast chyb.
- Hardcoded hodnoty: nazvy sheetu, role, permissions, statusy, logo ID, seed radky jsou primo v kodu.

## 7. ZAVERECNY REPORT

### Executive summary

Hodnoceni: **5/10**.

Aplikace ma citelny zaklad, centralizovany klientsky RPC wrapper a rozumne oddelene listy ve Spreadsheetu. Kriticke slabiny jsou ale v inicializaci databaze, identite uzivatele, destruktivni migraci sheetu, chybejicim lockovani zapisu a nedotazenem opravneni pro subaplikace.

### Kriticke nalezy - opravit okamzite

| Nalez | Soubor/Funkce | Riziko | Doporucena akce |
|---|---|---|---|
| Destruktivni `sheet.clear()` pri zmene hlavicek | `Kód.js / ensureSheet_` | Ztrata dat | Nedestruktivni migrace sloupcu. |
| `EffectiveUser` jako fallback identity | `Kód.js / getSignedInUser_` | Obejiti identity navstevnika | Nepouzivat pro autorizaci. |
| Prvni navstevnik muze byt superadmin | `Kód.js / seedInitialUserIfNeeded_` | Prevzeti aplikace | Seed admina pres explicitni instalaci. |
| Subapp permissions se ignoruji | `Kód.js / listDashboardSubApps_` | Unik pristupu k modulum | Filtrovat podle `auth.subApps`. |
| Zapisy bez locku | `saveUser/saveSubApp/saveLocation/saveDepartment/delete*` | Race conditions | Pridat lock kolem read-modify-write. |

### Stredni priorita - opravit v nejblizsi verzi

| Nalez | Soubor/Funkce | Dopad | Doporucena akce |
|---|---|---|---|
| Nadbytecne OAuth scopes | `appsscript.json` | Vyssi consent riziko | Odebrat `external_request`, `directory.readonly`. |
| Prazdny catch | `scripts.html / loadAllSettings` | Skryte chyby | Zobrazit a logovat chybu. |
| Chybi referencni integrita delete operaci | `deleteLocation/deleteDepartment/deleteSubApp` | Stale data | Blokovat delete nebo soft-delete. |
| Chybi UI pro `targetUrl` | `index.html / subAppForm` | Dlazdice nelze nakonfigurovat | Doplnit pole a validaci URL. |
| Dashboard nepouziva katalogove ikony | `scripts.html / renderModules` | Chybne zobrazeni | Pouzit `iconSymbol`. |

### Nizka priorita - tech debt

- Sjednotit styl `var` vs `const/let`.
- Vytahnout nazvy sheetu, role a permission klice do konstant.
- Pridat JSDoc ke vsem verejnym serverovym RPC funkcim.
- Rozdelit velky objekt `App` na mensi moduly.
- Odstranit nevolane klientske/serverove metody nebo je zapojit.

### Refactoring doporuceni

1. Zavest `SheetRepository` vrstvu pro cteni/zapis tabulek, validaci hlavicek a referencni kontroly.
2. Oddelit instalaci databaze od bezneho `doGet`; `ensureDatabase_` ma jen otevrit existujici databazi.
3. Zavest `AuthService`, ktery nepouziva `EffectiveUser` jako identitu navstevnika.
4. Pridat `AuditLog` sheet pro admin akce: kdo, kdy, funkce, payload summary, vysledek.
5. Pridat cache pro ciselniky a permissions s invalidaci po `save/delete`.

### Akcni plan

1. Opravit identitu uzivatele a seed superadmina.
2. Odstranit destruktivni `sheet.clear()` migraci.
3. Pridat locky do vsech zapisovych funkci.
4. Zapojit `SUBAPP_PERMISSIONS` do dashboardu.
5. Doplnit referencni kontroly delete operaci.
6. Zredukovat OAuth scopes.
7. Pridat logging, cache a dokumentaci datoveho modelu.

### Chybejici funkcionality

- Testy pro serverove validace a migrace sheetu.
- Audit log admin zmen.
- Monitoring chyb nad ramec Stackdriver vyjimek.
- Sprava `targetUrl` a `lastUpdatedAt` v UI dlazdic.
- Dokumentace deployment nastaveni web appu.
- Recovery postup pro poskozeny nebo smazany databazovy Spreadsheet.
