import { verifyOrderPrice } from './_verify-price.js';
import { getGatewayConfig } from './_gateway-config.js';

/**
 * Vercel Serverless Function - Paymob Payment Request Proxy
 * SECURITY:
 * 1. Resolves API Key, Secret Key, Public Key securely from Admin Database or process.env.
 * 2. Rejects any attempt to supply keys via client req.body.
 * 3. Enforces authoritative server-side price calculation (Fail-Closed).
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
        orderId, total, items, promoCode, shippingFee,
        cartDescription, customerName, customerPhone,
        customerCity, customerState, customerAddress, returnUrl,
        paymentMethod
    } = req.body || {};

    if (!orderId) {
        return res.status(400).json({ error: 'Order ID is required' });
    }

    // Resolve credentials dynamically from Admin-configured DB or Server Environment Variables
    const dynamicCfg = await getGatewayConfig();
    const pmCfg = dynamicCfg.paymob || {};

    const apiKey = (pmCfg.apiKey || process.env.PAYMOB_API_KEY || '').trim();
    const secretKey = (pmCfg.secretKey || process.env.PAYMOB_SECRET_KEY || '').trim();
    const publicKey = (pmCfg.publicKey || process.env.PAYMOB_PUBLIC_KEY || '').trim();
    const isValu = (paymentMethod === 'valu') || (cartDescription && cartDescription.includes('valu'));
    const integrationId = (isValu && (pmCfg.intValu || process.env.PAYMOB_INTEGRATION_ID_VALU))
        ? (pmCfg.intValu || process.env.PAYMOB_INTEGRATION_ID_VALU).toString().trim()
        : (pmCfg.intCards || process.env.PAYMOB_INTEGRATION_ID || '').toString().trim();
    const iframeId = (pmCfg.iframeId || process.env.PAYMOB_IFRAME_ID || '812345').toString().trim();

    if (!apiKey && !secretKey) {
        console.error('[SECURITY ERROR] Paymob credentials missing in Database and Environment Variables!');
        return res.status(500).json({
            error: 'Paymob gateway is not configured. Please set Paymob Secret Key or API Key in the Admin Dashboard or Vercel Environment Variables.'
        });
    }

    // SECURITY FIX: Authoritative Server-side price validation (Fail-Closed)
    let priceResult;
    try {
        priceResult = await verifyOrderPrice(items, total, promoCode, shippingFee);
    } catch (verErr) {
        console.error('[Paymob Price Check Failed]', verErr.message);
        return res.status(400).json({ error: verErr.message });
    }

    const { verifiedTotal, isTampered } = priceResult;
    const amountCents = Math.round(Number(verifiedTotal) * 100);

    if (amountCents <= 0) {
        return res.status(400).json({ error: 'Invalid verified order total.' });
    }

    const nameParts = String(customerName || 'عميل أبو الجوخ').trim().split(/\s+/);
    const firstName = nameParts[0] || 'عميل';
    const lastName = nameParts.slice(1).join(' ') || 'أبو الجوخ';
    const phone = String(customerPhone || '01202925192').trim();

    // ─────────────────────────────────────────────────────────────
    // Method 1: Modern Paymob Unified Checkout (Intention API)
    // ─────────────────────────────────────────────────────────────
    if (secretKey && secretKey.length > 10) {
        try {
            const host = req.headers['host'] || 'abu-el-goukh-store.vercel.app';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const baseUrl = `${protocol}://${host}`;

            const intMethods = [];
            if (integrationId && !isNaN(Number(integrationId))) {
                intMethods.push(Number(integrationId));
            }

            const intentionPayload = {
                amount: amountCents,
                currency: 'EGP',
                payment_methods: intMethods.length > 0 ? intMethods : undefined,
                items: [
                    {
                        name: String(cartDescription || 'دراجة هوائية من أبو الجوخ 1925').substring(0, 100),
                        amount: amountCents,
                        quantity: 1
                    }
                ],
                billing_data: {
                    first_name: firstName,
                    last_name: lastName,
                    phone_number: phone,
                    email: 'customer@abu-el-goukh.com',
                    country: 'EG',
                    city: customerCity || 'Cairo',
                    state: customerState || customerCity || 'Cairo',
                    street: customerAddress || 'Cairo',
                    building: 'NA',
                    floor: 'NA',
                    apartment: 'NA',
                    postal_code: '12345'
                },
                customer: {
                    first_name: firstName,
                    last_name: lastName,
                    phone_number: phone,
                    email: 'customer@abu-el-goukh.com'
                },
                extras: {
                    order_id: String(orderId)
                },
                notification_url: `${baseUrl}/api/payment-webhook?gateway=paymob`,
                redirection_url: returnUrl || `${baseUrl}/order-success.html?gateway=paymob&order=${encodeURIComponent(orderId)}`
            };

            const intentionRes = await fetch('https://accept.paymob.com/v1/intention/', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${secretKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(intentionPayload)
            });

            const intentionData = await intentionRes.json();

            if (intentionRes.ok && (intentionData.client_secret || intentionData.cs)) {
                const clientSecret = intentionData.client_secret || intentionData.cs;
                const pk = publicKey || (intentionData.public_key);
                const redirectUrl = `https://accept.paymob.com/unifiedcheckout/?publicKey=${pk || ''}&clientSecret=${clientSecret}`;
                return res.status(200).json({
                    redirect_url: redirectUrl,
                    client_secret: clientSecret,
                    priceVerified: true,
                    isTampered
                });
            }
        } catch (intErr) {
            console.warn('Paymob intention API error, falling back to classic accept flow');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Method 2: Classic 3-Step Paymob Accept Flow (API Key)
    // ─────────────────────────────────────────────────────────────
    if (!apiKey) {
        return res.status(500).json({ error: 'Paymob API Key is required for classic checkout' });
    }

    try {
        // Step 1: Authentication Token
        const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
        });
        const authData = await authRes.json();
        if (!authRes.ok || !authData.token) {
            return res.status(502).json({ error: 'Paymob Authentication Failed' });
        }
        const authToken = authData.token;

        // Step 2: Order Registration
        const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                auth_token: authToken,
                delivery_needed: 'false',
                amount_cents: amountCents,
                currency: 'EGP',
                merchant_order_id: String(orderId),
                items: [
                    {
                        name: String(cartDescription || 'دراجة هوائية أبو الجوخ').substring(0, 100),
                        amount_cents: amountCents,
                        description: 'Bike order ' + String(orderId),
                        quantity: 1
                    }
                ]
            })
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok || !orderData.id) {
            return res.status(502).json({ error: 'Paymob Order Registration Failed' });
        }
        const paymobOrderId = orderData.id;

        // Step 3: Payment Key Request
        const effectiveIntegrationId = integrationId ? Number(integrationId) : 0;
        const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                auth_token: authToken,
                amount_cents: amountCents,
                expiration: 3600,
                order_id: paymobOrderId,
                billing_data: {
                    apartment: 'NA',
                    email: 'customer@abu-el-goukh.com',
                    floor: 'NA',
                    first_name: firstName,
                    street: customerAddress || customerCity || 'NA',
                    building: 'NA',
                    phone_number: phone,
                    shipping_method: 'PKG',
                    postal_code: 'NA',
                    city: customerCity || 'Cairo',
                    country: 'EG',
                    last_name: lastName,
                    state: customerState || customerCity || 'Cairo'
                },
                currency: 'EGP',
                integration_id: effectiveIntegrationId,
                lock_order_when_paid: 'false'
            })
        });
        const keyData = await keyRes.json();
        if (!keyRes.ok || !keyData.token) {
            return res.status(502).json({ error: 'Paymob Payment Key Failed' });
        }
        const paymentToken = keyData.token;

        // Step 4: Hosted Iframe URL
        const finalRedirectUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;

        return res.status(200).json({
            redirect_url: finalRedirectUrl,
            payment_token: paymentToken,
            priceVerified: true,
            isTampered
        });

    } catch (err) {
        console.error('Paymob proxy error');
        return res.status(500).json({ error: 'Server Error connecting to Paymob' });
    }
}
