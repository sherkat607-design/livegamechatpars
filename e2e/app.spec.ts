import { expect, test, type Browser, type Page } from '@playwright/test';

// One story, two people: Sara creates a server and invites Reza. Runs against the built
// app (see serve.mjs) with a fake camera and microphone.

let sara: Page;
let reza: Page;
let serverPath = '';
let inviteLink = '';
const errors: string[] = [];

async function person(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  return page;
}

async function signUp(page: Page, email: string, displayName: string, username: string) {
  await page.getByLabel('ایمیل').fill(email);
  await page.getByLabel('نام نمایشی').fill(displayName);
  await page.getByLabel('نام کاربری').fill(username);
  await page.getByLabel('رمز عبور').fill('password123');
  await page.getByRole('button', { name: 'ثبت‌نام' }).click();
}

const composer = (page: Page, name = /پیام به #عمومی/) => page.getByRole('textbox', { name });
const message = (page: Page, text: string) => page.locator('[id^="msg-"]', { hasText: text }).first();
const serverMenu = (page: Page) => page.locator('button[aria-haspopup="menu"]').filter({ hasText: 'پارس گیمرز' });

test.describe.serial('LiveGameChat Pars', () => {
  test.beforeAll(async ({ browser }) => {
    sara = await person(browser, 'sara');
    reza = await person(browser, 'reza');
  });

  test('sign up and create a gaming server', async () => {
    await sara.goto('/register');
    await expect(sara.getByRole('heading', { name: 'ساخت حساب' })).toBeVisible();
    await signUp(sara, 'sara@example.com', 'سارا', 'sara');
    await sara.waitForURL('**/channels/@me');
    await sara.getByRole('button', { name: 'ساخت یا پیوستن به سرور' }).click();
    await sara.getByLabel('نام سرور').fill('پارس گیمرز');
    await sara.getByRole('button', { name: 'ساخت سرور' }).last().click();
    await sara.waitForURL(/\/channels\/\d+\/\d+/);
    serverPath = new URL(sara.url()).pathname;
    await expect(sara.getByRole('heading', { name: 'عمومی', exact: true })).toBeVisible();
    for (const name of ['قوانین', 'لابی', 'تیم ۱']) await expect(sara.getByRole('button', { name, exact: true })).toBeVisible();
  });

  test('formatted messages and the dice command', async () => {
    await composer(sara).fill('سلام بچه‌ها! **امشب** ساعت ۹ رنک می‌زنیم 🎮');
    await composer(sara).press('Enter');
    await composer(sara).fill('کد: `npm run dev` و ||اسپویلر||');
    await composer(sara).press('Enter');
    await composer(sara).fill('/roll 2d6');
    await composer(sara).press('Enter');
    await expect(message(sara, 'رنک می‌زنیم').locator('strong', { hasText: 'امشب' })).toBeVisible();
    await expect(message(sara, 'کد:').locator('code', { hasText: 'npm run dev' })).toBeVisible();
    await expect(sara.getByText(/2d6 → \d+ \+ \d+ = \d+/).first()).toBeVisible();
  });

  test('invite link: a new person signs up and joins', async () => {
    await serverMenu(sara).click();
    await sara.getByRole('menuitem', { name: 'دعوت افراد' }).click();
    const field = sara.getByLabel('لینک دعوت');
    await expect(field).toHaveValue(/\/invite\/[A-Za-z0-9]{10}$/);
    inviteLink = await field.inputValue();
    await sara.keyboard.press('Escape');

    await reza.goto(inviteLink);
    await expect(reza.getByRole('heading', { name: 'پارس گیمرز' })).toBeVisible();
    await reza.getByRole('button', { name: 'ثبت‌نام و پیوستن' }).click();
    await signUp(reza, 'reza@example.com', 'رضا', 'reza');
    await reza.getByRole('button', { name: 'قبول دعوت' }).click();
    await reza.waitForURL(/\/channels\/\d+\/\d+/);
    await expect(message(reza, 'رنک می‌زنیم')).toBeVisible();
    // Sara sees the welcome message in real time.
    await expect(sara.getByText(/رضا/).first()).toBeVisible();
  });

  test('real-time chat: mentions, reactions, replies and typing', async () => {
    await composer(reza).fill('سلام @sara! من هستم');
    await composer(reza).press('Enter');
    const mention = message(sara, 'من هستم');
    await expect(mention).toBeVisible();
    await expect(mention.getByText('@سارا')).toBeVisible();

    await mention.hover();
    await mention.getByRole('button', { name: 'واکنش با 🔥' }).click();
    await expect(message(reza, 'من هستم').getByRole('button', { name: /🔥/ })).toBeVisible();

    const original = message(reza, 'رنک می‌زنیم');
    await original.hover();
    await original.getByRole('button', { name: 'پاسخ' }).click();
    await composer(reza).pressSequentially('من پایه‌ام', { delay: 30 });
    await expect(sara.getByText(/رضا در حال نوشتن است/)).toBeVisible();
    await composer(reza).press('Enter');
    await expect(message(sara, 'من پایه‌ام').getByText('رنک می‌زنیم')).toBeVisible();
  });

  test('polls update live', async () => {
    await sara.getByRole('button', { name: 'ساخت نظرسنجی' }).first().click();
    await sara.getByLabel('سؤال').fill('امشب کدوم مپ؟');
    await sara.getByLabel('گزینه ۱').fill('داست ۲');
    await sara.getByLabel('گزینه ۲').fill('میراژ');
    await sara.getByRole('button', { name: 'ارسال نظرسنجی' }).click();
    await reza.getByRole('button', { name: /میراژ/ }).click();
    await expect(sara.getByText('۱ رأی‌دهنده')).toBeVisible();
  });

  test('threads, pins and search', async () => {
    const msg = message(sara, 'رنک می‌زنیم');
    await msg.hover();
    await msg.getByRole('button', { name: 'ساخت رشته' }).click();
    await sara.getByLabel('نام رشته').fill('برنامه امشب');
    await sara.getByRole('button', { name: 'ساختن' }).click();
    const panel = sara.getByRole('complementary');
    await panel.getByRole('textbox').fill('ساعت ۹ همه آنلاین باشید');
    await panel.getByRole('textbox').press('Enter');
    await expect(panel.getByText('ساعت ۹ همه آنلاین باشید')).toBeVisible();
    await panel.getByRole('button', { name: 'بستن' }).click();

    await msg.hover();
    await msg.getByRole('button', { name: 'بیشتر' }).click();
    await sara.getByRole('menuitem', { name: 'سنجاق کردن' }).click();
    await expect(sara.getByText('یک پیام را سنجاق کرد')).toBeVisible();
    await sara.getByRole('button', { name: 'پیام‌های سنجاق‌شده' }).click();
    await expect(sara.getByRole('complementary').getByText('رنک می‌زنیم')).toBeVisible();

    await sara.getByLabel('جستجو').first().fill('رنک');
    await sara.getByLabel('جستجو').first().press('Enter');
    await expect(sara.getByRole('complementary').getByText('۱ نتیجه')).toBeVisible();
    await sara.getByRole('complementary').getByRole('button', { name: 'بستن' }).click();
  });

  test('friends and direct messages', async () => {
    await sara.getByRole('button', { name: 'خانه' }).click();
    await sara.getByRole('tab', { name: 'افزودن دوست' }).click();
    await sara.getByPlaceholder('نام کاربری، مثلاً ali.gamer').fill('reza');
    await sara.getByRole('button', { name: 'ارسال درخواست' }).click();
    await expect(sara.getByText('درخواست دوستی فرستاده شد')).toBeVisible();

    await reza.getByRole('button', { name: 'خانه' }).click();
    await reza.getByRole('tab', { name: /درخواست‌ها/ }).click();
    await reza.getByRole('button', { name: 'پذیرفتن' }).click();
    await reza.getByRole('tab', { name: 'همه' }).click();
    await reza.getByRole('button', { name: 'پیام', exact: true }).click();
    await composer(reza, /پیام به سارا/).fill('سلام سارا، امشب هستی؟');
    await composer(reza, /پیام به سارا/).press('Enter');

    // The DM shows up for Sara with an unread badge.
    await sara.getByRole('button', { name: /رضا/ }).filter({ hasText: '۱' }).first().click();
    await expect(message(sara, 'امشب هستی؟')).toBeVisible();

    await sara.getByRole('button', { name: 'منشن‌ها' }).click();
    await expect(sara.getByText('من هستم')).toBeVisible();
  });

  test('server settings: roles, members, webhooks and every tab', async () => {
    await sara.goto(serverPath);
    await serverMenu(sara).click();
    await sara.getByRole('menuitem', { name: 'تنظیمات سرور' }).click();
    const dialog = sara.getByRole('dialog');
    for (const tab of ['نمای کلی', 'ایموجی‌ها', 'اعلان‌ها', 'دعوت‌ها', 'بن‌ها', 'گزارش فعالیت‌ها']) {
      await dialog.getByRole('button', { name: tab, exact: true }).click();
      await expect(dialog.getByRole('heading', { name: tab, exact: true })).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'نقش‌ها', exact: true }).click();
    await dialog.getByRole('button', { name: 'ساخت نقش' }).click();
    await dialog.getByLabel('نام نقش').fill('مدیر');
    await dialog.getByRole('switch', { name: 'مدیریت پیام‌ها' }).click();
    await dialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
    await expect(sara.getByText('ذخیره شد').last()).toBeVisible();

    await dialog.getByRole('button', { name: 'اعضا', exact: true }).click();
    await dialog.locator('li', { hasText: 'reza' }).getByRole('button', { name: 'نقش‌ها' }).click();
    await dialog.getByRole('button', { name: 'مدیر', pressed: false }).click();
    await expect(dialog.getByRole('button', { name: 'مدیر', pressed: true })).toBeVisible();

    await dialog.getByRole('button', { name: 'وب‌هوک‌ها', exact: true }).click();
    await dialog.getByLabel('نام وب‌هوک').fill('Scoreboard');
    await dialog.getByRole('button', { name: 'ساخت وب‌هوک' }).click();
    await expect(dialog.getByText('Scoreboard')).toBeVisible();

    await dialog.getByRole('button', { name: 'گزارش فعالیت‌ها', exact: true }).click();
    await expect(dialog.getByText('نقش داد به')).toBeVisible();
    await sara.keyboard.press('Escape');
  });

  test('channel permissions are enforced', async () => {
    await sara.getByRole('button', { name: 'عمومی', exact: true }).hover();
    await sara.getByRole('button', { name: 'تنظیمات کانال' }).click();
    const dialog = sara.getByRole('dialog');
    await dialog.getByRole('button', { name: 'دسترسی‌ها', exact: true }).click();
    await dialog.getByRole('radiogroup', { name: 'افزودن واکنش' }).getByRole('radio', { name: 'ممنوع' }).click();
    await dialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
    await expect(sara.getByText('ذخیره شد').last()).toBeVisible();
    await sara.keyboard.press('Escape');

    // Reza can no longer start new reactions here, but can still join existing ones.
    await reza.goto(serverPath);
    const target = message(reza, 'من هستم');
    await target.hover();
    await expect(target.getByRole('button', { name: 'واکنش با 👍' })).toHaveCount(0);
    await target.getByRole('button', { name: /🔥/ }).click();
    await expect(message(sara, 'من هستم').getByRole('button', { name: /🔥/ })).toContainText('۲');
  });

  test('voice and video between two people', async () => {
    await sara.getByRole('button', { name: 'لابی', exact: true }).click();
    await expect(sara.getByText('صدا وصل است')).toBeVisible();
    await reza.getByRole('button', { name: 'لابی', exact: true }).click();
    await expect(reza.getByText('صدا وصل است')).toBeVisible();
    await reza.getByRole('button', { name: 'روشن کردن دوربین' }).click();
    // Sara receives Reza's camera over WebRTC.
    await expect
      .poll(async () => sara.evaluate(() => [...document.querySelectorAll('main video')].some((v) => (v as HTMLVideoElement).videoWidth > 0)), {
        timeout: 20_000,
      })
      .toBe(true);
    await reza.getByRole('button', { name: 'خاموش کردن میکروفون' }).first().click();
    await expect(sara.locator('[aria-label="میکروفون خاموش"]').first()).toBeVisible();
    await sara.getByRole('button', { name: 'قطع اتصال' }).first().click();
    await reza.getByRole('button', { name: 'قطع اتصال' }).first().click();
  });

  test('user settings: profile, English and light theme', async () => {
    await sara.getByRole('button', { name: 'تنظیمات کاربر' }).click();
    const dialog = sara.getByRole('dialog');
    for (const tab of ['حساب من', 'صدا و تصویر', 'اعلان‌ها']) await dialog.getByRole('button', { name: tab, exact: true }).click();
    await dialog.getByRole('button', { name: 'پروفایل', exact: true }).click();
    await dialog.getByLabel('در حال بازی').fill('Valorant');
    await dialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
    await expect(sara.getByText('ذخیره شد').last()).toBeVisible();
    await dialog.getByRole('button', { name: 'ظاهر', exact: true }).click();
    await dialog.getByRole('radio', { name: 'English' }).click();
    await dialog.getByRole('radio', { name: /Light/ }).click();
    await sara.keyboard.press('Escape');
    await sara.goto(serverPath);
    await expect(composer(sara, /Message #عمومی/)).toBeVisible();
    await expect(sara.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(sara.locator('html')).toHaveAttribute('data-theme', 'light');
    // Reza sees Sara's new activity in the member list.
    await reza.goto(serverPath);
    await expect(reza.getByText('در حال بازی Valorant').first()).toBeVisible();
  });

  test('phone layout uses a drawer for navigation', async () => {
    const phone = await reza.context().newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(serverPath);
    await expect(phone.getByRole('heading', { name: 'عمومی', exact: true })).toBeVisible();
    await expect(phone.getByRole('navigation', { name: 'سرورها' })).toBeHidden();
    await phone.getByRole('button', { name: 'باز کردن فهرست' }).click();
    await expect(phone.getByRole('navigation', { name: 'سرورها' })).toBeVisible();
    await phone.close();
  });

  test('no errors in the browser console', () => {
    expect(errors).toEqual([]);
  });
});
