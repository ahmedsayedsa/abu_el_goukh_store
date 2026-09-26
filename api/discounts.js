import { verifyAdminToken } from './admin-auth.js';

function getFirebaseUrl(subpath = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${subpath}.json${query}`;
}

const DEFAULT_CODES = {
    'GOUKH1925': {
        code: 'GOUKH1925',
        percent: 5,
        freeShipping: false,
        minSubtotal: 0,
        active: true,
        description: 'خصم 5% رسمي بمناسبة مئوية أبو الجوخ 1925'
    },
    'FREESHIP': {
        code: 'FREESHIP',
        percent: 0,
        freeShipping: true,
        minSubtotal: 0,
        active: true,
        description: 'شحن مجاني لكافة محافظات مصر'
    }
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ─────────────────────────────────────────────────────────────
    // Security Gate: All discount management operations require Admin JWT
    // ─────────────────────────────────────────────────────────────
    const auth = verifyAdminToken(req);
    if (!auth.valid) {
        return res.status(401).json({
            error: 'غير مصرح: إدارة أكواد الخصم تتطلب تسجيل دخول المسؤول',
            details: auth.error
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 1. GET: Retrieve All Discount Codes
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        try {
            const fbRes = await fetch(getFirebaseUrl('/discount_codes'), {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(6000)
            });

            if (fbRes.ok) {
                const data = await fbRes.json();
                if (data && typeof data === 'object') {
                    return res.status(200).json(data);
                }
            }
            return res.status(200).json(DEFAULT_CODES);
        } catch (err) {
            console.error('[Discounts API GET Error]:', err);
            return res.status(200).json(DEFAULT_CODES);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. POST / PUT: Create or Update Discount Code
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'POST' || req.method === 'PUT') {
        try {
            const body = req.body || {};
            const codeRaw = String(body.code || '').trim().toUpperCase();
            if (!codeRaw || !/^[A-Z0-9_\-]{3,20}$/.test(codeRaw)) {
                return res.status(400).json({ error: 'كود الخصم غير صالح. يجب أن يتكون من 3 إلى 20 حرفاً وأرقاماً إنجليزية فقط.' });
            }

            const percent = Math.min(100, Math.max(0, Number(body.percent) || 0));
            const freeShipping = Boolean(body.freeShipping);
            const minSubtotal = Math.max(0, Number(body.minSubtotal) || 0);
            const active = body.active !== false;
            const description = String(body.description || '').trim().slice(0, 200);

            if (percent === 0 && !freeShipping) {
                return res.status(400).json({ error: 'يجب تحديد نسبة خصم أكبر من 0% أو تفعيل خيار الشحن المجاني.' });
            }

            const discountRecord = {
                code: codeRaw,
                percent,
                freeShipping,
                minSubtotal,
                active,
                description,
                updatedAt: new Date().toISOString()
            };

            const fbRes = await fetch(getFirebaseUrl(`/discount_codes/${codeRaw}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(discountRecord),
                signal: AbortSignal.timeout(6000)
            });

            if (!fbRes.ok) {
                return res.status(502).json({ error: `فشل الحفظ في Firebase (${fbRes.status})` });
            }

            return res.status(200).json({
                success: true,
                message: `تم حفظ كود الخصم ${codeRaw} بنجاح`,
                discount: discountRecord
            });
        } catch (err) {
            console.error('[Discounts API Save Error]:', err);
            return res.status(500).json({ error: 'حدث خطأ في الخادم أثناء حفظ كود الخصم' });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. DELETE: Remove Discount Code
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        try {
            const codeRaw = String(req.query.code || req.body?.code || '').trim().toUpperCase();
            if (!codeRaw) {
                return res.status(400).json({ error: 'كود الخصم مطلوب للحذف' });
            }

            const fbRes = await fetch(getFirebaseUrl(`/discount_codes/${codeRaw}`), {
                method: 'DELETE',
                signal: AbortSignal.timeout(6000)
            });

            if (!fbRes.ok) {
                return res.status(502).json({ error: `فشل الحذف من Firebase (${fbRes.status})` });
            }

            return res.status(200).json({
                success: true,
                message: `تم حذف كود الخصم ${codeRaw} بنجاح`
            });
        } catch (err) {
            console.error('[Discounts API Delete Error]:', err);
            return res.status(500).json({ error: 'حدث خطأ في الخادم أثناء حذف كود الخصم' });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
