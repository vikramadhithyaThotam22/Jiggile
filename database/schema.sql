-- ============================================================
-- JIGGILE - 10-Minute Grocery Delivery Platform
-- PostgreSQL Database Schema (Supabase)
-- Brand: Jiggile by Adwithya
-- ============================================================

-- ============================================================
-- 1. USERS TABLE
-- Supports OTP-only login, JWT refresh, and RBAC roles
-- ============================================================
CREATE TABLE IF NOT EXISTS Users (
    id              SERIAL PRIMARY KEY,
    mobile          VARCHAR(15)   NOT NULL UNIQUE,
    name            VARCHAR(100)  NULL,
    email           VARCHAR(255)  NULL,
    role            VARCHAR(20)   NOT NULL DEFAULT 'Customer'
                    CHECK (role IN ('Customer', 'Admin', 'Owner')),
    otp_hash        VARCHAR(255)  NULL,
    otp_expires_at  TIMESTAMPTZ   NULL,
    refresh_token   VARCHAR(500)  NULL,
    default_address VARCHAR(500)  NULL,
    default_lat     DECIMAL(10,7) NULL,
    default_lng     DECIMAL(10,7) NULL,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- Index for fast OTP lookups by mobile
CREATE INDEX IF NOT EXISTS IX_Users_Mobile ON Users(mobile);

-- ============================================================
-- 2. CATEGORIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS Categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    image_url   VARCHAR(500) NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- ============================================================
-- 3. PRODUCTS TABLE
-- Tracks both cost_price and selling_price for profit calc
-- ============================================================
CREATE TABLE IF NOT EXISTS Products (
    id              SERIAL PRIMARY KEY,
    category_id     INT           NOT NULL,
    name            VARCHAR(200)  NOT NULL,
    description     VARCHAR(1000) NULL,
    image_url       VARCHAR(500)  NULL,
    cost_price      DECIMAL(10,2) NOT NULL,
    selling_price   DECIMAL(10,2) NOT NULL,
    stock_quantity  INT           NOT NULL DEFAULT 0,
    unit            VARCHAR(50)   NOT NULL DEFAULT 'pc',
    low_stock_threshold INT      NOT NULL DEFAULT 10,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),

    CONSTRAINT FK_Products_Category FOREIGN KEY (category_id)
        REFERENCES Categories(id),
    CONSTRAINT CK_Products_Prices CHECK (selling_price >= 0 AND cost_price >= 0)
);

-- Index for category-based browsing and stock queries
CREATE INDEX IF NOT EXISTS IX_Products_Category ON Products(category_id, is_active);
CREATE INDEX IF NOT EXISTS IX_Products_Stock ON Products(stock_quantity) WHERE is_active = TRUE;

-- ============================================================
-- 4. ORDERS TABLE
-- Status enum enforces the auto-approval state machine
-- ============================================================
CREATE TABLE IF NOT EXISTS Orders (
    id                  SERIAL PRIMARY KEY,
    user_id             INT           NOT NULL,
    order_number        VARCHAR(20)   NOT NULL UNIQUE,
    status              VARCHAR(30)   NOT NULL DEFAULT 'Pending'
                        CHECK (status IN (
                            'Pending',
                            'Approved',
                            'SentToWarehouse',
                            'Packing',
                            'OutForDelivery',
                            'Delivered',
                            'Cancelled'
                        )),
    total_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    delivery_address    VARCHAR(500)  NOT NULL,
    delivery_lat        DECIMAL(10,7) NULL,
    delivery_lng        DECIMAL(10,7) NULL,
    delivery_deadline   TIMESTAMPTZ   NULL,
    notes               VARCHAR(500)  NULL,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    approved_at         TIMESTAMPTZ   NULL,
    packed_at           TIMESTAMPTZ   NULL,
    dispatched_at       TIMESTAMPTZ   NULL,
    delivered_at        TIMESTAMPTZ   NULL,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),

    CONSTRAINT FK_Orders_User FOREIGN KEY (user_id)
        REFERENCES Users(id)
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS IX_Orders_User ON Orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS IX_Orders_Status ON Orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS IX_Orders_CreatedAt ON Orders(created_at DESC);

-- ============================================================
-- 5. ORDER ITEMS TABLE
-- Snapshots cost_price at time of order for accurate profit calc
-- ============================================================
CREATE TABLE IF NOT EXISTS OrderItems (
    id                  SERIAL PRIMARY KEY,
    order_id            INT           NOT NULL,
    product_id          INT           NOT NULL,
    product_name        VARCHAR(200)  NOT NULL,
    quantity            INT           NOT NULL,
    unit_price          DECIMAL(10,2) NOT NULL,
    cost_price_snapshot DECIMAL(10,2) NOT NULL,
    subtotal            DECIMAL(12,2) GENERATED ALWAYS AS (unit_price * quantity) STORED,

    CONSTRAINT FK_OrderItems_Order FOREIGN KEY (order_id)
        REFERENCES Orders(id),
    CONSTRAINT FK_OrderItems_Product FOREIGN KEY (product_id)
        REFERENCES Products(id),
    CONSTRAINT CK_OrderItems_Qty CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS IX_OrderItems_Order ON OrderItems(order_id);

-- ============================================================
-- 6. PAYMENTS TABLE
-- Links to orders; webhook payload stored for audit
-- ============================================================
CREATE TABLE IF NOT EXISTS Payments (
    id                  SERIAL PRIMARY KEY,
    order_id            INT           NOT NULL,
    payment_gateway_id  VARCHAR(100)  NULL,
    amount              DECIMAL(12,2) NOT NULL,
    status              VARCHAR(20)   NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending', 'Success', 'Failed', 'Refunded')),
    payment_method      VARCHAR(50)   NULL,
    webhook_payload     TEXT          NULL,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),

    CONSTRAINT FK_Payments_Order FOREIGN KEY (order_id)
        REFERENCES Orders(id)
);

