// =======================
// Data
// =======================
// Persist cart across page reloads
let cart = (() => {
  try { return JSON.parse(localStorage.getItem('sstCart')) || []; } catch { return []; }
})();
let wishlist = (() => {
  try {
    const ids = JSON.parse(localStorage.getItem('sstWishlistIds')) || [];
    // Full product objects restored after liveProducts loads (see loadLiveProducts)
    return ids; // temporarily stores IDs; swapped to full objects post-load
  } catch { return []; }
})();
let currentCategory = "All";
let currentSlide = 0;
let slideTimer = null;

// Live product catalogue — loaded from Firestore
let liveProducts = [];

const categories = ["All", "Men", "Women", "Kids", "Home", "Daily Wear"];

// Sub-category state for Daily Wear ('' = all daily wear, 'Men' or 'Women' for sub-filter)
let currentDailySubCat = '';

// =======================
// Firestore Product Loader
// =======================
const PRODUCT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let _productCacheTime = 0;

function loadLiveProducts(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && liveProducts.length > 0 && (now - _productCacheTime) < PRODUCT_CACHE_TTL) {
    // Cache still fresh — just re-render
    renderCategories();
    renderProducts();
    updateCategoryCards();
    return;
  }
  const db = firebase.firestore();
  db.collection('products').get().then(snap => {
    liveProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _productCacheTime = Date.now();
    // Restore full wishlist objects from saved IDs
    try {
      const savedIds = JSON.parse(localStorage.getItem('sstWishlistIds')) || [];
      if (savedIds.length && wishlist.length === savedIds.length) {
        wishlist = savedIds
          .map(id => liveProducts.find(p => p.id === id))
          .filter(Boolean);
      }
    } catch {}
    renderCategories();
    renderProducts();
    updateCategoryCards();
    updateWishlistUI();
    updateCartCount();
  }).catch(err => {
    console.warn('Firestore load failed:', err);
    renderCategories();
    renderProducts();
  });
}

// =======================
// Hero Slider
// =======================
function initHeroSlider() {
  const slides = document.querySelectorAll('.hero-slide');
  const dotsContainer = document.getElementById('heroDots');
  if (!dotsContainer) return;

  dotsContainer.innerHTML = '';
  slides.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = `hero-dot ${i === 0 ? 'active' : ''}`;
    dot.onclick = () => goToSlide(i);
    dotsContainer.appendChild(dot);
  });

  startSlideTimer();
}

function startSlideTimer() {
  clearInterval(slideTimer);
  slideTimer = setInterval(() => changeSlide(1, false), 5000);
}

function changeSlide(dir, resetTimer = false) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  slides[currentSlide].classList.remove('active');
  dots[currentSlide]?.classList.remove('active');

  currentSlide = (currentSlide + dir + slides.length) % slides.length;
  slides[currentSlide].classList.add('active');
  dots[currentSlide]?.classList.add('active');
  if (resetTimer) startSlideTimer();
}

function goToSlide(i) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  slides[currentSlide].classList.remove('active');
  dots[currentSlide]?.classList.remove('active');
  currentSlide = i;
  slides[currentSlide].classList.add('active');
  dots[currentSlide]?.classList.add('active');
  startSlideTimer(); // reset on manual nav
}

// =======================
// Auth UI Functions (Firebase Integrated)
// =======================
function toggleAuthModal() {
  if (firebaseAuth && firebaseAuth.getCurrentUser()) {
    toggleProfileDropdown();
  } else {
    openModal('authModal');
    switchToLogin();
  }
}

function toggleProfileDropdown() {
  let dropdown = document.getElementById('profileDropdown');
  if (dropdown) {
    dropdown.remove();
    return;
  }

  const user = firebaseAuth.getCurrentUser();
  dropdown = document.createElement('div');
  dropdown.id = 'profileDropdown';
  dropdown.innerHTML = `
    <div class="profile-dropdown-header">
      <div class="pd-avatar">👤</div>
      <div>
        <div class="pd-name">${user?.name || 'User'}</div>
        <div class="pd-email">${user?.email || ''}</div>
      </div>
    </div>
    <hr class="pd-divider">
    <button class="pd-item" onclick="openOrdersModal(); document.getElementById('profileDropdown')?.remove()">
      📦 My Orders
    </button>
    <button class="pd-item logout" onclick="document.getElementById('profileDropdown')?.remove(); logout()">
      🚪 Logout
    </button>
  `;

  const btn = document.getElementById('userProfile');
  btn.style.position = 'relative';
  btn.appendChild(dropdown);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

function closeAuthModal() { closeModal('authModal'); }

function switchToSignup() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'block';
}

function switchToLogin() {
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
}

// =======================
// My Orders Modal
// =======================
function openOrdersModal() {
  const user = firebaseAuth ? firebaseAuth.getCurrentUser() : null;
  if (!user) {
    showNotification('⚠️ Please sign in to view orders', 'error');
    return;
  }
  openModal('ordersModal');
  renderOrders(user.email);
}

