// ============================================================
// JIGGILE — Admin Dashboard JavaScript
// Auth, Dashboard KPIs, Charts, Orders, Stock Alerts
// Brand: Jiggile by Adwithya
// ============================================================

const API_BASE = window.location.origin + '/api';

const state = {
    user: null,
    token: null,
    refreshToken: null,
    currentPage: 'overview',
    monthlyChart: null,
    ordersChart: null,
    ordersFilter: 'all'
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const savedToken = localStorage.getItem('jiggile_admin_token');
    const savedUser = localStorage.getItem('jiggile_admin_user');

    if (savedToken && savedUser) {
        state.token = savedToken;
        state.refreshToken = localStorage.getItem('jiggile_admin_refresh');
        state.user = JSON.parse(savedUser);
        showDashboard();
    }

    setupOTPInputs();
    document.getElementById('header-date').textContent = 
        new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
});

// ============================================================
// API CLIENT
// ============================================================
async function api(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

    try {
        const response = await fetch(url, { ...options, headers });
        if (response.status === 401 && state.refreshToken) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${state.token}`;
                return fetch(url, { ...options, headers }).then(r => r.json());
            }
            logout();
            return { success: false };
        }
        return response.json();
    } catch (err) {
        console.error('API Error:', err);
        return { success: false, message: 'Network error.' };
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
            localStorage.setItem('jiggile_admin_token', state.token);
            localStorage.setItem('jiggile_admin_refresh', state.refreshToken);
            return true;
        }
    } catch (e) {}
    return false;
}

// ============================================================
// AUTH
// ============================================================
function showPhoneStep() {
    document.getElementById('otp-step-phone').classList.remove('hidden');
    document.getElementById('otp-step-verify').classList.add('hidden');
    document.getElementById('auth-error').classList.add('hidden');
}

async function sendOTP() {
    const phone = document.getElementById('phone-input').value.trim();
    if (!/^[6-9]\d{9}$/.test(phone)) {
        showError('Enter a valid 10-digit mobile number.'); return;
    }

    const res = await api('/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ mobile: phone })
    });

    if (res.success) {
        document.getElementById('otp-phone-display').textContent = '+91 ' + phone;
        document.getElementById('otp-step-phone').classList.add('hidden');
        document.getElementById('otp-step-verify').classList.remove('hidden');
        document.getElementById('auth-error').classList.add('hidden');

        if (res.otp) {
            const digits = document.querySelectorAll('.otp-digit');
            res.otp.split('').forEach((d, i) => { if(digits[i]) digits[i].value = d; });
            toast('Dev OTP: ' + res.otp, 'info');
        }
        document.querySelector('.otp-digit').focus();
    } else {
        showError(res.message);
    }
}

async function verifyOTP() {
    const phone = document.getElementById('phone-input').value.trim();
    const otp = Array.from(document.querySelectorAll('.otp-digit')).map(d => d.value).join('');
    if (otp.length !== 6) { showError('Enter all 6 digits.'); return; }

    const res = await api('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ mobile: phone, otp })
    });

    if (res.success) {
        const user = res.data.user;
        if (!['Admin', 'Owner'].includes(user.role)) {
            showError('Access denied. Admin or Owner role required.');
            return;
        }

        state.user = user;
        state.token = res.data.accessToken;
        state.refreshToken = res.data.refreshToken;
        localStorage.setItem('jiggile_admin_token', state.token);
        localStorage.setItem('jiggile_admin_refresh', state.refreshToken);
        localStorage.setItem('jiggile_admin_user', JSON.stringify(user));

        showDashboard();
        toast('Welcome, ' + (user.name || 'Admin') + '!', 'success');
    } else {
        showError(res.message);
    }
}

function setupOTPInputs() {
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach((input, i) => {
        input.addEventListener('input', () => { if (input.value && i < inputs.length - 1) inputs[i+1].focus(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !input.value && i > 0) inputs[i-1].focus(); });
    });
}

function showError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg; el.classList.remove('hidden');
}

function logout() {
    state.user = null; state.token = null;
    localStorage.removeItem('jiggile_admin_token');
    localStorage.removeItem('jiggile_admin_refresh');
    localStorage.removeItem('jiggile_admin_user');
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('auth-modal').classList.remove('hidden');
}

// ============================================================
// DASHBOARD
// ============================================================
function showDashboard() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    document.getElementById('admin-name').textContent = state.user.name || 'Admin';
    document.getElementById('admin-role').textContent = state.user.role;
    document.getElementById('role-badge').textContent = state.user.role;

    if (state.user.role === 'Owner') {
        document.getElementById('role-badge').style.color = '#A855F7';
        document.getElementById('role-badge').style.borderColor = 'rgba(168,85,247,0.3)';
    }

    loadDashboardData();
}

async function refreshData() {
    toast('Refreshing data...', 'info');
    await loadDashboardData();
}

async function loadDashboardData() {
    await Promise.all([
        loadOverview(),
        loadMonthlyGrowth(),
        loadLowStock(),
        loadOrders()
    ]);
}

// ============================================================
// OVERVIEW PAGE — KPIs
// ============================================================
async function loadOverview() {
    const res = await api('/admin/dashboard');
    if (!res.success) return;

    const d = res.data;
    document.getElementById('kpi-revenue').textContent = '₹' + formatNum(d.today.total_revenue);
    document.getElementById('kpi-orders').textContent = d.today.total_orders;
    document.getElementById('kpi-customers').textContent = d.total_customers;

    // Profit — Owner only (RBAC enforced server-side)
    if (d.today.net_profit !== null) {
        document.getElementById('kpi-profit').textContent = '₹' + formatNum(d.today.net_profit);
    } else {
        document.getElementById('kpi-profit').textContent = '🔒 Owner Only';
        document.getElementById('kpi-profit').style.fontSize = '14px';
    }

    // Status breakdown
    document.getElementById('stat-pending').textContent = d.today.pending_orders || 0;
    document.getElementById('stat-processing').textContent = d.today.processing_orders || 0;
    document.getElementById('stat-delivery').textContent = d.today.out_for_delivery || 0;
    document.getElementById('stat-delivered').textContent = d.today.delivered_orders || 0;

    // Pending orders badge
    const pending = d.today.pending_orders || 0;
    const badge = document.getElementById('pending-badge');
    badge.textContent = pending > 0 ? pending : '';
}

// ============================================================
// MONTHLY GROWTH CHARTS
// ============================================================
async function loadMonthlyGrowth() {
    const res = await api('/admin/monthly-growth');
    if (!res.success || !res.data.length) return;

    const labels = res.data.map(d => d.month_label);
    const revenue = res.data.map(d => d.revenue);
    const profit = res.data.map(d => d.net_profit);
    const orders = res.data.map(d => d.total_orders);

    // Revenue & Profit Chart
    const ctx1 = document.getElementById('monthly-chart').getContext('2d');
    if (state.monthlyChart) state.monthlyChart.destroy();
    
    const datasets = [{
        label: 'Revenue',
        data: revenue,
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56,189,248,0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
    }];

    if (state.user.role === 'Owner') {
        datasets.push({
            label: 'Net Profit',
            data: profit,
            borderColor: '#00D26A',
            backgroundColor: 'rgba(0,210,106,0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4
        });
    }

    state.monthlyChart = new Chart(ctx1, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#94A3B8' } } },
            scales: {
                x: { ticks: { color: '#64748B' }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: '#64748B', callback: v => '₹' + formatNum(v) }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });

    // Orders Volume Chart
    const ctx2 = document.getElementById('orders-chart').getContext('2d');
    if (state.ordersChart) state.ordersChart.destroy();

    state.ordersChart = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Orders',
                data: orders,
                backgroundColor: 'rgba(168,85,247,0.6)',
                borderColor: '#A855F7',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#94A3B8' } } },
            scales: {
                x: { ticks: { color: '#64748B' }, grid: { display: false } },
                y: { ticks: { color: '#64748B' }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });
}

// ============================================================
// LOW STOCK ALERTS
// ============================================================
async function loadLowStock() {
    const res = await api('/admin/low-stock');
    if (!res.success) return;

    const alerts = res.data;
    
    // Badge
    const badge = document.getElementById('alerts-badge');
    badge.textContent = alerts.length > 0 ? alerts.length : '';

    // Preview (first 5)
    const preview = document.getElementById('low-stock-preview');
    if (alerts.length === 0) {
        preview.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:12px;">✅ All products are well-stocked.</p>';
    } else {
        preview.innerHTML = alerts.slice(0, 5).map(a => renderAlert(a)).join('');
    }

    // Full list
    const full = document.getElementById('alerts-full-list');
    full.innerHTML = alerts.length === 0 
        ? '<p style="color:var(--text-muted);font-size:14px;padding:20px;">✅ No stock alerts. All products are well-stocked.</p>'
        : alerts.map(a => renderAlert(a)).join('');
}

function renderAlert(a) {
    const isCritical = a.stock_quantity <= 0;
    return `
        <div class="alert-item ${isCritical ? 'critical' : 'warning'}">
            <div class="alert-product">
                <div class="alert-product-name">${a.name}</div>
                <div class="alert-product-cat">${a.category_name} • Threshold: ${a.low_stock_threshold}</div>
            </div>
            <div class="alert-stock">
                <span class="alert-stock-count ${isCritical ? 'zero' : 'low'}">${a.stock_quantity}</span>
                <span class="alert-stock-label">${a.alert_type}</span>
            </div>
        </div>
    `;
}

// ============================================================
// ORDERS MANAGEMENT
// ============================================================
async function loadOrders() {
    let endpoint = '/admin/orders?limit=50';
    if (state.ordersFilter !== 'all') {
        endpoint += `&status=${state.ordersFilter}`;
    }

    const res = await api(endpoint);
    if (!res.success) return;

    const tbody = document.getElementById('orders-tbody');
    if (res.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);">No orders found.</td></tr>';
        return;
    }

    const nextStatus = {
        'SentToWarehouse': 'Packing',
        'Packing': 'OutForDelivery',
        'OutForDelivery': 'Delivered'
    };

    tbody.innerHTML = res.data.map(o => {
        const next = nextStatus[o.status];
        const actionBtn = next 
            ? `<button class="btn-action advance" onclick="advanceOrder(${o.id}, '${next}')">→ ${formatStatus(next)}</button>`
            : '<span style="color:var(--text-muted);font-size:11px;">—</span>';

        return `
            <tr>
                <td><strong style="color:var(--primary)">${o.order_number}</strong></td>
                <td>${o.customer_name || o.customer_mobile}</td>
                <td>${o.item_count}</td>
                <td style="font-weight:600;">₹${o.total_amount}</td>
                <td><span class="table-status ${o.status}">${formatStatus(o.status)}</span></td>
                <td style="font-size:12px;color:var(--text-muted);">${formatDate(o.created_at)}</td>
                <td>${actionBtn}</td>
            </tr>
        `;
    }).join('');
}

function filterOrders(status, btn) {
    state.ordersFilter = status;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadOrders();
}

async function advanceOrder(orderId, newStatus) {
    const res = await api(`/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
    });

    if (res.success) {
        toast(`Order updated to "${formatStatus(newStatus)}"`, 'success');
        loadOrders();
        loadOverview(); // Refresh KPIs
    } else {
        toast(res.message || 'Update failed.', 'error');
    }
}

