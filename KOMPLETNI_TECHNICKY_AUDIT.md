# Kompletní hloubkový technický audit Google Apps Script projektu

Projekt: `OZ Dashboard`

Umístění: `D:\lidl\Projekty\Aplikace\OZ Dashboard`

Datum auditu: 2026-05-16

## 1. INVENTÁŘ PROJEKTU

Deployovatelný Google Apps Script projekt má 8 zdrojových souborů, 7 798 řádků:

| Soubor | Řádky | Účel |
|---|---:|---|
| `appsscript.json` | 11 | manifest, timezone, OAuth scope, V8 |
| `Config.js` | 97 | konfigurace aplikace, logo, verze, changelog |
| `Kód.js` | 1 628 | serverový backend, autorizace, CRUD, sheet databáze |
| `index.html` | 532 | hlavní HTML layout web app |
| `scripts.html` | 1 491 | klientská logika `App`, volání `google.script.run` |
| `styles.html` | 3 256 | CSS |
| `icons.html` | 777 | SVG symboly |
| `iconCatalog.html` | 6 | katalog ikon pro picker |

V repo jsou navíc podpůrné soubory `.clasp.json`, `.claspignore`, `deploy.ps1`, auditní markdowny a `icons.zip`; ty nejsou součástí runtime GAS aplikace.

Typ skriptu: web app přes `doGet()` v `Kód.js:4`. Není zde `onOpen`, `onEdit`, `doPost`, časový trigger ani knihovna. Projekt není container-bound podle lokální struktury `.clasp.json`; jde o standalone Apps Script web aplikaci napojenou na vlastní Spreadsheet databázi vytvářenou za běhu.

Hlavní moduly:

- Web render: `doGet`, `renderPage`, `include`, `getAppBootstrap`.
- Auth/context: `getCurrentUserContext_`, `requirePermission_`, `hasPermission_`, `getSignedInUser_`.
- DB bootstrap/schema: `ensureDatabase_`, `ensureDatabaseSchema_`, `setupDatabaseSheets_`, `ensureSheet_`, `seedInitialUserIfNeeded_`.
- CRUD: uživatelé, lokace, úseky, dlaždice, subapp permissions, role.
- Frontend controller: objekt `App` v `scripts.html:2`.

## 2. ARCHITEKTURA A NÁVAZNOSTI

### Entry points

- `doGet()` -> renderuje `index.html`.
- Klientská volání přes `google.script.run` v `App.callServer()` (`scripts.html:280`):
  `getInitData`, `getHomeData`, `saveUser`, `deleteUser`, `saveLocation`, `deleteLocation`, `saveDepartment`, `deleteDepartment`, `saveSubApp`, `deleteSubApp`, `getSubAppPermissionsData`, `saveSubAppPermission`, `deleteSubAppPermission`, `getRolesAdminData`, `saveRole`, `deleteRole`, `saveRolePermission`, `deleteRolePermission`.
- Veřejně volatelný z GAS runneru je také `getHealthData()` (`Kód.js:131`).

### Závislostní graf

