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
  // Маскуємось під звичайного користувача
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log('🌍 Переходимо на сайт...');
    // waitUntil: 'domcontentloaded' - пришвидшує роботу, не чекає картинок
    await page.goto('https://poweron.loe.lviv.ua/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log('⏳ Чекаємо 5 секунд для підвантаження динаміки...');
    await new Promise(r => setTimeout(r, 5000));

    // Отримуємо весь текст сторінки
    const content = await page.evaluate(() => document.body.innerText);
    console.log('📄 Текст отримано. Довжина:', content.length);

    // --- ЛОГІКА ПАРСИНГУ ---
    
    // 1. Шукаємо всі дати (DD.MM.YYYY)
    const dateRegex = /([0-3]\d\.[0-1]\d\.[0-9]{4})/g;
    let match;
    const foundDates = [];
    
    while ((match = dateRegex.exec(content)) !== null) {
        foundDates.push({
            date: match[1],
            index: match.index
        });
    }

    console.log(`📅 Знайдено потенційних дат: ${foundDates.length}`);

    const finalSchedule = {}; 

    if (foundDates.length === 0) {
        // РЕЗЕРВНИЙ ВАРІАНТ: Якщо дат не знайшли, пробуємо парсити весь текст як "Невідома дата"
        // Це спрацює, якщо формат дати на сайті зміниться, але графік залишиться
        console.log('⚠️ Дат не знайдено, парсимо весь текст як один блок.');
        const data = parseOutages(content);
        if (Object.keys(data).length > 0) {
            finalSchedule["Unknown"] = data;
        }
    } else {
        // Проходимо по знайдених датах
        for (let i = 0; i < foundDates.length; i++) {
            const currentDateObj = foundDates[i];
            const dateStr = currentDateObj.date;
            
            // Визначаємо межі тексту для цієї дати
            const startIdx = currentDateObj.index;
            // Кінець - це початок наступної дати або кінець всього тексту
            const endIdx = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            
            const textBlock = content.substring(startIdx, endIdx);
            
            // Парсимо групи в цьому шматку
            const parsedData = parseOutages(textBlock);

            // ВАЖЛИВА ПЕРЕВІРКА: 
            // Додаємо дату в JSON тільки якщо для неї знайшли хоч одну групу (1.1, 2.1 тощо).
            // Це відфільтрує дати новин, копірайтів та іншого шуму.
            if (Object.keys(parsedData).length > 0) {
                console.log(`✅ Дата ${dateStr}: знайдено ${Object.keys(parsedData).length} груп.`);
                finalSchedule[dateStr] = parsedData;
            } else {
                console.log(`🗑️ Дата ${dateStr}: ігноруємо (не знайдено даних про відключення).`);
            }
        }
    }

    // Зберігаємо результат
    const result = {
        scan_date: new Date().toISOString(),
        schedules: finalSchedule
    };
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));
    console.log('💾 Дані збережено в power_data.json');

  } catch (error) {
    console.error('❌ Критична помилка:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// Функція пошуку патернів "Група Х... з 00:00 до 04:00"
function parseOutages(text) {
    // Regex шукає: "Група 1.1 ... з 12:00 до 16:00"
    // Працює з варіаціями пробілів та тексту між словами
    const regex = /Група\s*([0-9]+\.[0-9]+)\.?[^\d]*?з\s*([0-2]?\d:[0-5]\d)\s*до\s*([0-2]?\d:[0-5]\d)/gi;
    let m;
    const schedule = {};
    
    while ((m = regex.exec(text)) !== null) {
        const gr = m[1];            // Номер групи (напр. 1.1)
        const time = m[2] + "-" + m[3]; // Час (напр. 14:00-18:00)
        
        if (!schedule[gr]) schedule[gr] = [];
        schedule[gr].push(time);
    }
    return schedule;
}
