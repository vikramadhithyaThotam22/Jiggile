// ============================================================
// JIGGILE — Customer Web App JavaScript
// SPA Router, API Client, OTP Auth, Cart, Orders, Tracking
// Brand: Jiggile by Adwithya
// ============================================================

const API_BASE = window.location.origin + '/api';

// ============================================================
// STATE
// ============================================================
const state = {
    user: null,
    token: null,
    refreshToken: null,
    cart: [],        // [{ product, quantity }]
    products: [],
    categories: [],
    currentCategory: 'all',
    searchQuery: '',
    trackingInterval: null,
    countdownInterval: null
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Load auth state from localStorage
    const savedToken = localStorage.getItem('jiggile_token');
    const savedUser = localStorage.getItem('jiggile_user');
    const savedCart = localStorage.getItem('jiggile_cart');

    if (savedToken && savedUser) {
        state.token = savedToken;
        state.refreshToken = localStorage.getItem('jiggile_refresh');
        state.user = JSON.parse(savedUser);
    }

    if (savedCart) {
        try { state.cart = JSON.parse(savedCart); } catch(e) {}
    }

    // Setup OTP input auto-advance
    setupOTPInputs();

    // Hide splash after animation
    setTimeout(() => {
        document.getElementById('splash-screen').style.display = 'none';
        if (state.token) {
            showApp();
        } else {
            showAuthModal();
        }
    }, 2500);
});

