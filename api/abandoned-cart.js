import { verifyAdminToken } from './admin-auth.js';

function getFirebaseUrl(subpath = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${subpath}.json${query}`;
}

export default async function handler(req, res) {
    // Enable CORS for API requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ─────────────────────────────────────────────────────────────
    // 1. POST: Capture Abandoned Cart (Public with Strict Validation)
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
        try {
            const body = req.body || {};
            const phone = String(body.phone || '').trim().replace(/[\s\-\+]/g, '');

            // Egyptian Mobile Number Validation: 010, 011, 012, 015 (11 digits)
            if (!/^01[0125][0-9]{8}$/.test(phone)) {
                return res.status(400).json({ error: 'رقم هاتف غير صالح. يجب إدخال رقم محمول مصري صحيح مكون من 11 رقماً.' });
            }

            const cart = Array.isArray(body.cart) ? body.cart : [];
            if (cart.length === 0) {
                return res.status(400).json({ error: 'سلة المشتريات فارغة.' });
            }

            const name = String(body.name || '').trim().slice(0, 100);
            const gov = String(body.gov || '').trim().slice(0, 50);
            const subtotal = Math.max(0, Number(body.subtotal) || 0);
            const discountCode = String(body.discountCode || '').trim().slice(0, 30);

            const record = {
                phone,
                name: name || 'عميل غير مسجل',
                gov: gov || 'غير محدد',
                items: cart.map(it => ({
                    id: it.id,
                    name: String(it.name || '').slice(0, 150),
                    price: Number(it.price) || 0,
                    size: it.size || '',
                    color: it.color || '',
                    sku: it.sku || ''
                })),
                itemCount: cart.length,
                subtotal,
                discountCode,
                status: 'pending',
                updatedAt: new Date().toISOString()
            };

            const fbRes = await fetch(getFirebaseUrl(`/abandoned_carts/${phone}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record),
                signal: AbortSignal.timeout(6000)
            });

            if (!fbRes.ok) {
                console.warn('[Abandoned Cart] Firebase write status:', fbRes.status);
            }

            return res.status(200).json({ success: true, message: 'تم حفظ السلة المتروكة بنجاح' });
        } catch (err) {
            console.error('[Abandoned Cart Error]:', err);
            return res.status(500).json({ error: 'تعذر حفظ السلة المتروكة' });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Admin Protected Endpoints (GET / DELETE)
    // ─────────────────────────────────────────────────────────────
    const auth = verifyAdminToken(req);
    if (!auth.valid) {
        return res.status(401).json({
            error: 'غير مصرح: هذه العملية تتطلب تسجيل دخول المسؤول',
            details: auth.error
        });
    }

    // 2. GET: List All Abandoned Carts for Admin Dashboard
    if (req.method === 'GET') {
        try {
            const fbRes = await fetch(getFirebaseUrl('/abandoned_carts'), {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(6000)
            });

            if (!fbRes.ok) {
                return res.status(200).json([]);
            }

            const data = await fbRes.json();
            if (!data || typeof data !== 'object') {
                return res.status(200).json([]);
            }

            const list = Object.values(data).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
            return res.status(200).json(list);
        } catch (err) {
            console.error('[Abandoned Cart GET Error]:', err);
            return res.status(500).json({ error: 'حدث خطأ أثناء جلب السلات المتروكة' });
        }
    }

    // 3. DELETE: Remove or resolve abandoned cart
    if (req.method === 'DELETE') {
        try {
            const phone = String(req.query.phone || req.body?.phone || '').trim();
            if (!phone) {
                return res.status(400).json({ error: 'رقم الهاتف مطلوب لحذف السلة' });
            }

            await fetch(getFirebaseUrl(`/abandoned_carts/${phone}`), {
                method: 'DELETE',
                signal: AbortSignal.timeout(6000)
            });

            return res.status(200).json({ success: true, message: 'تم حذف السلة المتروكة' });
        } catch (err) {
            console.error('[Abandoned Cart DELETE Error]:', err);
            return res.status(500).json({ error: 'حدث خطأ أثناء حذف السلة المتروكة' });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
