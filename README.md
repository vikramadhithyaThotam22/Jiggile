<p align="center">
  <img src="https://img.shields.io/badge/🛒-Jiggile-00E676?style=for-the-badge&labelColor=1a1a2e" alt="Jiggile" />
</p>

<h1 align="center">Jiggile — 10-Minute Grocery Delivery</h1>

<p align="center">
  <strong>Lightning-fast grocery delivery platform built by Adwithya</strong><br/>
  Order → Pay → Delivered in 10 minutes ⚡
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/SQL_Server-CC2927?style=flat-square&logo=microsoftsqlserver&logoColor=white" />
  <img src="https://img.shields.io/badge/JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white" />
  <img src="https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black" />
</p>

---

## ✨ Features

### 🛍️ Customer App
- **OTP-only login** — No passwords, mobile verification only
- **Product browsing** with category filters & search
- **Shopping cart** with real-time quantity controls
- **One-tap checkout** with address & auto-payment simulation
- **Live order tracking** with 10-minute countdown timer
- **GPS rider tracking** on interactive map (Leaflet + OpenStreetMap)

### 🏪 Admin Dashboard
- **Owner/Admin role-based access** (RBAC)
- **Sales & profit analytics** with live charts
- **Order management** — view, update status, track all orders
- **Product management** — add, edit, stock levels
- **Low stock alerts** & inventory monitoring

### 🔐 Security
- JWT access + refresh tokens
- Bcrypt-hashed OTPs
- Parameterized SQL queries (SQL injection prevention)
- Helmet security headers
- Rate limiting on all endpoints

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, Express.js |
| **Database** | Microsoft SQL Server |
| **Auth** | JWT + OTP (Bcrypt hashed) |
| **Frontend** | Vanilla HTML/CSS/JS |
| **Maps** | Leaflet.js + OpenStreetMap |
| **Security** | Helmet, CORS, Rate Limiting |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** v16+
- **SQL Server** (Express or Developer edition)
- SQL Server TCP/IP enabled on port 1433

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/Jiggile.git
cd Jiggile/backend
npm install
```

### 2. Database Setup
```bash
# Run the schema in SQL Server Management Studio or sqlcmd:
sqlcmd -S localhost -E -i database/schema.sql
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your SQL Server credentials
```

### 4. Start the Server
```bash
npm start
```

### 5. Open in Browser
| Interface | URL |
|-----------|-----|
| Customer App | [http://localhost:3000/customer](http://localhost:3000/customer) |
| Admin Dashboard | [http://localhost:3000/admin](http://localhost:3000/admin) |
| API Health | [http://localhost:3000/api/health](http://localhost:3000/api/health) |

---

## 📁 Project Structure

```
Jiggile/
├── backend/
│   ├── config/         # Database connection
│   ├── middleware/      # JWT auth & RBAC
│   ├── routes/          # API route handlers
│   ├── server.js        # Express app entry point
│   ├── .env.example     # Environment template
│   └── package.json
├── frontend/
│   ├── customer/        # Customer SPA (HTML/CSS/JS)
│   └── admin/           # Admin dashboard (HTML/CSS/JS)
├── database/
│   └── schema.sql       # Full database schema
└── README.md
```

---

## 🔑 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/send-otp` | ❌ | Send OTP to mobile |
| POST | `/api/auth/verify-otp` | ❌ | Verify OTP & get JWT |
| POST | `/api/auth/refresh` | ❌ | Refresh access token |
| PUT | `/api/auth/profile` | ✅ | Update user profile |
| GET | `/api/products` | ❌ | List products |
| GET | `/api/categories` | ❌ | List categories |
| POST | `/api/orders` | ✅ | Place an order |
| GET | `/api/orders/my` | ✅ | Get user's orders |
| GET | `/api/tracking/:id` | ✅ | Track order + GPS |
| POST | `/api/payments/simulate/:id` | ✅ | Auto-approve payment |
| GET | `/api/admin/dashboard` | 🔒 | Admin analytics |

---

## 📜 License

MIT © [Adwithya](https://github.com/YOUR_USERNAME)

---

<p align="center">
  Made with ❤️ by <strong>Adwithya</strong>
</p>
