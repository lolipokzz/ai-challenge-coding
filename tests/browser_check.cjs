const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const url = process.env.BASE_URL || 'http://127.0.0.1:18080';
const out = process.env.SCREENSHOT_DIR || '/private/tmp/razumist-current-screenshots';
(async () => {
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'chrome',headless:true});
 const results=[];
 try {
 for (const width of [1440,360]) {
  const context=await browser.newContext({viewport:{width,height:width===360?800:1000},timezoneId:'America/Los_Angeles',reducedMotion:'reduce'});
  const page=await context.newPage(); page.setDefaultTimeout(10000); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const nav=async(desktop,mobile=desktop)=>page.locator(width===360?'.tabbar':'.sidebar').getByRole('button',{name:new RegExp(width===360?mobile:desktop)}).click();
  const capture=async(name)=>{await page.evaluate(()=>document.fonts.ready);await page.locator('.toast').waitFor({state:'hidden',timeout:10000});await page.screenshot({path:path.join(out,`${width}-${name}.png`)}); assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`Horizontal overflow ${width} ${name}`);};
  await page.goto(url); await page.getByLabel('Логин',{exact:true}).waitFor(); await capture('login');
  await page.getByLabel('Логин',{exact:true}).fill('alina');await page.getByLabel('Пароль',{exact:true}).fill('Campus2026!');await page.getByRole('button',{name:'Войти в кабинет'}).click();
  await page.getByRole('heading',{name:'Привет, Алина'}).waitFor();await page.locator('.next-class').waitFor();await capture('overview');
  await nav('Расписание');await page.locator('.schedule-day').first().waitFor();
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/schedule?week=')&&r.status()===200),page.getByRole('button',{name:'Следующая неделя',exact:true}).click()]);
  await page.locator('.schedule-day').first().waitFor();
  await page.waitForTimeout(100);assert(await page.locator('main').innerText().then(t=>t.includes('Прикладная математика')||t.includes('Базы данных')),'Next week missing classes');await capture('schedule');
  await nav('Успеваемость','Оценки');await capture('grades');
  await nav('Заявки и справки','Заявки');await page.getByRole('button',{name:'Новая заявка',exact:true}).click();
  await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'Новая заявка',exact:true}).click();
  await page.getByLabel('Что тебе нужно?').selectOption('Справка о стипендии');
  const comment=`Проверка интерфейса ${width} ${Date.now()}`;await page.locator('textarea[name="comment"]').fill(comment);
  await page.getByRole('button',{name:'Отправить заявку',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});await page.locator('.request-row').first().click();
  await page.getByRole('dialog').getByText(comment,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Демо: принять в работу',exact:true}).click();
  await page.getByRole('button',{name:'Демо: завершить обработку',exact:true}).click();
  await page.getByRole('dialog').getByText('Документ готов в демонстрационном сценарии.',{exact:false}).waitFor();await capture('request-ready');
  const requestId=(await page.getByRole('dialog').locator('.eyebrow').innerText()).match(/\d+/)[0];
  await page.getByRole('button',{name:'Закрыть заявку'}).click();await page.reload();await page.locator('.next-class').waitFor();
  await nav('Заявки и справки','Заявки');await page.locator('.request-row').filter({hasText:`№ ${requestId} ·`}).click();await page.getByRole('dialog').getByText(comment,{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').locator('.badge.ready').count(),1);await page.keyboard.press('Escape');
  await nav('Уведомления','Входящие');await capture('notifications');
  assert(await page.locator('.deadline-date').count()>0,'No dated deadline');
  await page.getByRole('button',{name:'Открыть профиль',exact:true}).click();await capture('profile');
  await page.locator('main').getByRole('button',{name:'Выйти из аккаунта'}).click();
  await page.getByLabel('Логин',{exact:true}).fill('mark');await page.getByLabel('Пароль',{exact:true}).fill('Campus2026!');await page.getByRole('button',{name:'Войти в кабинет'}).click();await page.getByRole('heading',{name:'Привет, Марк'}).waitFor();
  const denied=await page.evaluate(id=>fetch('/api/requests/'+id).then(r=>r.status),requestId);assert.equal(denied,404);assert.deepEqual(errors,[]);
  results.push({width,status:'passed',checks:['login','next week','grades','request lifecycle','persistence','notifications with deadline','profile','Escape','second account isolation','no page errors','no horizontal overflow'],timezone:'America/Los_Angeles'});await context.close();
 }
 console.log(JSON.stringify(results,null,2));await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
