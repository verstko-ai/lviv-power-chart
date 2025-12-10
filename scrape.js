const puppeteer = require('puppeteer');
const fs = require('fs');

const MONTHS_MAP = {
    'січня': '01', 'лютого': '02', 'березня': '03', 'квітня': '04',
    'травня': '05', 'червня': '06', 'липня': '07', 'серпня': '08',
    'вересня': '09', 'жовтня': '10', 'листопада': '11', 'грудня': '12'
};

(async () => {
  console.log('🚀 Запускаємо браузер (Strict Mode)...');
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

    // --- СУВОРИЙ ПАРСИНГ ДАТ ---

    // Regex пояснення:
    // (?:^|\s) -> Початок рядка АБО пробіл (щоб не ловити всередині номерів телефонів)
    // (0?[1-9]|[12]\d|3[01]) -> День суворо 1-31. Жодних 38!
    // [\.\s]+ -> Роздільник (крапка або пробіл)
    // (...) -> Місяць (цифри 01-12 або слова)
    // (?:[\.\s]+(202[4-9]))? -> Рік 2024-2029 (опційно)
    const dateRegex = /(?:^|\s)(0?[1-9]|[12]\d|3[01])[\.\s]+(0[1-9]|1[0-2]|січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:[\.\s,]+(202[4-9]))?/gi;
    
    const datePositions = [];
    let match;
    const today = new Date();
    const currentYear = today.getFullYear();

    while ((match = dateRegex.exec(content)) !== null) {
        let day = match[1].padStart(2, '0');
        let monthRaw = match[2].toLowerCase();
        let year = match[3] || currentYear;

        if (MONTHS_MAP[monthRaw]) {
            monthRaw = MONTHS_MAP[monthRaw];
        }

        const dateString = `${year}-${monthRaw}-${day}`; // Format YYYY-MM-DD for checking
        const parsedDate = new Date(dateString);
        
        // --- ФІЛЬТР "АДЕКВАТНОСТІ" ---
        // Перевіряємо, наскільки дата далека від сьогодні
        const diffTime = parsedDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        // Дозволяємо дати: від "вчора" (-1) до "післязавтра" (+3)
        // Це відсіє старі новини за жовтень або дати з майбутнього року
        if (diffDays >= -2 && diffDays <= 4) {
             const formattedDisplay = `${day}.${monthRaw}.${year}`;
             console.log(`✅ Знайдено ВАЛІДНУ дату: ${formattedDisplay} (Index: ${match.index})`);
             
             datePositions.push({
                date: formattedDisplay,
                index: match.index,
                obj: parsedDate
            });
        } else {
            console.log(`🗑️ Ігноруємо дату (занадто стара/далека): ${day}.${monthRaw}.${year}`);
        }
    }
    
    console.log(`📅 Всього валідних дат: ${datePositions.length}`);

    // --- ПАРСИНГ ГРУП ---
    const groupRegex = /Група\s*([0-9]+\.[0-9]+)\.?[^\d]*?з\s*([0-2]?\d:[0-5]\d)\s*до\s*([0-2]?\d:[0-5]\d)/gi;
    const finalSchedule = {};
    let count = 0;

    while ((m = groupRegex.exec(content)) !== null) {
        const groupName = m[1];
        const timeRange = m[2] + "-" + m[3];
        const groupIndex = m.index;

        // Шукаємо найближчу дату зліва (Index < GroupIndex)
        const validDates = datePositions.filter(d => d.index < groupIndex);
        
        if (validDates.length > 0) {
            // Беремо останню знайдену (найближчу до групи)
            const bestDate = validDates[validDates.length - 1].date;
            
            if (!finalSchedule[bestDate]) finalSchedule[bestDate] = {};
            if (!finalSchedule[bestDate][groupName]) finalSchedule[bestDate][groupName] = [];
            
            // Захист від дублікатів (іноді на сайті пишуть час двічі)
            if (!finalSchedule[bestDate][groupName].includes(timeRange)) {
                finalSchedule[bestDate][groupName].push(timeRange);
            }
            count++;
        }
    }

    console.log(`✅ Розподілено записів: ${count}`);

    // Сортування ключів за часом
    const sortedSchedule = {};
    datePositions.sort((a, b) => a.obj - b.obj).forEach(dp => {
        if (finalSchedule[dp.date]) {
            sortedSchedule[dp.date] = finalSchedule[dp.date];
        }
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
