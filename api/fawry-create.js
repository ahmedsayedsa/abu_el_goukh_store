import crypto from 'crypto';
import { verifyOrderPrice } from './_verify-price.js';
import { getGatewayConfig } from './_gateway-config.js';

/**
 * Vercel Serverless Function - FawryPay Payment Request Proxy
 * SECURITY:
 * 1. Resolves merchantCode and securityKey securely from Admin Database or process.env.
 * 2. Rejects client-provided security keys.
 * 3. Enforces authoritative server-side price validation (Fail-Closed).
 * 4. Computes cryptographic SHA-256 signature server-side only.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
        expiry, orderId, total, items, promoCode,
        shippingFee, cartDescription, customerName,
        customerPhone, customerEmail, returnUrl
    } = req.body || {};

    if (!orderId) {
        return res.status(400).json({ error: 'Order ID is required' });
    }

    // Resolve credentials dynamically from Admin-configured DB or Server Environment Variables
    const dynamicCfg = await getGatewayConfig();
    const fwCfg = dynamicCfg.fawry || {};

    const mCode = (fwCfg.merchantCode || process.env.FAWRY_MERCHANT_CODE || '').trim();
    const secKey = (fwCfg.securityKey || process.env.FAWRY_SECURITY_KEY || '').trim();
    const effectiveMode = (fwCfg.mode || process.env.FAWRY_MODE || 'live').trim();

    if (!mCode || !secKey) {
        console.error('[SECURITY ERROR] Fawry credentials missing in Database and Environment Variables!');
        return res.status(500).json({
            error: 'Fawry gateway is not configured. Please set Merchant Code and Security Key in the Admin Dashboard or Vercel Environment Variables.'
        });
    }

    // SECURITY FIX: Authoritative Server-side price validation (Fail-Closed)
    let priceResult;
    try {
        priceResult = await verifyOrderPrice(items, total, promoCode, shippingFee);
    } catch (verErr) {
        console.error('[Fawry Price Check Failed]', verErr.message);
        return res.status(400).json({ error: verErr.message });
    }

    const { verifiedTotal, isTampered } = priceResult;
    const formattedPrice = Number(verifiedTotal).toFixed(2);

    if (Number(formattedPrice) <= 0) {
        return res.status(400).json({ error: 'Invalid verified order total.' });
    }

    const host = req.headers['host'] || 'abu-el-goukh-store.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;

    const itemId = `BIKE-${String(orderId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const custProfileId = String(customerPhone || '01202925192').trim();
    const retUrl = returnUrl || `${baseUrl}/order-success.html?gateway=fawry&order=${encodeURIComponent(orderId)}`;

    // Fawry standard SHA-256 signature for charge init:
    // merchantCode + merchantRefNum + customerProfileId + returnUrl + itemId + quantity + price + securityKey
    const rawSignature = `${mCode}${orderId}${custProfileId}${retUrl}${itemId}1${formattedPrice}${secKey}`;
    const signature = crypto.createHash('sha256').update(rawSignature).digest('hex');

    const fawryBase = (effectiveMode === 'live')
        ? 'https://www.atfawry.com'
        : 'https://atfawry.fawrystaging.com';

    const expiryTime = Date.now() + (Number(expiry || 48) * 3600 * 1000);

    const fawryPayload = {
        merchantCode: mCode,
        merchantRefNum: String(orderId),
        customerProfileId: custProfileId,
        customerName: String(customerName || 'عميل أبو الجوخ').substring(0, 50),
        customerMobile: custProfileId,
        customerEmail: customerEmail || 'customer@abu-el-goukh.com',
        paymentExpiry: expiryTime,
        chargeItems: [
            {
                itemId: itemId,
                description: String(cartDescription || 'طلب دراجة من متجر أبو الجوخ 1925').substring(0, 100),
                price: Number(formattedPrice),
                quantity: 1
            }
        ],
        returnUrl: retUrl,
        notifyUrl: `${baseUrl}/api/payment-webhook?gateway=fawry`,
        notificationUrl: `${baseUrl}/api/payment-webhook?gateway=fawry`,
        signature: signature
    };

    try {
        const initRes = await fetch(`${fawryBase}/fawrypay-api/api/payments/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fawryPayload)
        });

        const contentType = initRes.headers.get('content-type') || '';
        let initData = null;
        if (contentType.includes('application/json')) {
            initData = await initRes.json();
        } else {
            const rawText = await initRes.text();
            try { initData = JSON.parse(rawText); } catch(e) { initData = { text: rawText }; }
        }

        if (initData && (initData.nextActionUrl || initData.redirect_url || initData.paymentUrl)) {
            return res.status(200).json({
                redirect_url: initData.nextActionUrl || initData.redirect_url || initData.paymentUrl,
                priceVerified: true,
                isTampered
            });
        }

        const hostedCheckoutUrl = `${fawryBase}/ECommerceWeb/Fawry/payments/checkout?merchantCode=${mCode}&merchantRefNum=${orderId}&paymentExpiry=${expiryTime}&signature=${signature}`;

        return res.status(200).json({
            redirect_url: hostedCheckoutUrl,
            priceVerified: true,
            isTampered
        });

    } catch (err) {
        console.error('Fawry initiation error');
        return res.status(502).json({ error: 'Failed to initiate Fawry payment session' });
    }
}
