'use strict';

const { GoogleAuth } = require('google-auth-library');

function escapeQuery(value) { return String(value).replaceAll("'", "\\'"); }

class DrivePrimaryWriter {
  constructor(options = {}) {
    this.auth = options.auth || new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
    this.fetchImpl = options.fetchImpl || fetch;
    this.parentFolderId = options.parentFolderId || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '';
    this.folderName = options.folderName || process.env.TWSE_DRIVE_FOLDER_NAME || 'TWSE_MCP_PRIMARY';
    this.bucketName = options.bucketName ?? process.env.GCS_BUCKET ?? '';
    this.storage = options.storage || null;
    this.driveMirrorEnabled = options.driveMirrorEnabled ?? String(process.env.DRIVE_MIRROR_ENABLED || '').trim() === '1';
    this.driveMirrorRequired = options.driveMirrorRequired ?? String(process.env.DRIVE_MIRROR_REQUIRED || '').trim() === '1';
  }

  storageClient() {
    if (!this.storage) {
      const { Storage } = require('@google-cloud/storage');
      this.storage = new Storage();
    }
    return this.storage;
  }

  objectName(name) {
    return `${String(this.folderName).replace(/^\/+|\/+$/g, '')}/${String(name).replace(/^\/+/, '')}`;
  }

  async headers() {
    const client = await this.auth.getClient();
    return client.getRequestHeaders();
  }

  async list(query, fields = 'files(id,name,mimeType,modifiedTime,parents)') {
    const headers = await this.headers();
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=100`;
    const response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Google Drive list HTTP ${response.status}`);
    return (await response.json()).files || [];
  }

  async ensureFolder() {
    if (!this.parentFolderId) throw new Error('TWSE_DRIVE_PARENT_FOLDER_ID is required');
    const query = `'${escapeQuery(this.parentFolderId)}' in parents and name='${escapeQuery(this.folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const existing = await this.list(query);
    if (existing.length) return existing[0].id;
    const headers = await this.headers();
    const response = await this.fetchImpl('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ name: this.folderName, mimeType: 'application/vnd.google-apps.folder', parents: [this.parentFolderId] }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Google Drive create folder HTTP ${response.status}`);
    return (await response.json()).id;
  }

  async upsertDriveText(name, text, mimeType = 'application/json') {
    const folderId = await this.ensureFolder();
    const query = `'${escapeQuery(folderId)}' in parents and name='${escapeQuery(name)}' and trashed=false`;
    const existing = await this.list(query);
    const headers = await this.headers();
    if (existing.length) {
      const response = await this.fetchImpl(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing[0].id)}?uploadType=media&fields=id,name,modifiedTime`, {
        method: 'PATCH', headers: { ...headers, 'content-type': mimeType }, body: text, signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) throw new Error(`Google Drive update ${name} HTTP ${response.status}`);
      return response.json();
    }

    const boundary = `twstock-${Date.now()}`;
    const metadata = JSON.stringify({ name, parents: [folderId], mimeType });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${text}\r\n--${boundary}--`;
    const response = await this.fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime', {
      method: 'POST', headers: { ...headers, 'content-type': `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`Google Drive create ${name} HTTP ${response.status}`);
    return response.json();
  }

  async upsertText(name, text, mimeType = 'application/json') {
    if (!this.bucketName) return this.upsertDriveText(name, text, mimeType);

    const object = this.objectName(name);
    const file = this.storageClient().bucket(this.bucketName).file(object);
    await file.save(text, {
      contentType: `${mimeType}; charset=utf-8`,
      metadata: { cacheControl: 'no-store' },
      resumable: false
    });
    const saved = { id: `gs://${this.bucketName}/${object}`, name, object, storage: 'gcs' };

    if (this.driveMirrorEnabled) {
      try {
        saved.driveMirror = await this.upsertDriveText(name, text, mimeType);
      } catch (error) {
        if (this.driveMirrorRequired) throw error;
        console.warn(JSON.stringify({ event: 'drive-mirror-failed', folderName: this.folderName, name, error: String(error.message || error) }));
      }
    }
    return saved;
  }

  async readText(name) {
    if (this.bucketName) {
      const [buffer] = await this.storageClient().bucket(this.bucketName).file(this.objectName(name)).download();
      return buffer.toString('utf8');
    }

    const folderId = await this.ensureFolder();
    const query = `'${escapeQuery(folderId)}' in parents and name='${escapeQuery(name)}' and trashed=false`;
    const existing = await this.list(query);
    if (existing.length !== 1) throw new Error(`${this.folderName} ${name} count=${existing.length}`);
    const headers = await this.headers();
    const response = await this.fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing[0].id)}?alt=media`, {
      headers,
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Google Drive read ${name} HTTP ${response.status}`);
    return response.text();
  }
}

module.exports = { DrivePrimaryWriter };