// ============================================================
// API CLIENT (with JWT interceptor)
// ============================================================
async function api(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
        const response = await fetch(url, { ...options, headers });

        // Handle token expiry - try refresh
        if (response.status === 401 && state.refreshToken) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${state.token}`;
                return fetch(url, { ...options, headers }).then(r => r.json());
            } else {
                logout();
                return { success: false, message: 'Session expired.' };
            }
        }

        return response.json();
    } catch (err) {
        console.error('API Error:', err);
        return { success: false, message: 'Network error. Is the server running?' };
    }
}

async function refreshAccessToken() {
    try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: state.refreshToken })
        });
        const data = await res.json();
        if (data.success) {
            state.token = data.data.accessToken;
            state.refreshToken = data.data.refreshToken;
            localStorage.setItem('jiggile_token', state.token);
            localStorage.setItem('jiggile_refresh', state.refreshToken);
            return true;
        }
    } catch (e) {}
    return false;
}

// ============================================================
// AUTH: OTP FLOW
// ============================================================
function showAuthModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showPhoneStep() {
    document.getElementById('otp-step-phone').classList.remove('hidden');
    document.getElementById('otp-step-verify').classList.add('hidden');
    document.getElementById('auth-error').classList.add('hidden');
}

async function sendOTP() {
    const phone = document.getElementById('phone-input').value.trim();
    if (!/^[6-9]\d{9}$/.test(phone)) {
        showAuthError('Please enter a valid 10-digit mobile number.');
        return;
    }

    toggleBtnLoading('send-otp-btn', true);
    const res = await api('/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ mobile: phone })
    });
    toggleBtnLoading('send-otp-btn', false);

    if (res.success) {
        document.getElementById('otp-phone-display').textContent = '+91 ' + phone;
        document.getElementById('otp-step-phone').classList.add('hidden');
        document.getElementById('otp-step-verify').classList.remove('hidden');
        document.getElementById('auth-error').classList.add('hidden');

        // Auto-fill OTP in dev mode
        if (res.otp) {
            const digits = document.querySelectorAll('.otp-digit');
            res.otp.split('').forEach((d, i) => { if(digits[i]) digits[i].value = d; });
            toast('Dev OTP: ' + res.otp, 'info');
        }

        // Focus first OTP input
        document.querySelector('.otp-digit').focus();
    } else {
        showAuthError(res.message);
    }
}

async function verifyOTP() {
    const phone = document.getElementById('phone-input').value.trim();
    const otpDigits = document.querySelectorAll('.otp-digit');
    const otp = Array.from(otpDigits).map(d => d.value).join('');

    if (otp.length !== 6) {
        showAuthError('Please enter all 6 digits.');
        return;
    }

    toggleBtnLoading('verify-otp-btn', true);
    const res = await api('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ mobile: phone, otp })
    });
    toggleBtnLoading('verify-otp-btn', false);

    if (res.success) {
        state.user = res.data.user;
        state.token = res.data.accessToken;
        state.refreshToken = res.data.refreshToken;

        localStorage.setItem('jiggile_token', state.token);
        localStorage.setItem('jiggile_refresh', state.refreshToken);
        localStorage.setItem('jiggile_user', JSON.stringify(state.user));

        document.getElementById('auth-modal').classList.add('hidden');
        showApp();
        toast('Welcome to Jiggile! 🛒', 'success');
    } else {
        showAuthError(res.message);
    }
}

function setupOTPInputs() {
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if (e.target.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            paste.split('').forEach((d, i) => { if(inputs[i]) inputs[i].value = d; });
            if (paste.length === 6) inputs[5].focus();
        });
    });
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

function logout() {
    state.user = null;
    state.token = null;
    state.refreshToken = null;
    state.cart = [];
    localStorage.removeItem('jiggile_token');
    localStorage.removeItem('jiggile_refresh');
    localStorage.removeItem('jiggile_user');
    localStorage.removeItem('jiggile_cart');
    showAuthModal();
    toast('Logged out.', 'info');
}

// ============================================================
// MAIN APP
// ============================================================
async function showApp() {
    document.getElementById('app').classList.remove('hidden');
    
    // Show user info
    if (state.user) {
        document.getElementById('user-name-display').textContent = 
            state.user.name || 'Account';
        if (state.user.default_address) {
            document.getElementById('user-address').textContent = state.user.default_address;
        }
    }

    updateCartUI();
    await Promise.all([loadCategories(), loadProducts()]);
}

// ============================================================
// CATEGORIES
// ============================================================
async function loadCategories() {
    const res = await api('/categories');
    if (res.success) {
        state.categories = res.data;
        renderCategories();
    }
}

function renderCategories() {
    const bar = document.getElementById('category-bar');
    const pills = state.categories.map(c => 
        `<button class="cat-pill" data-cat="${c.id}" onclick="filterCategory(${c.id}, this)">${c.name}</button>`
    ).join('');
    bar.innerHTML = `<button class="cat-pill active" data-cat="all" onclick="filterCategory('all', this)">All</button>` + pills;
}

function filterCategory(catId, btn) {
    state.currentCategory = catId;
    document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    loadProducts();
}

// ============================================================
// PRODUCTS
// ============================================================
async function loadProducts() {
    const loading = document.getElementById('products-loading');
    const grid = document.getElementById('products-grid');
    const empty = document.getElementById('products-empty');

    loading.classList.remove('hidden');
    grid.innerHTML = '';
    empty.classList.add('hidden');

    let endpoint = '/products?limit=100';
    if (state.currentCategory !== 'all') {
        endpoint += `&category_id=${state.currentCategory}`;
    }
    if (state.searchQuery) {
        endpoint += `&search=${encodeURIComponent(state.searchQuery)}`;
    }

    const res = await api(endpoint);
    loading.classList.add('hidden');

    if (res.success && res.data.length > 0) {
        state.products = res.data;
        renderProducts();
    } else {
        empty.classList.remove('hidden');
    }
}

function renderProducts() {
    const grid = document.getElementById('products-grid');
    
    grid.innerHTML = state.products.map((p, i) => {
        const cartItem = state.cart.find(c => c.product.id === p.id);
        const qty = cartItem ? cartItem.quantity : 0;
        const emoji = getCategoryEmoji(p.category_name);
        
        let stockBadge = '';
        if (p.is_out_of_stock) {
            stockBadge = '<span class="stock-badge oos">Out of Stock</span>';
        } else if (p.is_low_stock) {
            stockBadge = '<span class="stock-badge low">Few Left</span>';
        }

        return `
            <div class="product-card ${p.is_out_of_stock ? 'out-of-stock' : ''}" 
                 style="animation-delay: ${i * 0.05}s" data-product-id="${p.id}">
                <div class="product-img">
                    ${emoji}
                    ${stockBadge}
                </div>
                <div class="product-info">
                    <div class="product-name">${p.name}</div>
                    <div class="product-unit">${p.unit}</div>
                    <div class="product-bottom">
                        <div class="product-price">
                            <span class="currency">₹</span>${p.selling_price}
                        </div>
                        ${!p.is_out_of_stock ? (qty === 0 
                            ? `<button class="add-btn" onclick="addToCart(${p.id})">ADD</button>`
                            : `<div class="qty-controls">
                                <button class="qty-btn" onclick="updateQty(${p.id}, -1)">−</button>
                                <span class="qty-value">${qty}</span>
                                <button class="qty-btn" onclick="updateQty(${p.id}, 1)">+</button>
                               </div>`) 
                            : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getCategoryEmoji(catName) {
    const map = {
        'Fruits & Vegetables': '🥬',
        'Dairy & Eggs': '🥛',
        'Snacks & Beverages': '🍿',
        'Staples & Grains': '🌾',
        'Personal Care': '🧴',
        'Cleaning & Household': '🧹'
    };
    return map[catName] || '📦';
}

// ============================================================
// SEARCH
// ============================================================
let searchTimeout;
function debounceSearch(value) {
    clearTimeout(searchTimeout);
    const clearBtn = document.getElementById('search-clear');
    clearBtn.classList.toggle('hidden', !value);
    
    searchTimeout = setTimeout(() => {
        state.searchQuery = value;
        loadProducts();
    }, 400);
}

function clearSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear').classList.add('hidden');
    state.searchQuery = '';
    loadProducts();
}

// ============================================================
// CART
// ============================================================
function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const existing = state.cart.find(c => c.product.id === productId);
    if (existing) {
        existing.quantity++;
    } else {
        state.cart.push({ product, quantity: 1 });
    }

    saveCart();
    updateCartUI();
    renderProducts(); // Re-render to show qty controls
    toast(`${product.name} added to cart`, 'success');
}

