const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');

// Знаходимо шлях до Chrome, який встановив GitHub Action
const getExecutablePath = () => {
    try {
        // У GitHub Actions це зазвичай тут
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            return process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        // Fallback (запасний варіант)
        return execSync('which google-chrome').toString().trim();
    } catch (e) {
        return '/usr/bin/google-chrome';
    }
};

(async () => {
  console.log('🚀 Старт (Puppeteer Core)...');
  let browser = null;

  try {
    const execPath = getExecutablePath();
    console.log(`🔧 Chrome path: ${execPath}`);

    browser = await puppeteer.launch({
      executablePath: execPath, // Використовуємо системний Chrome
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      timeout: 30000
    });
    
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    console.log('🌍 На сайт...');
    await page.goto('https://poweron.loe.lviv.ua/', { waitUntil: 'domcontentloaded' });
    
    // Чекаємо рендерингу
    await new Promise(r => setTimeout(r, 4000));
    
    const content = await page.evaluate(() => document.body.innerText);
    
    // --- ПАРСИНГ ---
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

    console.log(`📅 Дат: ${foundDates.length}`);
    const finalSchedule = {}; 

    if (foundDates.length === 0) {
        const today = new Date();
        const dateKey = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
        finalSchedule[dateKey] = parseRegions(content);
    } else {
        for (let i = 0; i < foundDates.length; i++) {
            const dateObj = foundDates[i];
            const start = dateObj.index;
            const end = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            const block = content.substring(start, end);
            finalSchedule[dateObj.date] = parseRegions(block);
        }
    }

    const result = {
        scan_date: new Date().toISOString(),
        schedules: finalSchedule
    };
    
    fs.writeFileSync('power_data.json', JSON.stringify(result, null, 2));
    console.log('💾 Збережено.');

  } catch (error) {
    console.error('❌ Помилка:', error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    process.exit(0);
  }
})();

function parseRegions(text) {
    const regionsData = { "general": {} };
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
        
        if (lowerLine.includes("тимчасово графік") || lowerLine.includes("окремий графік") || lowerLine.includes("підчерг")) {
            const trigger = REGION_TRIGGERS.find(t => lowerLine.includes(t.keyword));
            if (trigger) {
                currentRegionKey = trigger.key;
                if (!regionsData[currentRegionKey]) regionsData[currentRegionKey] = {};
            }
        }

        const foundGroupsInLine = [];
        let gMatch;
        while ((gMatch = groupRegex.exec(line)) !== null) {
            foundGroupsInLine.push(gMatch[1]);
        }

        if (foundGroupsInLine.length > 0) {
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
    
    Object.keys(regionsData).forEach(key => {
        if (Object.keys(regionsData[key]).length === 0 && key !== "general") {
            delete regionsData[key];
        }
    });

    return regionsData;
}
