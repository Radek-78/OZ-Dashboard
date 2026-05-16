const APP_CONFIG = {
  appName: 'OZ Dashboard',
  appSubtitle: '',
  logoFileId: '18mu_Lq1F_FqqSZcolMjLwG0aaQDPMdyD',
  logoUrl: 'https://drive.google.com/thumbnail?id=18mu_Lq1F_FqqSZcolMjLwG0aaQDPMdyD&sz=w320',
  version: 'v0.5.0',
  theme: {
    blue: '#0050aa',
    darkBlue: '#002466',
    lightBlue: '#008cd2',
    yellow: '#fff000',
    red: '#e60a14',
    white: '#ffffff',
    black: '#000000',
  },
};

const APP_CHANGELOG = [
  {
    version: 'v0.5.0',
    date: '2026-05-16',
    changes: [
      'Bezpečnost: saveRolePermission() validuje permissionKey proti whitelist, wildcard * blokován přes UI',
      'Bezpečnost: race condition v deleteRole() opravena — kontrola uživatelů probíhá uvnitř locku',
      'Bezpečnost: saveSubAppPermission() ověřuje existenci uživatele a dlaždice před zápisem',
      'Resilience: ensureDatabase_() rozlišuje transientní chyby od trvalých — reference se nesmaže při výpadku API',
      'Přidána funkce checkDataIntegrity() — audit konzistence dat napříč všemi sheety',
      'UI: tlačítko Audit dat v sekci Role spustí kontrolu integrity a zobrazí výsledky',
      'UX: openModal() podporuje víceřádkový text; focus se po zavření vrátí na spouštěcí element',
      'UX: renderRolePerms() odstraněn wildcard * z editovatelných oprávnění; přidáno roles.manage',
    ],
  },
  {
    version: 'v0.4.2',
    date: '2026-05-16',
    changes: [
      'Opravena chybějící diakritika v chybových hlášeních validateUserPayload_ (systémová role, role přístupu)',
      'Opraven bug saveRole() — createdAt se nyní správně nastavuje při vytvoření nové role',
      'Opravena diakritika v seed datech a logu prvního superadmina',
    ],
  },
  {
    version: 'v0.4.1',
    date: '2026-05-16',
    changes: [
      'Opravena kritická chyba — ukládání posledního přihlášení nyní funguje správně',
      'Cílová URL dlaždic nyní vyžaduje výhradně https://',
      'Opraveno escapování textu v modalu changelogu',
    ],
  },
  {
    version: 'v0.4.0',
    date: '2026-05-16',
    changes: [
      'Přepracován changelog modal — širší layout, verze jako karty, barevné tagy typů změn',
      'Přidána automatická detekce typů změn (Nové / Oprava / Výkon / Bezpečnost / Interní / Změna)',
    ],
  },
  {
    version: 'v0.3.3',
    date: '2026-05-15',
    changes: [
      'Opravena chyba — changelog se načítá ze správné šablonové proměnné app.changelog',
    ],
  },
  {
    version: 'v0.3.2',
    date: '2026-05-15',
    changes: [
      'Opravena chyba deploy skriptu — changelog záznamy starších verzí se již nepřepisují',
    ],
  },
  {
    version: 'v0.3.1',
    date: '2026-05-15',
    changes: [
      'Opravena chyba deploy skriptu — verze se nahrazovala i v changelog záznamech',
    ],
  },
  {
    version: 'v0.3.0',
    date: '2026-05-15',
    changes: [
      'Opravena diakritika v chybových zprávách, popiscích a seed datech',
      'Optimalizováno zapisování posledního přihlášení — zápis probíhá pouze při načtení stránky',
      'Kliknutí na číslo verze ve footeru otevře historii změn',
      'Přidán deploy skript pro automatizaci vydávání verzí',
    ],
  },
  {
    version: 'v0.2.0',
    date: '2026-05-15',
    changes: [
      'Přidána správa rolí přístupu a jejich oprávnění',
      'Přidána správa přístupů uživatelů ke dlaždicím (SUBAPP_PERMISSIONS)',
      'Optimalizace: načítání stránky nyní vyžaduje jediné volání serveru místo tří',
      'Optimalizace: databázová cache uchovává ID i verzi schématu (DATABASE_INFO_V2)',
      'Optimalizace: aktualizace posledního přihlášení pouze při načtení stránky',
      'Refaktoring: var → const/let v celém projektu',
      'Přidána pomocná funkce mapLocationRow_() — odstraněna duplikace logiky',
      'Přidána JSDoc dokumentace ke klíčovým serverovým funkcím',
      'Opravena diakritika v chybových a informačních zprávách',
    ],
  },
  {
    version: 'v0.1.1',
    date: '2026-05-01',
    changes: [
      'Oprava: přihlášený uživatel vidí všechny aktivní a připravované dlaždice',
      'Oprava: ochrana posledního aktivního superadmina — nelze odebrat',
      'Přidána podpora cílové URL u dlaždic aplikací',
      'Přidáno zobrazení role uživatele v postranním panelu',
      'Bezpečnost: minimalizace OAuth oprávnění (pouze e-mail a tabulky)',
    ],
  },
  {
    version: 'v0.1.0',
    date: '2026-04-01',
    changes: [
      'Správa uživatelů — vytvoření, úprava, smazání, aktivace',
      'Správa umístění (pobočky LC, centrála)',
      'Správa úseků s vazbou na umístění',
      'Správa dlaždic aplikací s ikonami a stavy',
      'Rolový přístupový systém s granulárními oprávněními',
      'Přihlášení přes Google účet (Google Workspace)',
      'Responzivní postranní panel s možností sbalení',
    ],
  },
];
