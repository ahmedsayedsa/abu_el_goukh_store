const fs = require('fs');

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

fs.writeFileSync('privacy.html', headAndNav + privacyContent + footer);
fs.writeFileSync('terms.html', headAndNav + termsContent + footer);
console.log('B5c complete');