function closeOrdersModal() {
  closeModal('ordersModal');
  if (_ordersUnsubscribe) { _ordersUnsubscribe(); _ordersUnsubscribe = null; }
}

// Tracks the active Firestore unsubscribe function for orders listener
let _ordersUnsubscribe = null;

async function renderOrders(userEmail) {
  const container = document.getElementById('orders-list');
  if (!container) return;

  // Unsubscribe previous listener if any
  if (_ordersUnsubscribe) { _ordersUnsubscribe(); _ordersUnsubscribe = null; }

  container.innerHTML = `<div class="cart-empty"><div class="empty-icon">⏳</div><p>Loading your orders...</p></div>`;

  try {
    _ordersUnsubscribe = db.collection("orders")
      .where("userId", "==", userEmail)
      .orderBy("createdAt", "desc")
      .onSnapshot(snapshot => {
        if (snapshot.empty) {
          container.innerHTML = `<div class="cart-empty"><div class="empty-icon">📦</div><p>No orders yet!</p><p style="font-size:13px;margin-top:6px">Your orders will appear here after you place one.</p></div>`;
          document.getElementById('orders-modal-count').textContent = '0';
          return;
        }

        document.getElementById('orders-modal-count').textContent = snapshot.size;
        container.innerHTML = '';

        snapshot.forEach(doc => {
          const o = doc.data();
          const date = o.createdAt?.toDate
            ? o.createdAt.toDate().toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
            : 'Recently';

          const status = o.status || 'Pending';
          const statusStyles = {
            'Pending':   { color: '#d97706', bg: '#fef3c720', icon: '⏳' },
            'Accepted':  { color: '#3b82f6', bg: '#eff6ff',   icon: '✅' },
            'Shipped':   { color: '#a855f7', bg: '#faf5ff',   icon: '🚚' },
            'Delivered': { color: '#16a34a', bg: '#f0fdf4',   icon: '📦' },
            'Cancelled': { color: '#dc2626', bg: '#fef2f2',   icon: '❌' },
          };
          const st = statusStyles[status] || statusStyles['Pending'];

          const div = document.createElement('div');
          div.className = 'order-card';
          div.innerHTML = `
            <div class="order-card-header">
              <div>
                <div class="order-id">Order #${o.orderId}</div>
                <div class="order-date">📅 ${date} &nbsp;|&nbsp; 💳 ${o.paymentMode}</div>
              </div>
              <span class="order-status" style="background:${st.bg};color:${st.color};display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:700">
                ${st.icon} ${status}
              </span>
            </div>
            <div class="order-items-list">
              ${(o.items || []).map(i => `
                <div class="order-item-row">
                  <span>${i.name}${i.size ? ` <span style="background:#eff6ff;color:#1d4ed8;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700">${i.size}</span>` : ''} × ${i.quantity}</span>
                  <span>₹${(i.price * i.quantity).toLocaleString()}</span>
                </div>
              `).join('')}
            </div>
            <div class="order-card-footer">
              <span>📍 ${o.city}, ${o.pin}</span>
              <span class="order-total">Total: ₹${o.total?.toLocaleString()}</span>
            </div>
          `;
          container.appendChild(div);
        });
      }, err => {
        console.error("Orders listener error:", err);
        container.innerHTML = `<div class="cart-empty"><div class="empty-icon">❌</div><p>Couldn't load orders.</p><p style="font-size:12px;color:#94a3b8;margin-top:4px">${err.message}</p></div>`;
      });
  } catch (err) {
    console.error("Orders fetch error:", err);
    container.innerHTML = `<div class="cart-empty"><div class="empty-icon">❌</div><p>Couldn't load orders.</p><p style="font-size:12px;color:#94a3b8;margin-top:4px">${err.message}</p></div>`;
  }
}

function updateUserUI() {
  const userName = document.getElementById('userName');
  const userBtn = document.getElementById('userProfile');
  if (!userName) return;

  const user = firebaseAuth ? firebaseAuth.getCurrentUser() : null;

  if (user) {
    userName.textContent = user.name.split(' ')[0];
    userBtn.querySelector('.action-icon').textContent = '👤';
    userBtn.style.background = '#eff6ff';
  } else {
    userName.textContent = 'Sign In';
    userBtn.style.background = '';
  }
}

