# OZ Dashboard — pokyny pro Claude

## Po každé dokončené sérii úprav VŽDY spusť deploy

Jakmile jsou kódové změny commitnuté, spusť deploy skript:

```powershell
.\deploy.ps1 -Bump <typ> -Changes 'Popis změny 1', 'Popis změny 2', ...
```

Skript automaticky:
1. Ověří čisté pracovní stromě
2. Provede `git pull --rebase`
3. Aktualizuje `version` a `APP_CHANGELOG` v `Config.js`
4. Commitne (`Release vX.Y.Z`)
5. Pushne na GitHub (`git push`)
6. Pushne do Google Apps Script (`clasp push`)

---

## Pravidla pro volbu typu verze (Bump)

| Typ     | Kdy použít                                                      | Příklad             |
|---------|------------------------------------------------------------------|---------------------|
| `patch` | Opravy chyb, diakritika, texty, drobné CSS úpravy              | v0.2.0 → v0.2.1     |
| `minor` | Nové funkce, nové stránky/modaly, nové serverové endpointy     | v0.2.1 → v0.3.0     |
| `major` | Architektonické přepsání, změny databázového schématu, breaking | v0.3.0 → v1.0.0     |

---

## Pravidla pro psaní changelog záznamů

- Psát česky, s diakritikou
- Začínat slovesem v příčestí trpném nebo přidaném: `Přidán`, `Opravena`, `Optimalizováno`, `Odstraněno`
- Stručně a výstižně — max 1 věta na záznam
- Nezmiňovat interní detaily implementace (typy proměnných, helper funkce, JSDoc)
- Uvádět jen to, co je viditelné nebo relevantní pro uživatele/správce

### Příklady dobrých záznamů
- `Přidána správa rolí a oprávnění`
- `Opravena diakritika v chybových zprávách`
- `Kliknutí na číslo verze otevře historii změn`
- `Optimalizováno načítání — stránka nyní potřebuje jediné volání serveru`

### Příklady špatných záznamů
- `var → const/let refaktoring` ❌ (interní detail)
- `Přidána funkce mapLocationRow_()` ❌ (interní implementace)
- `Fix` ❌ (příliš vágní)

---

## Struktura projektu

| Soubor           | Obsah                                      |
|------------------|--------------------------------------------|
| `Kód.js`         | Serverový kód (Google Apps Script)         |
| `index.html`     | HTML šablona stránky                       |
| `scripts.html`   | Klientský JavaScript                       |
| `styles.html`    | CSS styly                                  |
| `Config.js`      | Konfigurace aplikace + changelog           |
| `appsscript.json`| Manifest GAS (OAuth scopes, runtime)       |
| `deploy.ps1`     | Deploy skript (verze + git + clasp)        |

## Technické detaily

- **Runtime:** Google Apps Script V8
- **Databáze:** Google Sheets (vytvořen automaticky při prvním spuštění)
- **Cache:** `CacheService` klíč `DATABASE_INFO_V2` (TTL 6 h)
- **Zámky:** `LockService.getScriptLock()` pro všechny write operace
- **Autorizace:** `requirePermission_(permission)` před každou write funkcí
- **Verze:** Sémantické verzování, uloženo v `Config.js` → `APP_CONFIG.version`
