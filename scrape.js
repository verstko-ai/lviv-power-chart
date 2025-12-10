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
    
    console.log('⏳ Чекаємо 5 секунд для підвантаження...');
    await new Promise(r => setTimeout(r, 5000));

    // Отримуємо весь текст
    const content = await page.evaluate(() => document.body.innerText);
    console.log('📄 Текст отримано. Довжина:', content.length);

    // --- НОВА ЛОГІКА ПАРСИНГУ ---
    
    // 1. Шукаємо всі дати формату DD.MM.YYYY
    // Використовуємо regex з index, щоб знати, де починається блок дати
    const dateRegex = /([0-3]\d\.[0-1]\d\.[0-9]{4})/g;
    let match;
    const foundDates = [];
    
    while ((match = dateRegex.exec(content)) !== null) {
        foundDates.push({
            date: match[1],
            index: match.index
        });
    }

    console.log('📅 Знайдені дати:', foundDates.map(d => d.date));

    // Структура для збереження: { "09.12.2024": { "1.1": ["10-14"] }, "10.12.2024": ... }
    const finalSchedule = {}; 

    // Якщо дат не знайдено, спробуємо старий метод (на всяк випадок)
    if (foundDates.length === 0) {
        console.log('⚠️ Дат не знайдено, парсимо як один блок.');
        finalSchedule["Unknown"] = parseOutages(content);
    } else {
        // Проходимо по знайдених датах і ріжемо текст на шматки
        for (let i = 0; i < foundDates.length; i++) {
            const currentDateObj = foundDates[i];
            const dateStr = currentDateObj.date;
            
            // Початок шматка тексту - там де знайшли дату
            const startIdx = currentDateObj.index;
            
            // Кінець шматка - там де починається наступна дата (або кінець тексту)
            const endIdx = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            
            const textBlock = content.substring(startIdx, endIdx);
            console.log(`✂️ Обробка блоку для ${dateStr} (символи ${startIdx}-${endIdx})`);
            
            finalSchedule[dateStr] = parseOutages(textBlock);
        }
    }

    // Формуємо фінальний JSON
    const result = {
        scan_date: new Date().toISOString(),
        schedules: finalSchedule // Тепер це об'єкт з датами
    };
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));
    console.log('✅ Дані збережено в power_data.json');

  } catch (error) {
    console.error('❌ Помилка:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// Функція, яка витягує групи і час з шматка тексту
function parseOutages(text) {
    const regex = /Група\s*([0-9]+\.[0-9]+)\.?[^\d]*?з\s*([0-2]?\d:[0-5]\d)\s*до\s*([0-2]?\d:[0-5]\d)/gi;
    let m;
    const schedule = {};
    
    while ((m = regex.exec(text)) !== null) {
        const gr = m[1]; // Наприклад "1.1"
        const time = m[2] + "-" + m[3]; // Наприклад "14:00-16:00"
        
        if (!schedule[gr]) schedule[gr] = [];
        schedule[gr].push(time);
    }
    return schedule;
}
