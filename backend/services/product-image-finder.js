/**
 * КУДРИ · фоновый поиск фото товара.
 * Запускается «огнём-и-забыть» из POST /api/scans/full-photo сразу после
 * успешного createScan — не блокирует ответ пользователю.
 *
 * Идёт в ai-router.findProductImage (роль 'image_search', провайдер gemini
 * с tool googleSearch) и сохраняет результат в БД через
 * scans.updateScanProductImage.
 */

const aiRouter = require('./ai-router');
const scansService = require('./scans');
const { log } = require('./logger');

async function findAndSaveProductImage(scanId, brand, productName) {
  if (!brand || !productName) return;

  try {
    const result = await aiRouter.findProductImage({ brand, productName });
    scansService.updateScanProductImage(scanId, {
      url: result.url,
      status: result.status
    });
    log.info(null, '[product-image-finder]', `scanId=${scanId} status=${result.status}`);
  } catch (err) {
    try {
      scansService.updateScanProductImage(scanId, { url: null, status: 'failed' });
    } catch (innerErr) {
      log.error(null, '[product-image-finder]', innerErr);
    }
    log.error(null, '[product-image-finder]', `scanId=${scanId} err=${err.message}`);
  }
}

module.exports = { findAndSaveProductImage };
