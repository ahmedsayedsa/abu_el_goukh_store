/**
 * Vercel Serverless Function - PayTabs Payment Request Proxy
 * Solves CORS: browser -> this function -> PayTabs API
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
        profileId, serverKey, orderId, total,
        cartDescription, customerName, customerPhone,
        customerCity, customerState, customerAddress, returnUrl
    } = req.body;

    if (!profileId || !serverKey || !orderId || !total) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const ptEndpoint = 'https://secure-egypt.paytabs.com/payment/request';

    try {
        const ptBody = {
            profile_id: parseInt(profileId),
            tran_type: 'sale',
            tran_class: 'ecom',
            cart_id: orderId,
            cart_currency: 'EGP',
            cart_amount: Number(total),
            cart_description: (cartDescription || 'Abu El Goukh Bikes').substring(0, 127),
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
            return: returnUrl || 'https://abu-el-goukh-store.vercel.app/checkout?payment=success',
            callback: 'https://abu-el-goukh-store.vercel.app/checkout?payment=callback'
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
            return res.status(ptResponse.status).json({ error: 'PayTabs Error', details: ptData });
        }

        return res.status(200).json(ptData);

    } catch (error) {
        console.error('PayTabs proxy error:', error);
        return res.status(500).json({ error: 'Server Error', message: error.message });
    }
}
