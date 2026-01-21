const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('🚀 Запускаємо браузер (режим очистки)...');
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

    // Беремо innerText, він найкраще зберігає візуальну структуру (рядки)
    const content = await page.evaluate(() => document.body.innerText);
    
    // --- ЕТАП 1: ПОШУК ДАТ ---
    const dateRegex = /([0-3]\d\.[0-1]\d\.[0-9]{4})/g;
    let match;
    const foundDates = [];
    
    while ((match = dateRegex.exec(content)) !== null) {
        const dateStr = match[1];
        const index = match.index;
        // Перевірка на "станом на" (ігноруємо технічні дати)
        const lookbehind = content.substring(Math.max(0, index - 50), index).toLowerCase();
        if (!lookbehind.includes('станом на') && !lookbehind.includes('оновлено')) {
            foundDates.push({ date: dateStr, index: index });
        }
    }

    console.log(`📅 Знайдено дат: ${foundDates.length}`);
    const finalSchedule = {}; 

    if (foundDates.length === 0) {
        console.log('⚠️ Дат не знайдено, парсимо весь текст як "Сьогодні".');
        // Якщо дат немає, генеруємо поточну дату
        const today = new Date();
        const dateKey = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
        finalSchedule[dateKey] = parseLines(content);
    } else {
        for (let i = 0; i < foundDates.length; i++) {
            const dateObj = foundDates[i];
            // Визначаємо межі тексту для цієї дати
            const start = dateObj.index;
            const end = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            const block = content.substring(start, end);
            
            console.log(`✂️ Аналіз блоку для ${dateObj.date}...`);
            const data = parseLines(block);
            
            // Записуємо тільки якщо знайшли хоча б одну групу
            if (Object.keys(data).length > 0) {
                finalSchedule[dateObj.date] = data;
            }
        }
    }

    const result = {
        scan_date: new Date().toISOString(),
        schedules: finalSchedule
    };
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));
    console.log('💾 power_data.json оновлено (чисті дані).');

  } catch (error) {
    console.error('❌ Помилка:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// *** НОВА ФУНКЦІЯ: ПАРСИНГ ПО РЯДКАХ ***
function parseLines(text) {
    const schedule = {};
    let currentGroup = null;

    // 1. Розбиваємо текст на рядки
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Регулярка для пошуку групи. 
    // Шукаємо "Група 1.1" або просто "1.1." на початку рядка
    const groupRegex = /(?:^|\s)(?:Група\s*)?([1-6]\.[1-2])(?:[\.:\s]|$)/i;
    
    // Регулярка для часу (XX:XX - XX:XX)
    const timeRegex = /([0-2]?\d:[0-5]\d)\s*(?:до|-|–)\s*([0-2]?\d:[0-5]\d)/gi;

    for (let line of lines) {
        // А. Чи є в цьому рядку назва групи?
        const gMatch = groupRegex.exec(line);
        if (gMatch) {
            currentGroup = gMatch[1]; // Запам'ятовуємо: "Ми зараз читаємо про 1.1"
            if (!schedule[currentGroup]) schedule[currentGroup] = [];
            // Важливо: ми не робимо 'continue', бо в цьому ж рядку може бути і час
        }

        // Б. Чи є в цьому рядку час?
        // Але шукаємо час ТІЛЬКИ якщо ми вже знаємо, яка це група
        if (currentGroup) {
            let tMatch;
            // Скидаємо індекс пошуку для регулярки (важливо для global regex у циклі)
            timeRegex.lastIndex = 0;
            
            while ((tMatch = timeRegex.exec(line)) !== null) {
                const timeStr = `${tMatch[1]}-${tMatch[2]}`;
                // Уникаємо дублікатів
                if (!schedule[currentGroup].includes(timeStr)) {
                    schedule[currentGroup].push(timeStr);
                }
            }
        }
        
        // В. Захист від "протікання" (Footer detection)
        // Якщо рядок схожий на "Гаряча лінія" або телефон, скидаємо групу, щоб не записати туди зайві цифри
        if (line.toLowerCase().includes('гаряча лінія') || line.includes('0-800')) {
            currentGroup = null;
        }
    }

    return schedule;
}
