# OZ Dashboard – Výsledky technického auditu a implementované opravy

> **Verze:** 1.0  
> **Datum:** 2026-05-15  
> **Revize:** Dvě nezávislé analýzy (interní + `TECHNICKY_AUDIT.md`)  
> **Hodnocení před opravami:** 5 / 10  

---

## 1. Rozsah analýzy

Auditovány byly čtyři soubory Google Apps Script projektu:

| Soubor | Popis |
|---|---|
| `Kód.js` | Hlavní serverový soubor (~1 000+ řádků) |
| `index.html` | HTML šablona aplikace |
| `scripts.html` | Klientský JavaScript |
| `appsscript.json` | Manifest (OAuth scope, runtime) |

---

## 2. Přehled nálezů

### 2.1 Kritické (blocker / bezpečnostní riziko)

| # | Oblast | Problém |
|---|---|---|
| K1 | Autentizace | `getSignedInUser_()` — fallback na `EffectiveUser` způsoboval tiché přihlášení pod servisním účtem namísto reálného uživatele |
| K2 | Integrita dat | `ensureSheet_()` volalo `sheet.clear()` při každém startu, čímž mazalo produkční data při změně schématu |
| K3 | Auditovatelnost | `seedInitialUserIfNeeded_()` nelogoval vytvoření prvního superadmina |

### 2.2 Střední (bug / funkční regrese)

| # | Oblast | Problém |
|---|---|---|
| S1 | UI – dashboard | `renderModules()` volalo `iconId()` místo `iconSymbol()` — ikony z Lidl katalogu se zobrazovaly jako fallback |
| S2 | UI – formulář | `targetUrl` chybělo v editačním formuláři dlaždice — pole bylo pouze v databázi, nelze ho editovat |
| S3 | Autorizace | `listDashboardSubApps_()` ignorovalo tabulku `SUBAPP_PERMISSIONS` — `accessLevel` se uživateli nikdy neposlal |
| S4 | Autorizace | `getHomeData()` nekontrolovalo oprávnění `dashboard.view` — data se vracela i uživatelům bez tohoto práva |
| S5 | Integrita dat | `deleteLocation` / `deleteDepartment` nehlídaly referenční integritu — šlo smazat entitu, která je stále používána |
| S6 | Integrita dat | `deleteSubApp` po sobě neuklidilo záznamy v `SUBAPP_PERMISSIONS` — v tabulce zůstávaly osiřelé řádky |

### 2.3 Výkonnostní (latence / kvóty)

| # | Oblast | Problém |
|---|---|---|
| V1 | Overhead | `ensureDatabase_()` vytvářelo nový spreadsheet nebo volalo `openById` při každém requestu — 15–25 zbytečných API volání |
| V2 | Overhead | `getUsersAdminData()` / `getLocationsData()` / `getDepartmentsData()` volaly `getCurrentUserContext_()` dvakrát |

### 2.4 Technický dluh

| # | Oblast | Problém |
|---|---|---|
| T1 | OAuth | `appsscript.json` obsahoval 2 nepoužívané OAuth scope (`script.external_request`, `directory.readonly`) |
| T2 | Bezpečnost | Chyběla whitelist validace `systemRole` v `validateUserPayload_()` |
| T3 | Bezpečnost | Chyběla validace protokolu `targetUrl` v `validateSubAppPayload_()` |
| T4 | Bezpečnost | 8 CRUD funkcí nepoužívalo `LockService` — souběžné zápisy mohly způsobit race condition |
| T5 | Auditovatelnost | Žádná CRUD funkce nelogovala mutace — audit trail neexistoval |
| T6 | UI | Sidebar zobrazoval hardcoded `Superadmin - OZ` místo dynamické role přihlášeného uživatele |
| T7 | Mrtvý kód | `scripts.html` obsahoval 4 mrtvé funkce: `loadUsers()`, `loadLocations()`, `loadDepartments()`, `toDateTimeLocalValue()` |
| T8 | Chybové stavy | `loadAllSettings()` mělo prázdný `catch(() => {})` — chyby se tiše spolykaly |

---

## 3. Implementované opravy

### Oprava K1 – Odstranění EffectiveUser falbacku

**Soubor:** `Kód.js` – funkce `getSignedInUser_()`

