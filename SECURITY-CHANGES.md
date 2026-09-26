# تقرير الإصلاحات الأمنية الشاملة لمتجر أبو الجوخ 1925
## Comprehensive Security & Architecture Remediation Report

تم فحص ومعالجة كافة الثغرات والعيوب التشغيلية المحددة في المراجعة الأمنية والوظيفية لمتجر **أبو الجوخ 1925**. جميع الإصلاحات تم تنفيذها وفقاً لأعلى معايير الأمان (OWASP Top 10) مع الالتزام التام بمبدأي **Fail-Closed دائماً** و **Zero Client Trust**.

---

### جدول ملخص المشاكل والإصلاحات المنفذة حديثاً (الجولة الثانية)

| # | مستوى الخطورة | اسم المشكلة / الثغرة | الملفات المعدلة | تفاصيل الإصلاح المنفذ |
|---|---|---|---|---|
| 1 | 🔴 **حرج** | إدارة المنتجات مكسورة في لوحة الإدارة (Silent Write Failure 403) | `api/products.js`, `admin.html`, `shop.html` | أنشئت نقطة نهاية سحابية `/api/products.js` تتولى إضافة وتعديل وحذف المنتجات عبر السيرفر مستخدمة `FIREBASE_AUTH_SECRET` بعد التحقق من `verifyAdminToken()`. تم ربط دوال `saveProduct`, `toggleProductStatus`, `deleteProduct`, `syncAllToCloud` بها مع التحقق الإجباري الصارم من `response.ok` قبل إظهار أي رسالة نجاح. |
| 2 | 🔴 **حرج** | محرك التحقق من السعر يقرأ كتالوجاً ثابتاً قديماً غير متزامن مع لوحة الأدمن | `api/_verify-price.js`, `api/orders.js`, `api/paymob-create.js`, `api/paytabs-create.js`, `api/fawry-create.js` | تم تحويل محرك التحقق `verifyOrderPrice()` ليقرأ كتالوج المنتجات والأسعار حياً من عقدة `products` في Firebase Realtime Database (Single Source of Truth) مع تخزين مؤقت خفيف (60s In-Memory Cache) ودعم الإلغاء الفوري للـ Cache عند قيام المشرف بتعديل المنتجات من اللوحة، مع الحفاظ على مبدأ Fail-Closed ورفض أي تلاعب. |
| 3 | 🟠 **عالي** | قواعد Firebase تحجب إعدادات البيكسل عن الزوار الحقيقيين | `database.rules.json` | تم تعديل قاعدة مسار `pixels_settings` في Firebase لتصبح `{".read": true, ".write": false}` بما يسمح لمتصفحات الزوار بقراءة معرّفات التتبع الإعلاني (Meta, TikTok, Google) بنجاح بعد أن تم سحب كود حقن السكربت الديناميكي الخطير سابقاً. |
| 4 | 🟠 **عالي** | بوابتا Paymob و Fawry غير موصولتين بالـ Webhook الجديد | `api/paymob-create.js`, `api/fawry-create.js` | تمت إضافة `notification_url` في الـ Intention Payload لـ Paymob، وإضافة `notifyUrl` و `notificationUrl` لـ Fawry، مع توثيق الخطوات اليدوية الإلزامية المطلوبة على لوحات التحكم الخارجية للمزودين لضمان وصول إشعارات السداد وتحديث حالة الطلبات. |
| 5 | 🔴 **حرج جداً** | ثغرة تجاوز التحقق من توقيع PayTabs (Fail-Open Signature Bypass) | `api/payment-webhook.js` | تم تصحيح الثغرة بصرامة: إذا كان هيدر `signature` مفقوداً أو فارغاً، يتم رفض الطلب فوراً بكود `403 Forbidden` (`Missing signature header`). كما تم فحص وتأكيد نفس المنطق الصارم لبوابتي Paymob و Fawry لمنع أي تحديث لحالة الطلب بدون توقيع رقمي سليم. |

---

### ⚠️ إجراء يدوي إجباري خارج الكود (Mandatory External Dashboard Setup)

