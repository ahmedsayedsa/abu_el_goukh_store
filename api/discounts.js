import { verifyAdminToken, getClientIp, sanitizeIp } from './admin-auth.js';

function getFirebaseUrl(subpath = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${subpath}.json${query}`;
}

/**
 * SECURITY FIX (Group 3 / Item 5):
 * Rate Limiting for Public Promo Code Validation (POST /api/discounts?action=validate)
 * Stores attempts count per IP in Firebase RTDB (/rate_limits/promo/{sanitized_ip}).
 * Limit: 10 attempts per 10-minute window per IP.
 * Fail-Closed: If Firebase cannot be reached, reject with 503 to prevent brute-force attacks.
 */
async function checkPromoRateLimit(ip) {
    const cleanIp = sanitizeIp(ip);
    const now = Date.now();
    const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
    const MAX_ATTEMPTS = 10;
    const rateLimitUrl = getFirebaseUrl(`/rate_limits/promo/${cleanIp}`);

    try {
        const res = await fetch(rateLimitUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(3000)
        });

        if (!res.ok) {
            console.error('[RateLimit Error] Failed to read promo rate limit from Firebase, status:', res.status);
            return {
                allowed: false,
                statusCode: 503,
                message: 'تعذر التحقق من كود الخصم مؤقتاً. يرجى المحاولة بعد قليل.'
            };
        }

        const data = await res.json();
        let record = data && typeof data === 'object' ? data : null;

        if (record) {
            if (record.lockedUntil && now < record.lockedUntil) {
                const remainingMinutes = Math.max(1, Math.ceil((record.lockedUntil - now) / 60000));
                return {
                    allowed: false,
                    statusCode: 429,
                    message: `تم تجاوز عدد محاولات إدخال كود الخصم (10 محاولات كل 10 دقائق). يرجى المحاولة بعد ${remainingMinutes} دقيقة.`
                };
            }

            if (!record.windowStart || (now - record.windowStart) > WINDOW_MS) {
                record = { count: 1, windowStart: now };
            } else {
                record.count = (Number(record.count) || 0) + 1;
                if (record.count > MAX_ATTEMPTS) {
                    record.lockedUntil = now + WINDOW_MS;
                    await fetch(rateLimitUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(record),
                        signal: AbortSignal.timeout(3000)
                    });
                    return {
                        allowed: false,
                        statusCode: 429,
                        message: 'تم تجاوز عدد محاولات إدخال كود الخصم. يرجى المحاولة بعد 10 دقائق.'
                    };
                }
            }
        } else {
            record = { count: 1, windowStart: now };
        }

        await fetch(rateLimitUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(record),
            signal: AbortSignal.timeout(3000)
        });

        return { allowed: true };
    } catch (err) {
        console.error('[RateLimit Error] Promo rate limit exception:', err.message);
        return {
            allowed: false,
            statusCode: 503,
            message: 'تعذر التحقق من كود الخصم مؤقتاً. يرجى المحاولة بعد قليل.'
        };
    }
}

// NOTE: No hardcoded discount codes. Firebase /discount_codes is the single source of truth.
// الأكواد دي لازم تتعمل من لوحة الأدمن بعد النشر.


export default async function handler(req, res) {
    // SECURITY FIX (Vulnerability 5): Restrict CORS to trusted origins
    const siteUrl = (process.env.SITE_URL || 'https://abu-el-goukh-store.vercel.app').replace(/\/+$/, '');
    const origin = req.headers?.origin || '';
    const isAllowedOrigin = origin && (
        origin === siteUrl ||
        origin === 'https://abu-el-goukh-store.vercel.app' ||
        /^https:\/\/[a-z0-9-]+-ahmedsayedsas-projects\.vercel\.app$/i.test(origin) ||
        /^https:\/\/[a-z0-9-]+-abu-el-goukh-store\.vercel\.app$/i.test(origin) ||
        /^http:\/\/localhost(:\d+)?$/i.test(origin) ||
        /^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)
    );

    res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin ? origin : siteUrl);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ─────────────────────────────────────────────────────────────
    // Public Endpoint: POST /api/discounts?action=validate
    // Rate-limited per IP (10 requests per 10 mins in Firebase, Fail-Closed)
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'POST' && (req.query?.action === 'validate' || req.body?.action === 'validate')) {
        const clientIp = getClientIp(req);
        const rateCheck = await checkPromoRateLimit(clientIp);
        if (!rateCheck.allowed) {
            return res.status(rateCheck.statusCode).json({
                valid: false,
                message: rateCheck.message
            });
        }

        const body = req.body || {};
        const codeRaw = String(body.code || req.query?.code || '').trim().toUpperCase();
        if (!codeRaw || !/^[A-Z0-9_\-]{3,20}$/.test(codeRaw)) {
            return res.status(200).json({
                valid: false,
                message: 'كود خصم غير صحيح أو منتهي'
            });
        }

        try {
            const fbRes = await fetch(getFirebaseUrl(`/discount_codes/${codeRaw}`), {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(4000)
            });

            let promo = null;
            if (fbRes.ok) {
                promo = await fbRes.json();
            }
            // No fallback to hardcoded codes: Firebase /discount_codes is the single source of truth.


            if (!promo || typeof promo !== 'object') {
                return res.status(200).json({ valid: false, message: 'كود خصم غير صحيح أو منتهي' });
            }

            if (promo.active === false) {
                return res.status(200).json({ valid: false, message: 'كود خصم غير صحيح أو منتهي' });
            }

            if (promo.expiresAt && Date.now() > new Date(promo.expiresAt).getTime()) {
                return res.status(200).json({ valid: false, message: 'كود خصم غير صحيح أو منتهي' });
            }

            const minOrder = Number(promo.minSubtotal || promo.minOrder || 0);
            const freeShipping = Boolean(promo.freeShipping);
            const percent = Number(promo.percent ?? (promo.type === 'percentage' ? promo.value : 0));
            const fixedAmt = Number(promo.type === 'fixed' ? (promo.value || promo.amount) : (promo.amount || 0));

            let type = 'percent';
            let value = percent;
            if (fixedAmt > 0 && percent === 0) {
                type = 'fixed';
                value = fixedAmt;
            }

            const subtotal = Number(body.subtotal);
            if (!isNaN(subtotal) && subtotal > 0 && minOrder > 0 && subtotal < minOrder) {
                return res.status(200).json({
                    valid: false,
                    message: `الحد الأدنى لتطبيق هذا الكود هو ${minOrder} ج.م`
                });
            }

            return res.status(200).json({
                valid: true,
                type,
                value,
                freeShipping,
                minOrder
            });
        } catch (err) {
            console.error('[Discounts Validate Error]:', err);
            return res.status(503).json({
                valid: false,
                message: 'تعذر التحقق من كود الخصم مؤقتاً. يرجى المحاولة بعد قليل.'
            });
        }
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
            // Return empty object: codes must be created from admin panel
            return res.status(200).json({});
        } catch (err) {
            console.error('[Discounts API GET Error]:', err);
            return res.status(503).json({ error: 'تعذر تحميل أكواد الخصم من Firebase' });
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
            // SECURITY FIX (Vulnerability 1): Strict regex validation on DELETE prevents Path Traversal
            if (!codeRaw || !/^[A-Z0-9_\-]{3,20}$/.test(codeRaw)) {
                return res.status(400).json({ error: 'كود الخصم غير صالح أو مفقود. يجب أن يتكون من 3 إلى 20 حرفاً وأرقاماً إنجليزية فقط.' });
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
