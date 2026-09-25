import crypto from 'crypto';
import { verifyOrderPrice } from './_verify-price.js';
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
    const secret = (process.env.FIREBASE_AUTH_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${path}.json${query}`;
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
            priceResult = verifyOrderPrice(items, total, discountCode, shippingFee);
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

        // If specific order ID requested by customer for confirmation page
        if (queryId) {
            // Validate order ID pattern to prevent path traversal
            if (!/^AEG-[A-Za-z0-9_-]+$/.test(queryId)) {
                return res.status(400).json({ error: 'معرف طلب غير صالح' });
            }

            try {
                const fbRes = await fetch(getFirebaseUrl(`/orders/${queryId}`));
                if (!fbRes.ok) {
                    return res.status(404).json({ error: 'الطلب غير موجود' });
                }
                const orderData = await fbRes.json();
                if (!orderData) {
                    return res.status(404).json({ error: 'الطلب غير موجود' });
                }

                // SECURITY FIX: Sanitize output for public callers (Anti-IDOR / Anti-PII Leak)
                // Do NOT expose phone number or street address to unauthenticated callers
                return res.status(200).json({
                    success: true,
                    order: {
                        id: orderData.id,
                        date: orderData.date,
                        status: orderData.status,
                        payment: orderData.payment,
                        paymentStatus: orderData.paymentStatus,
                        paidAt: orderData.paidAt || '',
                        paymentRef: orderData.paymentRef || '',
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