**Původní problém:** Při chybném nastavení nasazení (`Execute as: Me`) vrátil `getActiveUser()` prázdný řetězec. Kód pak tiše přepnul na `getEffectiveUser()` (servisní účet) — uživatel byl autentizován pod cizí identitou bez jakéhokoliv varování.

**Oprava:** Fallback odstraněn. Pokud `getActiveUser()` vrátí prázdný řetězec, funkce vyhodí explicitní chybu s návodem pro administrátora:

```js
function getSignedInUser_() {
  const email = Session.getActiveUser().getEmail();
  if (email) return email;
  throw new Error(
    'Nepodařilo se zjistit identitu přihlášeného uživatele. ' +
    'Zkontrolujte nastavení nasazení: "Execute as" musí být ' +
    '"User accessing the web app".'
  );
}
```

---

### Oprava K2 – Nedestruktivní migrace schématu

**Soubor:** `Kód.js` – funkce `ensureSheet_()`

**Původní problém:** Funkce při každém spuštění volala `sheet.clear()`, čímž mazala celý list před jeho znovu-vytvořením. Jakákoliv změna schématu (přidání sloupce) v produkci vedla ke ztrátě dat.

**Oprava:** Kompletní přepis logiky:
- Pokud list neexistuje → vytvoří ho, zapíše hlavičky, seed řádky
- Pokud list existuje → porovná existující sloupce s požadovanými, chybějící **přidá na konec**, existující se nedotýká
- Seed řádky se zapíší pouze pokud je list prázdný (`lastRow < 2`)

---

### Oprava V1 – CacheService v ensureDatabase_()

**Soubor:** `Kód.js` – funkce `ensureDatabase_()`

**Původní problém:** Každý request hledal spreadsheet znovu — `PropertiesService.getProperty()` + `SpreadsheetApp.openById()` + potenciálně `setupDatabaseSheets_()`. Na vytíženém nasazení 15–25 zbytečných API volání per request.

**Oprava:** Tříúrovňový fast-path:
1. **CacheService** (TTL 6 h) — nejrychlejší, bez I/O
2. **PropertiesService** — pokud cache expirovala, obnoví ji
3. **LockService + setupDatabaseSheets_()** — pouze při prvním spuštění nebo obnově po smazaném spreadsheetu

---

### Oprava V2 – Eliminace dvojitého getCurrentUserContext_()

**Soubor:** `Kód.js`

Extrakce `buildUsersAdminData_(context)`, `buildLocationsData_(context)`, `buildDepartmentsData_(context)` — přijímají již vyřešený context a neprovádějí znovu autentizaci.

---

### Oprava T1 – Minimalizace OAuth scope

**Soubor:** `appsscript.json`

