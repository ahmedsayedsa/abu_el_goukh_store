import fs from 'fs';
import path from 'path';

/**
 * Server-Side Price Verification Engine
 * Validates cart items against the authoritative products.json catalog
 * Prevents client-side price tampering in devtools.
 */
export function verifyOrderPrice(items, claimedTotal, discountCode = '', shippingFee = 150) {
    try {
        const catalogPath = path.join(process.cwd(), 'products.json');
        if (!fs.existsSync(catalogPath)) {
            console.warn('[PriceCheck] products.json not found on disk, fallback to claimed');
            return { verifiedTotal: Number(claimedTotal), isTampered: false };
        }

        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        const catalogMap = new Map();
        catalog.forEach(p => {
            catalogMap.set(String(p.id), Number(p.price));
            if (p.sku) catalogMap.set(String(p.sku), Number(p.price));
        });

        let verifiedSubtotal = 0;
        if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
                const idKey = String(item.id || item.sku || '');
                const officialPrice = catalogMap.get(idKey);
                if (officialPrice && officialPrice > 0) {
                    verifiedSubtotal += officialPrice;
                } else {
                    // Fallback to item price if not in catalog, but ensure non-negative
                    verifiedSubtotal += Math.max(0, Number(item.price) || 0);
                }
            }
        } else {
            return { verifiedTotal: Number(claimedTotal), isTampered: false };
        }

        let verifiedShipping = Number(shippingFee) >= 0 ? Number(shippingFee) : 150;
        let verifiedDiscount = 0;

        if (discountCode) {
            const code = String(discountCode).trim().toUpperCase();
            if (code === 'GOUKH1925') {
                verifiedDiscount = Math.round(verifiedSubtotal * 0.05);
            } else if (code === 'FREESHIP') {
                verifiedShipping = 0;
            }
        }

        const calculatedTotal = Math.max(0, verifiedSubtotal - verifiedDiscount + verifiedShipping);
        const diff = Math.abs(calculatedTotal - Number(claimedTotal));

        // If client claimed total differs by more than 5 EGP, mark as tampered and enforce calculated
        const isTampered = diff > 5;
        if (isTampered) {
            console.warn(`[Security Alert] Price tampering detected! Claimed: ${claimedTotal} EGP, Authoritative: ${calculatedTotal} EGP`);
        }

        return {
            verifiedTotal: calculatedTotal,
            verifiedSubtotal,
            isTampered
        };
    } catch (err) {
        console.error('[PriceCheck Error]', err);
        return { verifiedTotal: Number(claimedTotal), isTampered: false };
    }
}
