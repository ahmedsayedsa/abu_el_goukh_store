// api/_catalog.js
// Centralized catalog utilities: Firebase URL helper, catalog validation, and conditional seeding.

function getFirebaseUrl(path = '') {
  const base = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/+$/, '');
  const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
  const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
  return `${base}${path}.json${query}`;
}

export function isCatalogValid(catalog) {
  const entries = Object.values(catalog || {});
  if (entries.length === 0) return false;
  const validCount = entries.filter(p => typeof p.id === 'string' && p.id.trim() !== '' && typeof p.price === 'number' && p.price > 0).length;
  return validCount / entries.length >= 0.9;
}

export async function seedCatalogIfEmpty() {
  const url = getFirebaseUrl('/products');
  // Fetch current catalog
  let current = null;
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (res.ok) current = await res.json();
  } catch (e) {}

  if (current && isCatalogValid(current)) {
    console.info('[Catalog] Valid catalog already present – no seeding needed.');
    return current;
  }

  // Load local fallback data
  const localData = await import('../products.json').then(m => m.default || m);
  console.info('[Catalog] Empty/invalid catalog – attempting conditional seeding with null_etag');
  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'if-match': 'null_etag'
    },
    body: JSON.stringify(localData)
  });
  const body = await putRes.text();
  console.info('[Catalog] Seed PUT status:', putRes.status);
  console.info('[Catalog] Seed PUT body:', body);
  if (putRes.ok) return localData;
  // If another instance seeded first (412) or failed, fallback to local data in memory
  return localData;
}
