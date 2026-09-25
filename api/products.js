import fs from 'fs';
import path from 'path';
import { verifyAdminToken } from './admin-auth.js';
import { clearCatalogCache } from './_verify-price.js';

/**
 * Serverless Products Management Endpoint
 * SECURITY & ARCHITECTURE:
 * 1. GET: Publicly accessible for storefront and mobile visitors. Reads live from Firebase, fallback to products.json.
 * 2. POST / PUT / DELETE: Strictly protected by Admin JWT (verifyAdminToken).
 * 3. Writes directly to Firebase Realtime Database using FIREBASE_AUTH_SECRET from process.env.
 * 4. Automatically clears the price verification in-memory cache upon write, reflecting price changes immediately.
 */

function getFirebaseUrl(subpath = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
    const secret = (process.env.FIREBASE_AUTH_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${subpath}.json${query}`;
}

function getLocalProductsFallback() {
    try {
        const filePath = path.join(process.cwd(), 'products.json');
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(data)) return data;
        }
    } catch (e) {
        console.error('[Products API] Failed to read local products.json:', e);
    }
    return [];
}

export default async function handler(req, res) {
    // ─────────────────────────────────────────────────────────────
    // 1. GET: Retrieve Public Products Catalog
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        try {
            const fbRes = await fetch(getFirebaseUrl('/products'), {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(5000)
            });

            if (fbRes.ok) {
                const data = await fbRes.json();
                if (Array.isArray(data) && data.length > 0) {
                    return res.status(200).json(data);
                } else if (data && typeof data === 'object') {
                    const arr = Object.values(data);
                    if (arr.length > 0) return res.status(200).json(arr);
                }
            }
        } catch (fbErr) {
            console.warn('[Products API] Firebase read failed, serving local fallback:', fbErr.message);
        }

        const fallback = getLocalProductsFallback();
        return res.status(200).json(fallback);
    }

    // ─────────────────────────────────────────────────────────────
    // Security Gate: All mutations require verified Admin JWT token
    // ─────────────────────────────────────────────────────────────
    const auth = verifyAdminToken(req);
    if (!auth.valid) {
        return res.status(401).json({
            error: 'غير مصرح: يرجى تسجيل الدخول كمسؤول للقيام بهذه العملية',
            details: auth.error
        });
    }

    const secret = (process.env.FIREBASE_AUTH_SECRET || '').trim();
    if (!secret) {
        console.error('[SECURITY ERROR] FIREBASE_AUTH_SECRET not set in environment variables!');
        return res.status(500).json({
            error: 'تعذر الاتصال بقاعدة البيانات: مفتاح الأمان السحابي FIREBASE_AUTH_SECRET غير مضبوط في متغيرات البيئة.'
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. PUT / POST: Update or Sync Products Catalog
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'PUT' || req.method === 'POST') {
        let productsToSave = null;

        if (Array.isArray(req.body)) {
            productsToSave = req.body;
        } else if (req.body && Array.isArray(req.body.products)) {
            productsToSave = req.body.products;
        } else if (req.body && typeof req.body === 'object') {
            // Single product edit / addition
            const single = req.body.product || req.body;
            if (!single.name || !single.price) {
                return res.status(400).json({ error: 'بيانات المنتج غير مكتملة (الاسم والسعر مطلوبان)' });
            }

            // Fetch current list from Firebase
            let current = [];
            try {
                const currRes = await fetch(getFirebaseUrl('/products'));
                if (currRes.ok) {
                    const currData = await currRes.json();
                    if (Array.isArray(currData)) current = currData;
                    else if (currData && typeof currData === 'object') current = Object.values(currData);
                }
            } catch(e) {
                current = getLocalProductsFallback();
            }

            if (req.method === 'POST') {
                const newId = current.length > 0 ? Math.max(...current.map(p => Number(p.id) || 0)) + 1 : 1;
                single.id = newId;
                single.active = single.active !== false;
                current.unshift(single);
            } else {
                // PUT single product
                const idx = current.findIndex(p => String(p.id) === String(single.id));
                if (idx !== -1) {
                    current[idx] = { ...current[idx], ...single };
                } else {
                    current.unshift(single);
                }
            }
            productsToSave = current;
        }

        if (!Array.isArray(productsToSave) || productsToSave.length === 0) {
            return res.status(400).json({ error: 'قائمة المنتجات المرسلة فارغة أو غير صالحة' });
        }

        // Clean & sanitize each product
        const sanitized = productsToSave.map(p => ({
            id: Number(p.id) || p.id,
            name: String(p.name || '').trim(),
            price: Number(p.price) || 0,
            category: String(p.category || 'mountain').trim(),
            size: String(p.size || '').trim(),
            gears: String(p.gears || '').trim(),
            frame: String(p.frame || '').trim(),
            metaDescription: String(p.metaDescription || '').trim(),
            image: String(p.image || '').trim(),
            active: p.active !== false
        }));

        try {
            const fbRes = await fetch(getFirebaseUrl('/products'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sanitized)
            });

            if (!fbRes.ok) {
                const errText = await fbRes.text();
                console.error('[Products API] Firebase PUT failed:', fbRes.status, errText);
                return res.status(502).json({
                    error: `فشل الحفظ في قاعدة بيانات Firebase (${fbRes.status}): ${fbRes.statusText}`
                });
            }

            // Immediately clear the server-side price verification cache
            clearCatalogCache();

            return res.status(200).json({
                success: true,
                count: sanitized.length,
                message: 'تم حفظ ومزامنة المنتجات سحابياً وتحديث محرك الأسعار بنجاح'
            });

        } catch (err) {
            console.error('[Products API Error]:', err);
            return res.status(500).json({
                error: 'حدث خطأ في الخادم أثناء حفظ المنتجات',
                details: err.message
            });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. DELETE: Remove a Product from Cloud Catalog
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        const idToDelete = req.query?.id || req.body?.id;
        if (!idToDelete) {
            return res.status(400).json({ error: 'معرف المنتج (id) مطلوب للحذف' });
        }

        let current = [];
        try {
            const currRes = await fetch(getFirebaseUrl('/products'));
            if (currRes.ok) {
                const currData = await currRes.json();
                if (Array.isArray(currData)) current = currData;
                else if (currData && typeof currData === 'object') current = Object.values(currData);
            }
        } catch(e) {
            current = getLocalProductsFallback();
        }

        const filtered = current.filter(p => String(p.id) !== String(idToDelete));

        try {
            const fbRes = await fetch(getFirebaseUrl('/products'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(filtered)
            });

            if (!fbRes.ok) {
                return res.status(502).json({ error: 'فشل حذف المنتج من قاعدة بيانات Firebase' });
            }

            clearCatalogCache();

            return res.status(200).json({
                success: true,
                count: filtered.length,
                message: 'تم حذف العجلة سحابياً بنجاح'
            });

        } catch (err) {
            return res.status(500).json({ error: 'خطأ في الخادم أثناء الحذف', details: err.message });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
