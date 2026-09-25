import crypto from 'crypto';
import { verifyOrderPrice } from './_verify-price.js';

/**
 * Vercel Serverless Function - FawryPay Payment Request Proxy
 * 1. Reads merchantCode and securityKey from process.env (Vercel Environment Variables)
 * 2. Validates order total server-side against catalog
 * 3. Computes cryptographic SHA-256 signature server-side
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
        expiry,
        orderId,
        total,
        items,
        promoCode,
        shippingFee,
        cartDescription,
        customerName,
        customerPhone,
        customerEmail,
        returnUrl
    } = req.body;

    // Securely resolve Fawry credentials from Server Environment Variables first
    const mCode = (process.env.FAWRY_MERCHANT_CODE || req.body.merchantCode || '').trim();
    const secKey = (process.env.FAWRY_SECURITY_KEY || req.body.securityKey || '').trim();
    const effectiveMode = (process.env.FAWRY_MODE || req.body.mode || 'live').trim();

    if (!mCode || !secKey || !orderId) {
        return res.status(400).json({
            error: 'Missing Fawry credentials. Please configure FAWRY_MERCHANT_CODE and FAWRY_SECURITY_KEY in Vercel Environment Variables.'
        });
    }

    // Authoritative Server-side price validation
    const { verifiedTotal, isTampered } = verifyOrderPrice(items, total, promoCode, shippingFee);
    const formattedPrice = Number(verifiedTotal).toFixed(2);

    const itemId = `BIKE-${orderId}`;
    const custProfileId = (customerPhone || '01202925192').trim();
    const retUrl = returnUrl || 'https://abu-el-goukh-store.vercel.app/order-success.html?payment=fawry_success';

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
        merchantRefNum: orderId,
        customerProfileId: custProfileId,
        customerName: customerName || 'عميل أبو الجوخ',
        customerMobile: custProfileId,
        customerEmail: customerEmail || 'customer@abu-el-goukh.com',
        paymentExpiry: expiryTime,
        chargeItems: [
            {
                itemId: itemId,
                description: (cartDescription || 'طلب دراجة من متجر أبو الجوخ 1925').substring(0, 100),
                price: Number(formattedPrice),
                quantity: 1
            }
        ],
        returnUrl: retUrl,
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
        console.error('Fawry error');
        const hostedCheckoutUrl = `${fawryBase}/ECommerceWeb/Fawry/payments/checkout?merchantCode=${mCode}&merchantRefNum=${orderId}&paymentExpiry=${expiryTime}&signature=${signature}`;
        return res.status(200).json({
            redirect_url: hostedCheckoutUrl,
            fallback: true,
            priceVerified: true,
            isTampered
        });
    }
}
