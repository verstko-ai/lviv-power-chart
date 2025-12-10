const puppeteer = require('puppeteer');
const fs = require('fs');

const MONTHS_MAP = {
    'січня': '01', 'лютого': '02', 'березня': '03', 'квітня': '04',
    'травня': '05', 'червня': '06', 'липня': '07', 'серпня': '08',
    'вересня': '09', 'жовтня': '10', 'листопада': '11', 'грудня': '12'
};

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

    // --- НОВА ЛОГІКА: Підтримка назв місяців ---

    // Regex шукає:
    // 1. Число (1-31)
    // 2. Роздільник (крапка АБО пробіл)
    // 3. Місяць (цифри АБО слово "грудня")
    // 4. (Опційно) Рік
    const dateRegex = /([0-3]?\d)[\.\s]+(0[1-9]|1[0-2]|січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:[\.\s]+([0-9]{4}))?/gi;
    
    const datePositions = [];
    let match;
    const currentYear = new Date().getFullYear();

    while ((match = dateRegex.exec(content)) !== null) {
        let day = match[1].padStart(2, '0');
        let monthRaw = match[2].toLowerCase();
        let year = match[3] || currentYear;

        // Конвертуємо назву місяця в номер (грудня -> 12)
        if (MONTHS_MAP[monthRaw]) {
            monthRaw = MONTHS_MAP[monthRaw];
        }

        const formattedDate = `${day}.${monthRaw}.${year}`;

        console.log(`🔎 Знайдено дату: ${formattedDate} (в позиції ${match.index}) - Текст: "${match[0]}"`);

        datePositions.push({
            date: formattedDate,
            index: match.index
        });
    }
    
    console.log(`📅 Всього знайдено міток дати: ${datePositions.length}`);

    // --- ПАРСИНГ ГРУП ---
    const groupRegex = /Група\s*([0-9]+\.[0-9]+)\.?[^\d]*?з\s*([0-2]?\d:[0-5]\d)\s*до\s*([0-2]?\d:[0-5]\d)/gi;
    const finalSchedule = {};
    let count = 0;

    while ((m = groupRegex.exec(content)) !== null) {
        const groupName = m[1];
        const timeRange = m[2] + "-" + m[3];
        const groupIndex = m.index;

        // Знаходимо дату, яка була ОСТАННЬОЮ перед цією групою
        const validDates = datePositions.filter(d => d.index < groupIndex);
        
        if (validDates.length > 0) {
            const bestDate = validDates[validDates.length - 1].date;
            
            if (!finalSchedule[bestDate]) finalSchedule[bestDate] = {};
            if (!finalSchedule[bestDate][groupName]) finalSchedule[bestDate][groupName] = [];
            
            finalSchedule[bestDate][groupName].push(timeRange);
            count++;
        }
    }

    console.log(`✅ Розподілено записів: ${count}`);

    // Сортуємо (10.12, потім 11.12)
    const sortedSchedule = {};
    Object.keys(finalSchedule).sort((a, b) => {
         const toDate = s => { const p = s.split('.'); return new Date(p[2], p[1]-1, p[0]); };
         return toDate(a) - toDate(b);
    }).forEach(key => {
        sortedSchedule[key] = finalSchedule[key];
    });

    const result = {
        scan_date: new Date().toISOString(),
        schedules: sortedSchedule
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
