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
  // Прикидаємось звичайним користувачем
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log('🌍 Переходимо на сайт...');
    await page.goto('https://poweron.loe.lviv.ua/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    console.log('⏳ Чекаємо завантаження контенту (5с)...');
    await new Promise(r => setTimeout(r, 5000));

    // Отримуємо "чистий" текст зі сторінки
    const content = await page.evaluate(() => document.body.innerText);
    // Для налагодження (можна розкоментувати, щоб побачити що бачить робот)
    // console.log('DEBUG CONTENT:', content.substring(0, 500)); 

    // --- 1. ПАРСИНГ ДАТ (ЗАГОЛОВКІВ) ---
    const dateRegex = /([0-3]\d\.[0-1]\d\.[0-9]{4})/g;
    let match;
    const foundDates = [];
    
    while ((match = dateRegex.exec(content)) !== null) {
        const dateStr = match[1];
        const index = match.index;

        // Перевіряємо, чи це не дата "станом на" (технічна)
        // Дивимось 50 символів перед датою
        const lookbehindText = content.substring(Math.max(0, index - 50), index).toLowerCase();
        if (lookbehindText.includes('станом на') || lookbehindText.includes('оновлено')) {
             console.log(`⚠️ Пропускаємо технічну дату: ${dateStr}`);
             continue; 
        }

        foundDates.push({ date: dateStr, index: index });
    }

    console.log(`📅 Знайдено дат графіків: ${foundDates.length}`);

    const finalSchedule = {}; 

    // --- 2. ОБРОБКА ДАНИХ ---
    if (foundDates.length === 0) {
        // Якщо дат не знайшли, пробуємо витягнути графік з усього тексту (на сьогодні)
        console.log('⚠️ Заголовків дат не знайдено. Парсимо весь текст.');
        const data = parseOutages(content);
        
        // Генеруємо сьогоднішню дату як ключ
        const today = new Date();
        const dateKey = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
        
        if (Object.keys(data).length > 0) {
            finalSchedule[dateKey] = data;
        }
    } else {
        // Якщо дати є, розбиваємо текст на блоки
        for (let i = 0; i < foundDates.length; i++) {
            const currentDateObj = foundDates[i];
            const dateStr = currentDateObj.date;
            
            const startIdx = currentDateObj.index;
            // Кінець поточного блоку - це початок наступної дати
            const endIdx = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            
            const textBlock = content.substring(startIdx, endIdx);
            
            console.log(`✂️ Обробка графіку на ${dateStr}...`);
            const parsedData = parseOutages(textBlock);

            if (Object.keys(parsedData).length > 0) {
                finalSchedule[dateStr] = parsedData;
            } else {
                console.log(`   (Графік пустий або не розпізнано)`);
            }
        }
    }

    // --- 3. ЗБЕРЕЖЕННЯ ---
    const result = {
        scan_date: new Date().toISOString(),
        schedules: finalSchedule
    };
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));
    console.log('💾 power_data.json успішно оновлено.');

  } catch (error) {
    console.error('❌ Критична помилка:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// *** ГОЛОВНА ФУНКЦІЯ ПАРСИНГУ ***
function parseOutages(text) {
    const schedule = {};
    
    // 1. Знаходимо всі позиції, де згадуються групи (наприклад "Група 1.1" або просто "1.1")
    // Ця регулярка шукає цифру крапку цифру (1.1 - 6.2)
    const groupRegex = /(?:Група\s*)?([1-6]\.[1-2])/gi;
    let match;
    let groupsFound = [];

    while ((match = groupRegex.exec(text)) !== null) {
        groupsFound.push({
            groupName: match[1], // "1.1"
            startIndex: match.index
        });
    }

    if (groupsFound.length === 0) return {};

    // 2. Проходимо по кожній знайденій групі
    for (let i = 0; i < groupsFound.length; i++) {
        const currentGroup = groupsFound[i];
        const name = currentGroup.groupName;
        
        // Визначаємо межі тексту для цієї групи:
        // Від початку цієї групи...
        const startSearch = currentGroup.startIndex + name.length; // + довжина назви, щоб не шукати в самій назві
        
        // ...до початку наступної групи (або до кінця тексту)
        const endSearch = (i + 1 < groupsFound.length) ? groupsFound[i+1].startIndex : text.length;

        // Вирізаємо шматок тексту, що стосується цієї групи
        const rawBlock = text.substring(startSearch, endSearch);
        
        // 3. Шукаємо час у цьому шматку
        // Шукаємо формати: "12:00-14:00", "з 12:00 до 14:00", "12:00 – 14:00"
        const timeRegex = /([0-2]?\d:[0-5]\d)\s*(?:до|-|–)\s*([0-2]?\d:[0-5]\d)/gi;
        
        let timeMatch;
        while ((timeMatch = timeRegex.exec(rawBlock)) !== null) {
            const startT = timeMatch[1];
            const endT = timeMatch[2];
            const timeStr = `${startT}-${endT}`; // Форматуємо як "HH:MM-HH:MM"

            if (!schedule[name]) {
                schedule[name] = [];
            }
            // Додаємо, якщо такого часу ще немає (уникнення дублів)
            if (!schedule[name].includes(timeStr)) {
                schedule[name].push(timeStr);
            }
        }
    }

    return schedule;
}
