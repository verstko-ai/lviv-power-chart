const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('🚀 Запускаємо браузер...');
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 800});
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log('🌍 Переходимо на сайт...');
    await page.goto('https://poweron.loe.lviv.ua/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log('⏳ Чекаємо 5 секунд...');
    await new Promise(r => setTimeout(r, 5000));

    const content = await page.evaluate(() => document.body.innerText);
    console.log('📄 Текст отримано. Довжина:', content.length);

    // --- НОВА ЛОГІКА (SMART PARSING) ---

    // 1. Знаходимо всі позиції дат у тексті.
    // Regex ловить "10.12.2025" АБО "10.12" (без року)
    const dateRegex = /([0-3]\d\.[0-1]\d)(\.[0-9]{4})?/g;
    
    const datePositions = [];
    let match;
    const currentYear = new Date().getFullYear();

    while ((match = dateRegex.exec(content)) !== null) {
        let dateStr = match[1]; // Це буде "10.12"
        // Якщо року немає в тексті, додаємо поточний
        if (!match[2]) {
            dateStr += `.${currentYear}`;
        } else {
            dateStr += match[2]; // Додаємо знайдений рік (.2025)
        }

        datePositions.push({
            date: dateStr,
            index: match.index
        });
    }
    
    console.log(`📅 Знайдено міток дати: ${datePositions.length}`);

    // 2. Знаходимо всі групи відключень і прив'язуємо до найближчої дати зверху
    const groupRegex = /Група\s*([0-9]+\.[0-9]+)\.?[^\d]*?з\s*([0-2]?\d:[0-5]\d)\s*до\s*([0-2]?\d:[0-5]\d)/gi;
    const finalSchedule = {};
    let count = 0;

    while ((m = groupRegex.exec(content)) !== null) {
        const groupName = m[1];
        const timeRange = m[2] + "-" + m[3];
        const groupIndex = m.index;

        // Шукаємо дату, яка стоїть ПЕРЕД цією групою і є найближчою
        // Фільтруємо ті, що менші за groupIndex, і беремо останню з них
        const validDates = datePositions.filter(d => d.index < groupIndex);
        
        if (validDates.length > 0) {
            const bestDate = validDates[validDates.length - 1].date;
            
            if (!finalSchedule[bestDate]) finalSchedule[bestDate] = {};
            if (!finalSchedule[bestDate][groupName]) finalSchedule[bestDate][groupName] = [];
            
            finalSchedule[bestDate][groupName].push(timeRange);
            count++;
        }
    }

    console.log(`✅ Оброблено записів відключень: ${count}`);

    // Сортуємо ключі дат (щоб у JSON було красиво)
    const sortedSchedule = {};
    Object.keys(finalSchedule).sort().forEach(key => {
        sortedSchedule[key] = finalSchedule[key];
    });

    const result = {
        scan_date: new Date().toISOString(),
        schedules: sortedSchedule
    };
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));
    console.log('💾 Дані збережено.');

  } catch (error) {
    console.error('❌ Помилка:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