- `doGet` -> `getAppBootstrap` -> `getCurrentUserContext_` -> `ensureDatabase_`, `getSignedInUser_`, `findUserByEmail_`, `getRolePermissions_`, `getUserSubAppAccess_`.
- `getInitData` -> `getCurrentUserContext_` -> `listDashboardSubApps_`, `buildUsersAdminData_`, `updateUserLastVisit_`.
- `getHomeData` -> `getCurrentUserContext_` -> `hasPermission_` -> `listDashboardSubApps_` -> `listSubApps_`.
- `getUsersAdminData` -> `requirePermission_('users.manage')` -> `buildUsersAdminData_`.
- `buildUsersAdminData_` -> `listUsers_`, `listRoles_`, `listLocations_`, `listDepartments_`, `listSubApps_`.
- `saveUser` -> `requirePermission_('users.manage')` -> `normalizeUserPayload_`, `validateUserPayload_`, `assertLastSuperadminIsProtected_`, `buildUserRow_`, `buildUsersAdminData_`.
- `deleteUser` -> `requirePermission_` -> `assertLastSuperadminIsProtected_`, `buildUsersAdminData_`.
- `saveLocation` / `deleteLocation` -> `requirePermission_` -> sheet `LOCATIONS`; delete kontroluje `DEPARTMENTS` a `USERS`.
- `saveDepartment` / `deleteDepartment` -> `requirePermission_` -> sheet `DEPARTMENTS`; delete kontroluje `USERS`.
- `saveSubApp` / `deleteSubApp` -> `requirePermission_` -> `SUBAPPS`; delete čistí `SUBAPP_PERMISSIONS`.
- `getSubAppPermissionsData` -> `requirePermission_` -> `buildPermissionsData_`.
- `saveSubAppPermission` / `deleteSubAppPermission` -> `requirePermission_` -> `SUBAPP_PERMISSIONS`.
- `getRolesAdminData` -> `requirePermission_` -> `buildRolesAdminData_`.
- `saveRole` / `deleteRole` / `saveRolePermission` / `deleteRolePermission` -> `requirePermission_` -> `ROLES`, `ROLE_PERMISSIONS`.

### Datové toky

- Vstup: web UI formuláře v `index.html:281`, zpracované v `scripts.html:623`.
- Transport: `google.script.run` v `scripts.html:280`.
- Transformace: normalizace/validace v `normalizeUserPayload_`, `validateUserPayload_`, `normalizeSubAppPayload_`, `validateSubAppPayload_`.
- Výstup: zápisy do Spreadsheetu přes `appendRow`, `setValues`, `deleteRow`.
- Spreadsheet listy: `CONFIG`, `USERS`, `ROLES`, `ROLE_PERMISSIONS`, `SUBAPP_PERMISSIONS`, `SUBAPPS`, `LOCATIONS`, `DEPARTMENTS` v `setupDatabaseSheets_()` (`Kód.js:404`).

### Trigger mapa

- HTTP: `doGet()` (`Kód.js:4`).
- Chybí: `doPost`, `onOpen`, `onEdit`, instalované triggery, časové triggery, `ScriptApp.newTrigger`.
- Práva: web app musí běžet jako "User accessing the web app"; kód to explicitně vyžaduje v `getSignedInUser_()` (`Kód.js:1618`).

### Sdílený stav

- Globály: `DATABASE_SCHEMA_VERSION`, `DATABASE_CACHE_TTL_SECONDS` (`Kód.js:1`), `APP_CONFIG`, `APP_CHANGELOG` (`Config.js:1`).
- `PropertiesService`: `DATABASE_SPREADSHEET_ID`, `DATABASE_SPREADSHEET_URL`, `DATABASE_SCHEMA_VERSION` v `ensureDatabase_()` (`Kód.js:319`).
- `CacheService`: `DATABASE_INFO_V2` s TTL 6 h (`Kód.js:320`).
- `LockService`: chrání inicializaci DB, migraci a CRUD zápisy.

### Externí závislosti

- GAS služby: `SpreadsheetApp`, `HtmlService`, `Session`, `Utilities`, `PropertiesService`, `CacheService`, `LockService`.
- Nepoužívá: `UrlFetchApp`, `DriveApp`, `CalendarApp`, `GmailApp`, `MailApp`, externí knihovny.
- Externí URL: Drive thumbnail logo v `Config.js:5`.

## 3. ANALÝZA CHYB

### A) Kritické chyby

