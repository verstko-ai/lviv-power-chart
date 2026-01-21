const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('🚀 Запускаємо мультирегіональний парсер...');
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
    
    // --- ЕТАП 1: ПОШУК ДАТ ---
    const dateRegex = /([0-3]\d\.[0-1]\d\.[0-9]{4})/g;
    let match;
    const foundDates = [];
    
    while ((match = dateRegex.exec(content)) !== null) {
        const dateStr = match[1];
        const index = match.index;
        const lookbehind = content.substring(Math.max(0, index - 50), index).toLowerCase();
        
        if (!lookbehind.includes('станом на') && !lookbehind.includes('оновлено')) {
            foundDates.push({ date: dateStr, index: index });
        }
    }

    console.log(`📅 Знайдено дат: ${foundDates.length}`);
    const finalSchedule = {}; 

    if (foundDates.length === 0) {
        console.log('⚠️ Дат не знайдено, пробуємо парсити все як "Сьогодні".');
        const today = new Date();
        const dateKey = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
        finalSchedule[dateKey] = parseRegions(content);
    } else {
        for (let i = 0; i < foundDates.length; i++) {
            const dateObj = foundDates[i];
            const start = dateObj.index;
            const end = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            const block = content.substring(start, end);
            
            console.log(`✂️ Аналіз блоку для ${dateObj.date}...`);
            finalSchedule[dateObj.date] = parseRegions(block);
        }
    }

    const result = {
        scan_date: new Date().toISOString(),
        schedules: finalSchedule
    };
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));
    console.log('💾 power_data.json оновлено (нова структура).');

  } catch (error) {
    console.error('❌ Помилка:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// *** ГОЛОВНА ЛОГІКА РОЗПОДІЛУ ПО РЕГІОНАХ ***
function parseRegions(text) {
    // Структура: { "general": { "1.1": [...] }, "sheptytskyi": { ... } }
    const regionsData = {
        "general": {} // Загальний графік (Львів та область) за замовчуванням
    };

    let currentRegionKey = "general";
    
    // Список тригерів для перемикання регіонів
    // [Ключове слово в тексті, Ключ в JSON, Назва для відображення]
    const REGION_TRIGGERS = [
        { keyword: "шептицьк", key: "sheptytskyi" },
        // Сюди можна додати інші: { keyword: "стрий", key: "stryi" }
    ];

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Регулярки
    const groupRegex = /([1-6]\.[1-2])/g; // Шукаємо всі групи в рядку (тепер global flag 'g')
    const timeRegex = /([0-2]?\d:[0-5]\d)\s*(?:до|-|–)\s*([0-2]?\d:[0-5]\d)/gi;

    for (let line of lines) {
        const lowerLine = line.toLowerCase();

        // 1. ПЕРЕВІРКА: ЧИ ЗМІНИВСЯ РЕГІОН?
        // Шукаємо маркери початку спец-графіків
        if (lowerLine.includes("тимчасово графік") || lowerLine.includes("окремий графік") || lowerLine.includes("підчерг")) {
            // Перевіряємо, який саме це регіон
            const trigger = REGION_TRIGGERS.find(t => lowerLine.includes(t.keyword));
            if (trigger) {
                currentRegionKey = trigger.key;
                if (!regionsData[currentRegionKey]) {
                    regionsData[currentRegionKey] = {}; // Ініціалізуємо об'єкт для нового регіону
                }
                console.log(`   👉 Перемикання на регіон: ${currentRegionKey}`);
            }
        }
        
        // 2. ЯКЩО ЦЕ "ЗАГАЛЬНИЙ" ГРАФІК, АЛЕ МИ БАЧИМО "ПІДЧЕРГИ" (без назви міста)
        // Це захист. Якщо в тексті пішли "підчерги", але назву міста не знайшли, 
        // краще писати в окрему купу "unknown", ніж псувати "general".
        // Але поки що залишимо як є, бо зазвичай назва міста йде перед словом "підчерга".

        // 3. ПАРСИНГ ГРУП І ЧАСУ
        // Шукаємо всі групи в цьому рядку (наприклад "1.1, 1.2")
        const foundGroupsInLine = [];
        let gMatch;
        while ((gMatch = groupRegex.exec(line)) !== null) {
            foundGroupsInLine.push(gMatch[1]);
        }

        if (foundGroupsInLine.length > 0) {
            // Шукаємо час у цьому ж рядку
            const times = [];
            timeRegex.lastIndex = 0;
            let tMatch;
            while ((tMatch = timeRegex.exec(line)) !== null) {
                times.push(`${tMatch[1]}-${tMatch[2]}`);
            }

            // Якщо час знайшли - записуємо його для ВСІХ груп, знайдених у рядку
            if (times.length > 0) {
                foundGroupsInLine.forEach(grp => {
                    if (!regionsData[currentRegionKey][grp]) {
                        regionsData[currentRegionKey][grp] = [];
                    }
                    // Додаємо час без дублікатів
                    times.forEach(t => {
                        if (!regionsData[currentRegionKey][grp].includes(t)) {
                            regionsData[currentRegionKey][grp].push(t);
                        }
                    });
                });
            }
        }
    }

    // Видаляємо пусті регіони, якщо такі створилися помилково
    Object.keys(regionsData).forEach(key => {
        if (Object.keys(regionsData[key]).length === 0 && key !== "general") {
            delete regionsData[key];
        }
    });

    return regionsData;
}
