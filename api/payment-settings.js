import { verifyAdminToken } from './admin-auth.js';
import { getGatewayConfig } from './_gateway-config.js';

function getFirebaseUrl(path = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new Error('متغير البيئة FIREBASE_DATABASE_URL غير مضبوط في الخادم');
    }
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${path}.json${query}`;
}

/** Validate an Egyptian mobile number (01x format) - empty string is allowed (means unset) */
function isValidEgPhone(val) {
    if (!val || val === '') return true; // empty = unset, allowed
    return /^01[0125][0-9]{8}$/.test(String(val).trim());
}

/** Validate InstaPay IPA address; adds @instapay suffix if missing */
function normalizeIpa(raw) {
    let ipa = String(raw || '').trim().toLowerCase();
    if (!ipa) return '';
    if (!ipa.includes('@')) ipa = ipa + '@instapay';
    return ipa;
}

function isValidIpa(ipa) {
    if (!ipa || ipa === '') return true; // empty = unset, allowed
    return /^[a-z0-9._-]{3,40}@[a-z]{3,20}$/.test(ipa);
}

export default async function handler(req, res) {
    // ─────────────────────────────────────────────────────────────
    // 1. GET: Public Checkout Flags OR Admin Authenticated Settings
    // ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const isPublic = req.query?.public === '1' || req.query?.public === 'true';

        // Public storefront lookup (safe non-sensitive info only)
        if (isPublic) {
            try {
                const cfg = await getGatewayConfig();
                const ip = cfg.instapay || {};

                // BUND 6c: only expose instapay data if explicitly enabled AND has valid IPA or phone
                const hasValidContact = isValidIpa(ip.ipa) && ip.ipa ||
                                        isValidEgPhone(ip.vodafoneCash) && ip.vodafoneCash ||
                                        isValidEgPhone(ip.phone) && ip.phone;
                const instapayEnabled = ip.enabled === true && hasValidContact;

                return res.status(200).json({
                    success: true,
                    instapay: instapayEnabled
                        ? {
                            enabled: true,
                            ipa: ip.ipa || '',
                            phone: ip.phone || '',
                            vodafoneCash: ip.vodafoneCash || '',
                            otherCash: ip.otherCash || '',
                            instructions: ip.instructions || ''
                          }
                        : { enabled: false },
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
            } catch (e) {
                // Fail-Closed: return disabled
                return res.status(200).json({ success: true, instapay: { enabled: false } });
            }
        }

        // Admin-only full settings retrieval
        const auth = verifyAdminToken(req);
        if (!auth.valid) {
            return res.status(401).json({ error: 'غير مصرح باستعراض إعدادات الدفع' });
        }

        const storedCfg = await getGatewayConfig();

        // BUND 6a: Zero defaults for instapay (no hardcoded IPA or phone)
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
            // BUND 6a: Zero defaults - only return what's stored, no hardcoded fallbacks
            instapay: {
                enabled: storedCfg.instapay?.enabled === true,
                ipa: storedCfg.instapay?.ipa || '',
                phone: storedCfg.instapay?.phone || '',
                vodafoneCash: storedCfg.instapay?.vodafoneCash || '',
                otherCash: storedCfg.instapay?.otherCash || '',
                instructions: storedCfg.instapay?.instructions || ''
            },
            cod: {
                enabled: storedCfg.cod?.enabled !== false,
                fee: Number(storedCfg.cod?.fee || 0),
                maxLimit: Number(storedCfg.cod?.maxLimit || 35000),
                allowInspection: storedCfg.cod?.allowInspection !== false
            },
            updatedAt: storedCfg.updatedAt || null
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

        const body = req.body || {};

        // BUND 6b: Server-side validation for instapay fields
        if (body.instapay !== undefined) {
            const ip = body.instapay || {};

            // Normalize and validate IPA
            const normalizedIpa = normalizeIpa(ip.ipa);
            if (normalizedIpa && !isValidIpa(normalizedIpa)) {
                return res.status(400).json({
                    error: `عنوان إنستاباي غير صحيح: "${normalizedIpa}". يجب أن يكون بصيغة username@instapay (3-40 حرف إنجليزي صغير وأرقام فقط).`
                });
            }
            body.instapay.ipa = normalizedIpa;

            // Validate phone numbers (empty allowed = unset)
            for (const field of ['vodafoneCash', 'phone', 'otherCash']) {
                const val = String(ip[field] || '').trim();
                if (val && !isValidEgPhone(val)) {
                    return res.status(400).json({
                        error: `رقم ${field} غير صحيح: "${val}". يجب أن يكون رقم مصري مكون من 11 رقماً يبدأ بـ 01.`
                    });
                }
                body.instapay[field] = val;
            }

            // Sanitize instructions (max 500 chars, strip HTML tags)
            const rawInstructions = String(ip.instructions || '').substring(0, 500);
            body.instapay.instructions = rawInstructions.replace(/[<>]/g, '');

            // BUND 6b: If enabled is true but no valid contact, force disable
            const hasContact = (normalizedIpa && isValidIpa(normalizedIpa)) ||
                               (isValidEgPhone(body.instapay.vodafoneCash) && body.instapay.vodafoneCash) ||
                               (isValidEgPhone(body.instapay.phone) && body.instapay.phone);
            if (ip.enabled === true && !hasContact) {
                body.instapay.enabled = false;
                console.warn('[Payment Settings] instapay enabled=true but no valid IPA/phone; forcing enabled=false');
            }
        }

        body.updatedAt = new Date().toISOString();

        try {
            const fbRes = await fetch(getFirebaseUrl('/payment_gateway_settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!fbRes.ok) {
                console.error('[Settings Save Failed]', await fbRes.text());
                return res.status(502).json({ error: 'فشل حفظ الإعدادات في قاعدة البيانات السحابية' });
            }

            return res.status(200).json({
                success: true,
                message: 'تم حفظ وتفعيل إعدادات بوابات الدفع بنجاح في السحابة!',
                updatedAt: body.updatedAt
            });
        } catch (err) {
            console.error('[Settings Save Error]', err);
            return res.status(500).json({ error: 'خطأ أثناء حفظ إعدادات بوابات الدفع' });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
