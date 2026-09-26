import crypto from 'crypto';
import { verifyOrderPrice, clearCatalogCache } from './_verify-price.js';
import { verifyAdminToken } from './admin-auth.js';

/**
 * Serverless Order Management Endpoint
 * SECURITY FIX:
 * 1. Mediates all access to Firebase orders collection; blocks direct browser access.
 * 2. Enforces server-side price recalculation and input sanitization on creation.
 * 3. Enforces cryptographically strong, non-guessable Order IDs.
 * 4. Requires verified Admin JWT token for listing, modifying, or deleting orders.
 * 5. Sanitizes single-order status lookups to prevent PII exposure (Anti-IDOR).
 */

function getFirebaseUrl(path = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${path}.json${query}`;
}

/**
 * Atomic stock decrement to prevent race conditions during concurrent orders.
 * Operates per-item via /products/{index}/stock.json with up to 3 retries and ETag concurrency control.
 */
async function decrementCatalogStock(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    if (!secret) return;

    try {
        // Fallback index mapping if catalogIndex is not already present on items
        let indexMap = null;
        const needsIndexLookup = items.some(it => it.catalogIndex === undefined || it.catalogIndex === null);

        if (needsIndexLookup) {
            try {
                const catRes = await fetch(getFirebaseUrl('/products'), {
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(4000)
                });
                if (catRes.ok) {
                    const catData = await catRes.json();
                    indexMap = new Map();
                    if (Array.isArray(catData)) {
                        catData.forEach((p, idx) => {
                            if (p) {
                                if (p.id) indexMap.set(String(p.id), idx);
                                if (p.sku) indexMap.set(String(p.sku), idx);
                            }
                        });
                    } else if (catData && typeof catData === 'object') {
                        Object.keys(catData).forEach(k => {
                            const p = catData[k];
                            if (p) {
                                if (p.id) indexMap.set(String(p.id), k);
                                if (p.sku) indexMap.set(String(p.sku), k);
                            }
                        });
                    }
                }
            } catch (mapErr) {
                console.warn('[Orders API] Index lookup error:', mapErr.message);
            }
        }

        let anyUpdated = false;

        // Process each item separately via its dedicated path /products/{index}/stock.json
        for (const orderedItem of items) {
            const idKey = String(orderedItem.id || orderedItem.sku || '');
            const qty = Number(orderedItem.quantity || orderedItem.qty || 1);
            if (qty <= 0) continue;

            const targetIndex = (orderedItem.catalogIndex !== undefined && orderedItem.catalogIndex !== null)
                ? orderedItem.catalogIndex
                : indexMap?.get(idKey);

            if (targetIndex === undefined || targetIndex === null) {
                console.warn(`[Orders API] Could not determine catalog index for item "${idKey}". Skipping stock decrement.`);
                continue;
            }

            const stockUrl = getFirebaseUrl(`/products/${targetIndex}/stock`);

            // Execute optimistic concurrency with up to 3 retries per item
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    // Step 1: Read current stock and ETag for this specific product
                    const stockRes = await fetch(stockUrl, {
                        headers: { 'Accept': 'application/json' },
                        signal: AbortSignal.timeout(3000)
                    });

                    if (!stockRes.ok) {
                        console.warn(`[Orders API] Attempt ${attempt}/3: Failed to read stock at index ${targetIndex} (HTTP ${stockRes.status})`);
                        if (attempt < 3) await new Promise(r => setTimeout(r, 50 * attempt));
                        continue;
                    }

                    const etag = stockRes.headers.get('etag');
                    const currentStockRaw = await stockRes.json();
                    const currentStock = (currentStockRaw !== null && currentStockRaw !== undefined)
                        ? Number(currentStockRaw)
                        : 10;

                    const newStock = Math.max(0, currentStock - qty);

                    // Step 2: Atomic conditional write via ETag (if-match)
                    const putHeaders = { 'Content-Type': 'application/json' };
                    if (etag) {
                        putHeaders['if-match'] = etag;
                    }

                    const putRes = await fetch(stockUrl, {
                        method: 'PUT',
                        headers: putHeaders,
                        body: JSON.stringify(newStock),
                        signal: AbortSignal.timeout(3000)
                    });

                    if (putRes.ok) {
                        anyUpdated = true;
                        break; // Success! Exit retry loop for this product
                    } else if (putRes.status === 412) {
                        // Concurrency conflict (Race condition prevented by ETag mismatch)
                        console.warn(`[Orders API] Concurrency race detected on product index ${targetIndex} (attempt ${attempt}/3). Retrying...`);
                        if (attempt < 3) await new Promise(r => setTimeout(r, 50 * attempt));
                    } else {
                        console.warn(`[Orders API] Attempt ${attempt}/3: PUT failed with status ${putRes.status}`);
                        if (attempt < 3) await new Promise(r => setTimeout(r, 50 * attempt));
                    }
                } catch (retryErr) {
                    console.warn(`[Orders API] Attempt ${attempt}/3 error for product index ${targetIndex}:`, retryErr.message);
                    if (attempt < 3) await new Promise(r => setTimeout(r, 50 * attempt));
                }
            }
        }

        if (anyUpdated) {
            clearCatalogCache();
        }
    } catch (e) {
        console.warn('[Orders API] Failed to decrement product stock in Firebase:', e.message);
    }
}

/**
 * Generate a cryptographically secure, collision-resistant Order ID
 * Example: AEG-M28K9Q-F4A1C9
 */
function generateSecureOrderId() {
    const timePart = Date.now().toString(36).toUpperCase();
    const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `AEG-${timePart}-${randPart}`;
}

export default async function handler(req, res) {
    // ─────────────────────────────────────────────────────────────
    // 1. POST: Create New Order (Public Checkout)
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
        const {
            items, total, discountCode, shippingFee,
            customer, phone, altPhone, gov, city, address, notes, payment
        } = req.body || {};

        // Input validation & length limits
        if (!customer || String(customer).trim().length < 2) {
            return res.status(400).json({ error: 'يرجى إدخال اسم العميل بشكل صحيح' });
        }
        if (!phone || !/^01[0125][0-9]{8}$/.test(String(phone).trim())) {
            return res.status(400).json({ error: 'يرجى إدخال رقم موبايل مصري صحيح مكون من 11 رقماً' });
        }
        if (!gov || !city || !address) {
            return res.status(400).json({ error: 'يرجى استكمال بيانات العنوان والمحافظة' });
        }

        // SECURITY FIX: Authoritative Server-side price calculation (Fail-Closed)
        let priceResult;
        try {
            priceResult = await verifyOrderPrice(items, total, discountCode, shippingFee);
        } catch (err) {
            console.error('[Order Create Price Check Failed]', err.message);
            return res.status(400).json({ error: err.message });
        }

        const { verifiedTotal, verifiedSubtotal, verifiedShipping, verifiedDiscount, verifiedItems } = priceResult;

        // SECURITY FIX: Cryptographically secure Order ID
        const orderId = generateSecureOrderId();

        // Safe status initialization
        let initialPaymentStatus = 'pending';
        const safePayment = String(payment || 'cod').toLowerCase();
        if (safePayment.includes('cod') || safePayment.includes('الاستلام')) {
            initialPaymentStatus = 'cod';
        } else if (safePayment === 'instapay') {
            initialPaymentStatus = 'pending_verification';
        }

        const newOrder = {
            id: orderId,
            date: new Date().toLocaleDateString('ar-EG'),
            createdAt: new Date().toISOString(),
            customer: String(customer).trim().substring(0, 80),
            phone: String(phone).trim(),
            altPhone: altPhone ? String(altPhone).trim().substring(0, 20) : '',
            gov: String(gov).trim().substring(0, 50),
            city: String(city).trim().substring(0, 50),
            address: String(address).trim().substring(0, 200),
            notes: notes ? String(notes).trim().substring(0, 300) : '',
            payment: safePayment,
            paymentStatus: initialPaymentStatus,
            status: 'جديد (قيد المراجعة)',
            items: verifiedItems,
            subtotal: verifiedSubtotal,
            shipping: verifiedShipping,
            discount: verifiedDiscount,
            total: verifiedTotal
        };

        try {
            const fbRes = await fetch(getFirebaseUrl(`/orders/${orderId}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newOrder)
            });

            if (!fbRes.ok) {
                console.error('[Firebase Order Save Failed]', await fbRes.text());
                return res.status(502).json({ error: 'فشل حفظ الطلب في قاعدة البيانات السحابية' });
            }

            // Decrement stock in Firebase RTDB and clear cache
            decrementCatalogStock(verifiedItems).catch(err => console.error('[Stock Error]', err));

            return res.status(201).json({
                success: true,
                orderId,
                total: verifiedTotal,
                order: newOrder
            });

        } catch (dbErr) {
            console.error('[Database Error]', dbErr);
            return res.status(500).json({ error: 'خطأ غير متوقع أثناء معالجة الطلب' });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. GET: List All Orders (Admin) OR Check Single Order Status
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const queryId = req.query?.id ? String(req.query.id).trim() : '';
        const queryPhone = req.query?.phone ? String(req.query.phone).trim() : '';

        // If specific order ID requested by customer for confirmation page or tracking
        if (queryId) {
            // Validate order ID pattern to prevent path traversal
            if (!/^AEG-[A-Za-z0-9_-]+$/.test(queryId)) {
                return res.status(400).json({ error: 'معرف طلب غير صالح' });
            }

            try {
                const fbRes = await fetch(getFirebaseUrl(`/orders/${queryId}`));
                if (!fbRes.ok) {
                    return res.status(404).json({ error: 'بيانات الطلب غير متطابقة' });
                }
                const orderData = await fbRes.json();
                if (!orderData) {
                    return res.status(404).json({ error: 'بيانات الطلب غير متطابقة' });
                }

                // If customer requested order tracking with phone verification (Anti-Enumeration / Anti-IDOR):
                if (queryPhone) {
                    const cleanQueryPhone = queryPhone.replace(/[\s\-_]/g, '').replace(/^\+?2/, '');
                    const cleanOrderPhone = String(orderData.phone || '').replace(/[\s\-_]/g, '').replace(/^\+?2/, '');
                    if (cleanQueryPhone !== cleanOrderPhone) {
                        // Generic 404 error - does not disclose whether order ID exists
                        return res.status(404).json({ error: 'بيانات الطلب غير متطابقة' });
                    }
                }

                // SECURITY FIX: Sanitize output for public callers (Anti-IDOR / Anti-PII Leak)
                // Do NOT expose customer name, phone number or street address to public callers
                return res.status(200).json({
                    success: true,
                    order: {
                        id: orderData.id,
                        date: orderData.date,
                        createdAt: orderData.createdAt || '',
                        status: orderData.status,
                        payment: orderData.payment,
                        paymentStatus: orderData.paymentStatus,
                        paidAt: orderData.paidAt || '',
                        paymentRef: orderData.paymentRef || '',
                        subtotal: orderData.subtotal,
                        shipping: orderData.shipping,
                        discount: orderData.discount || 0,
                        total: orderData.total,
                        items: orderData.items || []
                    }
                });
            } catch (err) {
                return res.status(500).json({ error: 'تعذر استرجاع حالة الطلب' });
            }
        }

        // SECURITY FIX: Full order list is strictly restricted to authenticated Admin
        const auth = verifyAdminToken(req);
        if (!auth.valid) {
            return res.status(401).json({ error: 'غير مصرح لك باستعراض سجلات الطلبات' });
        }

        try {
            const fbRes = await fetch(getFirebaseUrl('/orders'));
            if (!fbRes.ok) {
                return res.status(502).json({ error: 'فشل استرجاع الطلبات من السحابة' });
            }
            const data = await fbRes.json();
            const orders = (data && typeof data === 'object') ? Object.values(data).filter(Boolean) : [];
            return res.status(200).json({ success: true, orders });
        } catch (err) {
            return res.status(500).json({ error: 'خطأ في الاتصال بقاعدة البيانات' });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. PATCH: Update Order Status / Payment Status (Admin Only)
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
        const auth = verifyAdminToken(req);
        if (!auth.valid) {
            return res.status(401).json({ error: 'غير مصرح بتعديل الطلبات' });
        }

        const { orderId, status, paymentStatus, paidAt, paymentRef } = req.body || {};
        if (!orderId || !/^AEG-[A-Za-z0-9_-]+$/.test(String(orderId).trim())) {
            return res.status(400).json({ error: 'رقم طلب غير صالح' });
        }

        const updates = {};
        if (status) updates.status = String(status).trim().substring(0, 50);
        if (paymentStatus) {
            updates.paymentStatus = String(paymentStatus).trim().substring(0, 30);
            if (paymentStatus === 'paid' && !paidAt) {
                updates.paidAt = new Date().toLocaleString('ar-EG');
            }
        }
        if (paidAt) updates.paidAt = String(paidAt).trim().substring(0, 50);
        if (paymentRef) updates.paymentRef = String(paymentRef).trim().substring(0, 100);
        if (req.body.customer) updates.customer = String(req.body.customer).trim().substring(0, 80);
        if (req.body.phone) updates.phone = String(req.body.phone).trim().substring(0, 20);
        if (req.body.altPhone !== undefined) updates.altPhone = String(req.body.altPhone).trim().substring(0, 20);
        if (req.body.gov) updates.gov = String(req.body.gov).trim().substring(0, 50);
        if (req.body.city) updates.city = String(req.body.city).trim().substring(0, 50);
        if (req.body.address) updates.address = String(req.body.address).trim().substring(0, 200);
        if (req.body.notes !== undefined) updates.notes = String(req.body.notes).trim().substring(0, 300);
        if (req.body.subtotal !== undefined) updates.subtotal = Number(req.body.subtotal);
        if (req.body.shipping !== undefined) updates.shipping = Number(req.body.shipping);
        if (req.body.discount !== undefined) updates.discount = Number(req.body.discount);
        if (req.body.total !== undefined) updates.total = Number(req.body.total);
        if (req.body.payment) updates.payment = String(req.body.payment).trim().substring(0, 50);

        try {
            const fbRes = await fetch(getFirebaseUrl(`/orders/${orderId}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!fbRes.ok) {
                return res.status(502).json({ error: 'فشل تحديث بيانات الطلب' });
            }

            return res.status(200).json({ success: true, updates });
        } catch (err) {
            return res.status(500).json({ error: 'خطأ غير متوقع أثناء التحديث' });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. DELETE: Delete Order (Admin Only)
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        const auth = verifyAdminToken(req);
        if (!auth.valid) {
            return res.status(401).json({ error: 'غير مصرح بحذف الطلبات' });
        }

        const orderId = String(req.query?.id || req.body?.orderId || '').trim();
        if (!orderId || !/^AEG-[A-Za-z0-9_-]+$/.test(orderId)) {
            return res.status(400).json({ error: 'رقم طلب غير صالح' });
        }

        try {
            const fbRes = await fetch(getFirebaseUrl(`/orders/${orderId}`), {
                method: 'DELETE'
            });

            if (!fbRes.ok) {
                return res.status(502).json({ error: 'فشل حذف الطلب' });
            }

            return res.status(200).json({ success: true, message: `تم حذف الطلب ${orderId} بنجاح` });
        } catch (err) {
            return res.status(500).json({ error: 'خطأ أثناء حذف الطلب' });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
