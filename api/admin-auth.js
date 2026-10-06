import crypto from 'crypto';

/**
 * Serverless Helper - Firebase Realtime Database URL builder
 */
function getFirebaseUrl(path = '') {
    const base = (process.env.FIREBASE_DATABASE_URL || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new Error('متغير البيئة FIREBASE_DATABASE_URL غير مضبوط في الخادم');
    }
    const secret = (process.env.FIREBASE_AUTH_SECRET || process.env.FIREBASE_DATABASE_SECRET || process.env.FIREBASE_SECRET || '').trim();
    const query = secret ? `?auth=${encodeURIComponent(secret)}` : '';
    return `${base}${path}.json${query}`;
}

/**
 * Sanitize client IP for safe use as a Firebase path key
 * Firebase prohibits '.', '#', '$', '[', ']' in key names.
 */
export function sanitizeIp(ip) {
    return String(ip || '127_0_0_1').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * SECURITY FIX (Vulnerability 2): Anti-IP Spoofing for Rate Limiting
 * 1. Prioritizes 'x-vercel-forwarded-for' (set authoritatively by Vercel Edge; cannot be spoofed by client).
 * 2. Fallbacks to the last (rightmost) IP in 'x-forwarded-for' (closest trusted upstream proxy).
 * 3. Never trusts the first/leftmost IP in 'x-forwarded-for' as it is easily forged by client headers.
 */
export function getClientIp(req) {
    const vercelForwarded = req.headers?.['x-vercel-forwarded-for'];
    if (vercelForwarded && typeof vercelForwarded === 'string') {
        return vercelForwarded.split(',')[0].trim();
    }

    const forwarded = req.headers?.['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
        const parts = forwarded.split(',');
        return parts.pop().trim();
    }

    return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Persistent Rate Limiting stored in Firebase Realtime Database (/login_attempts/{sanitized_ip})
 * Fail-Closed: If Firebase cannot be reached, reject the request to prevent brute-force attacks.
 */
async function checkRateLimit(ip) {
    const cleanIp = sanitizeIp(ip);
    try {
        const res = await fetch(getFirebaseUrl(`/login_attempts/${cleanIp}`), {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(3000)
        });

        if (!res.ok) {
            console.error('[RateLimit Error] Failed to read login attempts, HTTP status:', res.status);
            return {
                allowed: false,
                statusCode: 500,
                message: 'خطأ في التحقق من أمان الخادم. يرجى المحاولة لاحقاً.'
            };
        }

        const record = await res.json();
        if (record && record.lockedUntil && Date.now() < record.lockedUntil) {
            const remainingMinutes = Math.max(1, Math.ceil((record.lockedUntil - Date.now()) / (60 * 1000)));
            return {
                allowed: false,
                statusCode: 429,
                message: `تم قفل محاولات تسجيل الدخول مؤقتاً لتكرار المحاولات الفاشلة. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`,
                record
            };
        }

        return { allowed: true, record };
    } catch (e) {
        // Fail-Closed on network or connection errors
        console.error('[RateLimit Error] Firebase connection failed (Fail-Closed enforced):', e.message);
        return {
            allowed: false,
            statusCode: 503,
            message: 'تعذر الاتصال بخادم الحماية. يرجى المحاولة لاحقاً.'
        };
    }
}

/**
 * Record a failed login attempt in Firebase Realtime Database
 * Locks out IP for 15 minutes after 5 consecutive failed attempts.
 */
async function recordFailedAttempt(ip, existingRecord = null) {
    const cleanIp = sanitizeIp(ip);
    try {
        let record = existingRecord;
        if (!record) {
            const getRes = await fetch(getFirebaseUrl(`/login_attempts/${cleanIp}`), {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(3000)
            });
            if (getRes.ok) {
                record = await getRes.json();
            }
        }

        const currentCount = ((record && typeof record === 'object' && record.count) || 0) + 1;
        const newRecord = {
            count: currentCount,
            lastAttempt: new Date().toISOString(),
            lockedUntil: currentCount >= 5 ? Date.now() + (15 * 60 * 1000) : null
        };

        await fetch(getFirebaseUrl(`/login_attempts/${cleanIp}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newRecord),
            signal: AbortSignal.timeout(3000)
        });
    } catch (e) {
        console.error('[RateLimit Error] Failed to record attempt in Firebase:', e.message);
    }
}

/**
 * Reset failed login attempts in Firebase upon successful login (DELETE /login_attempts/{sanitized_ip})
 */
async function resetLoginAttempts(ip) {
    const cleanIp = sanitizeIp(ip);
    try {
        await fetch(getFirebaseUrl(`/login_attempts/${cleanIp}`), {
            method: 'DELETE',
            signal: AbortSignal.timeout(3000)
        });
    } catch (e) {
        console.warn('[RateLimit Error] Failed to delete attempt record from Firebase:', e.message);
    }
}

/**
 * Constant-time string comparison using fixed 32-byte SHA-256 hashes
 * Prevents timing attacks and RangeError / buffer length mismatch bugs
 */
function safeCompare(a, b) {
    const hashA = crypto.createHash('sha256').update(String(a || '')).digest();
    const hashB = crypto.createHash('sha256').update(String(b || '')).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Helper to verify Admin JWT Token across Serverless Functions
 * Reads from HttpOnly cookie `abu_admin_session` first, with fallback to `Authorization: Bearer <token>`
 */
export function verifyAdminToken(req) {
    const adminSecret = process.env.ADMIN_JWT_SECRET;
    // SECURITY FIX: Fail-Closed if no JWT secret configured in environment
    if (!adminSecret) {
        return { valid: false, error: 'Server auth secret not configured' };
    }

    let token = '';

    // 1. Try reading from HttpOnly cookie first (abu_admin_session)
    const cookieHeader = req.headers?.cookie || '';
    if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)abu_admin_session=([^;]+)/);
        if (match && match[1]) {
            token = decodeURIComponent(match[1]).trim();
        }
    }

    // 2. Fallback to Authorization header if cookie not present
    if (!token) {
        const authHeader = req.headers?.authorization || '';
        token = authHeader.replace(/^Bearer\s+/i, '').trim();
    }

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
 * Admin Authentication Endpoint (GET: Verify, POST: Login / Logout, DELETE: Logout)
 */
export default async function handler(req, res) {
    // ─── Logout handler ───
    if (req.method === 'DELETE' || (req.method === 'POST' && (req.query?.action === 'logout' || req.body?.action === 'logout'))) {
        res.setHeader('Set-Cookie', 'abu_admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
        return res.status(200).json({ success: true, message: 'Logged out successfully' });
    }

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

        // SECURITY FIX: Brute-force rate limiting check in Firebase (Fail-Closed)
        const rateCheck = await checkRateLimit(clientIp);
        if (!rateCheck.allowed) {
            return res.status(rateCheck.statusCode || 429).json({
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
            // Clear failed attempts upon successful login
            await resetLoginAttempts(clientIp);

            const payload = {
                user: validUser.trim(),
                iat: Date.now(),
                exp: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
            };
            const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
            const signature = crypto.createHmac('sha256', adminSecret).update(payloadB64).digest('hex');
            const token = `${payloadB64}.${signature}`;

            // Set HttpOnly Secure SameSite cookie (12 hours = 43200 seconds)
            res.setHeader('Set-Cookie', `abu_admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);

            return res.status(200).json({
                authenticated: true,
                expiresAt: payload.exp
            });
        }

        // SECURITY FIX: Record failed attempt in Firebase and throttle attacker
        await recordFailedAttempt(clientIp, rateCheck.record);

        return res.status(401).json({
            authenticated: false,
            error: 'اسم المستخدم أو كلمة المرور غير صحيحة.'
        });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
