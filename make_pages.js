const fs = require('fs');
const path = require('path');

// ==========================================
// 1. Build Privacy and Terms Pages
// ==========================================
const headerFooterStr = fs.readFileSync('shipping.html', 'utf8');

const extractBetween = (str, start, end) => {
    const startIndex = str.indexOf(start);
    if (startIndex === -1) return '';
    const endIndex = str.indexOf(end, startIndex);
    if (endIndex === -1) return '';
    return str.substring(startIndex, endIndex + end.length);
};

const headAndNav = extractBetween(headerFooterStr, '<!DOCTYPE html>', '</header>');
const footer = extractBetween(headerFooterStr, '<footer', '</html>');

const privacyHead = headAndNav
    .replace(/<title>[\s\S]*?<\/title>/, '<title>سياسة الخصوصية | أبو الجوخ 1925</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="سياسة الخصوصية وحماية بيانات العملاء في متجر أبو الجوخ 1925 للدراجات.">');

const termsHead = headAndNav
    .replace(/<title>[\s\S]*?<\/title>/, '<title>شروط الاستخدام | أبو الجوخ 1925</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="شروط وأحكام الشراء والاستخدام في متجر أبو الجوخ 1925 للدراجات.">');

const privacyContent = `
    <main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 class="text-3xl font-black mb-8">سياسة الخصوصية</h1>
        <div class="prose prose-sm max-w-none space-y-6 text-gray-700 text-right" dir="rtl">
            <p>نحن في متجر أبو الجوخ 1925 نلتزم بحماية خصوصيتك وبياناتك الشخصية.</p>
            <h2 class="text-xl font-bold mt-6 text-black">1. جمع البيانات وتخزينها سحابياً</h2>
            <p>يتم تخزين بيانات المنتجات والطلبات وبعض الإعدادات بشكل آمن باستخدام قواعد بيانات Google Firebase السحابية المشفرة (Firebase Realtime Database & Storage).</p>
            
            <h2 class="text-xl font-bold mt-6 text-black">2. تتبع الإعلانات والبيكسل (Pixels)</h2>
            <p>يستخدم متجرنا أدوات تتبع إعلانية (Pixels) مثل Meta Pixel, TikTok, Snapchat و Google Analytics و Google Tag Manager. تساعدنا هذه الأدوات في تقديم إعلانات مخصصة وتحسين تجربة التسوق. يمكنك تعطيل هذه الملفات من خلال إعدادات متصفحك.</p>
            
            <h2 class="text-xl font-bold mt-6 text-black">3. السلات المتروكة والاحتفاظ بالبيانات</h2>
            <p>نحتفظ ببيانات السلة المتروكة (Cart Retention) ورقم الهاتف المدخل في صفحة الدفع لفترة محدودة بهدف تقديم الدعم البيعي والتواصل معك عبر الواتساب لإتمام طلبك.</p>
            
            <h2 class="text-xl font-bold mt-6 text-black">4. بوابات الدفع وبيانات البطاقات</h2>
            <p>نحن لا نقوم بتخزين أو معالجة أو تمرير أي من بيانات بطاقتك البنكية عبر خوادمنا (Card data not passing). تتم جميع عمليات الدفع الإلكتروني عبر بوابات دفع آمنة ومعتمدة (مثل Paymob و PayTabs و Fawry) حيث تتم المعالجة مباشرة على خوادمهم المشفرة.</p>

            <h2 class="text-xl font-bold mt-6 text-black">5. التحويل البنكي وإنستاباي (Instapay)</h2>
            <p>في حالة اختيار الدفع عبر إنستاباي، سيتم التواصل معك عبر تطبيق واتساب (WhatsApp) لتأكيد عملية التحويل ومطابقتها مع طلبك.</p>
        </div>
    </main>
`;

const termsContent = `
    <main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 class="text-3xl font-black mb-8">شروط الاستخدام</h1>
        <div class="prose prose-sm max-w-none space-y-6 text-gray-700 text-right" dir="rtl">
            <p>مرحباً بك في متجر أبو الجوخ 1925. باستخدامك لهذا المتجر، فإنك توافق على الشروط والأحكام التالية:</p>
            <h2 class="text-xl font-bold mt-6 text-black">1. الدفع الإلكتروني والتحويل</h2>
            <p>تتم معالجة جميع المدفوعات الإلكترونية عبر بوابات طرف ثالث معتمدة ولا نتحمل أي مسؤولية عن أخطاء البوابات الخارجية. بالنسبة لتحويلات إنستاباي، يعتبر الطلب غير مؤكد حتى يتم مراجعته والموافقة عليه عبر الواتساب.</p>
            <h2 class="text-xl font-bold mt-6 text-black">2. المتابعة البيعية</h2>
            <p>يحق لإدارة المتجر التواصل معك عبر رقم الهاتف (اتصال أو واتساب) المتروك في سلة المشتريات لمتابعة الطلبات المكتملة أو غير المكتملة (السلات المتروكة).</p>
            <h2 class="text-xl font-bold mt-6 text-black">3. التتبع والإعلانات</h2>
            <p>أنت توافق على استخدامنا لبيكسلات التتبع الإعلانية (Pixels) من شركات الطرف الثالث لتحليل زيارتك وعرض الإعلانات المستهدفة.</p>
        </div>
    </main>
`;

