/**
 * Serverless Helper - Dynamic Gateway Configuration Loader
 * 
 * Fetches current payment gateway configuration from secure, locked Firebase DB
 * with fallback to Server Environment Variables.
 */
export async function getGatewayConfig() {
    try {
        const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
        const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
        const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
        const res = await fetch(`${base}/payment_gateway_settings.json${query}`);
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                return data;
            }
        }
    } catch (e) {
        console.warn('[GatewayConfig] Could not fetch dynamic settings from Firebase:', e.message);
    }
    return {};
}