function updateQty(productId, delta) {
    const item = state.cart.find(c => c.product.id === productId);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        state.cart = state.cart.filter(c => c.product.id !== productId);
    }

    saveCart();
    updateCartUI();
    renderProducts();
}

function removeFromCart(productId) {
    state.cart = state.cart.filter(c => c.product.id !== productId);
    saveCart();
    updateCartUI();
    renderProducts();
    renderCartItems();
}

function saveCart() {
    localStorage.setItem('jiggile_cart', JSON.stringify(state.cart));
}

function getCartTotal() {
    return state.cart.reduce((sum, item) => sum + (item.product.selling_price * item.quantity), 0);
}

function getCartCount() {
    return state.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function updateCartUI() {
    const bar = document.getElementById('cart-bar');
    const count = getCartCount();
    const total = getCartTotal();

    if (count > 0) {
        bar.classList.remove('hidden');
        document.getElementById('cart-count').textContent = count;
        document.getElementById('cart-total').textContent = '₹' + total.toFixed(0);
    } else {
        bar.classList.add('hidden');
    }
}

function openCart() {
    document.getElementById('cart-overlay').classList.remove('hidden');
    document.getElementById('cart-drawer').classList.remove('hidden');
    renderCartItems();
    
    // Pre-fill address
    const addr = document.getElementById('checkout-address');
    if (state.user && state.user.default_address) {
        addr.value = state.user.default_address;
    }
}

function closeCart() {
    document.getElementById('cart-overlay').classList.add('hidden');
    document.getElementById('cart-drawer').classList.add('hidden');
}

function renderCartItems() {
    const container = document.getElementById('cart-items');
    const total = getCartTotal();

    if (state.cart.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">🛒</span>
                <h3>Your cart is empty</h3>
                <p>Add some items to get started</p>
            </div>`;
        document.getElementById('cart-subtotal').textContent = '₹0';
        document.getElementById('cart-total-final').textContent = '₹0';
        return;
    }

    container.innerHTML = state.cart.map(item => {
        const emoji = getCategoryEmoji(item.product.category_name);
        return `
            <div class="cart-item">
                <div class="cart-item-img">${emoji}</div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.product.name}</div>
                    <div class="cart-item-price">₹${item.product.selling_price} × ${item.quantity}</div>
                </div>
                <div class="cart-item-controls">
                    <div class="qty-controls">
                        <button class="qty-btn" onclick="updateQty(${item.product.id}, -1); renderCartItems();">−</button>
                        <span class="qty-value">${item.quantity}</span>
                        <button class="qty-btn" onclick="updateQty(${item.product.id}, 1); renderCartItems();">+</button>
                    </div>
                </div>
                <div class="cart-item-total">₹${(item.product.selling_price * item.quantity).toFixed(0)}</div>
            </div>
        `;
    }).join('');

    document.getElementById('cart-subtotal').textContent = '₹' + total.toFixed(0);
    document.getElementById('cart-total-final').textContent = '₹' + total.toFixed(0);
}

// ============================================================
// PLACE ORDER
// ============================================================
async function placeOrder() {
    if (state.cart.length === 0) {
        toast('Your cart is empty!', 'error');
        return;
    }

    const address = document.getElementById('checkout-address').value.trim();
    if (!address) {
        toast('Please enter a delivery address.', 'error');
        return;
    }

    toggleBtnLoading('checkout-btn', true);

    const res = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
            items: state.cart.map(c => ({
                product_id: c.product.id,
                quantity: c.quantity
            })),
            delivery_address: address
        })
    });

    toggleBtnLoading('checkout-btn', false);

    if (res.success) {
        const orderId = res.data.order_id;
        toast(`Order placed! #${res.data.order_number}`, 'success');

        // Auto-simulate payment in dev mode
        setTimeout(async () => {
            const payRes = await api(`/payments/simulate/${orderId}`, { method: 'POST' });
            if (payRes.success) {
                toast('Payment confirmed! Order auto-approved ✅', 'success');
            }
        }, 1000);

        // Clear cart
        state.cart = [];
        saveCart();
        updateCartUI();
        closeCart();

        // Show tracking after a brief delay
        setTimeout(() => showTracking(orderId), 2000);
    } else {
        toast(res.message || 'Order failed.', 'error');
    }
}

