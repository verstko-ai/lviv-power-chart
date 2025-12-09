const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('🚀 Запускаємо браузер...');
  // Запускаємо прихований браузер
  const browser = await puppeteer.launch({
  headless: "new",
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const page = await browser.newPage();

  // Прикидаємося звичайним комп'ютером (User Agent)
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log('🌍 Відкриваємо сайт Львівобленерго...');
    // Збільшив час очікування до 90 секунд, бо сайт може тупити
    await page.goto('https://poweron.loe.lviv.ua/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Чекаємо 5 секунд, щоб скрипти на сайті точно домалювали графік
    await new Promise(r => setTimeout(r, 5000));

    // Забираємо весь текст сторінки
    const content = await page.evaluate(() => document.body.innerText);
    console.log('📄 Текст отримано, довжина:', content.length);

    // --- ЛОГІКА ПОШУКУ (як у твоєму скрипті) ---
    const dateMatch = content.match(/Графік.*?на\s*([0-3]?\d\.[0-1]?\d\.[0-9]{4})/i);
    const dateFor = dateMatch ? dateMatch[1].trim() : "Не знайдено";

    const updateMatch = content.match(/станом на\s*([0-2]?\d:[0-5]\d)/i);
    const updatedAt = updateMatch ? updateMatch[1].trim() : new Date().toLocaleTimeString('uk-UA');

    // Шукаємо групи
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
    
    // Результат, який ми збережемо
    const result = {
        scan_date: new Date().toISOString(),
        target_date: dateFor,
        updated_at_site: updatedAt,
        data: schedule
    };

    console.log(`✅ Знайдено записів: ${foundCount}`);
    
    // Зберігаємо у файл power_data.json
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Помилка:', error);
    process.exit(1); // Завершити з помилкою
  } finally {
    await browser.close();
  }
})();
