# Kompletní technický audit — OZ Dashboard

> Verze aplikace při auditu: **v0.4.1**
> Datum auditu: **2026-05-16**
> Auditoval: Claude Sonnet (kompletní čtení zdrojových souborů)

---

## 1. INVENTÁŘ PROJEKTU

### Soubory a jejich role

| Soubor | Řádků | Role |
|---|---|---|
| `Kód.js` | 1 629 | Server-side GAS: doGet, API endpointy, DB vrstva |
| `scripts.html` | 1 491 | Klientská logika (App object, renderování, eventy) |
| `styles.html` | ~3 260 | Veškeré CSS pro celou aplikaci |
| `index.html` | 531 | HTML struktura, dialogy, SVG sprite |
| `Config.js` | 107 | Konfigurace a changelog (APP_CONFIG, APP_CHANGELOG) |
| `icons.html` | neznámý | SVG ikonový katalog (Lidl ikony, include z index.html) |
| `iconCatalog.html` | neznámý | JS definice iconCatalog pole pro picker |
| `appsscript.json` | 12 | GAS manifest: OAuth scopes, timezone, runtime |
| `deploy.ps1` | ~100 | PowerShell deploy skript (git+clasp automatizace) |
| `CLAUDE.md` | ~50 | Instrukce pro Claude (deploy pravidla, architektura) |

### Technický stack

- **Runtime**: Google Apps Script (GAS), V8 engine
- **Databáze**: Google Spreadsheet (8 listů: CONFIG, USERS, ROLES, ROLE_PERMISSIONS, SUBAPPS, SUBAPP_PERMISSIONS, LOCATIONS, DEPARTMENTS)
- **Frontend**: Vanilla JS + HTML dialogs, bez žádného frameworku
- **Autentizace**: Google OAuth přes `Session.getActiveUser().getEmail()`
- **Cache**: CacheService klíč `DATABASE_INFO_V2` (JSON: `{id, schemaVersion}`)
- **Zámky**: `LockService.getScriptLock()` pro write operace
- **Deploy**: clasp CLI v3.1.1, PowerShell 7 skript
- **OAuth scopes**: minimální — pouze `userinfo.email` + `spreadsheets`

### Přehled databázového schématu

| Sheet | Klíčové sloupce | Poznámka |
|---|---|---|
| USERS | id, email, firstName, lastName, locationType, locationName, department, systemRole, accessRole, active | locationName je textový display string, ne FK |
| ROLES | roleKey, roleName, description, active | 4 systémové role: SUPERADMIN, ADMIN, EDITOR, VIEWER |
| ROLE_PERMISSIONS | roleKey, permissionKey, allowed | `*` = wildcard pro vše |
| SUBAPPS | id, key, name, status, icon, description, targetUrl, sortOrder, active | |
| SUBAPP_PERMISSIONS | id, userId, email, subAppKey, accessLevel, active | |
| LOCATIONS | id, type, code, abbreviation, city, active | type: LC nebo CENTRALA |
| DEPARTMENTS | id, name, locationIds, active | locationIds = CSV string ID lokací |
| CONFIG | key, value, description, updatedAt, updatedBy | Metadata aplikace |

---

## 2. ARCHITEKTURA A NÁVAZNOSTI

### Server-side call flow

```
Browser → doGet() → HtmlService.createTemplateFromFile('index')
              ↓
         template.app = { appName, version, logoUrl, user, changelog, ... }
              ↓
         index.html (vyrenderováno serverem)
              ↓
         window.APP_BOOTSTRAP = {...} (JSON)
         window.APP_CHANGELOG = [...] (JSON)
              ↓
         App.init() → loadInitData() → google.script.run.getInitData()
              ↓
         getInitData()
           → getCurrentUserContext_()        // user lookup, permissions, subApps
           → ensureDatabase_()               // CacheService, SpreadsheetApp
           → buildUsersAdminData_() (podmíněně)
           → updateUserLastVisit_()          // POUZE zde — zápis do USERS
```

### Client-server komunikace

```js
// Wrapper v scripts.html
callServer(fnName, payload, opts) → Promise
  → google.script.run.withFailureHandler(...).withSuccessHandler(...)[fnName](payload)
```

- Všechna volání probíhají přes `callServer()` — konzistentní error handling
- `{ silent: true }` potlačí loader pro optimistické operace
- Optimistický UI vzor: snapshot → okamžitá UI změna → server call → rollback při chybě

