const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('🚀 Запускаємо браузер...');
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  // Встановлюємо розмір екрану як у ноутбука
  await page.setViewport({width: 1280, height: 800});

  // Прикидаємося звичайним користувачем
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log('🌍 Переходимо на сайт (без очікування повної тиші)...');
    
    // ЗМІНА: waitUntil: 'domcontentloaded' означає "як тільки з'явився текст", не чекаємо картинок/скриптів
    await page.goto('https://poweron.loe.lviv.ua/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });

    console.log('⏳ Чекаємо 10 секунд для вірності...');
    await new Promise(r => setTimeout(r, 10000));

    // РОБИМО ФОТО (Діагностика)
    console.log('📸 Робимо скріншот...');
    await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });

    // Витягуємо текст
    const content = await page.evaluate(() => document.body.innerText);
    console.log('📄 Текст отримано. Довжина:', content.length);
    console.log('Уривок тексту:', content.substring(0, 200)); // Покажемо початок у логах

    // --- ПАРСИНГ ---
    const dateMatch = content.match(/Графік.*?на\s*([0-3]?\d\.[0-1]?\d\.[0-9]{4})/i);
    const dateFor = dateMatch ? dateMatch[1].trim() : "Не знайдено";

    const regex = /Група\s*([0-9]+\.[0-9]+)\.?[^\d]*?з\s*([0-2]?\d:[0-5]\d)\s*до\s*([0-2]?\d:[0-5]\d)/gi;
    let m;
    const schedule = {};
    let foundCount = 0;

    while ((m = regex.exec(content)) !== null) {
        const gr = m[1];
        const time = m[2] + "-" + m[3];
        if (!schedule[gr]) schedule[gr] = [];
        schedule[gr].push(time);
        foundCount++;
    }

    const result = {
        scan_date: new Date().toISOString(),
        target_date: dateFor,
        data: schedule
    };

    console.log(`✅ Знайдено записів: ${foundCount}`);
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Помилка:', error);
    // Навіть при помилці пробуємо зберегти скріншот, якщо встигли відкрити сторінку
    try { await page.screenshot({ path: 'error_screenshot.png' }); } catch (e) {}
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