// ============================================================
// ORDERS
// ============================================================
function showOrders() {
    document.getElementById('orders-view').classList.remove('hidden');
    loadOrders();
}

function hideOrders() {
    document.getElementById('orders-view').classList.add('hidden');
}

async function loadOrders() {
    const container = document.getElementById('orders-list');
    container.innerHTML = '<div class="loading-state"><div class="skeleton-card" style="height:80px;margin-bottom:12px"></div><div class="skeleton-card" style="height:80px;margin-bottom:12px"></div></div>';

    const res = await api('/orders/my');
    if (res.success && res.data.length > 0) {
        container.innerHTML = res.data.map(o => `
            <div class="order-card" onclick="showTracking(${o.id})">
                <div class="order-card-top">
                    <span class="order-number">${o.order_number}</span>
                    <span class="order-status ${o.status}">${formatStatus(o.status)}</span>
                </div>
                <div class="order-card-bottom">
                    <span>${o.item_count} items • ${formatDate(o.created_at)}</span>
                    <span class="order-total">₹${o.total_amount}</span>
                </div>
            </div>
        `).join('');
    } else {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📦</span>
                <h3>No orders yet</h3>
                <p>Place your first order!</p>
            </div>`;
    }
}

function formatStatus(status) {
    const map = {
        'Pending': 'Pending',
        'Approved': 'Confirmed',
        'SentToWarehouse': 'Processing',
        'Packing': 'Packing',
        'OutForDelivery': 'On the way',
        'Delivered': 'Delivered',
        'Cancelled': 'Cancelled'
    };
    return map[status] || status;
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// ORDER TRACKING
// ============================================================
async function showTracking(orderId) {
    document.getElementById('tracking-view').classList.remove('hidden');
    document.getElementById('orders-view').classList.add('hidden');

    await loadTracking(orderId);

    // Poll for updates every 5 seconds
    clearInterval(state.trackingInterval);
    state.trackingInterval = setInterval(() => loadTracking(orderId), 5000);
}

function hideTracking() {
    document.getElementById('tracking-view').classList.add('hidden');
    clearInterval(state.trackingInterval);
    clearInterval(state.countdownInterval);
}

async function loadTracking(orderId) {
    const res = await api(`/tracking/${orderId}`);
    if (!res.success) return;

    const data = res.data;

    // Update countdown
    updateCountdown(data.remaining_seconds, data.status);

    // Update status timeline
    updateTimeline(data.status);

    // Update order info
    document.getElementById('tracking-order-info').innerHTML = `
        <p><strong>Order:</strong> ${data.order_number}</p>
        <p><strong>Status:</strong> ${formatStatus(data.status)}</p>
        <p><strong>Delivery:</strong> ${data.delivery_address}</p>
        ${data.rider_name ? `<p><strong>Rider:</strong> ${data.rider_name} (${data.rider_phone})</p>` : ''}
    `;

    // Update map if GPS data available
    if (data.rider_lat && data.rider_lng) {
        updateMap(data.rider_lat, data.rider_lng, data.delivery_lat, data.delivery_lng);
    }

    // Stop polling if delivered
    if (data.status === 'Delivered' || data.status === 'Cancelled') {
        clearInterval(state.trackingInterval);
        clearInterval(state.countdownInterval);
    }
}

function updateCountdown(remainingSeconds, status) {
    if (status === 'Delivered') {
        document.getElementById('countdown-min').textContent = '✓';
        document.getElementById('countdown-sec').textContent = '';
        document.querySelector('.countdown-label').textContent = '';
        document.getElementById('countdown-msg').textContent = 'Delivered!';
        document.getElementById('countdown-circle').style.strokeDashoffset = 0;
        return;
    }

    if (remainingSeconds === null || remainingSeconds === undefined) {
        return;
    }

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    document.getElementById('countdown-min').textContent = String(minutes).padStart(2, '0');
    document.getElementById('countdown-sec').textContent = String(seconds).padStart(2, '0');

    // Update circle progress (339.292 is full circumference)
    const totalSeconds = 10 * 60; // 10 minutes
    const progress = (1 - remainingSeconds / totalSeconds) * 339.292;
    document.getElementById('countdown-circle').style.strokeDashoffset = progress;

    // Countdown animation
    clearInterval(state.countdownInterval);
    let currentRemaining = remainingSeconds;
    state.countdownInterval = setInterval(() => {
        currentRemaining--;
        if (currentRemaining < 0) {
            clearInterval(state.countdownInterval);
            return;
        }
        const m = Math.floor(currentRemaining / 60);
        const s = currentRemaining % 60;
        document.getElementById('countdown-min').textContent = String(m).padStart(2, '0');
        document.getElementById('countdown-sec').textContent = String(s).padStart(2, '0');
        const prog = (1 - currentRemaining / totalSeconds) * 339.292;
        document.getElementById('countdown-circle').style.strokeDashoffset = prog;
    }, 1000);
}

function updateTimeline(currentStatus) {
    const statuses = ['Approved', 'SentToWarehouse', 'Packing', 'OutForDelivery', 'Delivered'];
    const currentIndex = statuses.indexOf(currentStatus);

    document.querySelectorAll('.status-step').forEach(step => {
        const stepStatus = step.getAttribute('data-status');
        const stepIndex = statuses.indexOf(stepStatus);

        step.classList.remove('active', 'completed');
        if (stepIndex < currentIndex) {
            step.classList.add('completed');
        } else if (stepIndex === currentIndex) {
            step.classList.add('active');
        }
    });
}

// ============================================================
// GPS MAP (Leaflet + OpenStreetMap)
// ============================================================
let map = null;
let riderMarker = null;
let destMarker = null;

function updateMap(riderLat, riderLng, destLat, destLng) {
    const mapEl = document.getElementById('tracking-map');

    if (!map) {
        map = L.map(mapEl).setView([riderLat, riderLng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);
    }

    // Rider marker
    if (riderMarker) {
        riderMarker.setLatLng([riderLat, riderLng]);
    } else {
        riderMarker = L.marker([riderLat, riderLng], {
            title: 'Rider'
        }).addTo(map).bindPopup('🏍️ Your rider');
    }

    // Destination marker
    if (destLat && destLng) {
        if (destMarker) {
            destMarker.setLatLng([destLat, destLng]);
        } else {
            destMarker = L.marker([destLat, destLng], {
                title: 'Delivery'
            }).addTo(map).bindPopup('📍 Delivery location');
        }

        map.fitBounds([[riderLat, riderLng], [destLat, destLng]], { padding: [50, 50] });
    } else {
        map.setView([riderLat, riderLng], 15);
    }
}

// ============================================================
// PROFILE
// ============================================================
function showProfile() {
    document.getElementById('profile-view').classList.remove('hidden');
    if (state.user) {
        document.getElementById('profile-name').value = state.user.name || '';
        document.getElementById('profile-email').value = state.user.email || '';
        document.getElementById('profile-address').value = state.user.default_address || '';
    }
}

function hideProfile() {
    document.getElementById('profile-view').classList.add('hidden');
}

async function updateProfile() {
    const name = document.getElementById('profile-name').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    const address = document.getElementById('profile-address').value.trim();

    const res = await api('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, email, default_address: address })
    });

    if (res.success) {
        state.user.name = name;
        state.user.email = email;
        state.user.default_address = address;
        localStorage.setItem('jiggile_user', JSON.stringify(state.user));
        
        document.getElementById('user-name-display').textContent = name || 'Account';
        if (address) document.getElementById('user-address').textContent = address;
        
        toast('Profile updated!', 'success');
    } else {
        toast(res.message || 'Update failed.', 'error');
    }
}

// ============================================================
// ADDRESS PROMPT
// ============================================================
function promptAddress() {
    const addr = prompt('Enter your delivery address:');
    if (addr) {
        document.getElementById('user-address').textContent = addr;
        if (state.user) {
            state.user.default_address = addr;
            localStorage.setItem('jiggile_user', JSON.stringify(state.user));
        }
    }
}

// ============================================================
// UTILITY: Toast Notifications
// ============================================================
function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
    container.appendChild(el);

    setTimeout(() => el.remove(), 3000);
}

// ============================================================
// UTILITY: Button loading state
// ============================================================
function toggleBtnLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    
    if (loading) {
        text.classList.add('hidden');
        loader.classList.remove('hidden');
        btn.disabled = true;
    } else {
        text.classList.remove('hidden');
        loader.classList.add('hidden');
        btn.disabled = false;
    }
}
