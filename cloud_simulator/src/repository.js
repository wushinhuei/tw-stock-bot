'use strict';

class MemoryRepository {
  constructor(seed = {}) { this.state = structuredClone(seed); this.news = []; this.snapshots = []; }
  async loadState() { return structuredClone(this.state); }
  async saveState(state) { this.state = structuredClone(state); }
  async saveNews(items) { this.news = [...this.news, ...structuredClone(items)]; }
  async saveSnapshot(snapshot) { this.snapshots.push(structuredClone(snapshot)); }
}

class GoogleRepository {
  constructor(options = {}) {
    const { Firestore } = require('@google-cloud/firestore');
    const { Storage } = require('@google-cloud/storage');
    this.firestore = new Firestore({ databaseId: options.databaseId });
    this.storage = new Storage();
    this.bucket = this.storage.bucket(options.bucket);
    this.environment = options.environment || 'staging';
  }
  document() { return this.firestore.doc(`environments/${this.environment}/runtime/state`); }
  async loadState() { const snap = await this.document().get(); return snap.exists ? snap.data() : {}; }
  async saveState(state) { await this.document().set(state); }
  async saveNews(items) {
    const batch = this.firestore.batch();
    for (const item of items) batch.set(this.firestore.doc(`environments/${this.environment}/news/${item.hash}`), item, { merge: true });
    await batch.commit();
  }
  async saveSnapshot(snapshot) {
    const date = snapshot.timestamp.slice(0, 10);
    const name = `raw/${date}/${snapshot.timestamp.replace(/[:.]/g, '-')}.json`;
    await this.bucket.file(name).save(JSON.stringify(snapshot), { contentType: 'application/json', gzip: true });
  }
  async publishDashboard(payload) {
    await this.bucket.file('public/dashboard.json').save(JSON.stringify(payload), {
      contentType: 'application/json', cacheControl: 'public,max-age=15'
    });
  }
}

module.exports = { GoogleRepository, MemoryRepository };