| Nález | Soubor/Funkce | Dopad | Doporučená akce |
|---|---|---|---|
| `getInitData()` volá `updateUserLastVisit_(database.spreadsheet, ...)`, ale `database` není v lokálním ani globálním scope. | `Kód.js:117` / `getInitData` | Runtime `ReferenceError`; chyba je zachycena, takže aplikace běží, ale poslední návštěva se nikdy neuloží. | Nahradit `database.spreadsheet` za `context.database.spreadsheet`. |
| Automatické smazání `DATABASE_SPREADSHEET_ID` při jakékoli chybě `openById`. | `Kód.js:348` / `ensureDatabase_` | Dočasná chyba oprávnění/služby může odpojit produkční databázi a vytvořit novou prázdnou. | Nerozlišovat "soubor neexistuje" a transient chyby mazáním properties; mazat jen po explicitní administrátorské obnově. |
| `listDashboardSubApps_()` nefiltruje podle `auth.subApps`; pouze vrací `accessLevel`. | `Kód.js:903` / `listDashboardSubApps_` | Každý uživatel s `dashboard.view` vidí všechny aktivní/připravované dlaždice bez ohledu na `SUBAPP_PERMISSIONS`. | Přidat filtr: admin vidí vše, běžný uživatel jen dlaždice s aktivním záznamem v `auth.subApps`. |
| `saveRolePermission()` dovolí přidat libovolné oprávnění včetně `*` komukoli s `users.manage`. | `Kód.js:1544` / `saveRolePermission` | Uživatel s administrací uživatelů může povýšit roli na wildcard superoprávnění. | Oddělit `roles.manage`, zakázat `*` mimo superadmina, validovat známé permission keys. |

### B) Logické chyby

| Nález | Soubor/Funkce | Dopad | Doporučená akce |
|---|---|---|---|
| `deleteLocation()` kontroluje uživatele přes textové `locationName`, ne přes ID. | `Kód.js:723` / `deleteLocation` | Přejmenování/kosmetická změna názvu lokace rozbije vazby a dovolí smazat používanou lokaci. | Ukládat `locationId` do `USERS`; text používat jen pro display. |
| `saveLocation()` dovoluje více záznamů `CENTRALA`. | `Kód.js:641` / `saveLocation` | Duplicitní centrála rozbije výběry a řazení. | Validovat `type` proti `LC/CENTRALA` a pro `CENTRALA` vynutit jediný aktivní záznam. |
| `saveDepartment()` nevaliduje, že `locationIds` existují v `LOCATIONS`. | `Kód.js:934` / `saveDepartment` | Úsek může odkazovat na neexistující lokaci. | Před zápisem ověřit všechna ID proti aktivním lokacím. |
| `deleteRole()` kontroluje přiřazené uživatele před získáním locku. | `Kód.js:1502` / `deleteRole` | Race condition: mezi kontrolou a smazáním může jiný request roli přiřadit. | Přesunout kontrolu uživatelů dovnitř stejného locku těsně před `deleteRow`. |
| `saveSubAppPermission()` neověřuje existenci uživatele ani dlaždice. | `Kód.js:1315` / `saveSubAppPermission` | Vznikají osiřelé nebo neúčinné permission záznamy. | Ověřit `userId/email` proti `USERS` a `subAppKey` proti `SUBAPPS`. |

### C) Chyby zpracování chyb

| Nález | Soubor/Funkce | Dopad | Doporučená akce |
|---|---|---|---|
| `getHealthData()` vrací detailní interní chybu klientovi. | `Kód.js:143` / `getHealthData` | Únik interních informací o DB/schéma chybách. | Logovat detail, klientovi vracet obecný stav. |
| `getInitData()` spolkne chybu ukládání návštěvy pouze do logu. | `Kód.js:118` / `getInitData` | Skutečná chyba `database is not defined` se v UI neprojeví a zůstane dlouhodobě skrytá. | Opravit proměnnou a pro neočekávané chyby přidat metriky/alert. |
| Frontend často předává `err.message` přímo do toastu. | `scripts.html:250` / `optimisticUpdate` a další catch bloky | Uživatel může vidět technické chyby z backendu. | Mapovat serverové chyby na bezpečné uživatelské zprávy. |

### D) GAS-specifické problémy