// =======================
// Category & Filter
// =======================
function renderCategories() {
  const container = document.getElementById('categories');
  if (!container) return;
  container.innerHTML = '';

  categories.forEach(cat => {
    const link = document.createElement('a');
    link.className = `category-link ${cat === currentCategory ? 'active' : ''}`;

    if (cat === 'All') {
      link.textContent = 'All Products';
    } else if (cat === 'Daily Wear') {
      link.textContent = '👕 Daily Wear';
      link.className += ' daily-wear-link';
    } else {
      link.textContent = cat + "'s";
    }

    link.onclick = () => filterCategory(cat);
    container.appendChild(link);
  });

  // Render Daily Wear sub-nav if that category is active
  const subNav = document.getElementById('dailyWearSubNav');
  if (currentCategory === 'Daily Wear') {
    if (!subNav) {
      const sub = document.createElement('div');
      sub.id = 'dailyWearSubNav';
      sub.className = 'daily-wear-subnav';
      sub.innerHTML = `
        <a class="subnav-link ${currentDailySubCat === '' ? 'active' : ''}" onclick="filterDailyWear('')">All Daily Wear</a>
        <a class="subnav-link ${currentDailySubCat === 'Men' ? 'active' : ''}" onclick="filterDailyWear('Men')">👔 Men's Daily</a>
        <a class="subnav-link ${currentDailySubCat === 'Women' ? 'active' : ''}" onclick="filterDailyWear('Women')">👗 Women's Daily</a>
      `;
      container.insertAdjacentElement('afterend', sub);
    } else {
      subNav.querySelectorAll('.subnav-link').forEach((a, idx) => {
        const vals = ['', 'Men', 'Women'];
        a.className = `subnav-link ${currentDailySubCat === vals[idx] ? 'active' : ''}`;
      });
    }
  } else {
    if (subNav) subNav.remove();
  }
}