CREATE INDEX IF NOT EXISTS IX_Payments_Order ON Payments(order_id);
CREATE INDEX IF NOT EXISTS IX_Payments_Status ON Payments(status);

-- ============================================================
-- 7. STOCK LOG TABLE
-- Audit trail for every stock change
-- ============================================================
CREATE TABLE IF NOT EXISTS StockLog (
    id          SERIAL PRIMARY KEY,
    product_id  INT           NOT NULL,
    change_qty  INT           NOT NULL,
    reason      VARCHAR(200)  NOT NULL,
    reference_id INT          NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),

    CONSTRAINT FK_StockLog_Product FOREIGN KEY (product_id)
        REFERENCES Products(id)
);

CREATE INDEX IF NOT EXISTS IX_StockLog_Product ON StockLog(product_id, created_at DESC);

-- ============================================================
-- 8. DELIVERY TRACKING TABLE
-- Real-time GPS coordinates for active deliveries
-- ============================================================
CREATE TABLE IF NOT EXISTS DeliveryTracking (
    id                  SERIAL PRIMARY KEY,
    order_id            INT           NOT NULL,
    rider_name          VARCHAR(100)  NULL,
    rider_phone         VARCHAR(15)   NULL,
    rider_lat           DECIMAL(10,7) NULL,
    rider_lng           DECIMAL(10,7) NULL,
    estimated_arrival   TIMESTAMPTZ   NULL,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),

    CONSTRAINT FK_Tracking_Order FOREIGN KEY (order_id)
        REFERENCES Orders(id)
);

CREATE INDEX IF NOT EXISTS IX_Tracking_Order ON DeliveryTracking(order_id);

-- ============================================================
-- SEED DATA: Categories & Sample Products
-- ============================================================
INSERT INTO Categories (name, sort_order) VALUES
    ('Fruits & Vegetables', 1),
    ('Dairy & Eggs', 2),
    ('Snacks & Beverages', 3),
    ('Staples & Grains', 4),
    ('Personal Care', 5),
    ('Cleaning & Household', 6)
ON CONFLICT (name) DO NOTHING;

INSERT INTO Products (category_id, name, description, cost_price, selling_price, stock_quantity, unit, low_stock_threshold) VALUES
    (1, 'Fresh Bananas (1 dozen)',    'Organic farm-fresh bananas',       25.00,  40.00,  150, 'dozen', 20),
    (1, 'Tomatoes (1 kg)',            'Red ripe tomatoes',                30.00,  45.00,  200, 'kg',    25),
    (1, 'Onions (1 kg)',              'Premium quality onions',           22.00,  35.00,  300, 'kg',    30),
    (1, 'Potatoes (1 kg)',            'Farm fresh potatoes',              18.00,  30.00,  250, 'kg',    30),
    (1, 'Fresh Spinach (250g)',       'Crisp green spinach leaves',       12.00,  20.00,  100, 'pack',  15),
    (2, 'Amul Toned Milk (1L)',       'Pasteurized toned milk',           28.00,  30.00,  100, 'pack',  15),
    (2, 'Farm Eggs (12 pcs)',         'Free-range eggs',                  55.00,  72.00,   80, 'tray',  10),
    (2, 'Amul Butter (100g)',         'Salted butter, creamy smooth',     40.00,  56.00,   60, 'pack',  10),
    (2, 'Curd (400g)',                'Fresh thick curd',                 22.00,  35.00,   90, 'cup',   12),
    (3, 'Lays Classic Salted (52g)',  'Potato chips, classic flavour',    15.00,  20.00,  200, 'pack',  25),
    (3, 'Coca-Cola (750ml)',          'Chilled carbonated drink',         32.00,  40.00,  150, 'bottle',20),
    (3, 'Parle-G Biscuits (250g)',    'Gold biscuits',                     8.00,  10.00,  300, 'pack',  40),
    (4, 'Basmati Rice (1 kg)',        'Aged premium basmati',             80.00, 110.00,  120, 'kg',    15),
    (4, 'Toor Dal (1 kg)',            'Split pigeon peas',                95.00, 130.00,  100, 'kg',    12),
    (4, 'Aashirvaad Atta (5 kg)',     'Whole wheat flour',               190.00, 250.00,   50, 'bag',    8),
    (5, 'Dove Soap (100g)',           'Moisturizing beauty bar',          38.00,  49.00,  120, 'bar',   15),
    (5, 'Colgate MaxFresh (150g)',    'Cooling crystal toothpaste',       70.00,  95.00,   80, 'tube',  10),
    (6, 'Vim Dishwash Bar (200g)',    'Lemon fresh dishwash',             12.00,  15.00,  200, 'bar',   25),
    (6, 'Surf Excel (1 kg)',          'Detergent powder',                130.00, 175.00,   70, 'pack',  10);

-- Create the default Owner account (OTP-only, no password)
INSERT INTO Users (mobile, name, role) VALUES
    ('9999999999', 'Adwithya Owner', 'Owner')
ON CONFLICT (mobile) DO NOTHING;
