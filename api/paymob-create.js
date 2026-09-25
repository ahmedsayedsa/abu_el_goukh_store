import { verifyOrderPrice } from './_verify-price.js';

/**
 * Vercel Serverless Function - Paymob Payment Request Proxy
 * 1. Reads API Key, Secret Key, Public Key securely from process.env (Vercel Environment Variables)
 * 2. Validates order total server-side against catalog to prevent price tampering
 * 3. Never leaks server secrets to client browser
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
        orderId, total, items, promoCode, shippingFee,
        cartDescription, customerName, customerPhone,
        customerCity, customerState, customerAddress, returnUrl
    } = req.body;

    // Securely resolve credentials from Server Environment Variables first
    const apiKey = (process.env.PAYMOB_API_KEY || req.body.apiKey || '').trim();
    const secretKey = (process.env.PAYMOB_SECRET_KEY || req.body.secretKey || '').trim();
    const publicKey = (process.env.PAYMOB_PUBLIC_KEY || req.body.publicKey || '').trim();
    const integrationId = (process.env.PAYMOB_INTEGRATION_ID || req.body.integrationId || '').toString().trim();
    const iframeId = (process.env.PAYMOB_IFRAME_ID || req.body.iframeId || '').toString().trim();

    if ((!apiKey && !secretKey) || !orderId) {
        return res.status(400).json({
            error: 'Missing Paymob credentials. Please set PAYMOB_API_KEY or PAYMOB_SECRET_KEY in Vercel Environment Variables.'
        });
    }

    // Authoritative Server-side price validation
    const { verifiedTotal, isTampered } = verifyOrderPrice(items, total, promoCode, shippingFee);
    const amountCents = Math.round(Number(verifiedTotal) * 100);

    const nameParts = (customerName || 'عميل أبو الجوخ').trim().split(/\s+/);
    const firstName = nameParts[0] || 'عميل';
    const lastName = nameParts.slice(1).join(' ') || 'أبو الجوخ';
    const phone = customerPhone || '01202925192';

    // ─────────────────────────────────────────────────────────────
    // Method 1: Modern Paymob Unified Checkout (Intention API)
    // ─────────────────────────────────────────────────────────────
    if (secretKey && secretKey.length > 10) {
        try {
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
                        name: (cartDescription || 'دراجة هوائية من أبو الجوخ 1925').substring(0, 100),
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
                    order_id: orderId
                }
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
        return res.status(400).json({ error: 'Paymob API Key is required for classic checkout' });
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
            return res.status(400).json({ error: 'Paymob Authentication Failed' });
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
                merchant_order_id: orderId,
                items: [
                    {
                        name: (cartDescription || 'دراجة هوائية أبو الجوخ').substring(0, 100),
                        amount_cents: amountCents,
                        description: 'Bike order ' + orderId,
                        quantity: 1
                    }
                ]
            })
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok || !orderData.id) {
            return res.status(400).json({ error: 'Paymob Order Registration Failed' });
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
            return res.status(400).json({ error: 'Paymob Payment Key Failed' });
        }
        const paymentToken = keyData.token;

        // Step 4: Hosted Iframe URL
        const effectiveIframeId = (iframeId && iframeId.trim()) ? iframeId.trim() : '812345';
        const finalRedirectUrl = `https://accept.paymob.com/api/acceptance/iframes/${effectiveIframeId}?payment_token=${paymentToken}`;

        return res.status(200).json({
            redirect_url: finalRedirectUrl,
            payment_token: paymentToken,
            priceVerified: true,
            isTampered
        });

    } catch (err) {
        console.error('Paymob proxy error');
        return res.status(500).json({ error: 'Server Error connecting to Paymob', message: err.message });
    }
}
