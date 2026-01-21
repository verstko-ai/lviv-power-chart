const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('🚀 Запускаємо браузер (універсальний фільтр)...');
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
        
        // Ігноруємо технічні дати "станом на" та "оновлено"
        if (!lookbehind.includes('станом на') && !lookbehind.includes('оновлено')) {
            foundDates.push({ date: dateStr, index: index });
        }
    }

    console.log(`📅 Знайдено дат: ${foundDates.length}`);
    const finalSchedule = {}; 

    if (foundDates.length === 0) {
        console.log('⚠️ Дат не знайдено, парсимо весь текст як "Сьогодні".');
        const today = new Date();
        const dateKey = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
        finalSchedule[dateKey] = parseLines(content);
    } else {
        for (let i = 0; i < foundDates.length; i++) {
            const dateObj = foundDates[i];
            const start = dateObj.index;
            // Кінець блоку - це початок наступної дати або кінець тексту
            const end = (i + 1 < foundDates.length) ? foundDates[i+1].index : content.length;
            const block = content.substring(start, end);
            
            console.log(`✂️ Аналіз блоку для ${dateObj.date}...`);
            const data = parseLines(block);
            
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
    console.log('💾 power_data.json оновлено.');

  } catch (error) {
    console.error('❌ Помилка:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();

// *** ФУНКЦІЯ ПАРСИНГУ З УНІВЕРСАЛЬНИМИ ТРИГЕРАМИ ***
function parseLines(text) {
    const schedule = {};
    let currentGroup = null;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Регулярки
    // Тепер суворіше: шукаємо "Група" або просто номер, але ігноруємо "підчерга"
    const groupRegex = /(?:^|\s)(?:Група\s*)?([1-6]\.[1-2])(?:[\.:\s]|$)/i;
    const timeRegex = /([0-2]?\d:[0-5]\d)\s*(?:до|-|–)\s*([0-2]?\d:[0-5]\d)/gi;

    // *** СПИСОК СТОП-СЛІВ ***
    // Якщо рядок містить будь-що з цього списку - ми зупиняємо парсинг цієї дати.
    // Це відсікає будь-які "спеціальні графіки" внизу сторінки.
    const STOP_PHRASES = [
        "тимчасово графік",   // "Тимчасово графік для..."
        "окремий графік",     // "Діє окремий графік..."
        "підчерги",           // Специфічні черги для районів
        "підчерга",
        "за посиланням",      // "Графік за посиланням..."
        "важливо:"            // Часто починає блок попереджень
    ];

    for (let line of lines) {
        const lowerLine = line.toLowerCase();

        // 1. Перевірка на стоп-слова (УНІВЕРСАЛЬНИЙ ЗАХИСТ)
        if (STOP_PHRASES.some(phrase => lowerLine.includes(phrase))) {
            console.log(`   🛑 Зупинено на фразі: "${line.substring(0, 30)}..." (початок спец-блоку)`);
            break; // Виходимо з циклу читання рядків для цієї дати
        }

        // 2. А. Шукаємо групу
        // Додатковий захист: переконуємося, що це не "підчерга", хоча 'break' вище мав би це зловити
        if (!lowerLine.includes('підчерг')) {
            const gMatch = groupRegex.exec(line);
            if (gMatch) {
                currentGroup = gMatch[1];
                if (!schedule[currentGroup]) schedule[currentGroup] = [];
            }
        }

        // 3. Б. Шукаємо час (тільки якщо знаємо групу)
        if (currentGroup) {
            let tMatch;
            timeRegex.lastIndex = 0;
            while ((tMatch = timeRegex.exec(line)) !== null) {
                const timeStr = `${tMatch[1]}-${tMatch[2]}`;
                if (!schedule[currentGroup].includes(timeStr)) {
                    schedule[currentGroup].push(timeStr);
                }
            }
        }
        
        // 4. В. Скидання групи на технічних рядках
        if (lowerLine.includes('гаряча лінія') || line.includes('0-800')) {
            currentGroup = null;
        }
    }

    return schedule;
}