// ============================================================
// PRODUCTS PAGE
// ============================================================
async function loadProducts() {
    const res = await api('/admin/products');
    if (!res.success) return;

    const tbody = document.getElementById('products-tbody');
    const isOwner = state.user.role === 'Owner';

    tbody.innerHTML = res.data.map(p => {
        const margin = ((p.selling_price - p.cost_price) / p.selling_price * 100).toFixed(1);
        let stockClass = 'stock-ok';
        if (p.stock_quantity <= 0) stockClass = 'stock-out';
        else if (p.stock_quantity <= p.low_stock_threshold) stockClass = 'stock-low';

        return `
            <tr>
                <td><strong>${p.name}</strong></td>
                <td style="color:var(--text-secondary)">${p.category_name}</td>
                <td>${isOwner ? '₹' + p.cost_price : '🔒'}</td>
                <td>₹${p.selling_price}</td>
                <td>${isOwner ? `<span class="${margin > 20 ? 'margin-positive' : 'margin-low'}">${margin}%</span>` : '🔒'}</td>
                <td class="${stockClass}">${p.stock_quantity}</td>
                <td>${p.is_active ? '✅ Active' : '❌ Inactive'}</td>
            </tr>
        `;
    }).join('');
}

// ============================================================
// PAGE NAVIGATION
// ============================================================
function switchPage(page, btn) {
    state.currentPage = page;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    btn.classList.add('active');

    // Show page
    document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
    document.getElementById(`page-${page}`).classList.remove('hidden');

    // Update title
    const titles = {
        'overview': 'Dashboard Overview',
        'orders': 'Order Management',
        'products': 'Product Management',
        'alerts': 'Stock Alerts'
    };
    document.getElementById('page-title').textContent = titles[page] || page;

    // Load page-specific data
    if (page === 'products') loadProducts();
    if (page === 'orders') loadOrders();
    if (page === 'alerts') loadLowStock();
}

// ============================================================
// UTILITIES
// ============================================================
function formatStatus(s) {
    const map = {
        'Pending': 'Pending', 'Approved': 'Approved',
        'SentToWarehouse': 'Warehouse', 'Packing': 'Packing',
        'OutForDelivery': 'Delivery', 'Delivered': 'Delivered',
        'Cancelled': 'Cancelled'
    };
    return map[s] || s;
}

function formatDate(d) {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatNum(n) {
    if (n >= 100000) return (n/100000).toFixed(1) + 'L';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return Number(n).toFixed(0);
}

function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
