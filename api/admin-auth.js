import crypto from 'crypto';

/**
 * Serverless Admin Authentication Endpoint
 * Verifies credentials server-side against Vercel Environment Variables.
 * Returns signed session token. No plaintext passwords stored on client.
 */
export default async function handler(req, res) {
    const adminSecret = process.env.ADMIN_JWT_SECRET || 'aeg-secure-secret-salt-1925-cairo';
    const validUser = (process.env.ADMIN_USERNAME || 'admin').trim();
    const validPass = (process.env.ADMIN_PASSWORD || 'Goukh@1925').trim();

    // Verification mode (GET)
    if (req.method === 'GET') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();

        if (!token) {
            return res.status(401).json({ authenticated: false, error: 'No token provided' });
        }

        try {
            const [payloadB64, signature] = token.split('.');
            if (!payloadB64 || !signature) {
                return res.status(401).json({ authenticated: false, error: 'Malformed token' });
            }

            const expectedSig = crypto.createHmac('sha256', adminSecret).update(payloadB64).digest('hex');
            if (signature !== expectedSig) {
                return res.status(401).json({ authenticated: false, error: 'Invalid token signature' });
            }

            const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
            if (payload.exp && Date.now() > payload.exp) {
                return res.status(401).json({ authenticated: false, error: 'Token expired' });
            }

            return res.status(200).json({ authenticated: true, user: payload.user });
        } catch (e) {
            return res.status(401).json({ authenticated: false, error: 'Verification failed' });
        }
    }

    // Login mode (POST)
    if (req.method === 'POST') {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const inputUser = String(username).trim();
        const inputPass = String(password).trim();

        // Constant-time comparison to prevent timing attacks
        const userMatches = crypto.timingSafeEqual(
            Buffer.from(inputUser.padEnd(64, ' ')),
            Buffer.from(validUser.padEnd(64, ' '))
        );

        const passMatches = crypto.timingSafeEqual(
            Buffer.from(inputPass.padEnd(64, ' ')),
            Buffer.from(validPass.padEnd(64, ' '))
        );

        if (userMatches && passMatches) {
            const payload = {
                user: validUser,
                iat: Date.now(),
                exp: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
            };
            const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
            const signature = crypto.createHmac('sha256', adminSecret).update(payloadB64).digest('hex');
            const token = `${payloadB64}.${signature}`;

            return res.status(200).json({
                authenticated: true,
                token,
                expiresAt: payload.exp
            });
        }

        return res.status(401).json({
            authenticated: false,
            error: 'اسم المستخدم أو كلمة المرور غير صحيحة.'
        });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
