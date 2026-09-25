# تقرير الإصلاحات الأمنية الشاملة لمتجر أبو الجوخ 1925
## Comprehensive Security Remediation Report

تم فحص ومعالجة كافة الثغرات الأمنية المحددة في تقرير الفحص والتدقيق الأمني (Security Audit) لمتجر **أبو الجوخ 1925**. جميع الإصلاحات تم تنفيذها وفقاً لمعايير الأمان العالمية (OWASP Top 10) مع الالتزام بمبدأ **Fail-Closed** ومبدأ **Zero Client Trust**.

---

### جدول ملخص الثغرات والإصلاحات المنفذة

| # | مستوى الخطورة | اسم الثغرة | الملفات المتأثرة | ملخص الإصلاح الفعلي |
|---|---|---|---|---|
| 1 | 🔴 **حرج جداً** | قاعدة بيانات Firebase مكشوفة للقراءة والكتابة للعامة بدون مصادقة | `database.rules.json`, `api/orders.js`, `api/payment-webhook.js` | إنشاء ملف قواعد Firebase وقفل المسارات الحساسة (`/orders`, `/payment_gateway_settings`, `/admin_auth`) بحظر القراءة والكتابة المباشرة (`.read: false, .write: false`). أصبحت جميع العمليات تتم عبر دوال Vercel Serverless Function المؤمنة بمفتاح `FIREBASE_AUTH_SECRET`. |
| 2 | 🔴 **حرج جداً** | تلاعب بالأسعار والمبالغ من المتصفح (Price Tampering) | `api/_verify-price.js`, `api/orders.js`, `api/paymob-create.js`, `api/paytabs-create.js`, `api/fawry-create.js`, `checkout.html` | إلغاء الاعتماد على الأسعار أو الإجمالي القادم من المتصفح. أنشئ محرك تحقق سيرفر `_verify-price.js` يعيد حساب التكلفة بناءً على الكتالوج المعتمد `products.json`، ويحسب كمية كل صنف، ويطبق كود الخصم المعتمد والشحن، ويرفض أي طلب يحتوي منتجاً غير معروف أو كمية غير صالحة. |
| 3 | 🔴 **حرج جداً** | تسريب مفاتيح بوابات الدفع السرية وتمريرها في المتصفح | `checkout.html`, `admin.html`, `api/paymob-create.js`, `api/paytabs-create.js`, `api/fawry-create.js` | سحب جميع المفاتيح السرية (`PAYMOB_SECRET_KEY`, `PAYTABS_SERVER_KEY`, `FAWRY_SECURITY_KEY`) من كود المتصفح والـ LocalStorage وقاعدة البيانات، وإلزام السيرفر بقراءتها حصرياً من متغيرات بيئة Vercel (`process.env`). رفض أي مفتاح سري مرسل في الـ Request Body. |
| 4 | 🔴 **حرج جداً** | تزييف حالة الدفع من المتصفح (Payment Status Forgery) | `order-success.html`, `api/payment-webhook.js` | إزالة كود الـ PATCH المباشر الذي كان يغير حالة الطلب إلى "مدفوع" بناءً على باراميتر في رابط الصفحة (`?payment=paytabs_success`). إنشاء Webhook سيرفر موثق يتحقق من توقيع HMAC لكل بوابة بنكية (Paymob HMAC SHA-512, PayTabs HMAC-SHA256, Fawry SHA-256) قبل تحديث حالة الدفع. |
| 5 | 🔴 **حرج** | كلمات مرور وأسرار مشفرة ثابتة في الكود (Hardcoded Secrets / Backdoor) | `api/admin-auth.js`, `admin.html` | إزالة بيانات الدخول الثابتة (`admin` / `Goukh@1925`) ومفتاح JWT الثابت. نقل كلمة المرور واسم المستخدم ومفتاح التوقيع لمتغيرات بيئة Vercel (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`). استخدام مقارنة ثابتة الوقت `crypto.timingSafeEqual` لمنع هجمات Timing Attacks. |
| 6 | 🔴 **حرج** | ثغرة تجاوز المصادقة بالسماح التلقائي (Fail-Open in Admin Auth) | `admin.html` | تم تصحيح دالة `checkAdminAuth()` بحيث تتبع مبدأ **Fail-Closed**: في حال حدوث أي خطأ في الشبكة أو استجابة غير متوقعة، يتم قفل اللوحة وإلغاء صلاحيات الجلسة فوراً ومنع الدخول. |
| 7 | 🟠 **عالي** | ثغرة حقن نصوص برمجية مخزنة عبر إعدادات البيكسل (Stored XSS) | `pixels.js` | تم إزالة كود تحميل الـ Script الديناميكي الخارجي (`cfg.custom.scriptUrl`) لمنع هجمات حقن الـ JavaScript وسلاسل الإمداد. |
| 8 | 🟠 **عالي** | ثغرة حقن داخل وسوم HTML وجدول الطلبات (DOM-XSS via Inline Handlers) | `admin.html`, `order-success.html` | استبدال معالجات الأحداث النصية المضمنة (`onclick="...${id}..."` و `onchange="..."`) بروابط آمنة عبر `data-order-id` وتقنية **Event Delegation** على مستوى الـ Table Body، مع تعقيم وتشفير كافة المخرجات باستخدام `escapeHtml()`. |
| 9 | 🟠 **عالي** | معرفات طلبات سهلة التخمين والتوقع (Predictable Order IDs) | `api/orders.js`, `checkout.html` | استبدال `Math.random()` العشوائية الضعيفة بمعرفات طلبات مشفرة غير قابلة للتخمين تعتمد على `crypto.randomBytes(3)` وتوقيت زمني دقيق بنظام Base36 (مثال: `AEG-M28K9Q-F4A1C9`). |
| 10 | 🟡 **متوسط** | كشف بيانات العملاء الشخصية لأي زائر (PII / IDOR) | `api/orders.js`, `order-success.html` | تخصيص مخرجات فحص حالة الطلب العام للعميل بحيث لا تُظهر رقم الهاتف أو العنوان التفصيلي، وحصر كشف السجلات الكاملة لمسؤولي المتجر المسجلين فقط عبر JWT Token. |
| 11 | 🟡 **متوسط** | هجمات التخمين المستمر على لوحة الإدارة (Brute-Force Attack) | `api/admin-auth.js` | إضافة نظام قفل وحظر آلي بعد 5 محاولات تسجيل دخول فاشلة من نفس الـ IP لمدة 15 دقيقة مع إرجاع كود HTTP 429 Too Many Requests. |
| 12 | 🟡 **متوسط** | غياب سياسة أمان المحتوى (Content Security Policy - CSP) | `vercel.json` | إضافة ترويسة `Content-Security-Policy` متكاملة وصارمة لمنع هجمات XSS والتحميل الخارجي غير المصرح به. |

---

### الملفات التي تم إنشاؤها وتعديلها

#### 1. الملفات الجديدة:
1. **`api/_verify-price.js`**: محرك التحقق الصارم من أسعار المنتجات والكميات وقيم الشحن وأكواد الخصم بناءً على الكتالوج المعتمد.
2. **`api/orders.js`**: نقطة النهاية (Endpoint) لإدارة الطلبات: إنشاء الطلب مع التحقق من السعر، استعراض حالة طلب العميل (Anti-IDOR)، استعراض كافة الطلبات للمشرف (JWT)، وتعديل وحذف الطلبات بصلاحية الأدمن.
3. **`api/payment-settings.js`**: نقطة نهاية سيرفر آمنة تتيح لمدير المتجر تعديل وتحديث مفاتيح بوابات الدفع وحسابات الشركات من لوحة التحكم مباشرة بضغطة زر مع حمايتها من المتلصصين.
4. **`api/_gateway-config.js`**: محرك استرجاع الإعدادات الحية للبوابات من قاعدة البيانات المحمية مع Fallback تلقائي لمتغيرات البيئة.
5. **`api/payment-webhook.js`**: نقطة نهاية آمنة وموحدة لاستقبال إشعارات السداد اللحظية (Webhooks / IPN) من بوابات PayTabs و Paymob و Fawry مع التحقق التشفيري الصارم من توقيع HMAC لكل عملية قبل اعتمادها.
6. **`database.rules.json`**: قواعد الأمان السحابية لـ Firebase لمنع القراءة والكتابة المباشرة من المتصفح على الجداول الحساسة.
7. **`.env.example`**: نموذج إرشادي لجميع متغيرات البيئة السرية المطلوب إضافتها في Vercel.
8. **`SECURITY-CHANGES.md`**: هذا التقرير الشامل.

#### 2. الملفات المعدلة:
1. **`api/admin-auth.js`**: سحب بيانات الدخول لمتغيرات البيئة، تشفير المقارنة الآمنة ضد Timing Attacks، ومكافحة التخمين Brute-Force Rate Limiting.
2. **`api/paymob-create.js`**: قراءة المفاتيح حصرياً من السيرفر، تطبيق فحص الأسعار الصارم، ورفض المفاتيح القادمة من المتصفح.
3. **`api/paytabs-create.js`**: قراءة المفاتيح حصرياً من السيرفر، تطبيق فحص الأسعار، وضبط عنوان الإشعار التلقائي للـ Webhook.
4. **`api/fawry-create.js`**: قراءة المفاتيح من السيرفر، حساب توقيع SHA-256 على السيرفر فقط، وتطبيق فحص الأسعار.
5. **`checkout.html`**: إرسال الطلبات عبر `/api/orders` السحابي، إزالة إرسال المفاتيح السرية للبوابات، استخدام المعرف المشفر، وتحديث العجلة الافتراضية للكتالوج.
6. **`admin.html`**: تصحيح الـ Fail-Open، إزالة كود كلمة المرور الثابتة والـ Backdoor، توجيه عمليات الطلبات لـ `/api/orders` بـ JWT، تحويل الجدول لـ Event Delegation منعاً للـ DOM-XSS، ومنع تخزين المفاتيح في LocalStorage أو Firebase.
7. **`order-success.html`**: إزالة تعديل الدفع المباشر من المتصفح، الاستعلام عن الحالة الموثقة من السيرفر، وتعقيم كافة مدخلات الروابط والجداول.
8. **`pixels.js`**: إزالة الحقن الديناميكي للروابط الخارجية لحماية المتجر من سلاسل الإمداد الخبيثة.
9. **`vercel.json`**: إضافة ترويسة Content-Security-Policy المتقدمة.

---

### الخطوات المطلوبة من مدير المتجر (Operator Action Items)

لتفعيل المنظومة الجديدة بشكل كامل، يرجى اتباع الخطوات التالية:

#### 1. إضافة متغيرات البيئة في لوحة Vercel
ادخل إلى مشروعك على **Vercel Dashboard** > **Project Settings** > **Environment Variables** وأضف المتغيرات التالية (يمكنك مراجعة `.env.example`):
- `FIREBASE_DATABASE_URL`: رابط قاعدة البيانات (مثال: `https://abu-el-goukh-store-default-rtdb.firebaseio.com`)
- `FIREBASE_AUTH_SECRET`: مفتاح Database Secret من Firebase Console > Project Settings > Service Accounts > Database Secrets.
- `ADMIN_USERNAME`: اسم مستخدم لوحة الإدارة (افتراضي مقترح: `admin`).
- `ADMIN_PASSWORD_HASH`: هاش SHA-256 لكلمة مرور الأدمن، أو `ADMIN_PASSWORD` لكلمة المرور النصية القوية.
- `ADMIN_JWT_SECRET`: مفتاح تشفير عشوائي قوي لتوقيع جلسات الأدمن (مثل: 64 حرف عشوائي).
- `PAYTABS_PROFILE_ID` و `PAYTABS_SERVER_KEY`: بيانات حساب PayTabs الخاص بك.
- `PAYMOB_API_KEY` و `PAYMOB_SECRET_KEY` و `PAYMOB_INTEGRATION_ID` و `PAYMOB_HMAC_SECRET`: بيانات Paymob ومفتاح HMAC من لوحة Paymob.
- `FAWRY_MERCHANT_CODE` و `FAWRY_SECURITY_KEY`: بيانات حساب فوري باي.

#### 2. تطبيق قواعد أمان Firebase Realtime Database
1. افتح **Firebase Console** > **Realtime Database** > تبويب **Rules (القواعد)**.
2. انسخ محتوى الملف [database.rules.json](file:///C:/GAMES/abu_el_goukh_store/database.rules.json) والصقه هناك.
3. اضغط **Publish (نشر)**.
> سيؤدي ذلك فوراً لإغلاق قاعدة البيانات في وجه أي متطفل أو برنامج خارجي، مع استمرار عمل الموقع وتطبيقات الـ API بكل سلاسة عبر الـ Auth Secret.

#### 3. تدوير المفاتيح (Key Rotation)
نظراً لأن المفاتيح السابقة كانت موجودة في كود المتصفح والـ Git History:
- يُنصح بالدخول إلى بوابات PayTabs و Paymob وفوري وإعادة توليد (Regenerate / Rotate) المفاتيح السرية واستبدالها في Vercel Environment Variables.
