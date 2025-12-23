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

    // Отримуємо текст, але спробуємо зберегти переноси рядків краще
    const content = await page.evaluate(() => {
        // innerText краще зберігає форматування ніж textContent
        return document.body.innerText;
    });
    console.log('📄 Текст отримано. Довжина:', content.length);

    // --- ЛОГІКА ПАРСИНГУ ---
    
    // Регулярка для пошуку дат (DD.MM.YYYY)
    const dateRegex = /([0-3]\d\.[0-1]\d\.[0-9]{4})/g;
    let match;
    const foundDates = [];
    
    while ((match = dateRegex.exec(content)) !== null) {
        const dateStr = match[1];
        const index = match.index;

        // Перевірка на "технічну" дату
        const lookbehindText = content.substring(Math.max(0, index - 50), index).toLowerCase();
        if (lookbehindText.includes('станом на') || lookbehindText.includes('оновлено')) {
             console.log(`⚠️ Пропускаємо дату ${dateStr}, бо це технічна дата оновлення.`);
             continue; 
        }

        foundDates.push({
            date: dateStr,
            index: index
        });
    }

    console.log(`📅 Знайдено дійсних заголовків дат: ${foundDates.length}`);

    const finalSchedule = {}; 

    if (foundDates.length === 0) {
        console.log('⚠️ Дат-заголовків не знайдено. Пробуємо парсити все як є.');
        const data = parseOutagesBetter(content); // Використовуємо нову функцію
        if (Object.keys(data).length > 0) {
            // Використовуємо поточну дату як ключ, якщо не знайшли
            const today = new Date();
            const dateKey = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
            finalSchedule[dateKey] = data;
        }
    } else {
        for (let i = 0; i < foundDates.length; i++) {
            const currentDateObj = foundDates[i];
            const dateStr = currentDateObj.date;
            
            const startIdx = currentDateObj.index;
            const endIdx = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            
            const textBlock = content.substring(startIdx, endIdx);
            
            console.log(`✂️ Обробка блоку для ${dateStr}`);
            const parsedData = parseOutagesBetter(textBlock); // Використовуємо нову функцію

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

// *** НОВА ПОКРАЩЕНА ФУНКЦІЯ ПАРСИНГУ ***
function parseOutagesBetter(text) {
    const schedule = {};
    
    // 1. Нормалізація тексту: замінюємо нерозривні пробіли, переноси на звичайні пробіли
    // Але краще залишити структуру, щоб розуміти контекст.
    // Спробуємо розбити на "токени" або шукати групи.

    // Шукаємо всі входження груп, наприклад "1.1", "1.2", "Група 2.1" і т.д.
    // Регулярка шукає патерн X.X, де X - цифра.
    // Ми будемо йти по тексту і дивитися, що йде після номера групи.
    
    // Оновлений підхід:
    // Розбиваємо текст на шматки, де кожен шматок починається з номера групи.
    // Але текст може бути сміттям. 
    
    // Давайте спробуємо знайти всі позиції груп.
    const groupRegex = /(?:Група\s*)?([1-6]\.[1-2])/gi;
    let match;
    let groupsFound = [];

    while ((match = groupRegex.exec(text)) !== null) {
        groupsFound.push({
            group: match[1],
            index: match.index
        });
    }

    if (groupsFound.length === 0) return {};

    // Тепер проходимо між знайденими групами і шукаємо час
    for (let i = 0; i < groupsFound.length; i++) {
        const currentGroup = groupsFound[i];
        const groupName = currentGroup.group;
        
        // Початок пошуку часу: відразу після номера цієї групи
        const startSearch = currentGroup.index + groupName.length;
        
        // Кінець пошуку: початок наступної групи АБО кінець тексту
        // Але тут обережно: іноді "1.1" може зустрітися в тексті випадково. 
        // Припустимо, що структура стабільна.
        const endSearch = (i + 1 < groupsFound.length) ? groupsFound[i+1].index : text.length;

        const timeBlock = text.substring(startSearch, endSearch);

        // Шукаємо час у цьому блоці. 
        // Підтримуємо формати: "з 14:00 до 18:00", "14:00 - 18:00", "14:00-18:00"
        const timeRegex = /([0-2]?\d:[0-5]\d)\s*(?:до|-|–)\s*([0-2]?\d:[0-5]\d)/gi;
        
        let timeMatch;
        while ((timeMatch = timeRegex.exec(timeBlock)) !== null) {
            const startT = timeMatch[1];
            const endT = timeMatch[2];
            const timeStr = `${startT}-${endT}`;

            if (!schedule[groupName]) {
                schedule[groupName] = [];
            }
            // Уникаємо дублікатів (іноді текст дублюється)
            if (!schedule[groupName].includes(timeStr)) {
                schedule[groupName].push(timeStr);
            }
        }
    }

    return schedule;
}
