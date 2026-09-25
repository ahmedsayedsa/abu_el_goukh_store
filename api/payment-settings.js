import { verifyAdminToken } from './admin-auth.js';
import { getGatewayConfig } from './_gateway-config.js';

function getFirebaseUrl(path = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || 'https://abu-el-goukh-store-default-rtdb.firebaseio.com').replace(/\/+$/, '');
    const secret = (process.env.FIREBASE_AUTH_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${path}.json${query}`;
}

export default async function handler(req, res) {
    // ─────────────────────────────────────────────────────────────
    // 1. GET: Public Checkout Flags OR Admin Authenticated Settings
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const isPublic = req.query?.public === '1' || req.query?.public === 'true';

        // Public storefront lookup (safe non-sensitive info only)
        if (isPublic) {
            const cfg = await getGatewayConfig();
            return res.status(200).json({
                success: true,
                instapay: {
                    enabled: cfg.instapay?.enabled !== false,
                    ipa: cfg.instapay?.ipa || 'aboelgoukh1925@instapay',
                    phone: cfg.instapay?.phone || '01202925192',
                    vodafoneCash: cfg.instapay?.vodafoneCash || '01202925192',
                    instructions: cfg.instapay?.instructions || ''
                },
                cod: {
                    enabled: cfg.cod?.enabled !== false,
                    fee: Number(cfg.cod?.fee || 0),
                    maxLimit: Number(cfg.cod?.maxLimit || 35000)
                },
                gateways: {
                    paytabs: (cfg.paytabs?.enabled !== false) && !!(cfg.paytabs?.profileId || process.env.PAYTABS_PROFILE_ID),
                    paymob: (cfg.paymob?.enabled !== false) && !!(cfg.paymob?.secretKey || cfg.paymob?.apiKey || process.env.PAYMOB_SECRET_KEY || process.env.PAYMOB_API_KEY),
                    fawry: (cfg.fawry?.enabled === true) && !!(cfg.fawry?.merchantCode || process.env.FAWRY_MERCHANT_CODE),
                    valu: (cfg.paymob?.enabled !== false)
                }
            });
        }

        // Admin-only full settings retrieval
        const auth = verifyAdminToken(req);
        if (!auth.valid) {
            return res.status(401).json({ error: 'غير مصرح باستعراض إعدادات الدفع' });
        }

        const storedCfg = await getGatewayConfig();

        // Merge with env defaults if field is empty
        const fullConfig = {
            paymob: {
                enabled: storedCfg.paymob?.enabled !== false,
                mode: storedCfg.paymob?.mode || 'live',
                apiKey: storedCfg.paymob?.apiKey || process.env.PAYMOB_API_KEY || '',
                publicKey: storedCfg.paymob?.publicKey || process.env.PAYMOB_PUBLIC_KEY || '',
                secretKey: storedCfg.paymob?.secretKey || process.env.PAYMOB_SECRET_KEY || '',
                intCards: storedCfg.paymob?.intCards || process.env.PAYMOB_INTEGRATION_ID || '',
                intWallets: storedCfg.paymob?.intWallets || '',
                intValu: storedCfg.paymob?.intValu || process.env.PAYMOB_INTEGRATION_ID_VALU || '',
                intKiosk: storedCfg.paymob?.intKiosk || '',
                iframeId: storedCfg.paymob?.iframeId || process.env.PAYMOB_IFRAME_ID || '812345',
                hmac: storedCfg.paymob?.hmac || process.env.PAYMOB_HMAC_SECRET || ''
            },
            paytabs: {
                enabled: storedCfg.paytabs?.enabled !== false,
                mode: storedCfg.paytabs?.mode || 'live',
                profileId: storedCfg.paytabs?.profileId || process.env.PAYTABS_PROFILE_ID || '',
                serverKey: storedCfg.paytabs?.serverKey || process.env.PAYTABS_SERVER_KEY || '',
                clientKey: storedCfg.paytabs?.clientKey || process.env.PAYTABS_CLIENT_KEY || ''
            },
            fawry: {
                enabled: storedCfg.fawry?.enabled === true,
                mode: storedCfg.fawry?.mode || process.env.FAWRY_MODE || 'sandbox',
                merchantCode: storedCfg.fawry?.merchantCode || process.env.FAWRY_MERCHANT_CODE || '',
                securityKey: storedCfg.fawry?.securityKey || process.env.FAWRY_SECURITY_KEY || '',
                expiry: Number(storedCfg.fawry?.expiry || 48)
            },
            instapay: {
                enabled: storedCfg.instapay?.enabled !== false,
                ipa: storedCfg.instapay?.ipa || 'aboelgoukh1925@instapay',
                phone: storedCfg.instapay?.phone || '01202925192',
                vodafoneCash: storedCfg.instapay?.vodafoneCash || '01202925192',
                otherCash: storedCfg.instapay?.otherCash || '',
                instructions: storedCfg.instapay?.instructions || 'يرجى تحويل قيمة الطلب إلى عنوان إنستاباي أو محفظة فودافون كاش الموضحة، ثم إرسال سكرين شوت التحويل عبر الواتساب لتأكيد شحن الدراجة فوراً.'
            },
            cod: {
                enabled: storedCfg.cod?.enabled !== false,
                fee: Number(storedCfg.cod?.fee || 0),
                maxLimit: Number(storedCfg.cod?.maxLimit || 35000),
                allowInspection: storedCfg.cod?.allowInspection !== false
            },
            updatedAt: storedCfg.updatedAt || new Date().toISOString()
        };

        return res.status(200).json({ success: true, config: fullConfig });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. POST / PUT: Admin Saves New Gateway Credentials
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'POST' || req.method === 'PUT') {
        const auth = verifyAdminToken(req);
        if (!auth.valid) {
            return res.status(401).json({ error: 'غير مصرح بتعديل إعدادات الدفع' });
        }

        const newConfig = req.body || {};
        newConfig.updatedAt = new Date().toISOString();

        try {
            const fbRes = await fetch(getFirebaseUrl('/payment_gateway_settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newConfig)
            });

            if (!fbRes.ok) {
                console.error('[Settings Save Failed]', await fbRes.text());
                return res.status(502).json({ error: 'فشل حفظ الإعدادات في قاعدة البيانات السحابية' });
            }

            return res.status(200).json({
                success: true,
                message: 'تم حفظ وتفعيل إعدادات بوابات الدفع بنجاح في السحابة!'
            });
        } catch (err) {
            console.error('[Settings Save Error]', err);
            return res.status(500).json({ error: 'خطأ أثناء حفظ إعدادات بوابات الدفع' });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
