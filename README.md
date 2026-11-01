<div dir="rtl">

# لایو گیم چت پارس

پلتفرم گفتگوی متنی، صوتی و تصویری برای جامعه‌های گیمینگ فارسی‌زبان؛ مشابه دیسکورد، با رابط کاربری فارسی و راست‌به‌چپ (و انگلیسی)، نسخه وب و اپ اندروید.

</div>

> **English:** LiveGameChat Pars is a Discord-style chat platform for gaming communities: servers, channels, roles and permissions, DMs, threads, polls, voice/video/screen share over WebRTC, a Persian-first RTL web app and an Android app. Node.js + Fastify + Socket.IO + PostgreSQL on the server, React + Vite + Tailwind on the client, Capacitor for Android.

<div dir="rtl">

## امکانات

**گفتگو**
- کانال متنی، کانال اطلاعیه، دسته‌بندی کانال‌ها و کانال خصوصی
- قالب‌بندی پیام (پررنگ، کج، زیرخط، خط‌خورده، کد، بلوک کد، نقل‌قول، تیتر، فهرست، اسپویلر و لینک)
- منشن کاربر، نقش، کانال، `@everyone` و `@here` با تکمیل خودکار
- پاسخ به پیام، ویرایش، حذف، سنجاق، واکنش با ایموجی و ایموجی اختصاصی سرور
- رشته (Thread) روی پیام‌ها، نظرسنجی تک‌گزینه و چندگزینه، تاس (`/roll 2d6`) و دستورهای `/shrug`، `/me` و…
- ارسال عکس، ویدیو، صدا و فایل با کشیدن و رها کردن یا Paste، با نوار پیشرفت
- جستجوی پیام‌ها با فیلتر (عکس، فایل، لینک، نظرسنجی)، صندوق منشن‌ها، «در حال نوشتن…»
- خوانده‌نشده‌ها و شمارنده منشن، حالت آهسته (Slowmode)، اعلان دسکتاپ و صدا

**صدا و تصویر**
- کانال صوتی با WebRTC: صدا، دوربین، اشتراک صفحه، تشخیص صحبت، بی‌صدا و قطع صدا، تنظیم بلندی صدای هر نفر
- تماس صوتی و تصویری در پیام خصوصی با زنگ تماس
- مدیرها می‌توانند میکروفون یا صدای اعضا را ببندند یا آن‌ها را از کانال بیرون کنند

**سرورها و مدیریت**
- ساخت سرور با الگو (تیم و کلن، دوستان، ساده)، لینک دعوت با تاریخ انقضا و سقف استفاده
- نقش‌ها با رنگ، ترتیب، نمایش جداگانه و ۲۸ دسترسی؛ دسترسی اختصاصی برای هر کانال
- اخراج، بن (با پاک کردن پیام‌های اخیر)، سکوت موقت، لقب، انتقال مالکیت
- گزارش فعالیت‌ها، وب‌هوک برای ربات‌ها و سرور بازی، کاوش سرورهای عمومی

**اجتماعی**
- دوستان، درخواست دوستی، مسدود کردن، پیام خصوصی و گروه خصوصی تا ۱۰ نفر
- وضعیت (آنلاین، غایب، مزاحم نشوید، نامرئی)، وضعیت دلخواه و «در حال بازی…»، پروفایل با بنر و بیو

**ظاهر**
- فارسی و انگلیسی (راست‌به‌چپ و چپ‌به‌راست)، تاریخ شمسی، تم تیره و روشن، طراحی واکنش‌گرا برای موبایل
- قابل نصب روی گوشی و کامپیوتر از مرورگر (Web App)

## اجرای سریع برای توسعه

پیش‌نیاز: Node.js نسخه ۲۲ یا بالاتر.

</div>

```bash
npm install
```

```bash
npm run dev
```

<div dir="rtl">

سپس `http://localhost:5173` را باز کن. بدون هیچ تنظیمی، پایگاه‌داده PostgreSQL داخلی (PGlite) در پوشه `data/` ساخته می‌شود.

