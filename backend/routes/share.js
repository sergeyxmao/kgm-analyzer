/**
 * КУДРИ · публичный роутер шеринга. Без авторизации.
 * GET /share/:token — рендерит HTML-страницу со сканом.
 */

const express = require('express');
const { getScanByShareToken } = require('../services/scans');
const { renderSharePage, renderNotFoundPage } = require('../services/share-page');
const { log } = require('../services/logger');

const router = express.Router();

router.get('/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const scan = await getScanByShareToken(token);
    if (!scan) {
      res.status(404).type('html').send(renderNotFoundPage());
      return;
    }
    res.type('html').send(renderSharePage(scan));
  } catch (err) {
    log.error(req, '[GET /share/:token]', err);
    res.status(500).type('html').send(renderNotFoundPage());
  }
});

module.exports = router;