### Načítání dat při startu

1. `doGet()` → vrátí HTML s `APP_BOOTSTRAP` a `APP_CHANGELOG` embedded v `<script>` tagu
2. `App.init()` → `loadInitData()` → `getInitData()` (jeden server call)
3. `getInitData()` vrací: `auth`, `homeData`, `usersAdminData` (vše najednou)
4. Optimalizace: od v0.2.0 jediný server call místo tří

### Template data vs client data

- Server renderuje: `app.appName`, `app.version`, `app.user`, `app.logoUrl` (přes `<?= ?>` — escaped)
- `<?!= JSON.stringify(app) ?>` — celý app objekt do `window.APP_BOOTSTRAP`
- `<?!= JSON.stringify(app.changelog) ?>` — changelog do `window.APP_CHANGELOG`
- **Poznámka**: `window.APP_BOOTSTRAP.changelog` a `window.APP_CHANGELOG` jsou duplicitní — oba obsahují changelog

---

## 3. ANALÝZA CHYB

### A. Kritické chyby (způsobují pád nebo ztrátu dat)

#### ~~A1. `database` mimo scope v `getInitData()`~~ — OPRAVENO (v0.4.1)
- **Popis**: Přesunutí `updateUserLastVisit_()` do `getInitData()` způsobilo `ReferenceError: database is not defined`
- **Oprava**: Změněno na `context.database.spreadsheet` ✓

#### ~~A2. `changelog` mimo scope v template (ReferenceError)~~ — OPRAVENO (v0.4.1)
- **Popis**: `<?!= JSON.stringify(changelog) ?>` místo `<?!= JSON.stringify(app.changelog) ?>`
- **Oprava**: Opraveno na `app.changelog` ✓

### B. Chyby funkčnosti (nesprávné chování)

#### B1. Chybějící diakritika ve dvou chybových hlášeních — NEOPRAVENO
- **Soubor**: `Kód.js`, řádky 1124 a 1127
- **Stávající kód**:
  ```js
  throw new Error('Vybrana systemova role neexistuje.');  // řádek 1124
  throw new Error('Vybrana role pristupu neexistuje.');   // řádek 1127
  ```
- **Správně**:
  ```js
  throw new Error('Vybraná systémová role neexistuje.');
  throw new Error('Vybraná role přístupu neexistuje.');
  ```
- **Dopad**: Chybná diakritika v hlášení při zadání neplatné role. Nízká pravděpodobnost výskytu (validace probíhá přes select), ale nekonzistentní s ostatními opravami.

#### B2. `saveRole()` — `createdAt` nikdy nenastaveno
- **Soubor**: `Kód.js`, řádek 1473
- **Stávající kód**:
  ```js
  let targetRow = -1;
  // ... loop nastaví targetRow na row+1 nebo nechá -1 ...
  if (!targetRow) map.createdAt = now;  // !(-1) === false !
  ```
- **Problém**: `!(-1)` vyhodnotí jako `false`. Výraz `if (!targetRow)` je nikdy pravdivý, protože `targetRow` je buď `-1` (nový záznam) nebo kladné číslo (existující). Správně: `if (targetRow <= 0)`.
- **Dopad**: Nové role budou mít prázdný `createdAt` v databázi. Editace existujících rolí jsou OK (uchovávají původní `createdAt` z original).

#### B3. Seed dat — locationName bez diakritiky
- **Soubor**: `Kód.js`, řádek 526
- **Stávající kód**: `'Centrala'` jako locationName v `seedInitialUserIfNeeded_`
- **Problém**: `mapLocationRow_()` vrací `'Centrála'` (s diakritikou), ale seed uloží `'Centrala'`. Po přihlášení prvního uživatele bude jeho umístění zobrazeno jako `'Centrala'`, a při editaci nebude location předvybrána (nenalezena v dropdownu).
- **Dopad**: Vizuální nekonzistence pro prvního superadmina; nevyvolá chybu.

#### B4. Duplicitní APP_CHANGELOG v `window`
- **Soubor**: `index.html`, řádky 512–513
- **Stávající kód**:
  ```html
  window.APP_BOOTSTRAP = <?!= JSON.stringify(app) ?>;
  window.APP_CHANGELOG = <?!= JSON.stringify(app.changelog) ?>;
  ```
