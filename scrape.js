const puppeteer = require('puppeteer');
const fs = require('fs');

// --- ЗАПОБІЖНИК ВІД ЗАВИСАННЯ (2 хвилини) ---
// Якщо скрипт зависне, цей таймер приб'є процес, щоб не витрачати ліміти GitHub (15 хв)
setTimeout(() => {
    console.error('⏰ TIMEOUT: Скрипт працював занадто довго (більше 120с). Примусове завершення.');
    process.exit(1);
}, 120000);

(async () => {
  console.log('🚀 Запускаємо мультирегіональний парсер...');
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: "new", // Використовуємо новий режим headless
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage', // Важливо для Docker/CI
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    // Встановлюємо жорсткий таймаут на навігацію (60 секунд)
    page.setDefaultNavigationTimeout(60000); 

    console.log('🌍 Переходимо на сайт...');
    // waitUntil: 'networkidle2' означає чекати, поки мережева активність майже вщухне
    await page.goto('https://poweron.loe.lviv.ua/', { waitUntil: 'networkidle2' });
    
    console.log('⏳ Чекаємо 3 секунди для певності...');
    await new Promise(r => setTimeout(r, 3000));

    const content = await page.evaluate(() => document.body.innerText);
    
    // --- ПОШУК ДАТ ---
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
        console.log('⚠️ Дат не знайдено. Парсимо як "Сьогодні".');
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
    console.log('💾 power_data.json успішно збережено.');

  } catch (error) {
    console.error('❌ Критична помилка:', error);
    process.exit(1); // Завершуємо з помилкою, щоб GitHub Action став червоним (але швидко)
  } finally {
    if (browser) {
        console.log('🔒 Закриваємо браузер...');
        await browser.close();
    }
    console.log('🏁 Робота завершена.');
    process.exit(0); // Явно завершуємо процес успішно
  }
})();

function parseRegions(text) {
    const regionsData = {
        "general": {}
    };
    let currentRegionKey = "general";
    
    const REGION_TRIGGERS = [
        { keyword: "шептицьк", key: "sheptytskyi" },
        { keyword: "стрий", key: "stryi" }
    ];

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const groupRegex = /([1-6]\.[1-2])/g;
    const timeRegex = /([0-2]?\d:[0-5]\d)\s*(?:до|-|–)\s*([0-2]?\d:[0-5]\d)/gi;

    for (let line of lines) {
        const lowerLine = line.toLowerCase();

        // Тригер зміни регіону
        if (lowerLine.includes("тимчасово графік") || lowerLine.includes("окремий графік") || lowerLine.includes("підчерг")) {
            const trigger = REGION_TRIGGERS.find(t => lowerLine.includes(t.keyword));
            if (trigger) {
                currentRegionKey = trigger.key;
                if (!regionsData[currentRegionKey]) regionsData[currentRegionKey] = {};
                console.log(`   👉 Регіон: ${currentRegionKey}`);
            }
        }

        // Пошук груп
        const foundGroupsInLine = [];
        let gMatch;
        while ((gMatch = groupRegex.exec(line)) !== null) {
            foundGroupsInLine.push(gMatch[1]);
        }

        if (foundGroupsInLine.length > 0) {
            // Пошук часу
            const times = [];
            timeRegex.lastIndex = 0;
            let tMatch;
            while ((tMatch = timeRegex.exec(line)) !== null) {
                times.push(`${tMatch[1]}-${tMatch[2]}`);
            }

            if (times.length > 0) {
                foundGroupsInLine.forEach(grp => {
                    if (!regionsData[currentRegionKey][grp]) {
                        regionsData[currentRegionKey][grp] = [];
                    }
                    times.forEach(t => {
                        if (!regionsData[currentRegionKey][grp].includes(t)) {
                            regionsData[currentRegionKey][grp].push(t);
                        }
                    });
                });
            }
        }
    }

    // Чистка пустих регіонів
    Object.keys(regionsData).forEach(key => {
        if (Object.keys(regionsData[key]).length === 0 && key !== "general") {
            delete regionsData[key];
        }
    });

    return regionsData;
}