| Nález | Soubor/Funkce | Dopad | Doporučená akce |
|---|---|---|---|
| `getInitData()` dělá několik plných čtení sheetů v jednom requestu. | `Kód.js:82` / `getInitData` | U větší DB naroste latence a riziko timeoutu. | V jednom requestu načíst sheet data jednou a předávat je dál jako snapshot. |
| Mazání více řádků přes `deleteRow()` v cyklu. | `Kód.js:856`, `Kód.js:1523` / `deleteSubApp`, `deleteRole` | U stovek oprávnění je mazání pomalé a kvótově drahé. | Přepsat list jedním `setValues()` bez smazaných řádků, případně batchovat souvislé rozsahy. |
| `updateUserLastVisit_()` zapisuje bez locku. | `Kód.js:1032` / `updateUserLastVisit_` | Souběžné uložení profilu může přepsat nový `updatedAt`/data řádku. | Použít lock nebo zapisovat pouze buňky `lastVisitAt` a případně neměnit `updatedAt`. |
| V kódu není `getValue()` v cyklu. | celý projekt | Dobré. | Zachovat práci přes `getValues()`/`setValues()`. |

## 4. BEZPEČNOSTNÍ AUDIT

OAuth scopes v `appsscript.json:4`:

- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/spreadsheets`

To odpovídá použití `Session.getActiveUser().getEmail()` a `SpreadsheetApp.create/openById`. Nejsou zde zbytečné Gmail/Drive/Calendar scope. Pozor: logo přes Drive thumbnail je veřejný/URL přístup, ne `DriveApp`.

Citlivá data:

- API klíče, hesla ani tokeny nebyly v kódu nalezeny.
- Hardcoded je Drive file ID loga v `Config.js:4`. Není to tajný klíč, ale je to interní asset reference.

Validace vstupů:

- Uživatelé mají základní validaci e-mailu, jména, lokace, úseku a rolí v `validateUserPayload_()` (`Kód.js:1116`).
- URL dlaždice dovoluje `http://` i `https://` v `validateSubAppPayload_()` (`Kód.js:1146`). To je bezpečnostně slabé pro interní dashboard.
- Frontend většinu dat escapuje přes `escape()` (`scripts.html:1480`). Výjimka je changelog: `openChangelog()` vkládá `entry.version` a text změn bez escapování (`scripts.html:1284`). Aktuálně jsou data z `Config.js`, takže nejde o uživatelský vstup, ale vzor je nebezpečný.

Přístupová kontrola:

- Serverové mutace chrání `requirePermission_('users.manage')`.
- Chybí granularita: správa rolí, oprávnění, subapp permissions i uživatelů spadá pod jedno oprávnění `users.manage`.
- Chybí ochrana wildcard `*` před nesuperadminy.
- `getHealthData()` nevyžaduje specifické permission, jen implicitně projde `getCurrentUserContext_()`; i uživatel bez přístupu může získat error payload.

Logy:

- `Logger.log` ukládá e-maily a změny přístupů, například `Kód.js:290`, `Kód.js:1366`. To je akceptovatelné pro auditní log, ale musí být omezen přístup k Cloud Logs.

## 5. VÝKON A ŠKÁLOVATELNOST

Spreadsheet antipatterns:

- Nejsou zde `getValue()` v cyklu.
- Je zde opakované `getDataRange().getValues()` pro stejné listy během jednoho requestu. Typicky `getInitData()` -> kontext čte `USERS`, `ROLE_PERMISSIONS`, `SUBAPP_PERMISSIONS`, potom home čte `SUBAPPS`, settings čte `USERS`, `ROLES`, `LOCATIONS`, `DEPARTMENTS`, `SUBAPPS`.
- `buildUsersAdminData_()` (`Kód.js:157`) načítá pět listů při každém uložení uživatele i dlaždice.

Odhad limitů:

