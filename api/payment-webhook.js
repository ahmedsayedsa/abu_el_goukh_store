import crypto from 'crypto';
import { getGatewayConfig } from './_gateway-config.js';

/**
 * Server-to-Server Payment Webhook Handler
 * SECURITY FIX:
 * 1. ONLY authoritative endpoint permitted to mark orders as 'paid' or 'failed'.
 * 2. Cryptographically validates HMAC / SHA-256 signatures for Paymob, PayTabs, and Fawry.
 * 3. Completely eliminates client-side payment forgery.
 */

function getFirebaseUrl(path = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
    const secret = (process.env.FIREBASE_AUTH_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${path}.json${query}`;
}

function safeCompare(a, b) {
    const hashA = crypto.createHash('sha256').update(String(a || '')).digest();
    const hashB = crypto.createHash('sha256').update(String(b || '')).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

async function updateOrderPayment(orderId, paymentStatus, paymentRef, gateway) {
    if (!orderId) return false;

    const updates = {
        paymentStatus,
        paymentRef: String(paymentRef || ''),
        paymentGateway: gateway,
        paymentUpdatedAt: new Date().toISOString()
    };

    if (paymentStatus === 'paid') {
        updates.paidAt = new Date().toLocaleString('ar-EG');
        updates.status = 'تم تأكيد الطلب والسداد بنجاح';
    } else if (paymentStatus === 'failed') {
        updates.status = 'فشل السداد الإلكتروني';
    }

    try {
        const res = await fetch(getFirebaseUrl(`/orders/${orderId}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        return res.ok;
    } catch (e) {
        console.error(`[Webhook Update Error for ${orderId}]:`, e);
        return false;
    }
}

export default async function handler(req, res) {
    // Only accept POST (standard for IPN / Webhooks)
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const gateway = String(req.query?.gateway || '').toLowerCase();
    const body = req.body || {};
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

        const queryHmac = req.query?.hmac || req.headers['x-paymob-hmac'] || '';
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

        if (!queryHmac || !safeCompare(queryHmac, calculatedHmac)) {
            console.warn('[SECURITY ALERT] Invalid Paymob HMAC Signature attempt!');
            return res.status(403).json({ error: 'Invalid HMAC signature' });
        }

        const orderId = obj.order?.merchant_order_id || obj.order_id || obj.order?.id;
        const txnId = obj.id;
        const isSuccess = obj.success === true || obj.success === 'true';

        await updateOrderPayment(orderId, isSuccess ? 'paid' : 'failed', txnId, 'paymob');
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
        if (signatureHeader) {
            const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            const calculatedSig = crypto.createHmac('sha256', serverKey).update(rawBody).digest('hex');
            if (!safeCompare(signatureHeader, calculatedSig)) {
                console.warn('[SECURITY ALERT] Invalid PayTabs Signature attempt!');
                return res.status(403).json({ error: 'Invalid signature' });
            }
        }

        const orderId = body.cart_id || body.merchant_order_id;
        const tranRef = body.tran_ref;
        const status = body.payment_result?.response_status || body.respStatus;
        const isSuccess = status === 'A'; // 'A' = Authorized / Completed

        await updateOrderPayment(orderId, isSuccess ? 'paid' : 'failed', tranRef, 'paytabs');
        return res.status(200).json({ received: true });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. FawryPay Webhook Verification (SHA-256)
    // ─────────────────────────────────────────────────────────────
    if (gateway === 'fawry' || body.fawryRefNum || body.merchantRefNum) {
        const secKey = (dynamicCfg.fawry?.securityKey || process.env.FAWRY_SECURITY_KEY || '').trim();
        if (!secKey) {
            console.error('[SECURITY ERROR] FAWRY_SECURITY_KEY not set in Database or environment!');
            return res.status(500).json({ error: 'Server webhook unconfigured' });
        }

        const { fawryRefNum, merchantRefNum, orderAmount, orderStatus, messageSignature } = body;
        const formattedAmount = Number(orderAmount).toFixed(2);

        // Fawry signature: fawryRefNum + merchantRefNum + amount + orderStatus + securityKey
        const rawString = `${fawryRefNum}${merchantRefNum}${formattedAmount}${orderStatus}${secKey}`;
        const calculatedSig = crypto.createHash('sha256').update(rawString).digest('hex');

        if (!messageSignature || !safeCompare(messageSignature, calculatedSig)) {
            console.warn('[SECURITY ALERT] Invalid Fawry Signature attempt!');
            return res.status(403).json({ error: 'Invalid signature' });
        }

        const isSuccess = String(orderStatus).toUpperCase() === 'PAID';
        await updateOrderPayment(merchantRefNum, isSuccess ? 'paid' : 'failed', fawryRefNum, 'fawry');
        return res.status(200).json({ received: true });
    }

    return res.status(400).json({ error: 'Unrecognized gateway webhook payload' });
}