fs.writeFileSync('privacy.html', privacyHead + privacyContent + footer);
fs.writeFileSync('terms.html', termsHead + termsContent + footer);
console.log('Static legal pages built (privacy.html, terms.html).');

// ==========================================
// 2. Pre-render Static Product Pages
// ==========================================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
const productTemplate = fs.readFileSync('product.html', 'utf8');

const DOMAIN = 'https://abu-el-goukh-store.vercel.app';

products.forEach(p => {
    const priceNum = Number(p.price) || 0;
    const priceFormatted = priceNum.toLocaleString('en-US');
    const pageTitle = `${p.name} | أبو الجوخ 1925 - أصل العجل في مصر`;
    const seoDesc = p.metaDescription || p.meta_desc || `اشتري ${p.name} الأصلية من توكيل أبو الجوخ 1925 بسعر ${priceFormatted} ج.م. شحن سريع لكافة المحافظات وضمان معتمد.`;
    const canonicalUrl = `${DOMAIN}/product-${p.id}.html`;
    const pImage = p.image || 'abu_el_goukh_logo.png';
    const absoluteImage = pImage.startsWith('http') ? pImage : `${DOMAIN}/${pImage.replace(/^\/+/, '')}`;
    const pSku = p.sku || `ABU-${p.id}`;
    const pCategory = p.category || 'دراجات هوائية';
    const pBadge = p.badge || 'ORIGINAL';
    const pSpecs = p.specs || 'شاسيه ألومنيوم طيران خفيف • سرعات شيمانو ياباني • فرامل ديسك أصلية';

    let html = productTemplate;

    // 1. Meta Title & Description
    html = html.replace(/<title id="page-meta-title">[\s\S]*?<\/title>/, `<title id="page-meta-title">${escapeHtml(pageTitle)}</title>`);
    html = html.replace(/<meta name="description" id="page-meta-desc" content="[^"]*">/, `<meta name="description" id="page-meta-desc" content="${escapeHtml(seoDesc)}">`);

    // 2. Self-referencing Canonical Link & remove head dynamic script from static pages
    html = html.replace(/<link rel="canonical" id="canonical-url" href="[^"]*">[\s\S]*?<\/script>/, `<link rel="canonical" id="canonical-url" href="${canonicalUrl}">`);

    // 3. Open Graph
    html = html.replace(/<meta property="og:url" id="og-url" content="[^"]*">/, `<meta property="og:url" id="og-url" content="${canonicalUrl}">`);
    html = html.replace(/<meta property="og:title" id="og-title" content="[^"]*">/, `<meta property="og:title" id="og-title" content="${escapeHtml(pageTitle)}">`);
    html = html.replace(/<meta property="og:description" id="og-desc" content="[^"]*">/, `<meta property="og:description" id="og-desc" content="${escapeHtml(seoDesc)}">`);
    html = html.replace(/<meta property="og:image" id="og-image" content="[^"]*">/, `<meta property="og:image" id="og-image" content="${absoluteImage}">`);

    // 4. Breadcrumbs
    html = html.replace(/<span id="breadcrumb-category" class="hover:text-trek-black transition">[\s\S]*?<\/span>/, `<span id="breadcrumb-category" class="hover:text-trek-black transition">${escapeHtml(pCategory)}</span>`);
    html = html.replace(/<span id="breadcrumb-title" class="font-bold text-trek-black line-clamp-1">[\s\S]*?<\/span>/, `<span id="breadcrumb-title" class="font-bold text-trek-black line-clamp-1">${escapeHtml(p.name)}</span>`);

    // 5. Badge & Image
    html = html.replace(/<span id="product-badge"[^>]*>[\s\S]*?<\/span>/, `<span id="product-badge" class="bg-trek-red text-white text-[11px] font-black px-3.5 py-1 rounded-full uppercase tracking-wider num-font shadow-md">${escapeHtml(pBadge)}</span>`);
    html = html.replace(/<img\s+id="product-main-image"[\s\S]*?>/, `<img id="product-main-image" src="${pImage}" alt="${escapeHtml(p.name)}" class="max-h-full max-w-full object-contain relative z-10 transition-transform duration-500 group-hover:scale-105 drop-shadow-[0_20px_25px_rgba(0,0,0,0.18)]">`);

    // 6. Category & SKU
    html = html.replace(/<span id="product-category" class="font-bold text-trek-red uppercase tracking-wider">[\s\S]*?<\/span>/, `<span id="product-category" class="font-bold text-trek-red uppercase tracking-wider">${escapeHtml(pCategory)}</span>`);
    html = html.replace(/<span class="num-font font-bold" id="product-sku">[\s\S]*?<\/span>/, `<span class="num-font font-bold" id="product-sku">${escapeHtml(pSku)}</span>`);

    // 7. h1 Title and Specs Summary
    html = html.replace(/<h1 id="product-title" class="text-2xl sm:text-3xl font-black text-trek-black leading-tight">[\s\S]*?<\/h1>/, `<h1 id="product-title" class="text-2xl sm:text-3xl font-black text-trek-black leading-tight">${escapeHtml(p.name)}</h1>`);
    html = html.replace(/<p id="product-specs-summary" class="text-xs sm:text-sm text-trek-gray mt-2 leading-relaxed">[\s\S]*?<\/p>/, `<p id="product-specs-summary" class="text-xs sm:text-sm text-trek-gray mt-2 leading-relaxed">${escapeHtml(pSpecs)}</p>`);

    // 8. Price
    html = html.replace(/<span id="product-price" class="text-3xl sm:text-4xl font-black text-trek-black num-font">[\s\S]*?<\/span>/, `<span id="product-price" class="text-3xl sm:text-4xl font-black text-trek-black num-font">${priceFormatted}</span>`);
    html = html.replace(/<span id="mobile-sticky-price" class="text-base font-black text-trek-black num-font">[\s\S]*?<\/span>/, `<span id="mobile-sticky-price" class="text-base font-black text-trek-black num-font">${priceFormatted}</span>`);

    // 9. Static JSON-LD Structured Data in head
    const jsonLdData = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": p.name,
        "image": (p.images && p.images.length > 0) ? p.images : [pImage],
        "description": seoDesc,
        "sku": pSku,
        "brand": {
            "@type": "Brand",
            "name": "أبو الجوخ 1925"
        },
        "offers": {
            "@type": "Offer",
            "url": canonicalUrl,
            "priceCurrency": "EGP",
            "price": priceNum,
            "availability": (p.inStock === false || (p.stock !== undefined && p.stock <= 0)) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition"
        }
    };
    const jsonLdTag = `<script type="application/ld+json" id="static-product-jsonld">${JSON.stringify(jsonLdData)}</script>\n</head>`;
    html = html.replace('</head>', jsonLdTag);

    // Save individual pre-rendered static HTML file
    const filename = `product-${p.id}.html`;
    fs.writeFileSync(filename, html, 'utf8');
});