- Do cca stovek řádků na list bude aplikace v GAS pravděpodobně použitelná.
- Při tisících uživatelů/oprávnění začnou být nejdražší `getObjects_()` nad celým listem a vícenásobné reloady po každé mutaci.
- Funkce nejvíc ohrožené 6min limitem: `getInitData`, `buildUsersAdminData_`, `deleteSubApp`, `deleteRole`, `deleteRolePermission` při velkém počtu permission řádků.

Kvóty:

- `UrlFetchApp`, Gmail, Calendar, Drive API se nepoužívají.
- Limit triggerů se neuplatní, kód triggery nevytváří.
- Spreadsheet kvóty a lock wait jsou hlavní provozní limit.

Kde by pomohla cache:

- `getRolePermissions_()` a `getUserSubAppAccess_()` pro aktuálního uživatele.
- `listSubApps_()` pro dashboard, invalidovat při `saveSubApp/deleteSubApp`.
- Katalog rolí/lokací/úseků pro formuláře.

Souběžný přístup:

- Většina zápisů používá script lock, což chrání proti duplicitám.
- Slabiny: `updateUserLastVisit_()` bez locku; `deleteRole()` kontroluje vazby před lockem; automatická obnova DB v `ensureDatabase_()` má vysoký dopad při souběžném chybovém stavu.

## 6. KVALITA KÓDU

Duplicity a mrtvý kód:

- `getHomeData()` a část `getInitData()` duplikují stavbu `homeData` (`Kód.js:51`, `Kód.js:82`).
- `renderUsersError()` (`scripts.html:490`) a `setUsersLoading()` (`scripts.html:434`) nejsou podle aktuálních volání využité.
- `getLocationsData()` a `getDepartmentsData()` existují na serveru, ale frontend po init používá cache a samostatně je nevolá.

Konzistence:

- Server používá `camelCase_` pro privátní helpery, konzistentní.
- Frontend je jeden velmi velký objekt `App`; metoda `bindEvents()` je dlouhá a kumuluje odpovědnosti.
- V datech se míchají stabilní ID a display stringy: nejvýrazněji `USERS.locationName`.

Dokumentace:

- Některé serverové helpery mají JSDoc, ale CRUD mutace a frontend metody bez dokumentace.
- Chybí schema dokumentace listů mimo kód v `setupDatabaseSheets_()`.

Příliš dlouhé funkce:

- `setupDatabaseSheets_()` (`Kód.js:404`) má mnoho schémat najednou.
- `bindEvents()` (`scripts.html:52`) je velký centrální handler.
- `renderIconPicker()` (`scripts.html:1359`) míchá filtrování, výběr skupin, render i binding.

Logování:

- Server používá `Logger.log`, frontend toasty. `console.log` není používán.
- Logování je relativně konzistentní, ale není strukturované ani nemá correlation/request ID.

Magické hodnoty:

- Názvy sheetů jsou hardcoded napříč `Kód.js`.
- Permission keys `dashboard.view`, `users.manage`, `*` jsou hardcoded v několika místech.
- Drive logo ID je v `Config.js:4`.
- TTL cache `21600` je pojmenovaný globál, to je v pořádku.

## 7. ZÁVĚREČNÝ REPORT

### Executive summary

Celkové hodnocení: **6/10**.

Aplikace má dobrý základ: minimální OAuth scopes, server-side kontrolu práv u mutací, locky u většiny zápisů, práci přes `getValues/setValues` místo buněk v cyklu a poměrně jasné sheet schéma. Kritické slabiny jsou v autorizaci dlaždic, správě rolí, automatické obnově databáze a jedné konkrétní runtime chybě v `getInitData`. Největší dlouhodobý problém je, že Spreadsheet funguje jako relační databáze, ale vztahy jsou částečně uložené textem a bez referenční validace.

### Kritické nálezy - opravit okamžitě

