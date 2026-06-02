const APP_CONFIG = {
  appName: 'OZ Dashboard',
  appSubtitle: '',
  logoFileId: '18mu_Lq1F_FqqSZcolMjLwG0aaQDPMdyD',
  logoUrl: 'https://drive.google.com/thumbnail?id=18mu_Lq1F_FqqSZcolMjLwG0aaQDPMdyD&sz=w320',
  version: 'v0.20.0',
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
    version: 'v0.20.0',
    date: '2026-06-02',
    changes: [
      'Informacni karty na dashboardu nahrazeny relevantnimi udaji (filialky, logisticka centra, posledni synchronizace, posledni prihlaseni)',
      'Informacni karty jsou nove klikaci a vedou na prislusnou stranku',
      'Karta posledni synchronizace barevne signalizuje stari dat',
      'Ikony karet sjednoceny do zaobleneho ctverce',
    ],
  },
  {
    version: 'v0.19.0',
    date: '2026-06-02',
    changes: [
      'Horni lista s pozdravem a informacni karty sjednoceny do jednoho panelu',
      'Pridan pozdrav podle denni doby (rano/den/vecer/noc)',
      'Osloveni uzivatele nove sklonovano do 5. padu',
      'Informacni karty na dashboardu barevne odliseny',
    ],
  },
  {
    version: 'v0.18.8',
    date: '2026-05-23',
    changes: [
      'Zruseni listy RM filtru',
    ],
  },
  {
    version: 'v0.18.7',
    date: '2026-05-23',
    changes: [
      'Filtr odpisu podle RM z tabulky',
    ],
  },
  {
    version: 'v0.18.6',
    date: '2026-05-23',
    changes: [
      'Vetsi toolbar text a detail podilu',
    ],
  },
  {
    version: 'v0.18.5',
    date: '2026-05-23',
    changes: [
      'Sjednoceni toolbar karet a tooltipu',
    ],
  },
  {
    version: 'v0.18.4',
    date: '2026-05-23',
    changes: [
      'Obnova vzhledu stavoveho chipu',
    ],
  },
  {
    version: 'v0.18.3',
    date: '2026-05-23',
    changes: [
      'Upresneni globalniho akcniho podilu',
    ],
  },
  {
    version: 'v0.18.2',
    date: '2026-05-23',
    changes: [
      'Uprava stavoveho chipu odpisu',
    ],
  },
  {
    version: 'v0.18.1',
    date: '2026-05-23',
    changes: [
      'Stavovy tooltip aktualizace odpisu',
    ],
  },
  {
    version: 'v0.18.0',
    date: '2026-05-22',
    changes: [
      'Přidán automatický monitoring zdrojových souborů odpisů',
      'Trigger každých 30 minut kontroluje mtime všech tří souborů a při změně přegeneruje data',
      'Toolbar Odpisů zobrazuje čas posledního zpracování dat',
      'Odstraněn hover efekt pohybu dlaždic',
    ],
  },
  {
    version: 'v0.17.1',
    date: '2026-05-22',
    changes: [
      'Odstraněn hover efekt pohybu dlaždice',
      'Dlaždice Odpisy se automaticky aktualizuje při každém čerstvém načtení dat',
    ],
  },
  {
    version: 'v0.17.0',
    date: '2026-05-22',
    changes: [
      'Celá dlaždice dashboardu je nyní klikatelná',
      'Přidán hover efekt na aktivní dlaždice',
      'Přidáno pole Poslední aktualizace do formuláře pro úpravu dlaždice',
    ],
  },
  {
    version: 'v0.16.2',
    date: '2026-05-22',
    changes: [
      'Záhlaví dokumentu skryto ve webovém zobrazení (zůstane pro export do PDF)',
      'Záhlaví a footer tabulky pevně ukotveny — přechod na border-collapse: separate odstranil sdílené hranice které způsobovaly průhlednost dat',
      'Svislé oddělovače v tmavém řádku záhlaví jsou viditelné',
      'Hodnoty v peněžních sloupcích jsou vycentrovány',
    ],
  },
  {
    version: 'v0.16.1',
    date: '2026-05-22',
    changes: [
      'Tooltip akčních artiklů je interaktivní — kurzor může vjet do plochy a scrollovat seznam',
      'Tooltip doplněn o sloupec se statusem artiklu (W nebo WW)',
      'Záhlaví tabulky ukotveno jako celek, obě řady záhlaví se při posouvání nepohybují',
      'Footer tabulky pevně ukotven, pod data neprojíždí',
      'Svislé oddělovače v tmavém řádku záhlaví jsou viditelné',
      'Hodnoty v peněžních sloupcích jsou vycentrovány',
      'Přejezd řádku žlutou barvou nepřepisuje červené zvýraznění ve sloupcích procent',
    ],
  },
  {
    version: 'v0.16.0',
    date: '2026-05-22',
    changes: [
      'Záložky logistických center přesunuty do toolbaru vedle tlačítka OZ Dashboard',
      'Název subaplikace vycentrován ve středu toolbaru',
      'Přehledové statistiky (filiálky, akční artikly, akční podíl) přesunuty do toolbaru',
      'Tooltip na čipu akčních artiklů zobrazuje seznam PLU s názvy a vysvětlení výpočtu',
      'Opravena kotvení obou řádků záhlaví tabulky při posouvání',
      'Footer tabulky ukotven při posouvání, barva první buňky sjednocena',
      'Filiálky řazeny abecedně dle RM, skupiny RM střídavě podbarveny',
      'Sloupce % vycentrovány, hodnoty nad průměrem zvýrazněny červeně a tučně bíle',
      'Z hlavičky dokumentu odstraněny popisky roku a KT',
    ],
  },
  {
    version: 'v0.15.0',
    date: '2026-05-22',
    changes: [
      'Přidána lišta s ovládacími prvky a tlačítkem Nastavení',
      'Průměr za LC zobrazuje skutečný průměr na filiálku',
      'Optimalizováno čtení poartiklových odpisů — jediné API volání místo N',
      'Odstraněn debug kód a mrtvé funkce',
    ],
  },
  {
    version: 'v0.14.13',
    date: '2026-05-22',
    changes: [
      'Redeploy opravy poartiklovych odpisu',
    ],
  },
  {
    version: 'v0.14.12',
    date: '2026-05-22',
    changes: [
      'Oprava hlavicky poartiklovych odpisu',
    ],
  },
  {
    version: 'v0.14.11',
    date: '2026-05-22',
    changes: [
      'Debug poartiklovych odpisu',
    ],
  },
  {
    version: 'v0.14.10',
    date: '2026-05-22',
    changes: [
      'Vypocet akcnich odpisu po filialkach',
    ],
  },
  {
    version: 'v0.14.9',
    date: '2026-05-22',
    changes: [
      'Deploy po oprave nacitani Telex PLU',
    ],
  },
  {
    version: 'v0.14.8',
    date: '2026-05-22',
    changes: [
      'Opraven vyber PLU sloupce v Telexu prednostne podle Art Cislo PLU',
      'Parser Telexu ignoruje sloupce s nazvem artiklu pri hledani PLU',
      'Akcni artikly W WW se nyni paruji na ciselne PLU',
    ],
  },
  {
    version: 'v0.14.7',
    date: '2026-05-22',
    changes: [
      'Zrychlen start hlavniho dashboardu bez DB pristupu pri HTML renderu',
      'Administrativni nastaveni se nacita az pri otevreni Nastaveni',
      'Zapis posledni navstevy uzivatele omezen na jednou za 6 hodin',
    ],
  },
  {
    version: 'v0.14.6',
    date: '2026-05-22',
    changes: [
      'Pridan debug panel Telexu v subaplikaci odpisu',
      'Diagnostika zobrazuje rozpoznane soubory, hlavicky, sloupce W WW a ukazky PLU',
      'Doplnen serverovy endpoint getOdpisyDebugData pro ladeni akcnich artiklu',
    ],
  },
  {
    version: 'v0.14.5',
    date: '2026-05-22',
    changes: [
      'Opraveno rozpoznani souboru odpisu po artiklech podle A1 a sirsiho nahledu listu',
      'Doplneno logovani typu zdrojoveho souboru odpisu vcetne MIME typu',
    ],
  },
  {
    version: 'v0.14.4',
    date: '2026-05-22',
    changes: [
      'Optimalizovano nacitani odpisu a cteni pouze potrebnych sloupcu artikloveho souboru',
      'Opravena detekce akcniho priznaku W WW v Telexu',
      'Pridana diagnostika rozpoznani zdrojovych souboru odpisu',
    ],
  },
  {
    version: 'v0.14.3',
    date: '2026-05-22',
    changes: [
      'Samostatna stranka subaplikace Vyhodnoceni odpisu akcnich artiklu',
      'Tolerantnejsi nacitani akcnich artiklu z Telexu',
      'Vzhled odpisu podle sheetove verze s LC zalozkami',
    ],
  },
  {
    version: 'v0.14.2',
    date: '2026-05-22',
    changes: [
      'Opravena automatická migrace URL dlaždice odpisů — shoda podle názvu místo interního klíče',
    ],
  },
  {
    version: 'v0.14.1',
    date: '2026-05-22',
    changes: [
      'Odstraněno pole Cílová URL z nastavení dlaždice — interní URL jsou nastaveny automaticky',
      'Interní URL dlaždic spravovány kódem, při startu aplikace zapsána do databáze',
    ],
  },
  {
    version: 'v0.14.0',
    date: '2026-05-21',
    changes: [
      'Přidána subaplikace Vyhodnocení odpisů akčních artiklů',
      'Dlaždice s URL ve tvaru #viewName otevírá subapp přímo v dashboardu',
      'Přidán server-side modul Odpisy.js pro zpracování tří zdrojových souborů z Drive',
    ],
  },
  {
    version: 'v0.13.2',
    date: '2026-05-21',
    changes: [
      'Sloupec Číslo v tabulce LC zobrazuje pouze číslo bez prefixu LC',
    ],
  },
  {
    version: 'v0.13.1',
    date: '2026-05-21',
    changes: [
      'Opraveno řazení LC chipů ve filtru — nyní numericky dle čísla LC (5, 6, 7…)',
      'Opraveno pole Číslo LC — placeholder upraven na jednoduchý formát',
    ],
  },
  {
    version: 'v0.13.0',
    date: '2026-05-21',
    changes: [
      'Sekce LC a Filiálky přesunuta do Nastavení se záložkami Logistická centra a Nastavení synchronizace',
      'Přehled Filiálek v hlavním menu zůstává jako čistý přehled prodejen bez tabů',
      'Správa LC (CRUD) nyní v sekci Nastavení → LC a Filiálky',
    ],
  },
  {
    version: 'v0.12.0',
    date: '2026-05-21',
    changes: [
      'Záložka Filiálky přejmenována na LC a Filiálky se dvěma přepínatelnými pohledy',
      'Přidána správa logistických center — vytváření, editace a mazání LC',
      'Odstraněn duplicitní sloupec abbreviation z přehledu filiálek',
      'Správa LC využívá existující LOCATIONS infrastrukturu bez zbytečné duplicity dat',
    ],
  },
  {
    version: 'v0.11.0',
    date: '2026-05-21',
    changes: [
      'Přidány unikátní ikony v navigaci (Filiálky, Umístění, Filiálky-nastavení, Role)',
      'Vyhledávání ve filtru sloupce ihned aplikuje výběr do tabulky',
      'Nadpisy filtrů LC/VT/RM vycentrovány a zvětšeny',
      'Opraveno kolísání šířky sloupců při změně RM filtru',
    ],
  },
  {
    version: 'v0.10.1',
    date: '2026-05-21',
    changes: [
      'Redesign hlaviček filtrů: žlutý pruh přes celou šířku karty',
      'Proporcionální distribuce chipů bez prázdných míst',
      'Kompaktní řádky v popup filtru sloupce',
      'Opravena logika tlačítka Vyčistit — odznačí vše',
      'Opraven stav disabled pro Vybrat vše a Vyčistit',
    ],
  },
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
