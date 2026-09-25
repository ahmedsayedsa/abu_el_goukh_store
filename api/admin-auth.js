import crypto from 'crypto';

/**
 * In-memory IP tracking for Rate Limiting / Brute Force Protection
 * Limits consecutive failed login attempts to 5 per 15 minutes.
 */
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '127.0.0.1';
}

function checkRateLimit(ip) {
    const record = loginAttempts.get(ip);
    if (!record) return { allowed: true };

    if (record.lockedUntil && Date.now() < record.lockedUntil) {
        const remainingMinutes = Math.ceil((record.lockedUntil - Date.now()) / (60 * 1000));
        return {
            allowed: false,
            message: `تم قفل محاولات تسجيل الدخول مؤقتاً لتكرار المحاولات الفاشلة. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`
        };
    }

    // Reset if window expired
    if (record.lockedUntil && Date.now() >= record.lockedUntil) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }

    return { allowed: true };
}

function recordFailedAttempt(ip) {
    const record = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= 5) {
        record.lockedUntil = Date.now() + (15 * 60 * 1000); // 15-minute lock
    }
    loginAttempts.set(ip, record);
}

function resetLoginAttempts(ip) {
    loginAttempts.delete(ip);
}

/**
 * Constant-time comparison using fixed 32-byte SHA-256 hashes
 * SECURITY FIX: Prevents RangeError / buffer length mismatch bugs & timing attacks
 */
function safeCompare(a, b) {
    const hashA = crypto.createHash('sha256').update(String(a || '')).digest();
    const hashB = crypto.createHash('sha256').update(String(b || '')).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Helper to verify Admin JWT Token across Serverless Functions
 */
export function verifyAdminToken(req) {
    const adminSecret = process.env.ADMIN_JWT_SECRET;
    // SECURITY FIX: Fail-Closed if no JWT secret configured in environment
    if (!adminSecret) {
        return { valid: false, error: 'Server auth secret not configured' };
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
        return { valid: false, error: 'Missing authorization token' };
    }

    try {
        const [payloadB64, signature] = token.split('.');
        if (!payloadB64 || !signature) {
            return { valid: false, error: 'Malformed token structure' };
        }

        const expectedSig = crypto.createHmac('sha256', adminSecret).update(payloadB64).digest('hex');
        const sigMatches = safeCompare(signature, expectedSig);
        if (!sigMatches) {
            return { valid: false, error: 'Invalid token signature' };
        }

        const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) {
            return { valid: false, error: 'Token expired' };
        }

        return { valid: true, user: payload.user };
    } catch (e) {
        return { valid: false, error: 'Token verification failed' };
    }
}

/**
 * Admin Authentication Endpoint (GET: Verify, POST: Login)
 */
export default async function handler(req, res) {
    // SECURITY FIX: Strictly require environment variables, NO HARDCODED FALLBACK CREDENTIALS
    const adminSecret = process.env.ADMIN_JWT_SECRET;
    const validUser = process.env.ADMIN_USERNAME;
    const validPass = process.env.ADMIN_PASSWORD;

    if (!adminSecret || !validUser || !validPass) {
        console.error('[SECURITY ALERT] Admin credentials missing in Vercel Environment Variables!');
        return res.status(500).json({
            error: 'Server authentication credentials are not configured in Vercel environment variables.'
        });
    }

    // ─── Verification mode (GET) ───
    if (req.method === 'GET') {
        const authResult = verifyAdminToken(req);
        if (authResult.valid) {
            return res.status(200).json({ authenticated: true, user: authResult.user });
        }
        return res.status(401).json({ authenticated: false, error: authResult.error });
    }

    // ─── Login mode (POST) ───
    if (req.method === 'POST') {
        const clientIp = getClientIp(req);

        // SECURITY FIX: Brute-force rate limiting check
        const rateCheck = checkRateLimit(clientIp);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                authenticated: false,
                error: rateCheck.message
            });
        }

        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const inputUser = String(username).trim();
        const inputPass = String(password).trim();

        // Constant-time comparison
        const userMatches = safeCompare(inputUser, validUser.trim());
        const passMatches = safeCompare(inputPass, validPass.trim());

        if (userMatches && passMatches) {
            resetLoginAttempts(clientIp);

            const payload = {
                user: validUser.trim(),
                iat: Date.now(),
                exp: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
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

        // SECURITY FIX: Record failed attempt and throttle attacker
        recordFailedAttempt(clientIp);

        return res.status(401).json({
            authenticated: false,
            error: 'اسم المستخدم أو كلمة المرور غير صحيحة.'
        });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
