import crypto from 'crypto';

/**
 * Vercel Serverless Function - FawryPay Payment Request Proxy
 * Generates SHA-256 signature and initializes Fawry Hosted Checkout
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
        merchantCode,
        securityKey,
        mode,
        expiry,
        orderId,
        total,
        cartDescription,
        customerName,
        customerPhone,
        customerEmail,
        returnUrl
    } = req.body;

    if (!merchantCode || !securityKey || !orderId || !total) {
        return res.status(400).json({ error: 'Missing required Fawry credentials (merchantCode and securityKey required)' });
    }

    const mCode = merchantCode.trim();
    const secKey = securityKey.trim();
    const formattedPrice = Number(total).toFixed(2);
    const itemId = `BIKE-${orderId}`;
    const custProfileId = (customerPhone || '01202925192').trim();
    const retUrl = returnUrl || 'https://abu-el-goukh-store.vercel.app/checkout?payment=fawry_success';

    // Fawry standard SHA-256 signature for charge init:
    // merchantCode + merchantRefNum + customerProfileId + returnUrl + itemId + quantity + price + securityKey
    const rawSignature = `${mCode}${orderId}${custProfileId}${retUrl}${itemId}1${formattedPrice}${secKey}`;
    const signature = crypto.createHash('sha256').update(rawSignature).digest('hex');

    const fawryBase = (mode === 'live')
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
                redirect_url: initData.nextActionUrl || initData.redirect_url || initData.paymentUrl
            });
        }

        const hostedCheckoutUrl = `${fawryBase}/ECommerceWeb/Fawry/payments/checkout?merchantCode=${mCode}&merchantRefNum=${orderId}&paymentExpiry=${expiryTime}&signature=${signature}`;

        return res.status(200).json({
            redirect_url: hostedCheckoutUrl,
            fawry_data: initData
        });

    } catch (err) {
        console.error('Fawry error:', err);
        const hostedCheckoutUrl = `${fawryBase}/ECommerceWeb/Fawry/payments/checkout?merchantCode=${mCode}&merchantRefNum=${orderId}&paymentExpiry=${expiryTime}&signature=${signature}`;
        return res.status(200).json({
            redirect_url: hostedCheckoutUrl,
            fallback: true
        });
    }
}
