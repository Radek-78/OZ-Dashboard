/**
 * OZ Dashboard — Dostupnost pečiva
 *
 * Zpracovává backendovou logiku pro vyhodnocení dostupnosti pečiva.
 */

const PECIVO_SOURCE_FOLDER_ID_PROP = 'PECIVO_SOURCE_FOLDER_ID';
const PECIVO_SUBAPP_KEY = 'PECIVO';

/**
 * Vrátí kompletní data pro subapp Dostupnost pečiva.
 * Přístup: pecivo.view (každý přihlášený uživatel s tímto oprávněním).
 * @returns {Object}
 */
function getPecivoInitData() {
  const context = requirePermission_('pecivo.view');
  
  // Zde bude načítání dat ze spreadsheetu/složek. Prozatím vrátíme základní strukturu.
  const folderId = getSubAppSourceFolderId_(context.database.spreadsheet, PECIVO_SUBAPP_KEY, PECIVO_SOURCE_FOLDER_ID_PROP);
  const canConfigure = hasPermission_(context.auth, 'pecivo.manage');
  
  // Aktualizujeme timestamp na dashboardu
  updateSubAppLastUpdatedByUrl_(context.database.spreadsheet, '?page=pecivo');
  
  return {
    success: true,
    configured: !!folderId,
    canConfigure: canConfigure,
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
  const folderId = saveSubAppSourceFolderId_(context, PECIVO_SUBAPP_KEY, payload);
  
  Logger.log('[PECIVO_FOLDER_SET] by=%s folder=%s', context.user.email, folderId);
  return getPecivoInitData();
}
