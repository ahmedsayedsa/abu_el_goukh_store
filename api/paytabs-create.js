import { verifyOrderPrice } from './_verify-price.js';
import { getGatewayConfig } from './_gateway-config.js';

/**
 * Vercel Serverless Function - PayTabs Payment Request Proxy
 * SECURITY:
 * 1. Resolves Server Key and Profile ID securely from Admin Database or process.env.
 * 2. Rejects client-provided secret keys.
 * 3. Enforces authoritative server-side price verification (Fail-Closed).
 * 4. Configures server-to-server webhook endpoint for verified IPN processing.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
        orderId, total, items, promoCode, shippingFee,
        cartDescription, customerName, customerPhone,
        customerCity, customerState, customerAddress, returnUrl
    } = req.body || {};

    if (!orderId) {
        return res.status(400).json({ error: 'Order ID is required' });
    }

    // Resolve credentials dynamically from Admin-configured DB or Server Environment Variables
    const dynamicCfg = await getGatewayConfig();
    const ptCfg = dynamicCfg.paytabs || {};

    const serverKey = (ptCfg.serverKey || process.env.PAYTABS_SERVER_KEY || '').trim();
    const profileId = (ptCfg.profileId || process.env.PAYTABS_PROFILE_ID || '').toString().trim();

    if (!serverKey || !profileId) {
        console.error('[SECURITY ERROR] PayTabs configuration missing in Database and Environment Variables!');
        return res.status(500).json({
            error: 'PayTabs gateway is not configured. Please set PayTabs Profile ID and Server Key in the Admin Dashboard or Vercel Environment Variables.'
        });
    }

    // SECURITY FIX: Authoritative Server-side price validation (Fail-Closed)
    let priceResult;
    try {
        priceResult = verifyOrderPrice(items, total, promoCode, shippingFee);
    } catch (verErr) {
        console.error('[PayTabs Price Check Failed]', verErr.message);
        return res.status(400).json({ error: verErr.message });
    }

    const { verifiedTotal, isTampered } = priceResult;
    const finalAmount = Number(verifiedTotal);

    if (finalAmount <= 0) {
        return res.status(400).json({ error: 'Invalid verified order total.' });
    }

    const host = req.headers['host'] || 'abu-el-goukh-store.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;

    const ptEndpoint = 'https://secure-egypt.paytabs.com/payment/request';

    try {
        const ptBody = {
            profile_id: parseInt(profileId, 10),
            tran_type: 'sale',
            tran_class: 'ecom',
            cart_id: String(orderId),
            cart_currency: 'EGP',
            cart_amount: finalAmount,
            cart_description: String(cartDescription || 'Abu El Goukh Bikes 1925').substring(0, 127),
            customer_details: {
                name: String(customerName || 'Customer').substring(0, 50),
                phone: String(customerPhone || '01000000000').substring(0, 20),
                email: 'orders@abu-el-goukh.com',
                street1: String(customerAddress || customerCity || 'Egypt').substring(0, 100),
                city: String(customerCity || 'Cairo').substring(0, 50),
                state: String(customerState || customerCity || 'Cairo').substring(0, 50),
                country: 'EG',
                zip: '12345'
            },
            shipping_details: {
                name: String(customerName || 'Customer').substring(0, 50),
                phone: String(customerPhone || '01000000000').substring(0, 20),
                email: 'orders@abu-el-goukh.com',
                street1: String(customerAddress || customerCity || 'Egypt').substring(0, 100),
                city: String(customerCity || 'Cairo').substring(0, 50),
                state: String(customerState || customerCity || 'Cairo').substring(0, 50),
                country: 'EG',
                zip: '12345'
            },
            // Customer browser return
            return: returnUrl || `${baseUrl}/order-success.html?gateway=paytabs&order=${encodeURIComponent(orderId)}`,
            // SECURITY FIX: Point IPN callback directly to serverless webhook for cryptographic HMAC verification
            callback: `${baseUrl}/api/payment-webhook?gateway=paytabs`
        };

        const ptResponse = await fetch(ptEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': serverKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(ptBody)
        });

        const ptData = await ptResponse.json();

        if (!ptResponse.ok) {
            console.error('PayTabs gateway error response');
            return res.status(ptResponse.status).json({
                error: 'PayTabs Error',
                message: ptData.message || 'Payment initiation failed'
            });
        }

        return res.status(200).json({
            redirect_url: ptData.redirect_url,
            tran_ref: ptData.tran_ref,
            priceVerified: true,
            isTampered
        });

    } catch (error) {
        console.error('PayTabs proxy internal error');
        return res.status(500).json({ error: 'Server Error connecting to PayTabs' });
    }
}