// =======================
// Dynamic Category Card Counts
// =======================
function updateCategoryCards() {
  const catalogue = liveProducts;
  const catMap = { Men: 0, Women: 0, Kids: 0, Home: 0, 'Daily Wear': 0 };

  catalogue.forEach(p => {
    if (catMap.hasOwnProperty(p.category)) catMap[p.category]++;
    // Also tally Daily Wear sub-categories
    if (p.category === 'Daily Wear - Men' || p.category === 'Daily Wear - Women') {
      catMap['Daily Wear']++;
    }
  });

  document.querySelectorAll('.cat-card').forEach(card => {
    const nameEl = card.querySelector('.cat-name');
    const countEl = card.querySelector('.cat-count');
    if (!nameEl || !countEl) return;

    const rawName = nameEl.textContent.trim().replace(/'?s$/i, '');
    const key = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    const normalised = { Men: 'Men', Women: 'Women', Kids: 'Kids', Home: 'Home', 'Daily wear': 'Daily Wear' }[key] || key;

    if (catMap.hasOwnProperty(normalised)) {
      countEl.textContent = catMap[normalised] + ' Products';
    }
  });
}

function filterCategory(category) {
  currentCategory = category;
  // Reset daily sub-cat whenever switching top-level category
  if (category !== 'Daily Wear') currentDailySubCat = '';
  renderCategories();
  if (category === 'All') {
    document.getElementById('sectionTitle').textContent = 'All Products';
  } else if (category === 'Daily Wear') {
    document.getElementById('sectionTitle').textContent = 'Daily Wear Collection';
  } else {
    document.getElementById('sectionTitle').textContent = category + ' Collection';
  }
  document.getElementById('sortSelect').value = 'default';
  renderProducts();
  scrollToProducts();
}

function filterDailyWear(subCat) {
  currentDailySubCat = subCat;
  renderCategories();
  if (subCat === '') {
    document.getElementById('sectionTitle').textContent = 'Daily Wear Collection';
  } else {
    document.getElementById('sectionTitle').textContent = subCat + "'s Daily Wear";
  }
  document.getElementById('sortSelect').value = 'default';
  renderProducts();
}

function sortProducts() {
  renderProducts();
}

function scrollToProducts() {
  document.getElementById('productsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Tracks whether the first product load has happened (for animation)
let _productsFirstLoad = true;

// =======================
// Render Products
// =======================
function renderProducts(filteredProducts = null) {
  const container = document.getElementById('products');
  const noResults = document.getElementById('noResults');
  container.innerHTML = '';

  const catalogue = liveProducts;

  let list;
  if (filteredProducts) {
    list = filteredProducts;
  } else if (currentCategory === 'All') {
    list = [...catalogue];
  } else if (currentCategory === 'Daily Wear') {
    if (currentDailySubCat === '') {
      // Show all daily wear products (both sub-cats)
      list = catalogue.filter(p => p.category === 'Daily Wear' || p.category === 'Daily Wear - Men' || p.category === 'Daily Wear - Women');
    } else {
      // Show specific sub-category
      list = catalogue.filter(p => p.category === 'Daily Wear - ' + currentDailySubCat || p.category === 'Daily Wear');
    }
  } else {
    list = catalogue.filter(p => p.category === currentCategory);
  }

  const sort = document.getElementById('sortSelect')?.value;
  if (sort === 'price-low') list.sort((a, b) => a.price - b.price);
  else if (sort === 'price-high') list.sort((a, b) => b.price - a.price);
  else if (sort === 'discount') list.sort((a, b) => { const da = a.oldPrice > 0 ? (a.oldPrice - a.price) / a.oldPrice : 0; const db2 = b.oldPrice > 0 ? (b.oldPrice - b.price) / b.oldPrice : 0; return db2 - da; });

  if (list.length === 0) {
    noResults.style.display = 'block';
    _productsFirstLoad = false;
    return;
  }
  noResults.style.display = 'none';

  const animate = _productsFirstLoad || filteredProducts !== null;
  _productsFirstLoad = false;

  list.forEach((product, i) => {
    const discount = Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100);
    const savings = product.oldPrice - product.price;
    const inCart = cart.some(item => item.id === product.id);
    const inWishlist = wishlist.some(item => item.id === product.id);
    const productIdAttr = typeof product.id === 'string' ? `'${product.id}'` : product.id;

    const card = document.createElement('div');
    card.className = 'product-card' + (animate ? ' animate-in' : '');
    if (animate) card.style.animationDelay = `${i * 0.02}s`;
    card.innerHTML = `
      <div class="product-img-wrap">
        <img src="${product.img}" alt="${product.name}" loading="lazy">
        ${!product.stock ? '<div class="out-of-stock-badge">Out of Stock</div>' : ''}
        <div class="discount-badge">${discount}% OFF</div>
        <div class="card-actions">
          <button class="card-action-btn" onclick="toggleWishlist(${productIdAttr})" title="Wishlist" id="wl-${product.id}">
            ${inWishlist ? '❤️' : '🤍'}
          </button>
        </div>
        <div class="quick-view-overlay" onclick="openQuickView(${productIdAttr})">👁 Quick View</div>
      </div>
      <div class="product-info">
        <h3>${product.name}</h3>
        <div class="price-row">
          <span class="price">₹${product.price.toLocaleString()}</span>
          <span class="old-price">₹${product.oldPrice.toLocaleString()}</span>
          <span class="savings">Save ₹${savings}</span>
        </div>
        ${(product.category === 'Men' || product.category === 'Daily Wear - Men') ? `
        <div class="size-selector" id="size-wrap-${product.id}">
          <span class="size-label">Size:</span>
          ${['S','M', 'L', 'XL', 'XXL'].map(s => `
            <button class="size-btn" data-size="${s}" onclick="selectSize(this, ${productIdAttr})">${s}</button>
          `).join('')}
        </div>` : ''}
        <button class="add-btn ${inCart ? 'in-cart' : ''} ${!product.stock ? 'disabled-btn' : ''}"
          onclick="${product.stock ? `addToCart(${productIdAttr})` : ''}"
          id="cart-btn-${product.id}"
          ${!product.stock ? 'disabled' : ''}>
          ${!product.stock ? '❌ Out of Stock' : inCart ? '✅ Added' : '🛒 Add to Cart'}
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// =======================
// Wishlist
// =======================
function updateWishlistUI() {
  updateWishlistCount();
}

function toggleWishlist(productId) {
  const catalogue = liveProducts;
  const idx = wishlist.findIndex(item => item.id === productId);
  const product = catalogue.find(p => p.id === productId);

  if (idx > -1) {
    wishlist.splice(idx, 1);
    showNotification('💔 Removed from wishlist');
  } else {
    wishlist.push(product);
    showNotification('❤️ Added to wishlist!', 'success');
  }

  updateWishlistCount();
  updateWishlistCardUI(productId);
  try { localStorage.setItem('sstWishlistIds', JSON.stringify(wishlist.map(p => p.id))); } catch {}
}

// Update only the wishlist button on the specific product card
function updateWishlistCardUI(productId) {
  const btn = document.getElementById('wl-' + productId);
  const inWL = wishlist.some(item => item.id === productId);
  if (btn) btn.textContent = inWL ? '❤️' : '🤍';
}

function updateWishlistCount() {
  const el = document.getElementById('wishlist-count');
  if (!el) return;
  el.textContent = wishlist.length;
  el.style.display = wishlist.length > 0 ? 'flex' : 'none';
  // Sync mobile bottom nav badge
  const mobWlBadge = document.getElementById('mob-wishlist-count');
  if (mobWlBadge) {
    mobWlBadge.textContent = wishlist.length;
    mobWlBadge.style.display = wishlist.length > 0 ? 'flex' : 'none';
  }
}

function toggleWishlistModal() {
  const modal = document.getElementById('wishlistModal');
  if (modal.classList.contains('open')) {
    closeModal('wishlistModal');
  } else {
    renderWishlistItems();
    openModal('wishlistModal');
  }
}

function renderWishlistItems() {
  const container = document.getElementById('wishlist-items');
  const count = document.getElementById('wishlist-modal-count');
  if (!container) return;

  count.textContent = wishlist.length;

  if (wishlist.length === 0) {
    container.innerHTML = `<div class="cart-empty"><div class="empty-icon">🤍</div><p>Your wishlist is empty</p></div>`;
    return;
  }

  container.innerHTML = '';
  wishlist.forEach(item => {
    const div = document.createElement('div');
    div.className = 'cart-item';
    const itemIdAttr = typeof item.id === 'string' ? `'${item.id}'` : item.id;
    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}">
      <div class="cart-item-info">
        <h4>${item.name}</h4>
        <p class="price">₹${item.price.toLocaleString()}</p>
      </div>
      <div class="cart-item-controls">
        <button class="add-btn" style="width:auto;padding:8px 14px;font-size:13px" onclick="addToCart(${itemIdAttr}); toggleWishlistModal()">Add to Cart</button>
        <button class="remove-btn" onclick="toggleWishlist(${itemIdAttr}); renderWishlistItems()">Remove</button>
      </div>
    `;
    container.appendChild(div);
  });
}

// =======================
// Size Selection (Men's)
// =======================
const selectedSizes = {}; // productId → selected size

function selectSize(btn, productId) {
  const wrap = document.getElementById('size-wrap-' + productId);
  if (!wrap) return;
  wrap.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedSizes[productId] = btn.dataset.size;
}

// =======================
// Cart
// =======================
function addToCart(productId) {
  const catalogue = liveProducts;
  const product = catalogue.find(p => p.id === productId);
  if (!product || !product.stock) return;

  // Require size selection for Men's products
  if ((product.category === 'Men' || product.category === 'Daily Wear - Men') && !selectedSizes[productId]) {
    showNotification('📏 Please select a size first!', 'error');
    // Highlight the size selector
    const wrap = document.getElementById('size-wrap-' + productId);
    if (wrap) { wrap.style.animation = 'none'; wrap.offsetHeight; wrap.classList.add('size-shake'); setTimeout(() => wrap.classList.remove('size-shake'), 600); }
    return;
  }

  const size = (product.category === 'Men' || product.category === 'Daily Wear - Men') ? selectedSizes[productId] : null;
  const cartKey = size ? `${productId}-${size}` : productId;
  const existing = cart.find(item => item.cartKey === cartKey);
  if (existing) {
    existing.quantity += 1;
    showNotification('🛒 Quantity updated!', 'info');
  } else {
    cart.push({ ...product, quantity: 1, size, cartKey });
    showNotification('✅ Added to cart!', 'success');
  }

  updateCartCount();
  updateProductCardUI(productId);
}

// Update a single product card's button state without re-rendering everything
function updateProductCardUI(productId) {
  const btn = document.getElementById('cart-btn-' + productId);
  const inCart = cart.some(item => item.id === productId);
  if (btn) {
    btn.textContent = inCart ? '✅ Added' : '🛒 Add to Cart';
    btn.classList.toggle('in-cart', inCart);
  }
}

function updateCartCount() {
  const total = cart.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById('cart-count').textContent = total;
  // Sync mobile bottom nav badge
  const mobBadge = document.getElementById('mob-cart-count');
  if (mobBadge) mobBadge.textContent = total;
  try { localStorage.setItem('sstCart', JSON.stringify(cart)); } catch {}
}

function openCart() {
  renderCart();
  openModal('cartModal');
}

function closeCart() { closeModal('cartModal'); }

function renderCart() {
  const container = document.getElementById('cart-items');
  const modalCount = document.getElementById('modal-cart-count');
  const subtotalEl = document.getElementById('cart-subtotal');
  const totalEl = document.getElementById('cart-total');
  const shippingEl = document.getElementById('shipping-text');

  if (!container) return;

  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  modalCount.textContent = totalQty;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty">
        <div class="empty-icon">🛒</div>
        <h3>Your cart is empty</h3>
        <p>Browse our collection and add items to your cart</p>
        <button onclick="closeCart(); scrollToProducts()" style="margin-top:12px;background:var(--blue);color:white;border:none;padding:10px 24px;border-radius:50px;font-size:14px;font-weight:600;cursor:pointer;font-family:var(--font-body)">
          Shop Now
        </button>
      </div>`;
    subtotalEl.textContent = '0';
    totalEl.textContent = '0';
    shippingEl.textContent = 'FREE';
    return;
  }

  let subtotal = 0;
  container.innerHTML = '';

  cart.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;

    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}">
      <div class="cart-item-info">
        <h4>${item.name}${item.size ? ` <span class="cart-size-tag">Size: ${item.size}</span>` : ''}</h4>
        <p>₹${item.price.toLocaleString()} each</p>
      </div>
      <div class="cart-item-controls">
        <strong>₹${itemTotal.toLocaleString()}</strong>
        <div class="qty-controls">
          <button class="qty-btn" onclick="changeQuantity(${index}, -1)">−</button>
          <span class="qty-num">${item.quantity}</span>
          <button class="qty-btn" onclick="changeQuantity(${index}, 1)">+</button>
        </div>
        <button class="remove-btn" onclick="removeFromCart(${index})">🗑 Remove</button>
      </div>
    `;
    container.appendChild(div);
  });

  const shipping = subtotal >= 999 ? 0 : 49;
  const total = subtotal + shipping;

  subtotalEl.textContent = subtotal.toLocaleString();
  shippingEl.textContent = shipping === 0 ? '🎉 FREE' : '₹' + shipping;
  totalEl.textContent = total.toLocaleString();
}

