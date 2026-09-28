const fs = require('fs');
const files = ['index.html', 'shop.html', 'product.html', 'checkout.html', 'about.html', 'shipping.html', 'warranty.html', 'returns-policy.html', 'track-order.html', 'order-success.html'];
const newLinks = `
                        <li><a href="privacy.html" class="hover:text-white transition">سياسة الخصوصية</a></li>
                        <li><a href="terms.html" class="hover:text-white transition">شروط الاستخدام</a></li>`;

files.forEach(f => {
    if (fs.existsSync(f)) {
        let c = fs.readFileSync(f, 'utf8');
        // Add to the first occurrence
        c = c.replace(/(<li><a href="returns-policy\.html"[^>]*>سياسة الاسترجاع والاستبدال<\/a><\/li>)/, '$1' + newLinks);
        // Sometimes it appears twice in the same page, or it might not. Let's do replaceAll just in case, but replaceAll might fail in older node.
        // We'll use a global regex.
        c = c.replace(/(<li><a href="returns-policy\.html"[^>]*>سياسة الاسترجاع والاستبدال<\/a><\/li>)/g, '$1' + newLinks);
        
        fs.writeFileSync(f, c);
        console.log('Processed ' + f);
    }
});