| Nález | Soubor/Funkce | Riziko | Doporučená akce |
|---|---|---|---|
| `database` není definována v `getInitData`. | `Kód.js:117` / `getInitData` | Nefunguje ukládání poslední návštěvy. | Použít `context.database.spreadsheet`. |
| DB property se smažou při chybě `openById`. | `Kód.js:348` / `ensureDatabase_` | Riziko vytvoření nové prázdné DB místo produkční. | Nemazat properties automaticky; přidat explicitní recovery režim. |
| Dlaždice nejsou filtrovány podle `SUBAPP_PERMISSIONS`. | `Kód.js:903` / `listDashboardSubApps_` | Uživatelé vidí moduly, ke kterým nemají mít přístup. | Filtrovat podle `auth.subApps`, adminům ponechat výjimku. |
| `users.manage` dovoluje správu rolí a wildcard oprávnění. | `Kód.js:1544` / `saveRolePermission` | Privilege escalation. | Zavést `roles.manage`; `*` povolit jen superadminovi. |

### Střední priorita - opravit v nejbližší verzi

| Nález | Soubor/Funkce | Dopad | Doporučená akce |
|---|---|---|---|
| Vazba uživatele na lokaci je textem. | `deleteLocation`, `saveUser` | Nekonzistentní vazby. | Přidat `locationId` do `USERS`. |
| Chybí validace existence `locationIds`. | `saveDepartment` | Osiřelé úseky. | Ověřit ID proti `LOCATIONS`. |
| Chybí validace user/subapp v permission. | `saveSubAppPermission` | Osiřelá oprávnění. | Ověřit proti `USERS` a `SUBAPPS`. |
| Role delete má race condition. | `deleteRole` | Smazání používané role. | Kontrolu přesunout pod lock. |
| `http://` cílové URL jsou povolené. | `validateSubAppPayload_` | Phishing/MITM riziko. | Povolit jen `https://`, případně allowlist domén. |
| Changelog render neescapuje texty. | `openChangelog` | Budoucí XSS při externích datech. | Použít `this.escape()` i zde. |

### Nízká priorita - tech debt

- Rozdělit `Kód.js` na moduly podle domén: auth, db, users, locations, subapps, roles.
- Centralizovat názvy sheetů a permission keys do konstant.
- Přidat request/audit ID do logů.
- Odstranit nebo zapojit nevyužité frontend/server helpery.
- Zmenšit `bindEvents()` a render metody na menší části.
- Popsat sheet schema v dokumentaci.

### Refactoring doporučení

1. Zavést `DatabaseRepository` vrstvu: jeden snapshot sheetů na request, metody `getUsers`, `saveUser`, `getRoles`.
2. Převést vazby na ID: `USERS.locationId`, `USERS.departmentId`, permission přes `userId` a `subAppId/key`.
3. Rozdělit oprávnění: `dashboard.view`, `users.manage`, `roles.manage`, `subapps.manage`, `permissions.manage`.
4. Přidat bezpečný recovery proces pro databázi místo automatického mazání ScriptProperties.
5. Zavést malé testovatelné validátory payloadů a schema migrace verzovat po krocích.

### Akční plán

1. Opravit `database.spreadsheet` v `getInitData`.
2. Upravit `listDashboardSubApps_()` tak, aby běžní uživatelé viděli jen povolené dlaždice.
3. Zakázat automatické mazání DB properties v `ensureDatabase_`.
4. Oddělit `roles.manage` a zablokovat wildcard `*` pro nesuperadminy.
5. Doplnit referenční validace pro lokace, úseky, subapp permissions.
6. Přepsat mazání permission řádků na batch strategii.
7. Přidat dokumentaci schématu, smoke testy a základní monitoring.

### Chybějící funkcionality

- Automatizované testy serverových funkcí a validátorů.
- Monitoring/alerting pro chyby v `ensureDatabase_`, auth a mutacích.
- Admin-only health endpoint bez úniku detailů.
- Granulární role a auditní historie změn v samostatném sheetu.
- Schema migrace s verzovanými kroky a rollback plánem.
- Formální dokumentace deployment nastavení: "Execute as", "Who has access", očekávané OAuth scopes.
