const APP_CONFIG = {
  appName: 'OZ Dashboard',
  appSubtitle: '',
  logoFileId: '18mu_Lq1F_FqqSZcolMjLwG0aaQDPMdyD',
  logoUrl: 'https://drive.google.com/thumbnail?id=18mu_Lq1F_FqqSZcolMjLwG0aaQDPMdyD&sz=w320',
  version: 'v0.10.0',
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
    version: 'v0.10.0',
    date: '2026-05-21',
    changes: [
      'Sjednocena výška chipů filtrů (30 px pro všechny skupiny)',
      'Redesign label tabů LC/VT/RM s napojením na chip control',
      'Jasné barevné rozlišení příbuzných (žlutá) a nepříbuzných (dim) chipů',
      'Opraven hover záhlaví tabulky — zůstává modré',
      'RM filtr nahrazen vlastním searchable dropdown',
      'Redesign popup filtru sloupce s modrým headerem a grid tlačítky',
      'Odstraněny zbytečné mezery ve filtrovací liště a nad tabulkou',
    ],
  },
  {
    version: 'v0.9.5',
    date: '2026-05-21',
    changes: [
      'Zhutněny okraje rychlých filtrů filiálek',
      'Názvy filtrů LC VT RM přesunuty nad ovládací prvky',
      'Navázané hodnoty filtrů jsou výrazněji zvýrazněné',
      'Odstraněn sync čas z hlavičky přehledu filiálek',
      'Barevně zvýrazněna hlavička tabulky filiálek',
    ],
  },
  {
    version: 'v0.9.4',
    date: '2026-05-21',
    changes: [
      'RM filtr filiálek vrácen do kompaktního rozevíracího seznamu',
      'Výběr RM automaticky nastaví navázané VT a LC',
      'Zhutněny okraje rychlých filtrů a hodnotového filtru sloupců',
      'Barevně zvýrazněny nadpisy filtrů LC VT RM',
    ],
  },
  {
    version: 'v0.9.3',
    date: '2026-05-21',
    changes: [
      'Vylepšen vzhled rychlých filtrů filiálek',
      'Rychlé filtry LC VT RM nově zvýrazňují navázané hodnoty',
      'Zkompaktněn hodnotový filtr sloupců',
      'Zafixovány šířky sloupců v přehledu filiálek',
    ],
  },
  {
    version: 'v0.9.2',
    date: '2026-05-21',
    changes: [
      'Opravena normalizace českých telefonních čísel při importu filiálek',
      'Import odstraní jednu nadbytečnou nulu za předvolbou +420 nebo na začátku lokálního čísla',
    ],
  },
  {
    version: 'v0.9.1',
    date: '2026-05-21',
    changes: [
      'Vylepšen vzhled přehledu filiálek',
      'Vyhledávání a statistika přesunuty do hlavičky',
      'Přidány rychlé filtry LC VT RM',
      'Přidán hodnotový filtr sloupců ve stylu Excelu',
      'Tabulka filiálek využívá dostupnou výšku panelu',
    ],
  },
  {
    version: 'v0.9.0',
    date: '2026-05-21',
    changes: [
      'Opraveno zobrazení otevíracích časů filiálek',
      'Ve sloupci Číslo se zobrazuje jen číslo filiálky',
      'Ukotvena hlavička tabulky filiálek při rolování',
      'Přidáno řazení a filtrování po kliknutí na záhlaví sloupce',
    ],
  },
  {
    version: 'v0.8.2',
    date: '2026-05-21',
    changes: [
      'Opraven import čísla filiálky ze sloupce Č.prodejny',
      'Opraven import otevíracích a zavíracích časů ze sloupců otevřeno/zavřeno',
      'Doplněna normalizace telefonů prodejen a RM do formátu +420 000 000 000',
      'Doplněno mapování hodnoty lc také do sloupce abbreviation',
    ],
  },
  {
    version: 'v0.8.1',
    date: '2026-05-21',
    changes: [
      'Přesunuto nastavení zdrojové složky filiálek do Nastavení > Filiálky',
      'Záložka Filiálky nyní zobrazuje pouze přehled prodejen',
      'Zkompaktněna statistika filiálek v přehledu',
      'Pole zdrojové složky filiálek nově přijímá ID i celou Drive URL',
    ],
  },
  {
    version: 'v0.8.0',
    date: '2026-05-21',
    changes: [
      'Přidána záložka Filiálky s přehledem prodejen, LC, VT a RM',
      'Přidána synchronizace filiálek z nejnovějšího Google Sheet souboru ve zdrojové složce',
      'Přidána infrastruktura první subaplikace Vyhodnocení odpisů akčních artiklů včetně vlastního Drive prostoru',
      'Rozšířeno databázové schéma o list FILIALKY a oprávnění branches.view / branches.sync',
    ],
  },
  {
    version: 'v0.7.2',
    date: '2026-05-16',
    changes: [
      'Opraveno tlacitko Zrusit v modalu editace role – nevracelo reakci kvuli spatne data-action hodnote',
    ],
  },
  {
    version: 'v0.7.1',
    date: '2026-05-16',
    changes: [
      'Opravena viditelnost tlacítek Zrusit/Ulozit v modalu dlazdice – modal-body nyne scrolluje samostatne',
    ],
  },
  {
    version: 'v0.7.0',
    date: '2026-05-16',
    changes: [
      'Refaktoring: Kod.js rozdelenm na 9 modularnych souboru',
      'Refaktoring: scripts.html preorganizovan do 15 sekci s JSDoc',
      'Odstranen mrtvy kod: setUsersLoading, renderUsersError, getLoaderText',
      'Interni: LOADER_TEXTS a SYSTEM_ROLE_KEYS jako modulove konstanty',
    ],
  },
  {
    version: 'v0.6.0',
    date: '2026-05-16',
    changes: [
      'Přidáno vyhledávání uživatelů — filtr podle jména, e-mailu a úseku v reálném čase',
      'Přidán filtr podle role přístupu a stavu (aktivní / neaktivní)',
      'Přidáno řazení podle sloupce (kliknutím na hlavičku) se zobrazením směru řazení',
      'Přidán export viditelných uživatelů do CSV (s BOM pro správné zobrazení diakritiky v Excelu)',
      'Counter uživatelů zobrazuje počet filtrovaných záznamů z celkového počtu',
      'roles.manage přidáno do seed oprávnění role ADMIN',
    ],
  },
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
