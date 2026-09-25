import fs from 'fs';
import path from 'path';

/**
 * Server-Side Authoritative Price Verification Engine
 * SECURITY FIX: Fail-Closed enforcement.
 * 1. Strictly rejects empty carts, unverified items, or negative/tampered numbers.
 * 2. Multiplies official catalog price by item quantity.
 * 3. Never falls back to client-provided price or claimed total upon error.
 */
export function verifyOrderPrice(items, claimedTotal, discountCode = '', shippingFee = 150) {
    // SECURITY FIX: Reject missing or non-array items (Fail-Closed)
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Order verification failed: Cart is empty or invalid.');
    }

    const catalogPath = path.join(process.cwd(), 'products.json');
    if (!fs.existsSync(catalogPath)) {
        // SECURITY FIX: Fail-Closed if catalog file is unavailable
        throw new Error('Server configuration error: Product catalog unavailable for verification.');
    }

    let catalog;
    try {
        catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    } catch (parseErr) {
        throw new Error('Server configuration error: Malformed product catalog.');
    }

    const catalogMap = new Map();
    catalog.forEach(p => {
        const price = Number(p.price);
        if (price > 0) {
            catalogMap.set(String(p.id), price);
            if (p.sku) catalogMap.set(String(p.sku), price);
        }
    });

    let verifiedSubtotal = 0;
    const verifiedItems = [];

    for (const item of items) {
        if (!item || typeof item !== 'object') {
            throw new Error('Invalid cart item payload.');
        }

        const idKey = String(item.id || item.sku || '').trim();
        const officialPrice = catalogMap.get(idKey);

        // SECURITY FIX: Refuse any item not found in authoritative catalog
        if (!officialPrice || officialPrice <= 0) {
            throw new Error(`Unauthorized or unverified item ID in cart: "${idKey}". Price tampering rejected.`);
        }

        // SECURITY FIX: Enforce valid integer quantity between 1 and 50
        const qty = parseInt(item.quantity || item.qty || 1, 10);
        if (isNaN(qty) || qty < 1 || qty > 50) {
            throw new Error(`Invalid quantity for item "${idKey}": ${item.quantity}`);
        }

        const lineTotal = officialPrice * qty;
        verifiedSubtotal += lineTotal;

        verifiedItems.push({
            id: idKey,
            name: String(item.name || 'دراجة هوائية').substring(0, 120),
            price: officialPrice,
            quantity: qty,
            lineTotal
        });
    }

    // SECURITY FIX: Strictly validate shipping fee (reasonable bounds: 0 to 500 EGP)
    const parsedShipping = Number(shippingFee);
    let verifiedShipping = (!isNaN(parsedShipping) && parsedShipping >= 0 && parsedShipping <= 500)
        ? parsedShipping
        : 150;

    let verifiedDiscount = 0;
    if (discountCode) {
        const code = String(discountCode).trim().toUpperCase();
        if (code === 'GOUKH1925') {
            verifiedDiscount = Math.round(verifiedSubtotal * 0.05); // 5% discount
        } else if (code === 'FREESHIP') {
            verifiedShipping = 0;
        }
    }

    const calculatedTotal = Math.max(0, verifiedSubtotal - verifiedDiscount + verifiedShipping);
    const diff = Math.abs(calculatedTotal - Number(claimedTotal));

    // Flag tampering if client claimed total differs by more than 5 EGP
    const isTampered = isNaN(Number(claimedTotal)) || diff > 5;
    if (isTampered) {
        console.warn(`[Security Alert] Price tampering detected! Claimed: ${claimedTotal} EGP, Calculated: ${calculatedTotal} EGP`);
    }

    return {
        isValid: true,
        verifiedTotal: calculatedTotal,
        verifiedSubtotal,
        verifiedShipping,
        verifiedDiscount,
        verifiedItems,
        isTampered
    };
}
