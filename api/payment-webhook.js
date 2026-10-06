import crypto from 'crypto';
import { getGatewayConfig } from './_gateway-config.js';
import { rollbackStock } from './orders.js';
import { clearCatalogCache } from './_verify-price.js';

/**
 * CRITICAL CONFIG: Disable Vercel automatic body parser for this webhook endpoint.
 * This preserves the raw, byte-for-byte HTTP payload required for exact HMAC-SHA256 signature verification.
 */
export const config = {
    api: {
        bodyParser: false
    }
};

/**
 * Server-to-Server Payment Webhook Handler
 * SECURITY FIX:
 * 1. ONLY authoritative endpoint permitted to mark orders as 'paid' or 'failed'.
 * 2. Cryptographically validates HMAC / SHA-256 signatures for Paymob, PayTabs, and Fawry.
 * 3. Enforces authoritative server-to-order binding: verifies order existence in DB, currency is EGP,
 *    and paid amount matches order.total within tolerance.
 * 4. Automatically restores reserved inventory if payment fails (Anti-depletion).
 */

function getFirebaseUrl(path = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new Error('متغير البيئة FIREBASE_DATABASE_URL غير مضبوط في الخادم');
    }
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${path}.json${query}`;
}

function safeCompare(a, b) {
    const hashA = crypto.createHash('sha256').update(String(a || '')).digest();
    const hashB = crypto.createHash('sha256').update(String(b || '')).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

async function updateOrderPayment(orderId, paymentStatus, paymentRef, gateway, paidAmount = null, paidCurrency = 'EGP') {
    if (!orderId) return false;

    const cleanOrderId = String(orderId).trim();
    // SECURITY FIX: Prevent Path Traversal via webhook orderId
    if (!cleanOrderId || !/^[A-Za-z0-9_-]+$/.test(cleanOrderId)) {
        console.warn(`[SECURITY ALERT] Invalid orderId format in webhook: "${cleanOrderId}". Update rejected.`);
        return false;
    }
    const orderUrl = getFirebaseUrl(`/orders/${cleanOrderId}`);

    let currentOrder = null;
    try {
        const orderRes = await fetch(orderUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(5000)
        });
        if (orderRes.ok) {
            currentOrder = await orderRes.json();
        }
    } catch (fetchErr) {
        console.error(`[Webhook Order Fetch Error for ${cleanOrderId}]:`, fetchErr.message);
    }

    if (!currentOrder) {
        console.error(`[SECURITY ALERT] Webhook received for non-existent order: "${cleanOrderId}". Update rejected.`);
        return false;
    }

    // Idempotency: if already marked as paid, ignore duplicate webhooks safely
    if (currentOrder.paymentStatus === 'paid') {
        console.log(`[Webhook Notice] Order ${cleanOrderId} is already paid. Ignoring duplicate webhook.`);
        return true;
    }

    const updates = {
        paymentRef: String(paymentRef || ''),
        paymentGateway: gateway,
        paymentUpdatedAt: new Date().toISOString()
    };

    if (paymentStatus === 'paid') {
        // SECURITY VERIFICATION (Issue 2):
        // 1. Currency Verification
        const normalizedCurrency = String(paidCurrency || 'EGP').trim().toUpperCase();
        if (normalizedCurrency !== 'EGP') {
            console.error(`[SECURITY ALERT] Currency mismatch for order ${cleanOrderId}: Received "${normalizedCurrency}", Expected "EGP"!`);
            updates.paymentStatus = 'currency_mismatch';
            updates.status = 'خطأ في عملة الدفع (غير مطابقة للجنيه المصري)';
            updates.flaggedReason = `currency_mismatch_${normalizedCurrency}`;
            try {
                await fetch(orderUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates)
                });
            } catch (pErr) {}
            return false;
        }

        // 2. Amount Verification
        const expectedTotal = Number(currentOrder.total);
        const actualPaid = paidAmount !== null && paidAmount !== undefined ? Number(paidAmount) : NaN;

        if (isNaN(actualPaid) || Math.abs(expectedTotal - actualPaid) > 1.0) {
            console.error(`[SECURITY ALERT] Payment amount mismatch for order ${cleanOrderId}! Expected: ${expectedTotal} EGP, Received: ${actualPaid} EGP.`);
            updates.paymentStatus = 'amount_mismatch';
            updates.status = 'فشل التحقق: قيمة السداد لا تطابق إجمالي الطلب';
            updates.flaggedReason = `amount_mismatch_expected_${expectedTotal}_received_${actualPaid}`;
            try {
                await fetch(orderUrl, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates)
                });
            } catch (pErr) {}
            return false;
        }

        // Both currency and amount verified authoritatively
        updates.paymentStatus = 'paid';
        updates.paidAt = new Date().toLocaleString('ar-EG');
        updates.status = 'تم تأكيد الطلب والسداد بنجاح';
        updates.verifiedPaidAmount = actualPaid;
        updates.verifiedCurrency = normalizedCurrency;
    } else {
        // Payment failed or cancelled
        updates.paymentStatus = 'failed';
        updates.status = 'فشل السداد الإلكتروني';

        // ISSUE 4 FIX: Automatically restore inventory for failed webhook transactions
        if (currentOrder.stockDeducted && !currentOrder.stockRestored && Array.isArray(currentOrder.items)) {
            console.log(`[Stock Restoration] Order ${cleanOrderId} payment failed via webhook, restoring stock...`);
            try {
                await rollbackStock(currentOrder.items);
                clearCatalogCache();
                updates.stockRestored = true;
                updates.stockRestoredAt = new Date().toISOString();
                updates.stockRestoredReason = 'payment_failed_webhook';
            } catch (rErr) {
                console.error(`[Stock Restoration Error for ${cleanOrderId}]:`, rErr.message);
            }
        }
    }

    try {
        const res = await fetch(orderUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        return res.ok;
    } catch (e) {
        console.error(`[Webhook Update Error for ${cleanOrderId}]:`, e);
        return false;
    }
}

export default async function handler(req, res) {
    // Only accept POST (standard for IPN / Webhooks)
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Read the exact raw byte stream to preserve character-for-character payload for HMAC verification
    let rawBody = '';
    if (typeof req[Symbol.asyncIterator] === 'function') {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        rawBody = Buffer.concat(chunks).toString('utf8');
    } else if (typeof req.rawBody === 'string') {
        rawBody = req.rawBody;
    } else if (typeof req.body === 'string') {
        rawBody = req.body;
    } else if (req.body && typeof req.body === 'object') {
        rawBody = JSON.stringify(req.body);
    }

    let body = {};
    if (rawBody && rawBody.trim()) {
        try {
            body = JSON.parse(rawBody);
        } catch (e) {
            console.warn('[Webhook Warning] Failed to parse JSON body:', e.message);
            return res.status(400).json({ error: 'Invalid JSON payload' });
        }
    } else if (req.body && typeof req.body === 'object') {
        body = req.body;
    }

    const gateway = String(req.query?.gateway || body.gateway || '').toLowerCase();
    const dynamicCfg = await getGatewayConfig();

    // ─────────────────────────────────────────────────────────────
    // 1. Paymob Webhook Verification (HMAC-SHA512)
    // ─────────────────────────────────────────────────────────────
    if (gateway === 'paymob' || body.obj?.order?.merchant_order_id || body.obj?.id) {
        const hmacSecret = (dynamicCfg.paymob?.hmac || process.env.PAYMOB_HMAC_SECRET || '').trim();
        if (!hmacSecret) {
            console.error('[SECURITY ERROR] PAYMOB_HMAC_SECRET not set in Database or environment!');
            return res.status(500).json({ error: 'Server webhook unconfigured' });
        }

        const queryHmac = req.query?.hmac || req.headers['x-paymob-hmac'] || (typeof req.body === 'object' && req.body?.hmac) || '';
        if (!queryHmac) {
            console.warn('[SECURITY ALERT] Paymob webhook received with no HMAC signature - rejected.');
            return res.status(403).json({ error: 'Missing HMAC signature' });
        }

        const obj = body.obj || body;

        // Paymob concatenated keys in exact standard order
        const keys = [
            'amount_cents', 'created_at', 'currency', 'error_occured',
            'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
            'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
            'is_voided', 'order.id', 'owner', 'pending',
            'source_data.pan', 'source_data.sub_type', 'source_data.type',
            'success'
        ];

        let concatenated = '';
        for (const k of keys) {
            let val;
            if (k.includes('.')) {
                const parts = k.split('.');
                val = obj[parts[0]]?.[parts[1]];
            } else {
                val = obj[k];
            }
            concatenated += (val !== undefined && val !== null) ? String(val) : '';
        }

        const calculatedHmac = crypto.createHmac('sha512', hmacSecret).update(concatenated).digest('hex');

        if (!safeCompare(queryHmac, calculatedHmac)) {
            console.warn('[SECURITY ALERT] Invalid Paymob HMAC Signature attempt!');
            return res.status(403).json({ error: 'Invalid HMAC signature' });
        }

        const orderId = obj.order?.merchant_order_id || obj.extra?.order_id || obj.extras?.order_id || obj.special_reference || obj.order_id || obj.order?.id;
        const txnId = obj.id;
        const isSuccess = obj.success === true || obj.success === 'true';
        const paidAmount = Number(obj.amount_cents) / 100;
        const paidCurrency = obj.currency;

        const updateOk = await updateOrderPayment(orderId, isSuccess ? 'paid' : 'failed', txnId, 'paymob', paidAmount, paidCurrency);
        if (!updateOk && isSuccess) {
            return res.status(400).json({ error: 'Order validation failed or mismatch' });
        }
        return res.status(200).json({ received: true });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. PayTabs Webhook Verification (HMAC-SHA256)
    // ─────────────────────────────────────────────────────────────
    if (gateway === 'paytabs' || body.tran_ref || body.cart_id) {
        const serverKey = (dynamicCfg.paytabs?.serverKey || process.env.PAYTABS_SERVER_KEY || '').trim();
        if (!serverKey) {
            console.error('[SECURITY ERROR] PAYTABS_SERVER_KEY not set in Database or environment!');
            return res.status(500).json({ error: 'Server webhook unconfigured' });
        }

        const signatureHeader = req.headers['signature'] || '';
        // SECURITY FIX (Issue 5): Fail-Closed if signature header is missing or empty
        if (!signatureHeader) {
            console.warn('[SECURITY ALERT] PayTabs webhook received with no signature header - rejected.');
            return res.status(403).json({ error: 'Missing signature header' });
        }

        // SECURITY FIX: Calculate HMAC-SHA256 directly on the exact rawBody byte stream
        const calculatedSig = crypto.createHmac('sha256', serverKey).update(rawBody).digest('hex');
        if (!safeCompare(signatureHeader, calculatedSig)) {
            console.warn('[SECURITY ALERT] Invalid PayTabs Signature attempt!');
            return res.status(403).json({ error: 'Invalid signature' });
        }

        const orderId = body.cart_id || body.merchant_order_id;
        const tranRef = body.tran_ref;
        const status = body.payment_result?.response_status || body.respStatus;
        const isSuccess = status === 'A'; // 'A' = Authorized / Completed
        const paidAmount = Number(body.cart_amount ?? body.tran_total ?? 0);
        const paidCurrency = body.cart_currency || body.tran_currency || 'EGP';

        const updateOk = await updateOrderPayment(orderId, isSuccess ? 'paid' : 'failed', tranRef, 'paytabs', paidAmount, paidCurrency);
        if (!updateOk && isSuccess) {
            return res.status(400).json({ error: 'Order validation failed or mismatch' });
        }
        return res.status(200).json({ received: true });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. FawryPay Webhook Verification (SHA-256)
    // ─────────────────────────────────────────────────────────────
    if (gateway === 'fawry' || body.fawryRefNumber || body.fawryRefNum || body.merchantRefNumber || body.merchantRefNum) {
        const secKey = (dynamicCfg.fawry?.securityKey || process.env.FAWRY_SECURITY_KEY || '').trim();
        if (!secKey) {
            console.error('[SECURITY ERROR] FAWRY_SECURITY_KEY not set in Database or environment!');
            return res.status(500).json({ error: 'Server webhook unconfigured' });
        }

        const {
            fawryRefNumber,
            fawryRefNum,
            merchantRefNumber,
            merchantRefNum,
            paymentAmount,
            orderAmount,
            orderStatus,
            paymentMethod,
            paymentRefrenceNumber,
            paymentReferenceNumber,
            paymentRefNumber,
            messageSignature
        } = body;

        // SECURITY: Fail-Closed if messageSignature is missing, empty, or not a string
        if (!messageSignature || typeof messageSignature !== 'string') {
            console.warn('[SECURITY ALERT] Fawry webhook received with no valid signature - rejected.');
            return res.status(403).json({ error: 'Missing signature' });
        }

        const refNumber = String(fawryRefNumber || fawryRefNum || '').trim();
        const merchantOrder = String(merchantRefNumber || merchantRefNum || '').trim();
        const pAmount = Number(paymentAmount ?? orderAmount ?? 0).toFixed(2);
        const oAmount = Number(orderAmount ?? paymentAmount ?? 0).toFixed(2);
        const status = String(orderStatus || '').trim();
        const method = String(paymentMethod || '').trim();
        const paymentRef = String(paymentRefrenceNumber || paymentReferenceNumber || paymentRefNumber || '').trim();

        // Official FawryPay V2 Server-to-Server Notification formula:
        // fawryRefNumber + merchantRefNum/merchantRefNumber + paymentAmount + orderAmount + orderStatus + paymentMethod + paymentRefrenceNumber + secureKey
        const rawStringV2 = `${refNumber}${merchantOrder}${pAmount}${oAmount}${status}${method}${paymentRef}${secKey}`;
        const calculatedSigV2 = crypto.createHash('sha256').update(rawStringV2).digest('hex');

        // Legacy / V1 fallback formula: fawryRefNumber + merchantRefNum + orderAmount + orderStatus + secureKey
        const rawStringV1 = `${refNumber}${merchantOrder}${oAmount}${status}${secKey}`;
        const calculatedSigV1 = crypto.createHash('sha256').update(rawStringV1).digest('hex');

        const isValid = safeCompare(messageSignature, calculatedSigV2) || safeCompare(messageSignature, calculatedSigV1);

        if (!isValid) {
            console.warn('[SECURITY ALERT] Invalid Fawry Signature attempt! Received:', messageSignature, 'Computed V2:', calculatedSigV2);
            return res.status(403).json({ error: 'Invalid signature' });
        }

        const isSuccess = status.toUpperCase() === 'PAID';
        const paidAmount = Number(pAmount);
        const paidCurrency = body.currency || 'EGP';

        const updateOk = await updateOrderPayment(merchantOrder, isSuccess ? 'paid' : 'failed', refNumber, 'fawry', paidAmount, paidCurrency);
        if (!updateOk && isSuccess) {
            return res.status(400).json({ error: 'Order validation failed or mismatch' });
        }
        return res.status(200).json({ received: true });
    }

    return res.status(400).json({ error: 'Unrecognized gateway webhook payload' });
}