function changeQuantity(index, change) {
  cart[index].quantity += change;
  if (cart[index].quantity < 1) cart[index].quantity = 1;
  renderCart();
  updateCartCount();
}

function removeFromCart(index) {
  const removed = cart[index];
  cart.splice(index, 1);
  renderCart();
  updateCartCount();
  // Update just the removed item's button
  if (removed) updateProductCardUI(removed.id);
}

function checkout() {
  if (cart.length === 0) { showNotification('⚠️ Your cart is empty!', 'error'); return; }

  // Require login to place an order
  const user = firebaseAuth ? firebaseAuth.getCurrentUser() : null;
  if (!user) {
    closeCart();
    showNotification('🔒 Please sign in to place an order!', 'error');
    setTimeout(() => {
      openModal('authModal');
      switchToLogin();
    }, 400);
    return;
  }
  closeCart();

  buildOrderSummaryMini();
  openModal('checkoutModal');
}

function buildOrderSummaryMini() {
  const el = document.getElementById('orderSummaryMini');
  if (!el) return;
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = subtotal >= 999 ? 0 : 49;
  el.innerHTML = `
    <h4>Order Summary</h4>
    ${cart.map(item => `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span>${item.name} × ${item.quantity}</span>
      <span>₹${(item.price * item.quantity).toLocaleString()}</span>
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:8px;font-weight:700">
      <span>Total</span><span>₹${(subtotal + shipping).toLocaleString()}</span>
    </div>
  `;
}

function closeCheckout() { closeModal('checkoutModal'); }

function placeOrder() {
  const name    = document.getElementById('co-name')?.value.trim();
  const phone   = document.getElementById('co-phone')?.value.trim();
  const address = document.getElementById('co-address')?.value.trim();
  const city    = document.getElementById('co-city')?.value.trim();
  const pin     = document.getElementById('co-pin')?.value.trim();

  if (!name || !phone || !address || !city || !pin) {
    showNotification('⚠️ Please fill all required fields!', 'error'); return;
  }
  if (phone.replace(/\D/g, '').length < 10) {
    showNotification('⚠️ Please enter a valid phone number!', 'error'); return;
  }
  if (!/^\d{6}$/.test(pin)) {
    showNotification('⚠️ Please enter a valid 6-digit pincode!', 'error'); return;
  }

  const subtotal    = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping    = subtotal >= 999 ? 0 : 49;
  const total       = subtotal + shipping;
  const isUPI       = document.querySelector('input[name=payment]:checked').value === 'upi';
  const paymentMode = isUPI ? 'UPI / Online Payment' : 'Cash on Delivery';
  const orderId     = "SST" + Date.now().toString().slice(-6);
  const itemsList   = cart.map(i => `${i.name}${i.size ? ` (${i.size})` : ''} x${i.quantity} — ₹${(i.price * i.quantity).toLocaleString()}`).join("\n");

  const currentUser = firebaseAuth ? firebaseAuth.getCurrentUser() : null;

  const orderData = {
    orderId,
    userId: currentUser?.email || "guest",
    name,
    phone,
    address,
    city,
    pin,
    paymentMode,
    items: cart.map(i => ({ name: i.name, quantity: i.quantity, price: i.price, ...(i.size ? { size: i.size } : {}) })),
    total,
    status: "Pending",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  // ── Save to Firestore ──
  db.collection("orders").doc(orderId).set(orderData)
    .then(() => console.log("✅ Order saved to Firestore"))
    .catch(err => console.error("Firestore error:", err));

  // ── Send Email to Owner ──
  emailjs.send("service_yj14i3n", "template_ec2y5gj", {
    order_id:         orderId,
    customer_name:    name,
    customer_phone:   phone,
    customer_address: address,
    customer_city:    city,
    customer_pin:     pin,
    payment_mode:     paymentMode,
    order_items:      itemsList,
    order_total:      total.toLocaleString()
  }).then(() => console.log("✅ Email sent"))
    .catch(err => console.error("EmailJS error:", err));

  // ── Clear cart ──
  closeCheckout();
  cart = [];
  updateCartCount();
  // Reset all add-to-cart buttons since cart is now empty
  document.querySelectorAll('.add-btn.in-cart').forEach(btn => {
    btn.textContent = '🛒 Add to Cart';
    btn.classList.remove('in-cart');
  });

  // ── UPI: redirect to payment page ──
  if (isUPI) {
    const payParams = new URLSearchParams({
      orderId,
      total,
      name,
      phone,
      address,
      city,
      pin,
      items: encodeURIComponent(JSON.stringify(
        orderData.items
      ))
    });
    window.location.href = `payment.html?${payParams.toString()}`;
    return; // skip the success overlay below
  }

  const msg = document.createElement('div');
  msg.id = 'orderSuccessOverlay';
  msg.style.cssText = `
    position:fixed; inset:0; background:rgba(15,23,42,0.85); z-index:9999;
    display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);
  `;
  const isDark = document.body.classList.contains('dark-mode');
  const cardBg  = isDark ? '#141e2e' : '#ffffff';
  const textCol = isDark ? '#f1f5f9' : '#0f172a';
  const mutedCol = isDark ? '#94a3b8' : '#64748b';

  msg.innerHTML = `
    <div style="background:${cardBg}; border-radius:24px; padding:48px 40px; text-align:center; max-width:440px; width:90%; border:1px solid ${isDark ? '#1e293b' : '#e2e8f0'}; box-shadow:0 24px 60px rgba(0,0,0,0.35);">
      <div style="font-size:72px; margin-bottom:8px; animation: bounceIn 0.6s ease;">🎉</div>
      <h2 style="font-family:'Playfair Display',serif; font-size:28px; color:${textCol}; margin-bottom:6px;">Order Placed!</h2>
      <p style="color:${mutedCol}; margin-bottom:16px; font-size:15px;">Thank you, <strong style="color:${textCol}">${name}</strong>! We've received your order.</p>
      <div style="background:${isDark ? '#1a2540' : '#eff6ff'}; color:#1d4ed8; padding:12px 16px; border-radius:12px; font-weight:700; margin-bottom:10px; font-size:15px; letter-spacing:0.03em;">
        🧾 Order ID: ${orderId}
      </div>
      <div style="background:${isDark ? '#0d2a1a' : '#f0fdf4'}; color:#16a34a; padding:12px 16px; border-radius:12px; font-weight:600; margin-bottom:8px;">
        💰 ₹${total.toLocaleString()} &nbsp;|&nbsp; ${paymentMode}
      </div>
      <p style="font-size:13px; color:${mutedCol}; margin:12px 0 24px;">We'll contact you on <strong style="color:${textCol}">${phone}</strong> to confirm delivery.</p>
      <button onclick="document.getElementById('orderSuccessOverlay').remove(); document.body.style.overflow='';" style="background:linear-gradient(135deg,#1d4ed8,#1e3a8a); color:white; border:none; padding:14px 36px; border-radius:50px; font-size:16px; font-weight:700; cursor:pointer; font-family:'DM Sans',sans-serif; box-shadow:0 6px 20px rgba(29,78,216,0.4);">
        Continue Shopping →
      </button>
    </div>
  `;
  document.body.appendChild(msg);
}

// =======================
// Quick View (with image gallery)
// =======================
function openQuickView(productId) {
  const catalogue = liveProducts;
  const product = catalogue.find(p => p.id === productId);
  if (!product) return;
  const discount = Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100);
  const inWL = wishlist.some(item => item.id === product.id);

  // Build images array — use imgs[] if available, else just the main img
  const images = (product.imgs && product.imgs.length > 0) ? product.imgs : [product.img];

  const thumbnails = images.map((src, idx) => `
    <img src="${src}" alt="${product.name} view ${idx + 1}"
      class="qv-thumb ${idx === 0 ? 'active' : ''}"
      onclick="qvSwitchImage(this, '${src}')"
    >
  `).join('');

  document.getElementById('quickViewContent').innerHTML = `
    <div class="qv-inner">
      <div class="qv-gallery">
        <img src="${images[0]}" alt="${product.name}" class="qv-img" id="qvMainImg">
        ${images.length > 1 ? `<div class="qv-thumbs">${thumbnails}</div>` : ''}
      </div>
      <div class="qv-info">
        <span class="qv-tag">${product.category}</span>
        <h3>${product.name}</h3>
        <div class="qv-prices">
          <span class="price">₹${product.price.toLocaleString()}</span>
          <span class="old-price">₹${product.oldPrice.toLocaleString()}</span>
        </div>
        <p style="color:var(--red);font-weight:600;font-size:14px">🔖 ${discount}% OFF — Save ₹${(product.oldPrice - product.price).toLocaleString()}</p>
        <p style="color:var(--muted);font-size:13px;line-height:1.6">High quality ${product.category.includes('Daily Wear') ? 'daily wear' : product.category.toLowerCase() + "'s"} textile from Sri Satya Sai's premium collection.</p>
        ${(product.category === 'Men' || product.category === 'Daily Wear - Men') ? `
        <div class="size-selector" id="size-wrap-qv-${product.id}" style="margin-bottom:12px">
          <span class="size-label">Size:</span>
          ${['S','M','L','XL','XXL'].map(s => `
            <button class="size-btn ${selectedSizes[product.id] === s ? 'active' : ''}" data-size="${s}" onclick="selectSizeQV(this, ${product.id})">${s}</button>
          `).join('')}
        </div>` : ''}
        ${product.stock
          ? `<button class="btn-full" onclick="addToCartFromQV(${product.id})">🛒 Add to Cart</button>`
          : `<button class="btn-full" disabled style="opacity:0.5;cursor:not-allowed">❌ Out of Stock</button>`
        }
        <button class="btn-full" style="background:none;border:2px solid var(--border);color:var(--mid);margin-top:8px" onclick="toggleWishlist(${product.id}); closeQuickView()">
          ${inWL ? '❤️ Remove from Wishlist' : '🤍 Add to Wishlist'}
        </button>
      </div>
    </div>
  `;
  openModal('quickViewModal');
}

function qvSwitchImage(thumbEl, src) {
  document.getElementById('qvMainImg').src = src;
  document.querySelectorAll('.qv-thumb').forEach(t => t.classList.remove('active'));
  thumbEl.classList.add('active');
}

function selectSizeQV(btn, productId) {
  const wrap = document.getElementById('size-wrap-qv-' + productId);
  if (!wrap) return;
  wrap.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedSizes[productId] = btn.dataset.size;
}

function addToCartFromQV(productId) {
  addToCart(productId);
  closeQuickView();
}

function closeQuickView() { closeModal('quickViewModal'); }

// =======================
// Search
// =======================
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');

  if (searchInput) {
    let searchTimer = null;
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      searchClear.style.display = term ? 'block' : 'none';

      // Debounce — wait 280ms after user stops typing
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (!term) { renderProducts(); return; }
        const catalogue = liveProducts;
        const filtered = catalogue.filter(p =>
          p.name.toLowerCase().includes(term) ||
          p.category.toLowerCase().includes(term) ||
          (p.tags && p.tags.some && p.tags.some(t => t.toLowerCase().includes(term)))
        );
        document.getElementById('sectionTitle').textContent = `Search results for "${e.target.value}"`;
        renderProducts(filtered);
        // Only scroll if user is above the products section
        const section = document.getElementById('productsSection');
        if (section) {
          const rect = section.getBoundingClientRect();
          if (rect.top > window.innerHeight) section.scrollIntoView({ behavior: 'smooth' });
        }
      }, 280);
    });

    // Allow pressing Enter to also trigger search immediately
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') clearSearch();
    });
  }

  // Initialize everything — load products from Firestore
  renderCategories();
  loadLiveProducts();
  updateCartCount();
  updateUserUI();
  initHeroSlider();
});

// =======================
// Search Clear
// =======================
function clearSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  document.getElementById('sectionTitle').textContent =
    currentCategory === 'All' ? 'All Products' : currentCategory + ' Collection';
  renderProducts();
}

// =======================
// Modal Helpers
// =======================
let _openModalCount = 0;

function openModal(id) {
  const el = document.getElementById(id);
  if (el && !el.classList.contains('open')) {
    el.classList.add('open');
    el.style.display = 'flex';
    _openModalCount++;
  }
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el && el.classList.contains('open')) {
    el.classList.remove('open');
    el.style.display = 'none';
    _openModalCount = Math.max(0, _openModalCount - 1);
  }
  if (_openModalCount === 0) document.body.style.overflow = '';
}

function handleOverlayClick(e, modalId, closeFn) {
  if (e.target === document.getElementById(modalId)) closeFn();
}

// =======================
// Notifications
// =======================
let _notifStack = 0; // track how many are showing for vertical stacking

function showNotification(message, type = 'default') {
  _notifStack++;
  const notif = document.createElement('div');
  notif.className = `notification ${type}`;
  notif.textContent = message;
  // Stack vertically if multiple notifications at once
  notif.style.bottom = (24 + (_notifStack - 1) * 60) + 'px';
  document.body.appendChild(notif);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    notif.style.opacity = '0';
    notif.style.transform = 'translateX(100%)';
    notif.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => { notif.remove(); _notifStack = Math.max(0, _notifStack - 1); }, 300);
  };

  // Dismiss on click
  notif.addEventListener('click', dismiss);

  setTimeout(dismiss, 3000);
}

// =======================
// Sticky Header
// =======================
window.addEventListener('scroll', () => {
  const header = document.getElementById('mainHeader');
  if (header) {
    if (window.scrollY > 10) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }
}, { passive: true });
// =======================
// Keyboard Accessibility
// =======================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close any open modal on Escape
    ['cartModal', 'authModal', 'wishlistModal', 'quickViewModal', 'ordersModal', 'checkoutModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) closeModal(id);
    });
    // Close profile dropdown
    document.getElementById('profileDropdown')?.remove();
  }
});
