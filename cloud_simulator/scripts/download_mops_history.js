'use strict';

const { downloadMopsHistory } = require('../src/mops_history');

downloadMopsHistory({
  startYear: process.env.START_YEAR || 2016,
  endYear: process.env.END_YEAR || new Date().getFullYear(),
  outputDir: process.env.OUTPUT_DIR || 'tmp/mops-history',
  driveParentId: process.env.DRIVE_PARENT_FOLDER_ID || null,
  delayMs: process.env.REQUEST_DELAY_MS || 1500
  ,downloadXbrlArchives: process.env.DOWNLOAD_XBRL_ARCHIVES === '1'
}).then(result => {
  console.log(JSON.stringify({ event: 'mops-history-complete', status: result.status, files: result.files.length, errors: result.errors.length }));
  if (result.status !== 'complete') process.exitCode = 2;
}).catch(error => { console.error(error); process.exitCode = 1; });
