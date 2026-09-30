/**
 * ZEE SIP — Scroll-Driven Canvas Product Animation Engine
 * 
 * Inspects & utilizes the 300 original image frames (ezgif-frame-001.jpg to ezgif-frame-300.jpg).
 * Features:
 * - High-DPI HTML5 Canvas frame scrubbing
 * - Progressive, non-blocking image preloading queue with nearest-frame fallback
 * - Scroll synchronization (bidirectional: forward on scroll down, backward on scroll up)
 * - Dynamic editorial text phase shifts
 * - Order Now reveal strictly at the completion of the animation
 * - Modal order form integration & smooth back-to-top replay
 */

document.addEventListener('DOMContentLoaded', () => {
  const TOTAL_FRAMES = 300;
  const FRAME_PREFIX = 'ezgif-frame-';
  const FRAME_EXT = '.jpg';

  // DOM Elements
  const scrollTrack = document.getElementById('hero');
  const canvas = document.getElementById('productCanvas');
  const scrollProgressBar = document.getElementById('scrollProgressBar');
  const scrollCueText = document.getElementById('scrollCueText');
  const heroStatusStrip = document.getElementById('heroStatusStrip');
  const completionPrompt = document.getElementById('videoCompletionPrompt');
  const orderNowBtn = document.getElementById('orderNowBtn');
  const promptReplayBtn = document.getElementById('promptReplayBtn');
  const quickOrderNav = document.getElementById('quick-order-nav');

  // Order Modal Elements
  const orderModal = document.getElementById('orderModal');
  const closeOrderModal = document.getElementById('closeOrderModal');
  const orderForm = document.getElementById('orderForm');
  const productSelect = document.getElementById('productSelect');
  const itemQty = document.getElementById('itemQty');
  const qtyMinus = document.getElementById('qtyMinus');
  const qtyPlus = document.getElementById('qtyPlus');
  const orderTotalDisplay = document.getElementById('orderTotalDisplay');
  const custName = document.getElementById('custName');
  const custPhone = document.getElementById('custPhone');
  const custAddress = document.getElementById('custAddress');
  const nameError = document.getElementById('nameError');
  const phoneError = document.getElementById('phoneError');
  const addressError = document.getElementById('addressError');
  const orderSuccessState = document.getElementById('orderSuccessState');
  const summaryName = document.getElementById('summaryName');
  const summaryPhone = document.getElementById('summaryPhone');
  const summaryProduct = document.getElementById('summaryProduct');
  const summaryTotal = document.getElementById('summaryTotal');
  const summaryAddress = document.getElementById('summaryAddress');
  const newOrderBtn = document.getElementById('newOrderBtn');
  const closeSuccessBtn = document.getElementById('closeSuccessBtn');
  const successReplayBtn = document.getElementById('successReplayBtn');
  const brandLogo = document.querySelector('.brand-logo');

  if (!canvas || !scrollTrack) return;

  const ctx = canvas.getContext('2d', { alpha: false });

  // ---------------------------------------------------------------------------
  // 1. Frame URL Generator & Preload Cache
  // ---------------------------------------------------------------------------
  const getFrameUrl = (index) => {
    const num = String(index + 1).padStart(3, '0');
    return `${FRAME_PREFIX}${num}${FRAME_EXT}`;
  };

  const frames = new Array(TOTAL_FRAMES);
  const loadedFrames = new Set();

  // Helper to load a single frame
  const loadFrame = (index) => {
    return new Promise((resolve) => {
      if (frames[index]) {
        resolve(frames[index]);
        return;
      }
      const img = new Image();
      img.src = getFrameUrl(index);
      img.onload = () => {
        frames[index] = img;
        loadedFrames.add(index);
        resolve(img);
      };
      img.onerror = () => {
        resolve(null);
      };
    });
  };

  // Find closest loaded frame if requested frame is still downloading
  const getClosestLoadedFrame = (targetIndex) => {
    if (loadedFrames.has(targetIndex)) return frames[targetIndex];

    let distance = 1;
    while (targetIndex - distance >= 0 || targetIndex + distance < TOTAL_FRAMES) {
      if (targetIndex - distance >= 0 && loadedFrames.has(targetIndex - distance)) {
        return frames[targetIndex - distance];
      }
      if (targetIndex + distance < TOTAL_FRAMES && loadedFrames.has(targetIndex + distance)) {
        return frames[targetIndex + distance];
      }
      distance++;
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // 2. High-Fidelity 4K/Retina Canvas Rendering Engine
  // Native 1920x1080 1:1 pixel mapping eliminates subpixel downsampling blur.
  // The GPU dynamically scales the element via CSS bicubic interpolation.
  // ---------------------------------------------------------------------------
  const NATIVE_WIDTH = 1920;
  const NATIVE_HEIGHT = 1080;
  let currentRenderedFrame = -1;

  canvas.width = NATIVE_WIDTH;
  canvas.height = NATIVE_HEIGHT;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Pre-fill canvas with obsidian background to eliminate any blank frame flicker
  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);

  const drawFrame = (frameIndex, force = false) => {
    if (!force && currentRenderedFrame === frameIndex) return;

    const img = getClosestLoadedFrame(frameIndex);
    if (!img) return;

    // Draw directly at native 1:1 resolution — razor sharp condensation, labels, and fruit pulp
    ctx.drawImage(img, 0, 0, NATIVE_WIDTH, NATIVE_HEIGHT);
    currentRenderedFrame = frameIndex;
  };

  // ---------------------------------------------------------------------------
  // 3. Progressive Preloading Pipeline
  // ---------------------------------------------------------------------------
  const initPreloading = async () => {
    // Stage 1: Load Frame 0 immediately for instant zero-latency paint
    const firstFrame = await loadFrame(0);
    if (firstFrame) {
      drawFrame(0, true);
    }

    // Stage 2: Load keyframe stride (every 10th frame) + initial 20 frames
    // This allows instant responsive scrubbing while remaining frames load
    const priorityIndices = new Set();
    for (let i = 0; i < 20; i++) priorityIndices.add(i);
    for (let i = 0; i < TOTAL_FRAMES; i += 10) priorityIndices.add(i);
    priorityIndices.add(TOTAL_FRAMES - 1);

    await Promise.all(Array.from(priorityIndices).map(loadFrame));

    // Stage 3: Progressively queue remaining frames in batches of 6 concurrent requests
    const remainingIndices = [];
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      if (!priorityIndices.has(i)) {
        remainingIndices.push(i);
      }
    }

    const BATCH_SIZE = 6;
    const processBatch = async (startIndex) => {
      if (startIndex >= remainingIndices.length) return;
      const batch = remainingIndices.slice(startIndex, startIndex + BATCH_SIZE);
      await Promise.all(batch.map(loadFrame));
      // Schedule next batch on next animation frame / idle
      requestAnimationFrame(() => processBatch(startIndex + BATCH_SIZE));
    };

    processBatch(0);
  };

  initPreloading();

  // ---------------------------------------------------------------------------
  // 4. Scroll Tracking & Bottom Order Popup Engine
  // ---------------------------------------------------------------------------
  let currentTargetFrame = 0;
  let displayedFrame = 0;
  let isTicking = false;

  const handleScroll = () => {
    const rect = scrollTrack.getBoundingClientRect();
    const scrollableDistance = scrollTrack.offsetHeight - window.innerHeight;

    // Calculate normalized progress from 0.0 to 1.0
    const progress = Math.min(Math.max(-rect.top / scrollableDistance, 0), 1);

    // Map progress to 0 ... 299
    currentTargetFrame = Math.min(Math.floor(progress * (TOTAL_FRAMES - 1)), TOTAL_FRAMES - 1);

    // Update progress bar
    if (scrollProgressBar) {
      scrollProgressBar.style.width = `${(progress * 100).toFixed(1)}%`;
    }

    // Scroll cue text
    if (scrollCueText) {
      if (progress < 0.25) {
        scrollCueText.textContent = "Scroll to explore";
      } else if (progress < 0.85) {
        scrollCueText.textContent = "Experience the pour";
      } else {
        scrollCueText.textContent = "Ready to savor";
      }
    }

    // Detect completion: reveal order popup at bottom strictly towards end
    const isCompleted = progress >= 0.88 || currentTargetFrame >= 270;
    if (completionPrompt) {
      completionPrompt.classList.toggle('revealed', isCompleted);
      completionPrompt.setAttribute('aria-hidden', isCompleted ? 'false' : 'true');
    }
    if (heroStatusStrip) {
      heroStatusStrip.classList.toggle('faded', isCompleted);
    }

    if (!isTicking) {
      isTicking = true;
      requestAnimationFrame(renderLoop);
    }
  };

  // Render loop with lerp for ultra-smooth 60fps frame scrubbing
  const renderLoop = () => {
    const deltaFrame = currentTargetFrame - displayedFrame;
    const frameSettled = Math.abs(deltaFrame) < 0.4;

    if (frameSettled) {
      displayedFrame = currentTargetFrame;
      drawFrame(displayedFrame);
      isTicking = false;
      return;
    }

    // Smooth speed factor for frame scrubbing
    displayedFrame += deltaFrame * 0.35;
    drawFrame(Math.round(displayedFrame));

    requestAnimationFrame(renderLoop);
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', handleScroll, { passive: true });
  // Initial check
  handleScroll();

  // ---------------------------------------------------------------------------
  // 5. Back to Top / Replay Scroll Action
  // ---------------------------------------------------------------------------
  const scrollToTop = () => {
    window.scrollTo({
      top: scrollTrack.offsetTop,
      behavior: 'smooth'
    });
  };

  if (promptReplayBtn) promptReplayBtn.addEventListener('click', scrollToTop);
  if (brandLogo) {
    brandLogo.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToTop();
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Navigation Scrollspy
  // ---------------------------------------------------------------------------
  const navLinks = document.querySelectorAll('.nav-links .nav-link');
  const trackedSections = [
    { id: 'hero', el: document.getElementById('hero') },
    { id: 'specs', el: document.getElementById('specs') },
    { id: 'taste', el: document.getElementById('taste') }
  ];

  const updateActiveNav = () => {
    const scrollBottom = window.scrollY + window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    let currentId = 'hero';

    if (scrollBottom >= docHeight - 80) {
      currentId = 'taste';
    } else {
      const viewCenter = window.scrollY + (window.innerHeight * 0.45);
      for (const sec of trackedSections) {
        if (sec.el) {
          const rect = sec.el.getBoundingClientRect();
          const top = rect.top + window.scrollY;
          const height = sec.el.offsetHeight;
          if (viewCenter >= top && viewCenter < top + height) {
            currentId = sec.id;
            break;
          }
        }
      }
    }

    navLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href === `#${currentId}`) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  };

  window.addEventListener('scroll', updateActiveNav, { passive: true });
  updateActiveNav();

  // ---------------------------------------------------------------------------
  // 7. Order Modal Flow & Form Validation
  // ---------------------------------------------------------------------------
  let lastFocusedElement = null;

  const resetOrderForm = () => {
    if (orderForm) {
      orderForm.reset();
      orderForm.classList.remove('hidden');
    }
    if (orderSuccessState) {
      orderSuccessState.classList.add('hidden');
    }
    clearFormErrors();
    if (itemQty) itemQty.value = '1';
    if (productSelect) productSelect.value = 'pack6';
    updateOrderTotal();
  };

  const openModal = () => {
    if (!orderModal) return;
    lastFocusedElement = document.activeElement;

    // Reset view if previously completed
    if (orderSuccessState && !orderSuccessState.classList.contains('hidden')) {
      resetOrderForm();
    }

    orderModal.classList.add('active');
    orderModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      if (custName) custName.focus();
    }, 150);
  };

  const closeModal = () => {
    if (!orderModal) return;
    orderModal.classList.remove('active');
    orderModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  };

  if (orderNowBtn) orderNowBtn.addEventListener('click', openModal);
  if (quickOrderNav) {
    quickOrderNav.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });
  }

  if (closeOrderModal) closeOrderModal.addEventListener('click', closeModal);
  if (closeSuccessBtn) closeSuccessBtn.addEventListener('click', closeModal);
  if (newOrderBtn) {
    newOrderBtn.addEventListener('click', () => {
      resetOrderForm();
      if (custName) custName.focus();
    });
  }

  if (successReplayBtn) {
    successReplayBtn.addEventListener('click', () => {
      closeModal();
      scrollToTop();
    });
  }

  if (orderModal) {
    orderModal.addEventListener('click', (e) => {
      if (e.target === orderModal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && orderModal?.classList.contains('active')) {
      closeModal();
    }
  });

  // Price & Quantity Calculation
  const updateOrderTotal = () => {
    if (!productSelect || !itemQty || !orderTotalDisplay) return;
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unitPrice = parseInt(selectedOption?.getAttribute('data-price') || '360', 10);
    const quantity = parseInt(itemQty.value, 10) || 1;
    const total = unitPrice * quantity;
    orderTotalDisplay.textContent = `₹${total.toLocaleString('en-IN')}`;
  };

  if (productSelect) productSelect.addEventListener('change', updateOrderTotal);

  if (qtyMinus) {
    qtyMinus.addEventListener('click', () => {
      let current = parseInt(itemQty.value, 10) || 1;
      if (current > 1) {
        itemQty.value = current - 1;
        updateOrderTotal();
      }
    });
  }

  if (qtyPlus) {
    qtyPlus.addEventListener('click', () => {
      let current = parseInt(itemQty.value, 10) || 1;
      if (current < 50) {
        itemQty.value = current + 1;
        updateOrderTotal();
      }
    });
  }

  // Form Validation & Submission
  const clearFormErrors = () => {
    if (nameError) nameError.textContent = '';
    if (phoneError) phoneError.textContent = '';
    if (addressError) addressError.textContent = '';
    if (custName) custName.classList.remove('invalid');
    if (custPhone) custPhone.classList.remove('invalid');
    if (custAddress) custAddress.classList.remove('invalid');
  };

  // Real-time error clearance on typing
  [custName, custPhone, custAddress].forEach((input) => {
    if (input) {
      input.addEventListener('input', () => {
        input.classList.remove('invalid');
        if (input === custName && nameError) nameError.textContent = '';
        if (input === custPhone && phoneError) phoneError.textContent = '';
        if (input === custAddress && addressError) addressError.textContent = '';
      });
    }
  });

  if (orderForm) {
    orderForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearFormErrors();

      let isValid = true;
      const nameVal = custName?.value.trim() || '';
      const phoneVal = custPhone?.value.trim() || '';
      const addressVal = custAddress?.value.trim() || '';

      if (!nameVal) {
        if (nameError) nameError.textContent = 'Please enter your name.';
        if (custName) custName.classList.add('invalid');
        isValid = false;
      }

      if (!phoneVal) {
        if (phoneError) phoneError.textContent = 'Please enter a contact phone number.';
        if (custPhone) custPhone.classList.add('invalid');
        isValid = false;
      } else if (!/^[\d\s+\-()]{7,16}$/.test(phoneVal)) {
        if (phoneError) phoneError.textContent = 'Please enter a valid phone number.';
        if (custPhone) custPhone.classList.add('invalid');
        isValid = false;
      }

      if (!addressVal) {
        if (addressError) addressError.textContent = 'Please provide your delivery address.';
        if (custAddress) custAddress.classList.add('invalid');
        isValid = false;
      }

      if (!isValid) return;

      const selectedOption = productSelect?.options[productSelect.selectedIndex];
      const productText = selectedOption?.text.split('—')[0].trim() || 'Zee Sip Pulpy Grape';
      const quantity = itemQty?.value || '1';
      const totalText = orderTotalDisplay?.textContent || '₹360';

      if (summaryName) summaryName.textContent = nameVal;
      if (summaryPhone) summaryPhone.textContent = phoneVal;
      if (summaryProduct) summaryProduct.textContent = `${productText} (Qty: ${quantity})`;
      if (summaryTotal) summaryTotal.textContent = totalText;
      if (summaryAddress) summaryAddress.textContent = addressVal;

      orderForm.classList.add('hidden');
      if (orderSuccessState) orderSuccessState.classList.remove('hidden');
    });
  }
});
