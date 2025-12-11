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

    // --- ЛОГІКА ПАРСИНГУ ---
    
    // Регулярка для пошуку дат
    const dateRegex = /([0-3]\d\.[0-1]\d\.[0-9]{4})/g;
    let match;
    const foundDates = [];
    
    while ((match = dateRegex.exec(content)) !== null) {
        const dateStr = match[1];
        const index = match.index;

        // ВИТЯГУЄМО КОНТЕКСТ: 50 символів ПЕРЕД датою
        // Це дозволить зрозуміти, чи це заголовок "Графік на...", чи "Станом на..."
        const lookbehindText = content.substring(Math.max(0, index - 50), index).toLowerCase();

        // Фільтр: ігноруємо дату, якщо перед нею є слова-паразити
        if (lookbehindText.includes('станом на') || lookbehindText.includes('оновлено')) {
             console.log(`⚠️ Пропускаємо дату ${dateStr}, бо це технічна дата оновлення.`);
             continue; // Йдемо до наступної дати
        }

        // Якщо перевірку пройдено - це "корисна" дата (заголовок графіку)
        foundDates.push({
            date: dateStr,
            index: index
        });
    }

    console.log(`📅 Знайдено дійсних заголовків дат: ${foundDates.length}`);

    const finalSchedule = {}; 

    if (foundDates.length === 0) {
        console.log('⚠️ Дат-заголовків не знайдено. Пробуємо парсити все як є.');
        const data = parseOutages(content);
        if (Object.keys(data).length > 0) {
            // Якщо не знайшли дату, запишемо як "Сьогодні" або дату з scan_date
            // Але краще дати зрозуміти, що дата не визначена
            finalSchedule["Unknown"] = data;
        }
    } else {
        for (let i = 0; i < foundDates.length; i++) {
            const currentDateObj = foundDates[i];
            const dateStr = currentDateObj.date;
            
            const startIdx = currentDateObj.index;
            // Кінець блоку - це початок наступної ВАЛІДНОЇ дати
            const endIdx = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            
            const textBlock = content.substring(startIdx, endIdx);
            
            console.log(`✂️ Обробка блоку для ${dateStr}`);
            const parsedData = parseOutages(textBlock);

            if (Object.keys(parsedData).length > 0) {
                finalSchedule[dateStr] = parsedData;
            } else {
                console.log(`🗑️ Дата ${dateStr}: пустий графік, ігноруємо.`);
            }
        }
    }

    const result = {
        scan_date: new Date().toISOString(),
        schedules: finalSchedule
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

function parseOutages(text) {
    const regex = /Група\s*([0-9]+\.[0-9]+)\.?[^\d]*?з\s*([0-2]?\d:[0-5]\d)\s*до\s*([0-2]?\d:[0-5]\d)/gi;
    let m;
    const schedule = {};
    
    while ((m = regex.exec(text)) !== null) {
        const gr = m[1];
        const time = m[2] + "-" + m[3];
        if (!schedule[gr]) schedule[gr] = [];
        schedule[gr].push(time);
    }
    return schedule;
}
