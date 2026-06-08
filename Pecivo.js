/**
 * OZ Dashboard — Dostupnost pečiva
 *
 * Zpracovává backendovou logiku pro vyhodnocení dostupnosti pečiva.
 */

const PECIVO_SOURCE_FOLDER_ID_PROP = 'PECIVO_SOURCE_FOLDER_ID';

/**
 * Vrátí kompletní data pro subapp Dostupnost pečiva.
 * Přístup: pecivo.view (každý přihlášený uživatel s tímto oprávněním).
 * @returns {Object}
 */
function getPecivoInitData() {
  const context = requirePermission_('pecivo.view');
  
  // Zde bude načítání dat ze spreadsheetu/složek. Prozatím vrátíme základní strukturu.
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PECIVO_SOURCE_FOLDER_ID_PROP) || '';
  
  // Aktualizujeme timestamp na dashboardu
  updateSubAppLastUpdatedByUrl_(context.database.spreadsheet, '?page=pecivo');
  
  return {
    success: true,
    folderId: folderId,
    data: [],
    message: 'Backend subaplikace Dostupnost pečiva je připraven.'
  };
}

/**
 * Uloží ID složky se zdrojovými soubory dostupnosti pečiva.
 * Přístup: pecivo.manage.
 * @param {{ folderId: string }} payload
 * @returns {Object}
 */
function savePecivoSourceFolder(payload) {
  const context = requirePermission_('pecivo.manage');
  const folderId = extractDriveId_(payload && payload.folderId);
  if (!folderId) throw new Error('Vyplňte ID zdrojové složky.');

  // Ověříme existenci složky
  const folder = DriveApp.getFolderById(folderId);
  PropertiesService.getScriptProperties().setProperty(PECIVO_SOURCE_FOLDER_ID_PROP, folder.getId());
  
  Logger.log('[PECIVO_FOLDER_SET] by=%s folder=%s', context.user.email, folder.getId());
  return getPecivoInitData();
}
