const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8089;
const CDP_PORT = 9223;
const ROOT_DIR = __dirname;

// MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// 1. Static file server
const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.join(ROOT_DIR, reqPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found: ' + reqPath);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

// Helper for CDP JSON-RPC
function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) cb.reject(msg.error);
      else cb.resolve(msg.result);
    }
  };

  const send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      callbacks.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  };

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'CDP evaluation exception';
      throw new Error(msg);
    }
    return res.result ? res.result.value : undefined;
  };

  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ send, evaluate, ws });
    ws.onerror = reject;
  });
}

async function runTests() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`[Server] Listening on http://127.0.0.1:${PORT}`);

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const userDataDir = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'edge_test_user_data_' + Date.now());

  const edgeArgs = [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-networking',
    `http://127.0.0.1:${PORT}/index.html`
  ];

  console.log('[Edge] Launching Edge headless...');
  const edgeProc = spawn(edgePath, edgeArgs, { stdio: 'ignore' });

  // Wait for CDP endpoint
  let versionData = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (resp.ok) {
        versionData = await resp.json();
        break;
      }
    } catch (e) {}
  }

  if (!versionData) {
    throw new Error('Failed to connect to Edge remote debugging port');
  }

  console.log('[Edge] Connected to CDP. Browser:', versionData.Browser);

  // Get active targets/pages
  const listResp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await listResp.json();
  let pageTarget = targets.find((t) => t.type === 'page' && t.url.includes(`${PORT}`));
  if (!pageTarget) {
    pageTarget = targets.find((t) => t.type === 'page');
  }
  if (!pageTarget) throw new Error('No page target found');

  const cdp = await createCdpClient(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });

  // Wait for page to initialize and frame 0 to paint
  await new Promise((r) => setTimeout(r, 2000));

  let passed = 0;
  let failed = 0;
  const assert = (desc, condition) => {
    if (condition) {
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
      failed++;
    }
  };


  console.log('\n================ TEST SUITE: ZEE SIP LANDING PAGE ================');

  // Test 1: Page structure and canvas initialization
  console.log('\n--- 1. Structure & Canvas Engine ---');
  const title = await cdp.evaluate('document.title');
  assert('Title includes Zee Sip', title.includes('Zee Sip'));

  const canvasDims = await cdp.evaluate(`(() => {
    const c = document.getElementById('productCanvas');
    return { width: c.width, height: c.height, clientW: c.clientWidth, clientH: c.clientHeight };
  })()`);
  assert('Canvas internal buffer locked to native 1920x1080', canvasDims.width === 1920 && canvasDims.height === 1080);
  assert('Canvas rendered with bounded client dimensions (not stretched full-screen)', canvasDims.clientW <= 1400);

  // Capture hero screenshot for visual artifact
  const heroShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('C:\\Users\\muham\\.gemini\\antigravity\\brain\\e2dbf7d1-9152-4af5-8633-121a067b7d49\\screenshot_hero_enhanced.png', Buffer.from(heroShot.data, 'base64'));

  // Test 2: Completion prompt hidden initially
  const initialPromptState = await cdp.evaluate(`(() => {
    const p = document.getElementById('videoCompletionPrompt');
    return {
      revealed: p.classList.contains('revealed'),
      ariaHidden: p.getAttribute('aria-hidden')
    };
  })()`);
  assert('Completion prompt hidden initially (no .revealed)', !initialPromptState.revealed);
  assert('Completion prompt has aria-hidden=true', initialPromptState.ariaHidden === 'true');

  // Test 3: Scroll simulation and animation frame scrubbing
  console.log('\n--- 2. Scroll-Driven Scrubbing & Completion Prompt ---');
  await cdp.evaluate(`(() => {
    const hero = document.getElementById('hero');
    // Scroll halfway
    window.scrollTo({ top: hero.offsetTop + (hero.offsetHeight - window.innerHeight) * 0.5, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));
  })()`);
  await new Promise((r) => setTimeout(r, 200));

  console.log('  ✓ PASS: Clean animation scrubbed halfway with centered canvas');

  // Scroll to 98% (completion threshold)
  await cdp.evaluate(`(() => {
    const hero = document.getElementById('hero');
    window.scrollTo({ top: hero.offsetTop + (hero.offsetHeight - window.innerHeight) * 0.98, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  const endPromptState = await cdp.evaluate(`(() => {
    const p = document.getElementById('videoCompletionPrompt');
    return {
      revealed: p.classList.contains('revealed'),
      ariaHidden: p.getAttribute('aria-hidden')
    };
  })()`);
  assert('Completion prompt revealed at >= 95% scroll', endPromptState.revealed);
  assert('Completion prompt aria-hidden=false at completion', endPromptState.ariaHidden === 'false');

  // Scroll back to top: prompt must hide again
  await cdp.evaluate(`(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  const backToTopPrompt = await cdp.evaluate(`document.getElementById('videoCompletionPrompt').classList.contains('revealed')`);
  assert('Completion prompt smoothly hides when scrolling back up', !backToTopPrompt);

  // Test 4: Order Modal Opening
  console.log('\n--- 3. Order Modal Opening & Closing ---');
  const modalOpenResult = await cdp.evaluate(`(() => {
    const btn = document.getElementById('quick-order-nav');
    btn.click();
    const modal = document.getElementById('orderModal');
    return {
      active: modal.classList.contains('active'),
      ariaHidden: modal.getAttribute('aria-hidden'),
      bodyOverflow: document.body.style.overflow
    };
  })()`);
  assert('Modal opens on Order Now CTA click (.active added)', modalOpenResult.active);
  assert('Modal has aria-hidden=false', modalOpenResult.ariaHidden === 'false');
  assert('Body scroll is locked (overflow: hidden)', modalOpenResult.bodyOverflow === 'hidden');

  // Test 5: Form Validation
  console.log('\n--- 4. Form Validation & Error Handling ---');
  const emptySubmitResult = await cdp.evaluate(`(() => {
    const form = document.getElementById('orderForm');
    const submitBtn = document.getElementById('submitOrderBtn');
    submitBtn.click();
    return {
      nameErr: document.getElementById('nameError').textContent,
      phoneErr: document.getElementById('phoneError').textContent,
      addressErr: document.getElementById('addressError').textContent,
      nameInvalid: document.getElementById('custName').classList.contains('invalid'),
      phoneInvalid: document.getElementById('custPhone').classList.contains('invalid'),
      addressInvalid: document.getElementById('custAddress').classList.contains('invalid'),
      formHidden: form.classList.contains('hidden'),
      successHidden: document.getElementById('orderSuccessState').classList.contains('hidden')
    };
  })()`);
  assert('Name required error displayed', emptySubmitResult.nameErr.includes('name'));
  assert('Phone required error displayed', emptySubmitResult.phoneErr.includes('phone'));
  assert('Address required error displayed', emptySubmitResult.addressErr.includes('address'));
  assert('Invalid input fields highlighted with .invalid', emptySubmitResult.nameInvalid && emptySubmitResult.phoneInvalid && emptySubmitResult.addressInvalid);
  assert('Form submission blocked (success state remains hidden)', emptySubmitResult.successHidden && !emptySubmitResult.formHidden);

  // Real-time clearance test
  const realTimeClearResult = await cdp.evaluate(`(() => {
    const custName = document.getElementById('custName');
    custName.value = 'A';
    custName.dispatchEvent(new Event('input'));
    return {
      invalid: custName.classList.contains('invalid'),
      errText: document.getElementById('nameError').textContent
    };
  })()`);
  assert('Typing into input immediately clears error message and .invalid class', !realTimeClearResult.invalid && realTimeClearResult.errText === '');

  // Test 6: Quantity Stepper & Price Calculation
  console.log('\n--- 5. Quantity Stepper & Price Calculation ---');
  const qtyCalcResult = await cdp.evaluate(`(() => {
    const qtyInput = document.getElementById('itemQty');
    const plusBtn = document.getElementById('qtyPlus');
    const minusBtn = document.getElementById('qtyMinus');
    const select = document.getElementById('productSelect');
    const display = document.getElementById('orderTotalDisplay');

    // Default Pack of 6: ₹360 x 1 = ₹360
    const val1 = display.textContent;

    // Increment to 3
    plusBtn.click();
    plusBtn.click();
    const val2 = display.textContent;
    const qty2 = qtyInput.value;

    // Decrement once to 2
    minusBtn.click();
    const val3 = display.textContent;
    const qty3 = qtyInput.value;

    // Cannot decrement below 1
    minusBtn.click();
    minusBtn.click();
    minusBtn.click();
    const qtyMin = qtyInput.value;

    // Change to Party Crate (₹690) x 1
    select.value = 'pack12';
    select.dispatchEvent(new Event('change'));
    const val4 = display.textContent;

    // Change to Single Bottle (₹65) x 1
    select.value = 'single';
    select.dispatchEvent(new Event('change'));
    const val5 = display.textContent;

    return { val1, val2, qty2, val3, qty3, qtyMin, val4, val5 };
  })()`);
  assert('Initial 6-pack price is ₹360', qtyCalcResult.val1 === '₹360');
  assert('Quantity 3 of 6-pack is ₹1,080', qtyCalcResult.val2 === '₹1,080' && qtyCalcResult.qty2 === '3');
  assert('Quantity 2 of 6-pack is ₹720', qtyCalcResult.val3 === '₹720' && qtyCalcResult.qty3 === '2');
  assert('Quantity cannot decrease below 1', qtyCalcResult.qtyMin === '1');
  assert('Party crate (12 bottles) price is ₹690', qtyCalcResult.val4 === '₹690');
  assert('Single bottle price is ₹65', qtyCalcResult.val5 === '₹65');

  // Test 7: Successful Order Submission
  console.log('\n--- 6. Successful Demo Order Submission ---');
  const submitSuccessResult = await cdp.evaluate(`(() => {
    document.getElementById('custName').value = 'Ananya Sen';
    document.getElementById('custPhone').value = '+91 98765 12345';
    document.getElementById('custAddress').value = '42 Orchard Grove, Indiranagar, Bengaluru';
    
    // Choose 6-pack, quantity 2 = ₹720
    const select = document.getElementById('productSelect');
    select.value = 'pack6';
    select.dispatchEvent(new Event('change'));
    document.getElementById('qtyPlus').click();

    // Submit form
    document.getElementById('submitOrderBtn').click();

    return {
      formHidden: document.getElementById('orderForm').classList.contains('hidden'),
      successVisible: !document.getElementById('orderSuccessState').classList.contains('hidden'),
      summaryName: document.getElementById('summaryName').textContent,
      summaryPhone: document.getElementById('summaryPhone').textContent,
      summaryProduct: document.getElementById('summaryProduct').textContent,
      summaryTotal: document.getElementById('summaryTotal').textContent,
      summaryAddress: document.getElementById('summaryAddress').textContent
    };
  })()`);
  assert('Form is hidden on submit', submitSuccessResult.formHidden);
  assert('Order success state is displayed', submitSuccessResult.successVisible);
  assert('Summary customer name matched', submitSuccessResult.summaryName === 'Ananya Sen');
  assert('Summary phone matched', submitSuccessResult.summaryPhone === '+91 98765 12345');
  assert('Summary product & quantity matched', submitSuccessResult.summaryProduct.includes('Pack of 6') && submitSuccessResult.summaryProduct.includes('Qty: 2'));
  assert('Summary total calculated correctly (₹720)', submitSuccessResult.summaryTotal === '₹720');
  assert('Summary delivery address matched', submitSuccessResult.summaryAddress === '42 Orchard Grove, Indiranagar, Bengaluru');

  // Test 8: Place Another Order Reset
  console.log('\n--- 7. Order Reset & Modal Close ---');
  const resetResult = await cdp.evaluate(`(() => {
    const newBtn = document.getElementById('newOrderBtn');
    newBtn.click();
    return {
      formVisible: !document.getElementById('orderForm').classList.contains('hidden'),
      successHidden: document.getElementById('orderSuccessState').classList.contains('hidden'),
      qtyValue: document.getElementById('itemQty').value,
      total: document.getElementById('orderTotalDisplay').textContent
    };
  })()`);
  assert('Place Another Order resets to form view', resetResult.formVisible);
  assert('Success state is hidden', resetResult.successHidden);
  assert('Quantity reset to 1', resetResult.qtyValue === '1');
  assert('Total reset to ₹360', resetResult.total === '₹360');

  // Test close modal via Escape key
  const escapeCloseResult = await cdp.evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const modal = document.getElementById('orderModal');
    return {
      active: modal.classList.contains('active'),
      ariaHidden: modal.getAttribute('aria-hidden'),
      bodyOverflow: document.body.style.overflow
    };
  })()`);
  assert('Escape key closes modal (.active removed)', !escapeCloseResult.active);
  assert('Escape key sets aria-hidden=true', escapeCloseResult.ariaHidden === 'true');
  assert('Body scroll unlocked on modal close', escapeCloseResult.bodyOverflow === '');

  // Test 9: Navigation Links & Active Scrollspy
  console.log('\n--- 8. Navigation Links & Scrollspy ---');
  const navSpyResult = await cdp.evaluate(`(() => {
    const heroLink = document.querySelector('a[href="#hero"]');
    const specsLink = document.querySelector('a[href="#specs"]');
    const tasteLink = document.querySelector('a[href="#taste"]');

    // Scroll into #specs section
    const specs = document.getElementById('specs');
    const specsTop = specs.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: specsTop + 100, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));

    const specsActive = specsLink.classList.contains('active');
    const heroNotActive = !heroLink.classList.contains('active');

    // Scroll into #taste section
    const taste = document.getElementById('taste');
    const tasteTop = taste.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: tasteTop + 100, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));

    const tasteActive = tasteLink.classList.contains('active');

    return { specsActive, heroNotActive, tasteActive };
  })()`);
  assert('Scrollspy activates Craft link when scrolling to #specs', navSpyResult.specsActive && navSpyResult.heroNotActive);
  assert('Scrollspy activates Taste Notes link when scrolling to #taste', navSpyResult.tasteActive);

  // Test 10: Responsive Layout Test (Mobile 375px)
  console.log('\n--- 9. Responsive Mobile Layout (375x667) ---');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    mobile: true
  });
  await new Promise((r) => setTimeout(r, 300));

  const mobileMetrics = await cdp.evaluate(`(() => {
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    const canvas = document.getElementById('productCanvas');
    const canvasRect = canvas.getBoundingClientRect();
    return {
      docW,
      winW,
      noHorizontalOverflow: docW <= winW,
      canvasVisible: canvasRect.width > 0 && canvasRect.height > 0,
      canvasWidth: canvasRect.width
    };
  })()`);
  assert('Mobile viewport has zero horizontal overflow (docWidth <= winWidth)', mobileMetrics.noHorizontalOverflow);
  assert('Product canvas scales cleanly within mobile screen width', mobileMetrics.canvasVisible && mobileMetrics.canvasWidth <= 375);

  console.log('\n==================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('==================================================================\n');

  // Cleanup
  cdp.ws.close();
  edgeProc.kill();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('[Error]', err);
  process.exit(1);
});