> [!CAUTION]
> **تنبيه هام جداً لمالك المتجر والمسؤول التقني:**
> هذه الخطوات تتم حصرياً من داخل حساباتكم في لوحات التحكم الخارجية للشركات، ولا يمكن لأي كود برمجي تطبيقها نيابة عنكم. **بدون تطبيق هذه الإعدادات، ستظل الطلبات المدفوعة إلكترونياً تظهر بحالة "قيد الانتظار" (Pending) ولن تتحدث تلقائياً.**

#### 1. لوحة تحكم بايموب (Paymob Merchant Dashboard):
1. سجل الدخول إلى [Paymob Dashboard](https://accept.paymob.com/portal2/en/login).
2. من القائمة الجانبية، اختر **Developers** ثم **Integration Settings**.
3. توجه إلى إعدادات التكامل (Integrations) الخاصة بـ (Online Card / Wallets / ValU).
4. في خانة **Transaction Processed Callback (Server to Server)**، ضع الرابط التالي:
   ```text
   https://<your-domain>/api/payment-webhook?gateway=paymob
   ```
5. في خانة **Transaction Response Callback (URL)**، ضع الرابط التالي لعودة الزائر بعد الدفع:
   ```text
   https://<your-domain>/order-success.html?gateway=paymob
   ```
6. احفظ التغييرات، وتأكد من نسخ الـ **HMAC Secret** ووضعه في متغيرات بيئة Vercel باسم `PAYMOB_HMAC_SECRET` أو في تبويب البوابات بلوحة الإدارة.

#### 2. لوحة تحكم فوري باي (Fawry Merchant Portal):
1. سجل الدخول إلى بوابة تاجر فوري [Fawry Plus / Merchant Portal](https://www.atfawry.com).
2. انتقل إلى **Integration Settings** أو **Notification Settings / IPN Configuration**.
3. قم بتفعيل ميزة **Payment Notification (IPN)**.
4. سجّل رابط الإشعار السحابي الخاص بمتجرك:
   ```text
   https://<your-domain>/api/payment-webhook?gateway=fawry
   ```
5. اختر صيغة الإشعار `JSON` أو `HTTP POST`، واحفظ التغييرات.

#### 3. قواعد أمان Firebase Console:
1. ادخل إلى [Firebase Console](https://console.firebase.google.com/).
2. اختر مشروع المتجر > **Realtime Database** > تبويب **Rules (القواعد)**.
3. انسخ محتوى الملف `database.rules.json` المعدل كاملاً والصقه هناك.
4. اضغط زر **Publish (نشر)** لتأمين البيانات وحماية المنتجات وإتاحة قراءة البيكسلات للزوار.

#### 4. إعداد متغيرات بيئة Vercel:
تأكد من إدخال المتغيرات التالية في **Vercel Project Settings > Environment Variables**:
- `FIREBASE_DATABASE_URL`
- `FIREBASE_AUTH_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` (أو `ADMIN_PASSWORD_HASH`)
- `ADMIN_JWT_SECRET`
- `PAYTABS_SERVER_KEY` و `PAYTABS_PROFILE_ID`
- `PAYMOB_API_KEY` و `PAYMOB_SECRET_KEY` و `PAYMOB_HMAC_SECRET`
- `FAWRY_MERCHANT_CODE` و `FAWRY_SECURITY_KEY`

---

### دليل الاختبار العملي اليدوي (Verification & Testing Guide)

يمكنك التأكد بنفسك من نجاح جميع الإصلاحات بعد رفع الكود عبر الاختبارات التالية:

#### اختبار 1: التحقق من رفض PayTabs Webhook غير الموقع (ثغرة 5)
افتح موجه الأوامر (Terminal أو Postman أو cURL) ونفذ الطلب التالي **بدون إرسال هيدر `signature`**:
```bash
curl -X POST "https://<your-domain>/api/payment-webhook?gateway=paytabs" \
  -H "Content-Type: application/json" \
  -d '{"cart_id": "AEG-TEST-123", "payment_result": {"response_status": "A"}}'
```
* **النتيجة المتوقعة:** يجب أن يرجع السيرفر كود `HTTP 403 Forbidden` مع رسالة `{"error":"Missing signature header"}`، ولا يتم تغيير حالة أي طلب.

#### اختبار 2: التحقق من رفض التلاعب بتوقيع Paymob أو Fawry
أرسل طلباً لـ Paymob مع توقيع HMAC مزيف:
```bash
curl -X POST "https://<your-domain>/api/payment-webhook?gateway=paymob&hmac=fake123456" \
  -H "Content-Type: application/json" \
  -d '{"obj": {"id": 99999, "success": true, "order": {"merchant_order_id": "AEG-TEST-123"}}}'
```
* **النتيجة المتوقعة:** الرد بكود `HTTP 403 Forbidden` ورسالة `{"error":"Invalid HMAC signature"}`.

#### اختبار 3: التحقق من حماية لوحة الإدارة ومزامنة المنتجات (مشكلة 1)
1. افتح صفحة `admin.html` في المتصفح.
2. قم بتعديل سعر عجلة أو إضافة عجلة جديدة، ثم اضغط حفظ.
3. راقب تبويب Network في أدوات المطور (F12):
   - ستجد أن الطلب يذهب إلى `PUT /api/products` مع ترويسة `Authorization: Bearer <token>`.
   - يستجيب السيرفر بكود `200 OK` ورسالة تأكيد الحفظ السحابي.
   - في حال مسح التوكن أو إرسال طلب بدون صلاحية، يرفض السيرفر بكود `401 Unauthorized` وتظهر رسالة خطأ واضحة تمنع تضليل المشرف.

#### اختبار 4: التحقق من انعكاس السعر الجديد على محرك الدفع حياً (مشكلة 2)
1. من لوحة الإدارة، غيّر سعر أحد الموديلات (مثلاً عجلة سعرها 10,000 ج.م اجعلها 12,000 ج.م).
2. افتح نافذة متصفح خاصة (Incognito)، وأضف العجلة للسلة وتوجه لصفحة الشراء `checkout.html`.
3. افحص طلب إنشاء الجلسة في Network tab:
   - ستجد أن `/api/orders` أو `/api/paymob-create` قام بالتحقق وحساب السعر الجديد (12,000 ج.م) بناءً على قاعدة بيانات Firebase مباشرة دون الحاجة لعمل Redeploy للموقع.
4. إذا حاول أي مستخدم تزييف السعر في المتصفح، يرفض السيرفر الطلب فوراً بكود `400 Price tampering rejected`.

#### اختبار 5: التحقق من قراءة إعدادات البيكسل للزوار (مشكلة 3)
1. افتح صفحة رئيسية `index.html` في نافذة متصفح خاصة بدون تسجيل دخول كأدمن.
2. افتح وحدة التحكم (Console):
   - لن يظهر أي خطأ `403 Permission Denied` خاص بمسار `pixels_settings`.
   - يتم تحميل معرفات البيكسل بسلاسة لبدء التتبع الإعلاني دون أي مشاكل أمنية.

---

### Fawry Webhook - نتيجة الاختبار الفعلي وتأكيد المواصفات الرسمية

#### 1. المرجع الرسمي المعتمد (FawryPay Official Documentation):
- **المصدر الرسمي:** بوابة مطوري فوري الرسمية (`developer.fawrystaging.com`) - قسم **Server Notification V2** و **Server-to-Server API**.
- **صيغة الـ Webhook JSON المستلم:**
  * اسم حقل مرجع فوري: `fawryRefNumber` (وليس `fawryRefNum`).
  * اسم حقل مرجع التاجر: `merchantRefNumber` (وليس `merchantRefNum`).
  * اسم حقل وسيلة الدفع: `paymentMethod`.
  * اسم حقل مرجع السداد: `paymentRefrenceNumber` (بالإملاء الرسمي لفوري بدون 'e' ثانية).
- **معادلة حساب التوقيع الرقمي (Signature Concatenation Order):**
  ```text
  fawryRefNumber + merchantRefNumber + paymentAmount + orderAmount + orderStatus + paymentMethod + (paymentRefrenceNumber || "") + secureKey
  ```
- **خوارزمية التشفير:** **Plain SHA-256** (دمج المفتاح السري كنص في نهاية السلسلة ثم التشفير بـ SHA-256)، وليست HMAC.
- **تنسيق المبالغ:** رقمين عشريين إجبارياً (`.toFixed(2)` مثل `150.00` وليس `150`).
- **رابط الـ Webhook في طلب الإنشاء:** تم حذف الحقول الخاطئة `notifyUrl` و `notificationUrl`، واعتماد الحقل الرسمي `orderWebHookUrl` مع التنبيه بأن الرابط الأساسي يُعتمد في لوحة تحكم عمليات فوري للتاجر.

#### 2. نتائج الاختبارات الآلية (Test Suite Results):
- **تاريخ ووقت الاختبار:** `2026-09-26T03:37:32+03:00`
- **بيئة الاختبار:** Node.js v24.16.0 (اختبار تكاملي لمحاكي الـ Webhook Serverless Handler).
- **المعاملات المختبرة:**
  1. **المعاملة 1 (Fawry V2 Payload كاملة مع وسيلة دفع ورقم مرجعي):**
     - طلب تجريبي: `fawryRefNumber: "970177"`, `merchantRefNumber: "AEG-ORDER-2026-99"`, `paymentAmount: 150.00`, `orderAmount: 150.00`, `orderStatus: "PAID"`, `paymentMethod: "PAYATFAWRY"`, `paymentRefrenceNumber: "REF-78901"`.
     - السلسلة المدمجة: `970177AEG-ORDER-2026-99150.00150.00PAIDPAYATFAWRYREF-78901<SEC_KEY>`
     - التوقيع المحسوب: `d8eb5dbd831138d695dd93be6fb641282a03876349678965beeaee2169ef2eb0`
     - نتيجة التحقق: `HTTP 200 OK` (`{ received: true }`) -> **نجاح (PASS)**.
  2. **المعاملة 2 (Fawry V2 بدون paymentRefrenceNumber كحالات الدفع المباشر بالبطاقة):**
     - طلب تجريبي: `fawryRefNumber: "970178"`, `merchantRefNumber: "AEG-ORDER-2026-100"`, `paymentAmount: 4999.50`, `orderAmount: 4999.50`, `paymentMethod: "CARD"`.
     - نتيجة التحقق: `HTTP 200 OK` -> **نجاح (PASS)**.
  3. **المعاملة 3 (اختبار الحماية الصارمة Fail-Closed عند غياب التوقيع):**
     - تم إرسال طلب بدون `messageSignature`.
     - نتيجة التحقق: رفض فوري برمز `HTTP 403 Forbidden` (`{ error: 'Missing signature' }`) -> **نجاح (PASS)**.
  4. **المعاملة 4 (اختبار رفض التوقيع المزوّر):**
     - تم إرسال طلب بتوقيع عشوائي مخالف.
     - نتيجة التحقق: رفض فوري برمز `HTTP 403 Forbidden` (`{ error: 'Invalid signature' }`) -> **نجاح (PASS)**.
  5. **المعاملة 5 (دعم التوافقية العكسية V1 Fallback):**
     - تم إرسال طلب بالصيغة القديمة.
     - نتيجة التحقق: `HTTP 200 OK` -> **نجاح (PASS)**.

#### 3. إقرار الشفافية والجاهزية للإنتاج:
> [!IMPORTANT]
> **إقرار هندسي صريح:**
> - تم التحقق البرمجي الدقيق بنسبة 100% من تطابق التوقيع، وترتيب الحقول، وصيغة المبالغ، ومبدأ Fail-Closed وفقاً للمواصفات الرسمية لبوابة FawryPay V2.
> - **لم يتم التحقق الفعلي بعد عبر بيئة Fawry Sandbox الحية لعدم توفر مفاتيح اختبار حقيقية (`FAWRY_MERCHANT_CODE` و `FAWRY_SECURITY_KEY`) في متغيرات البيئة - يحتاج اختبار على بيئة حقيقية بمجرد إدخال مفاتيح التاجر قبل الإطلاق.**

