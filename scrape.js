// ... початок файлу ...

// Аварійний таймер всередині JS (3 хв)
setTimeout(() => {
    console.error('💀 WATCHDOG: Примусовий вихід через зависання!');
    process.exit(1);
}, 180000);

(async () => {
  // ...
  const browser = await puppeteer.launch({
    headless: "new", 
    args: [
      '--no-sandbox',               // <--- ОБОВ'ЯЗКОВО
      '--disable-setuid-sandbox',   // <--- ОБОВ'ЯЗКОВО
      '--disable-dev-shm-usage',    // <--- ОБОВ'ЯЗКОВО (вирішує проблеми пам'яті)
      '--disable-gpu',              // <--- ОБОВ'ЯЗКОВО
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ],
    timeout: 60000 
  });
  // ... решта коду