console.log(`Pre-rendered ${products.length} static product pages (product-{id}.html).`);

// ==========================================
// 3. Generate Clean Non-Duplicate sitemap.xml
// ==========================================
const corePages = [
    { url: `${DOMAIN}/`, priority: '1.0', changefreq: 'daily' },
    { url: `${DOMAIN}/shop.html`, priority: '0.9', changefreq: 'daily' },
    { url: `${DOMAIN}/blog.html`, priority: '0.85', changefreq: 'weekly' },
    { url: `${DOMAIN}/checkout.html`, priority: '0.7', changefreq: 'weekly' },
    { url: `${DOMAIN}/warranty.html`, priority: '0.6', changefreq: 'monthly' },
    { url: `${DOMAIN}/shipping.html`, priority: '0.6', changefreq: 'monthly' },
    { url: `${DOMAIN}/returns-policy.html`, priority: '0.6', changefreq: 'monthly' },
    { url: `${DOMAIN}/contact.html`, priority: '0.6', changefreq: 'monthly' },
    { url: `${DOMAIN}/about.html`, priority: '0.6', changefreq: 'monthly' },
    { url: `${DOMAIN}/track-order.html`, priority: '0.6', changefreq: 'monthly' },
    { url: `${DOMAIN}/privacy.html`, priority: '0.5', changefreq: 'monthly' },
    { url: `${DOMAIN}/terms.html`, priority: '0.5', changefreq: 'monthly' }
];

const today = new Date().toISOString().split('T')[0];

let sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

corePages.forEach(p => {
    sitemapXml += `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>\n`;
});

products.forEach(p => {
    sitemapXml += `  <url>\n    <loc>${DOMAIN}/product-${p.id}.html</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
});

sitemapXml += `</urlset>\n`;

fs.writeFileSync('sitemap.xml', sitemapXml, 'utf8');
console.log(`Generated clean sitemap.xml with ${corePages.length + products.length} URLs.`);