## راه‌اندازی روی سرور (Docker)

۱. فایل `.env.example` را به `.env` کپی کن و `DOMAIN`، `JWT_SECRET` و `POSTGRES_PASSWORD` را پر کن (برای رمزها: `openssl rand -base64 48`).
۲. رکورد DNS دامنه را به IP سرور بزن.
۳. اجرا با HTTPS خودکار:

</div>

```bash
docker compose --profile https up -d
```

<div dir="rtl">

- صدا، تصویر و اپ اندروید به **HTTPS** نیاز دارند. پروفایل `https` با Caddy گواهی رایگان می‌گیرد.
- برای کاربرانی که پشت NAT سخت (مثل اینترنت همراه) هستند، سرور TURN را هم روشن کن و در `.env` مقدار `TURN_URL=turn:دامنه:3478` را بگذار:

</div>

```bash
docker compose --profile https --profile turn up -d
```

<div dir="rtl">

**بدون Docker:** با PostgreSQL خودت (یا بدون `DATABASE_URL` برای پایگاه‌داده داخلی):

</div>

```bash
npm run build
```

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/lgcp CLIENT_DIST=client/dist NODE_ENV=production npm start
```

<div dir="rtl">

## اپ اندروید

اپ اندروید با [Capacitor](https://capacitorjs.com) ساخته شده: همین رابط کاربری داخل اپ بسته‌بندی می‌شود و به آدرس سرور تو وصل می‌شود. ورود در اپ با توکن انجام می‌شود و همه امکانات (چت، صدا، تصویر، فایل) کار می‌کنند. فقط **اشتراک صفحه** در اپ اندروید پشتیبانی نمی‌شود (محدودیت WebView اندروید) و دکمه‌اش در اپ نمایش داده نمی‌شود.

**ساخت APK بدون نصب چیزی (پیشنهادی):**
۱. در گیت‌هاب به تب **Actions** برو و **Android app** را انتخاب کن.
۲. روی **Run workflow** بزن و آدرس سرورت را وارد کن (مثلاً `https://chat.example.com`).
۳. بعد از چند دقیقه، فایل APK در بخش **Artifacts** همان اجرا آماده دانلود است.

**ساخت روی کامپیوتر خودت** (نیاز به Android Studio):

</div>

```bash
LGCP_SERVER_URL=https://chat.example.com npm run android:sync
```

```bash
npm run android:open
```

<div dir="rtl">

**انتشار در گوگل‌پلی یا کافه‌بازار:**
- قبل از اولین انتشار، شناسه اپ (`com.livegamechatpars.app`) را در `mobile/android/app/build.gradle` و `mobile/capacitor.config.ts` به دامنه خودت تغییر بده؛ بعد از انتشار دیگر قابل تغییر نیست.
- یک کلید امضا بساز و نگهش دار (از دست دادنش یعنی دیگر نمی‌توانی اپ را به‌روزرسانی کنی):

</div>

```bash
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias lgcp
```

<div dir="rtl">

- در تنظیمات مخزن (Settings → Secrets and variables → Actions) این Secretها را بساز: `ANDROID_KEYSTORE_BASE64` (خروجی `base64 -w0 release.jks`)، `ANDROID_KEYSTORE_PASSWORD`، `ANDROID_KEY_ALIAS` و `ANDROID_KEY_PASSWORD`. از این به بعد workflow علاوه بر APK آزمایشی، APK امضاشده و فایل AAB برای گوگل‌پلی هم می‌سازد.
- آیکون‌ها از لوگو ساخته می‌شوند؛ اگر لوگو را عوض کردی: `npm run icons -w mobile`.

## وب‌هوک (اتصال ربات و سرور بازی)

در تنظیمات سرور ← وب‌هوک‌ها یک وب‌هوک بساز و آدرسش را کپی کن:

</div>

```bash
curl -X POST https://chat.example.com/api/webhooks/ID/TOKEN -H "Content-Type: application/json" -d '{"content":"مسابقه شروع شد!","username":"Scoreboard"}'
```

