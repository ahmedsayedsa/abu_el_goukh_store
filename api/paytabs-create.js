import { verifyOrderPrice } from './_verify-price.js';

/**
 * Vercel Serverless Function - PayTabs Payment Request Proxy
 * 1. Reads Server Key securely from process.env (Vercel Environment Variables)
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

    // Securely resolve credentials: Server Environment Variables take precedence
    const serverKey = (process.env.PAYTABS_SERVER_KEY || req.body.serverKey || '').trim();
    const profileId = (process.env.PAYTABS_PROFILE_ID || req.body.profileId || '').toString().trim();

    if (!serverKey || !profileId || !orderId) {
        return res.status(400).json({
            error: 'Missing PayTabs configuration. Please configure PAYTABS_SERVER_KEY and PAYTABS_PROFILE_ID in Vercel Environment Variables.'
        });
    }

    // Server-side authoritative price verification
    const { verifiedTotal, isTampered } = verifyOrderPrice(items, total, promoCode, shippingFee);
    const finalAmount = verifiedTotal;

    const ptEndpoint = 'https://secure-egypt.paytabs.com/payment/request';

    try {
        const ptBody = {
            profile_id: parseInt(profileId, 10),
            tran_type: 'sale',
            tran_class: 'ecom',
            cart_id: orderId,
            cart_currency: 'EGP',
            cart_amount: Number(finalAmount),
            cart_description: (cartDescription || 'Abu El Goukh Bikes 1925').substring(0, 127),
            customer_details: {
                name: customerName || 'Customer',
                phone: customerPhone || '01000000000',
                email: 'orders@abu-el-goukh.com',
                street1: customerAddress || customerCity || 'Egypt',
                city: customerCity || 'Cairo',
                state: customerState || customerCity || 'Cairo',
                country: 'EG',
                zip: '12345'
            },
            shipping_details: {
                name: customerName || 'Customer',
                phone: customerPhone || '01000000000',
                email: 'orders@abu-el-goukh.com',
                street1: customerAddress || customerCity || 'Egypt',
                city: customerCity || 'Cairo',
                state: customerState || customerCity || 'Cairo',
                country: 'EG',
                zip: '12345'
            },
            return: returnUrl || 'https://abu-el-goukh-store.vercel.app/order-success.html?payment=paytabs_success',
            callback: 'https://abu-el-goukh-store.vercel.app/order-success.html?payment=paytabs_callback'
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
            return res.status(ptResponse.status).json({ error: 'PayTabs Error', message: ptData.message || 'Payment initiation failed' });
        }

        return res.status(200).json({
            ...ptData,
            priceVerified: true,
            isTampered
        });

    } catch (error) {
        console.error('PayTabs proxy internal error');
        return res.status(500).json({ error: 'Server Error', message: error.message });
    }
}