Odstraněny 2 nepoužívané scopy — `script.external_request` a `directory.readonly`:

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/spreadsheets"
]
```

---

### Oprava T2 – Validace systemRole

**Soubor:** `Kód.js` – funkce `validateUserPayload_()`

```js
const VALID_SYSTEM_ROLES = ['SUPERADMIN', 'ADMIN', 'USER'];
if (!VALID_SYSTEM_ROLES.includes(payload.systemRole)) {
  throw new Error('Neplatná systémová role.');
}
```

---

### Oprava T3 – Validace protokolu targetUrl

**Soubor:** `Kód.js` – funkce `validateSubAppPayload_()`

```js
if (payload.targetUrl && !payload.targetUrl.match(/^https?:\/\//)) {
  throw new Error('targetUrl musí začínat https:// nebo http://.');
}
```

---

### Oprava T4 – LockService pro CRUD operace

**Soubor:** `Kód.js` – všechny write funkce

Všech 8 funkcí (`saveUser`, `deleteUser`, `saveLocation`, `deleteLocation`, `saveDepartment`, `deleteDepartment`, `saveSubApp`, `deleteSubApp`) obaleno `LockService.getScriptLock()` s `waitLock(10000)` kolem kritické sekce čti-modifikuj-zapiš.

---

### Oprava T5 – Audit log

**Soubor:** `Kód.js`

Každá mutující operace loguje do Stackdriveru:

```
[USER_CREATE/UPDATE/DELETE] by=email id=uuid
[LOCATION_CREATE/UPDATE/DELETE] by=email id=uuid
[DEPT_CREATE/UPDATE/DELETE] by=email id=uuid name=…
[SUBAPP_CREATE/UPDATE/DELETE] by=email id=uuid key=…
[ACCESS] email role=ADMIN/USER
[SEED] Prvni superadmin vytvoren: email v ISO timestamp
```

---

### Oprava T6 – Dynamická role v sidebaru

**Soubor:** `index.html` + `scripts.html`

```html
<!-- bylo -->
<small>Superadmin - OZ</small>
<!-- je -->
<small id="sidebarRole"></small>
```

`applyBootstrap()` naplní element reálnou rolí:

```js
this.setText('#sidebarRole', auth.accessRole || auth.systemRole || '');
```

---

### Oprava T7 – Mrtvý kód

**Soubor:** `scripts.html`

Odstraněny 4 funkce, které nebyly nikde volány: `loadUsers()`, `loadLocations()`, `loadDepartments()`, `toDateTimeLocalValue()`.

---

### Oprava T8 – Tiché spolknutí chyb

**Soubor:** `scripts.html` – funkce `loadAllSettings()`

```js
// bylo
.catch(() => {})
// je
.catch((err) => {
  console.error('[loadAllSettings]', err);
  if (!/permission/i.test(err.message)) {
    this.showToast('Nepodařilo se načíst nastavení.', 'error');
  }
})
```

---

### Oprava S1 – Ikony dlaždic na dashboardu

**Soubor:** `scripts.html` – funkce `renderModules()`

```js
// bylo – vždy použilo fallback ikonu
this.iconId(item.icon)
// je – použije ikonu z Lidl katalogu
this.iconSymbol(item.icon)
```

---

### Oprava S2 – Pole targetUrl ve formuláři dlaždice

**Soubory:** `index.html` + `scripts.html`

Přidáno pole do formuláře, `openSubAppForm()` ho naplní při editaci, `saveSubAppFromForm()` ho posílá v payloadu i optimistickém update.

---

### Oprava S3 – SUBAPP_PERMISSIONS na dashboardu

**Soubor:** `Kód.js` – funkce `listDashboardSubApps_()`

Funkce `getUserSubAppAccess_()` (již existovala, ale nebyla zapojena) je nyní volána a výsledek přidán ke každé dlaždici jako `accessLevel`.

---

### Oprava S4 – Kontrola dashboard.view oprávnění

**Soubor:** `Kód.js` – funkce `getHomeData()`

```js
if (!context.auth.hasAccess || !hasPermission_(context.auth, 'dashboard.view')) { … }
```

---

### Oprava S5 – Referenční integrita při mazání

**Soubor:** `Kód.js`

- `deleteLocation` — blokuje smazání, pokud na location odkazuje DEPARTMENTS přes `locationIds`
- `deleteDepartment` — blokuje smazání, pokud na úsek odkazují aktivní uživatelé přes pole `department`

---

### Oprava S6 – Cleanup SUBAPP_PERMISSIONS při smazání dlaždice

**Soubor:** `Kód.js` – funkce `deleteSubApp()`

Po smazání řádku v SUBAPPS iteruje tabulku SUBAPP_PERMISSIONS od konce a maže všechny záznamy se stejným `subAppKey`.

---

## 4. Souhrn změn po souborech

| Soubor | Typy změn |
|---|---|
| `Kód.js` | Bezpečnost, výkon, integrita dat, logování, autorizace |
| `scripts.html` | Bug fix ikony, formulář, error handling, odebrání mrtvého kódu |
| `index.html` | Formulář targetUrl, dynamická role v sidebaru |
| `appsscript.json` | Odebrání nepoužívaných OAuth scope |

---

## 5. Doporučení do budoucna (mimo rozsah oprav)

- **Testy** — přidat unit testy pro `validateUserPayload_()`, `ensureSheet_()` a lockované CRUD operace
- **Error boundary na klientovi** — wrapper pro `google.script.run` zachytávající neočekávané chyby globálně
- **Stránkování** — při větším počtu uživatelů nebo dlaždic načítat tabulky po stránkách
- **Health check endpoint** — funkce která ověří dostupnost spreadsheetové databáze bez side-effectů