<div dir="rtl">

## تست‌ها

- ۴۷ تست یکپارچه سرور (API، دسترسی‌ها، مدیریت، رویدادهای زنده، سیگنالینگ صدا):

</div>

```bash
npm test
```

<div dir="rtl">

- ۱۳ سناریوی کامل در مرورگر واقعی با دو کاربر، دوربین و میکروفون مجازی (ثبت‌نام، دعوت، چت زنده، نظرسنجی، رشته، دوستان، تنظیمات، دسترسی‌ها، تماس تصویری، موبایل):

</div>

```bash
npm run test:e2e
```

<div dir="rtl">

با هر push، workflow **CI** همه تست‌ها را روی گیت‌هاب اجرا می‌کند.

## تنظیمات (متغیرهای محیطی)

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `DATABASE_URL` | خالی | آدرس PostgreSQL. خالی یعنی پایگاه‌داده داخلی در `DATA_DIR/db` |
| `DATA_DIR` | `./data` | محل فایل‌های آپلودشده و پایگاه‌داده داخلی |
| `JWT_SECRET` | ساخته‌شده خودکار | کلید امضای ورود (حداقل ۳۲ کاراکتر)؛ در Docker الزامی |
| `PORT` | `3000` | پورت سرور |
| `CLIENT_DIST` | خالی | پوشه نسخه ساخته‌شده وب (`client/dist`) برای سرو کردن سایت |
| `SECURE_COOKIES` | در production روشن | کوکی فقط روی HTTPS |
| `TRUST_PROXY` | `false` | پشت Caddy/Nginx روشن کن |
| `MAX_UPLOAD_MB` | `25` | حداکثر حجم هر فایل |
| `ICE_SERVERS` | STUN گوگل | سرورهای STUN/TURN به صورت JSON |
| `TURN_URL` و `TURN_USERNAME` و `TURN_CREDENTIAL` | خالی | راه ساده‌تر افزودن یک سرور TURN |
| `CORS_ORIGINS` | آدرس‌های اپ | مبدأهای مجاز برای اپ‌های موبایل |
| `RATE_LIMIT` | روشن | محدودیت تعداد درخواست |

## ساختار پروژه

</div>

```text
server/   Fastify + Socket.IO + Drizzle ORM (PostgreSQL / PGlite)
  src/routes/    REST API
  src/gateway/   رویدادهای زنده، حضور آنلاین، سیگنالینگ صدا و تصویر
  drizzle/       migrationهای پایگاه‌داده
  test/          تست‌های یکپارچه (Vitest)
client/   React 19 + Vite + Tailwind CSS 4 + Zustand
  src/i18n/      ترجمه فارسی و انگلیسی
  src/lib/       API، سوکت، WebRTC، قالب‌بندی پیام
shared/   انواع داده و سیستم دسترسی مشترک بین سرور و کلاینت
mobile/   اپ اندروید (Capacitor)
e2e/      تست‌های مرورگر (Playwright)
```

<div dir="rtl">

## محدودیت‌ها و قدم‌های بعدی

- **اعلان push** هنوز نیست (برای اندروید نیاز به Firebase Cloud Messaging دارد). در سایت، اعلان دسکتاپ تا وقتی سایت باز است کار می‌کند؛ در اپ اندروید فعلاً فقط صدای اعلان پخش می‌شود.
- **اشتراک صفحه در اپ اندروید** ممکن نیست؛ در وب (کامپیوتر) کار می‌کند.
- صدا و تصویر به‌صورت **Mesh** (اتصال مستقیم بین افراد) است و برای کانال‌های تا حدود ۸ نفر مناسب است. برای جمع‌های بزرگ‌تر باید یک SFU (مثل LiveKit یا mediasoup) اضافه شود.
- نسخه iOS، پیش‌نمایش لینک‌ها، جستجوی GIF، کانال Stage و Forum و API ربات (غیر از وب‌هوک) هنوز ساخته نشده‌اند.
- برای پروژه هنوز مجوز (License) انتخاب نشده است.

</div>