- **Problém**: `window.APP_BOOTSTRAP.changelog` a `window.APP_CHANGELOG` jsou totožné objekty dvakrát v paměti prohlížeče. Zbytečná duplikace.
- **Dopad**: Zanedbatelný pro aktuální velikost changelogu; kosmetický.

### C. Logické chyby a race conditions

#### C1. Race condition v `deleteRole()` — lock mimo check
- **Soubor**: `Kód.js`, řádek 1492–1510
- **Stávající kód**:
  ```js
  // Kontrola PŘED lockem:
  const userRows = getObjects_(spreadsheet.getSheetByName('USERS'));
  const usersUsing = userRows.filter(...);
  if (usersUsing.length > 0) throw new Error(...);

  // Lock AŽ ZDE:
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  ```
- **Problém**: Mezi kontrolou a zamčením může jiný request přiřadit uživatele ke smazávané roli. Role se smaže, ale uživatel má neexistující roli.
- **Závažnost**: Střední. GAS je single-threaded per execution, ale souběžné requesty jsou možné.
- **Oprava**: Přesunout check UVNITŘ locku.

#### C2. `updateUserLastVisit_()` bez zámku
- **Soubor**: `Kód.js`, řádek 1032
- **Problém**: Čte celý sheet (`getDataRange().getValues()`), najde řádek a zapíše (`setValues()`). Při dvou souběžných voláních (rychlá re-návštěva) může dojít k přepsání dat.
- **Závažnost**: Nízká — maximální škoda: `lastVisitAt` bude o sekundy starší.

#### C3. Chybí validace existence uživatele a dlaždice v `saveSubAppPermission()`
- **Soubor**: `Kód.js`, řádek 1315
- **Problém**: Funkce přijme `userId`, `email` a `subAppKey` bez ověření, zda daný uživatel existuje v USERS sheetu a zda daná dlaždice existuje v SUBAPPS sheetu.
- **Dopad**: Do SUBAPP_PERMISSIONS lze vložit "oprávnění" pro neexistující uživatele nebo dlaždice. Neohrozí bezpečnost, ale zanechá "waivers" data v sheetu.

### D. Potenciální problémy

#### D1. Text-based reference na umístění v USERS
- **Problém**: Uživatelé mají uložený `locationName` (textový display string) namísto `locationId`. Při přejmenování LC (změna abbreviation/city) se locationName v existujících uživatelích nestane automaticky neplatným — ale ani se neaktualizuje.
- **Závažnost**: Nízká — je to vědomé designové rozhodnutí (jednodušší schema).

#### D2. `ensureDatabase_()` — destruktivní mazání na transientní chybu
- **Problém**: Při jakékoliv výjimce (včetně transientní, např. `SpreadsheetApp.openById` timeout) se volá `PropertiesService.getScriptProperties().deleteProperty('DATABASE_INFO_V2')`. Po smazání reference je databáze "ztracena" — aplikace bude chybovat pro všechny uživatele.
- **Závažnost**: Střední. Transientní chyby Google API (krátkodobé výpadky) mohou způsobit výpadek aplikace pro všechny.
- **Oprava**: Rozlišovat typy výjimek — smazat cache pouze při trvalé chybě (DB neexistuje), ne při síťových chybách.

---

## 4. BEZPEČNOSTNÍ AUDIT

### 4.1 Autentizace a autorizace

| Oblast | Stav | Poznámka |
|---|---|---|
| Identita uživatele | ✅ Bezpečné | `Session.getActiveUser().getEmail()` — Google OAuth |
| Autorizace endpointů | ✅ Bezpečné | Všechny write endpointy volají `requirePermission_()` |
| Wildcard permission | ✅ Správné | `hasPermission_()` kontroluje `*` na indexu 0 |
| Ochrana superadmina | ✅ Implementováno | `assertLastSuperadminIsProtected_()` |
| Ochrana systémových rolí | ✅ Implementováno | SUPERADMIN, ADMIN, EDITOR, VIEWER nelze smazat |
| Ochrana Centrály | ✅ Implementováno | Centrála nelze smazat (type check) |

### 4.2 Privilege Escalation — STŘEDNÍ RIZIKO

**Problém**: Uživatel s rolí ADMIN (oprávnění `users.manage`) může přes UI "Role a oprávnění" přidat oprávnění `*` (wildcard) k libovolné roli, a tím si nebo jiným uživatelům udělit plný přístup na úrovni SUPERADMIN.

**Tok útoku**:
1. Admin má `users.manage`
2. Admin otevře sekci "Role" → klikne na správu oprávnění libovolné role
3. Přidá `*` permission (UI to neblokuje — je v `knownPermissions` listu)
4. Přiřadí tuto roli uživateli
5. Uživatel má fakticky superadmin přístup

**Závažnost**: Střední — vyžaduje existujícího admina s úmyslem eskalovat.

**Oprava**: Přidat separátní oprávnění `roles.manage` pro správu rolí a oprávnění. `users.manage` by mělo pokrývat pouze CRUD uživatelů.

### 4.3 XSS (Cross-Site Scripting)

| Oblast | Stav |
|---|---|
| HTML rendering v renderUsers() | ✅ `this.escape()` na všech datech |
| HTML rendering v renderLocations() | ✅ `this.escape()` |
| Changelog modal rendering | ✅ `this.escape()` na textech tagů a položek |
| data-* atributy v renderUsers() | ✅ `${this.escape(user.id)}` |
| openModal title/body | ✅ `setText()` → textContent (ne innerHTML) |
| GAS template output | ✅ `<?= ?>` (escaped) pro user-visible data |
| JSON embed do window | ✅ `JSON.stringify()` správně escapuje |
| setSelectOptions value/label | ✅ `this.escape()` |

**Závěr**: XSS ochrana je konzistentní a správná. Bez zjištěných zranitelností.

### 4.4 Validace vstupů (server-side)

| Funkce | Validace | Stav |
|---|---|---|
| `saveUser()` | email, firstName, lastName, location, department, role check | ⚠️ 2 error msg bez diakritiky (B1) |
| `saveLocation()` | code required pro LC, city required pro LC | ✅ |
| `saveDepartment()` | name required, duplicate check | ✅ |
| `saveSubApp()` | name required, status whitelist, https:// check | ✅ |
| `saveSubAppPermission()` | userId/email required, subAppKey required, accessLevel whitelist | ⚠️ chybí existence check (C3) |
| `saveRole()` | roleKey, roleName required | ✅ |
| `saveRolePermission()` | roleKey, permissionKey required | ⚠️ permissionKey není validován proti whitelist |

**Poznámka k `saveRolePermission()`**: `permissionKey` přijme libovolný string — lze přidat neznámá "oprávnění", která budou ignorována `hasPermission_()`, ale znečistí ROLE_PERMISSIONS data.

### 4.5 OAuth scopes

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/spreadsheets"
]
```

**Hodnocení**: ✅ Výborné — minimální nutná oprávnění. Bez Drive, Gmail, Docs nebo jiných širokých scopů.

### 4.6 URL validace

- `validateSubAppPayload_()` vyžaduje `https://` prefix ✅
- Žádná SSRF ochrana není nutná (URL není server-side fetchována, jen uložena a klient ji otevírá přes `window.open`)

---

## 5. VÝKON A ŠKÁLOVATELNOST

### 5.1 Počet Sheets API volání na operaci

| Operace | Čtení | Zápis | Cache |
|---|---|---|---|
| Načtení stránky (`getInitData`) | 5–6 sheety | 1 (lastVisit) | ✅ DB ref |
| `saveUser` | 3 (USERS, ROLES, validate) | 1 | ✅ DB ref |
| `deleteUser` | 1 | 1 (delete row) | ✅ DB ref |
| `saveSubApp` | 1 | 1 | ✅ DB ref |
| `deleteSubApp` | 2 | 1+cascade | ✅ DB ref |
| `saveLocation` | 1 | 1 | ✅ DB ref |
| `deleteLocation` | 3 | 1 | ✅ DB ref |

**Hodnocení**: Rozumný počet. `getInitData` je nejdražší (načítá vše najednou), ale volá se pouze jednou při startu.

### 5.2 CacheService — efektivita

- CacheService klíč `DATABASE_INFO_V2` uchovává `{id, schemaVersion}` — eliminuje `PropertiesService` lookup při každém volání ✅
- Cache TTL není explicitně nastavena → defaultní 600 sekund (10 minut)
- **Problém D2**: Při chybě se cache smaže — zbytečný cache miss při příštím volání

### 5.3 LockService — správné použití

- `lock.waitLock(10000)` — 10 sekund max čekání
- Všechna write volání správně v `try/finally` s `lock.releaseLock()` ✅
- Výjimka: `deleteRole()` má check mimo lock (viz C1)

### 5.4 Škálovatelnost

- Spreadsheet limit: 10M buněk / list
- Pro 100 uživatelů, 50 subApps: zanedbatelné
- Pro 1000+ uživatelů: `buildUsersAdminData_()` načítá 6 sheety najednou — může se přiblížit k 30s GAS limitu
- `getDataRange().getValues()` je vždy jeden API call (batch read) — správná praxe ✅

### 5.5 Frontend výkon

- SVG sprite v index.html inline — eliminuje extra HTTP requesty ✅
- `setInterval(update, 30000)` pro hodiny — minimální zátěž ✅
- Optimistické UI updaty — okamžitá odezva bez čekání na server ✅
- `setInterval` pro hodiny: 30 sekund refresh pro minutový display — mírné přebytečné volání, ale zanedbatelné

---

## 6. KVALITA KÓDU

### 6.1 Obecné hodnocení

| Oblast | Hodnocení | Komentář |
|---|---|---|
| Konzistentnost | ✅ Dobrá | Sjednocené vzory napříč funkcemi |
| Čitelnost | ✅ Dobrá | Jasná pojmenování, JSDoc u klíčových funkcí |
| Defensivní programování | ✅ Dobrá | `String(x || '')`, `isTruthy_()`, null checks |
| Error propagation | ✅ Dobrá | throw Error → catch v callServer → toast |
| Logging | ✅ Dobrá | Konzistentní `Logger.log('[TAG]')` formát |
| DRY (Don't Repeat Yourself) | ✅ Dobrá | `mapLocationRow_`, `buildUserRow_`, `rowToObject_` |
| Modularita | ⚠️ Průměrná | Vše v jednom Kód.js souboru (1 629 řádků) |

### 6.2 Specifické postřehy

#### 6.2.1 Dobrý vzor — `normalizeXPayload_` / `validateXPayload_`
Všechny save funkce používají normalizaci a validaci jako samostatné kroky:
```js
const data = normalizeUserPayload_(payload);  // sanitizace vstupů
validateUserPayload_(data, spreadsheet);       // business rules check
```
Čistá separace zodpovědností. ✅

#### 6.2.2 Dobrý vzor — `optimisticUpdate()` v client kódu
```js
optimisticUpdate(
  () => { /* okamžitá UI změna */ },
  () => callServer(...),
  (data) => { /* aktualizace z odpovědi serveru */ },
  'Zpráva o úspěchu'
)
```
Snapshot/restore pro rollback při chybě. Elegantní a konzistentní. ✅

#### 6.2.3 Dobrý vzor — `escape()` helper
```js
escape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
```
Správná implementace HTML escape. Použita důsledně. ✅

#### 6.2.4 Bug — `saveRole()` — `!targetRow` nikdy true
- **Soubor**: `Kód.js`, řádek 1473
- `targetRow` je inicializováno na `-1`. Výraz `!(-1)` je `false`.
- Podmínka `if (!targetRow) map.createdAt = now` je NIKDY splněna.
- Správně: `if (targetRow <= 0) map.createdAt = now`.

#### 6.2.5 `isAdminAuth_()` — kombinace systemRole a accessRole
Pokud má uživatel VIEWER systemRole ale SUPERADMIN accessRole, dostane admin přístupy. Je záměrné, ale dvousystémové role mohou být matoucí.

#### 6.2.6 `knownPermissions` je hardcoded
```js
knownPermissions: ['*', 'dashboard.view', 'users.manage'],
```
Nová oprávnění musí být přidána manuálně na dvou místech. Není dynamicky odvozeno z ROLE_PERMISSIONS.

#### 6.2.7 Potenciálně nepoužívané metody
`setUsersLoading()` a `renderUsersError()` v `scripts.html` (řádky 434, 490) — volání v kódu nebylo nalezeno. Pravděpodobně pozůstatek z dřívější implementace. Prověřit před smazáním.

### 6.3 Diakritika — přehled zbývajících chyb

| Soubor | Řádek | Chybný text | Správně |
|---|---|---|---|
| `Kód.js` | 1124 | `'Vybrana systemova role neexistuje.'` | `'Vybraná systémová role neexistuje.'` |
| `Kód.js` | 1127 | `'Vybrana role pristupu neexistuje.'` | `'Vybraná role přístupu neexistuje.'` |
| `Kód.js` | 526 | `'Centrala'` (locationName seed) | `'Centrála'` |
| `Kód.js` | 534 | `'Prvni superadmin vytvoren'` (log only) | `'První superadmin vytvořen'` |

---

## 7. ZÁVĚREČNÝ REPORT

### Souhrnné skóre

| Oblast | Hodnocení | Skóre |
|---|---|---|
| Architektura | Čistá, dobře navržená | ⭐⭐⭐⭐⭐ |
| Bezpečnost (XSS/injection) | Bez zjištěných zranitelností | ⭐⭐⭐⭐⭐ |
| Bezpečnost (autorizace) | Privilege escalation riziko | ⭐⭐⭐☆☆ |
| Validace vstupů | Dobrá, s drobnými mezerami | ⭐⭐⭐⭐☆ |
| Výkon | Optimální pro daný stack | ⭐⭐⭐⭐⭐ |
| Stabilita (race conditions) | Jedno reálné riziko | ⭐⭐⭐☆☆ |
| Kvalita kódu | Dobrá, konzistentní | ⭐⭐⭐⭐☆ |
| **Celkem** | | **⭐⭐⭐⭐☆** |

### Prioritizovaný seznam akcí

#### 🔴 Opravit okamžitě (způsobuje viditelnou nebo tichou chybu)

| # | Problém | Soubor | Řádky |
|---|---|---|---|
| 1 | Chybějící diakritika v chybových hlášeních | `Kód.js` | 1124, 1127 |
| 2 | `saveRole()` — `createdAt` nikdy nenastaveno (bug `!targetRow`) | `Kód.js` | 1473 |
| 3 | Seed superadmina — locationName bez diakritiky (`'Centrala'`) | `Kód.js` | 526 |

#### 🟡 Opravit v příštím vydání (logická nebo bezpečnostní chyba)

| # | Problém | Soubor |
|---|---|---|
| 4 | Race condition v `deleteRole()` — check mimo lock | `Kód.js` |
| 5 | Chybí validace existence user/subApp v `saveSubAppPermission()` | `Kód.js` |
| 6 | `ensureDatabase_()` — destruktivní mazání na transientní chybu | `Kód.js` |
| 7 | Privilege escalation — `users.manage` umožňuje přidat `*` permission | `Kód.js` + `scripts.html` |

#### 🔵 Technický dluh (žádoucí, ne urgentní)

| # | Problém | Soubor |
|---|---|---|
| 8 | Duplicitní `window.APP_CHANGELOG` (je i v `APP_BOOTSTRAP`) | `index.html` |
| 9 | `saveRolePermission()` — permissionKey bez whitelist validace | `Kód.js` |
| 10 | `knownPermissions` hardcoded — není dynamické | `Kód.js`, `scripts.html` |
| 11 | Nepoužívané metody `setUsersLoading()`, `renderUsersError()` — prověřit | `scripts.html` |
| 12 | Text-based locationName v USERS (bez FK) — omezení při přejmenování | design decision |
| 13 | Log zpráva `'Prvni superadmin vytvoren'` bez diakritiky | `Kód.js` řádek 534 |

### Shrnutí

Aplikace OZ Dashboard je technicky solidní projekt s dobrou architekturou, konzistentním kódem a velmi dobrou XSS ochranou. Největší technický dluh leží ve třech oblastech:

1. **Diakritika** — zbývají 4 místa (2 v error hlášeních, 1 v seed datech, 1 v logu)
2. **Drobné logické bugy** — zejména `!targetRow` v `saveRole()` je tichá chyba způsobující prázdný `createdAt` u nových rolí; seed dat bez diakritiky způsobí UX nesrovnalost pro prvního superadmina
3. **Privilege escalation** — vědomá mezera v systému rolí, která by v produkci potenciálně umožnila admin uživateli získat superadmin přístup přes UI správy oprávnění

Kritické chyby z předchozí verze (scope bug v `getInitData`, ReferenceError v template, deploy regex chyba) jsou **opraveny**. Aplikace je provozuschopná a stabilní.

---

*Audit zpracován ze zdrojových souborů: Kód.js (1 629 ř.), scripts.html (1 491 ř.), index.html (531 ř.), styles.html (~3 260 ř.), Config.js (107 ř.), appsscript.json (12 ř.)*
*Datum: 2026-05-16 | Verze: v0.4.1*
