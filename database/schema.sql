-- ============================================================
-- JIGGILE - 10-Minute Grocery Delivery Platform
-- SQL Server Database Schema
-- Brand: Jiggile by Adwithya
-- ============================================================

-- Use a dedicated database
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'JiggileDB')
    CREATE DATABASE JiggileDB;
GO

USE JiggileDB;
GO

-- ============================================================
-- 1. USERS TABLE
-- Supports OTP-only login, JWT refresh, and RBAC roles
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
CREATE TABLE Users (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    mobile          VARCHAR(15)   NOT NULL UNIQUE,
    name            NVARCHAR(100) NULL,
    email           NVARCHAR(255) NULL,
    role            VARCHAR(20)   NOT NULL DEFAULT 'Customer'
                    CHECK (role IN ('Customer', 'Admin', 'Owner')),
    otp_hash        VARCHAR(255)  NULL,
    otp_expires_at  DATETIME2     NULL,
    refresh_token   VARCHAR(500)  NULL,
    default_address NVARCHAR(500) NULL,
    default_lat     DECIMAL(10,7) NULL,
    default_lng     DECIMAL(10,7) NULL,
    is_active       BIT           NOT NULL DEFAULT 1,
    created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Index for fast OTP lookups by mobile
CREATE NONCLUSTERED INDEX IX_Users_Mobile ON Users(mobile);
GO

-- ============================================================
-- 2. CATEGORIES TABLE
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Categories')
CREATE TABLE Categories (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    name        NVARCHAR(100) NOT NULL UNIQUE,
    image_url   NVARCHAR(500) NULL,
    sort_order  INT           NOT NULL DEFAULT 0,
    is_active   BIT           NOT NULL DEFAULT 1,
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- ============================================================
-- 3. PRODUCTS TABLE
-- Tracks both cost_price and selling_price for profit calc
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
CREATE TABLE Products (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    category_id     INT           NOT NULL,
    name            NVARCHAR(200) NOT NULL,
    description     NVARCHAR(1000) NULL,
    image_url       NVARCHAR(500) NULL,
    cost_price      DECIMAL(10,2) NOT NULL,
    selling_price   DECIMAL(10,2) NOT NULL,
    stock_quantity  INT           NOT NULL DEFAULT 0,
    unit            NVARCHAR(50)  NOT NULL DEFAULT 'pc',
    low_stock_threshold INT      NOT NULL DEFAULT 10,
    is_active       BIT           NOT NULL DEFAULT 1,
    created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_Products_Category FOREIGN KEY (category_id)
        REFERENCES Categories(id),
    CONSTRAINT CK_Products_Prices CHECK (selling_price >= 0 AND cost_price >= 0)
);
GO

-- Index for category-based browsing and stock queries
CREATE NONCLUSTERED INDEX IX_Products_Category ON Products(category_id, is_active);
CREATE NONCLUSTERED INDEX IX_Products_Stock ON Products(stock_quantity) WHERE is_active = 1;
GO

-- ============================================================
-- 4. ORDERS TABLE
-- Status enum enforces the auto-approval state machine
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
CREATE TABLE Orders (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
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
    delivery_address    NVARCHAR(500) NOT NULL,
    delivery_lat        DECIMAL(10,7) NULL,
    delivery_lng        DECIMAL(10,7) NULL,
    delivery_deadline   DATETIME2     NULL,  -- order_placed + 10 minutes
    notes               NVARCHAR(500) NULL,
    created_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    approved_at         DATETIME2     NULL,
    packed_at           DATETIME2     NULL,
    dispatched_at       DATETIME2     NULL,
    delivered_at        DATETIME2     NULL,
    updated_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_Orders_User FOREIGN KEY (user_id)
        REFERENCES Users(id)
);
GO

-- Indexes for dashboard queries
CREATE NONCLUSTERED INDEX IX_Orders_User ON Orders(user_id, created_at DESC);
CREATE NONCLUSTERED INDEX IX_Orders_Status ON Orders(status, created_at DESC);
CREATE NONCLUSTERED INDEX IX_Orders_CreatedAt ON Orders(created_at DESC);
GO

-- ============================================================
-- 5. ORDER ITEMS TABLE
-- Snapshots cost_price at time of order for accurate profit calc
-- Profit = SUM((unit_price - cost_price_snapshot) * quantity)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderItems')
CREATE TABLE OrderItems (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    order_id            INT           NOT NULL,
    product_id          INT           NOT NULL,
    product_name        NVARCHAR(200) NOT NULL,  -- snapshot
    quantity            INT           NOT NULL,
    unit_price          DECIMAL(10,2) NOT NULL,   -- selling price snapshot
    cost_price_snapshot DECIMAL(10,2) NOT NULL,   -- cost price snapshot
    subtotal            AS (unit_price * quantity) PERSISTED,

    CONSTRAINT FK_OrderItems_Order FOREIGN KEY (order_id)
        REFERENCES Orders(id),
    CONSTRAINT FK_OrderItems_Product FOREIGN KEY (product_id)
        REFERENCES Products(id),
    CONSTRAINT CK_OrderItems_Qty CHECK (quantity > 0)
);
GO

CREATE NONCLUSTERED INDEX IX_OrderItems_Order ON OrderItems(order_id);
GO

-- ============================================================
-- 6. PAYMENTS TABLE
-- Links to orders; webhook payload stored for audit
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Payments')
CREATE TABLE Payments (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    order_id            INT           NOT NULL,
    payment_gateway_id  VARCHAR(100)  NULL,
    amount              DECIMAL(12,2) NOT NULL,
    status              VARCHAR(20)   NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending', 'Success', 'Failed', 'Refunded')),
    payment_method      VARCHAR(50)   NULL,
    webhook_payload     NVARCHAR(MAX) NULL,
    created_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_Payments_Order FOREIGN KEY (order_id)
        REFERENCES Orders(id)
);
GO

CREATE NONCLUSTERED INDEX IX_Payments_Order ON Payments(order_id);
CREATE NONCLUSTERED INDEX IX_Payments_Status ON Payments(status);
GO

-- ============================================================
-- 7. STOCK LOG TABLE
-- Audit trail for every stock change
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StockLog')
CREATE TABLE StockLog (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    product_id  INT           NOT NULL,
    change_qty  INT           NOT NULL,  -- negative = deduction, positive = restock
    reason      NVARCHAR(200) NOT NULL,
    reference_id INT          NULL,       -- order_id or restock ticket
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_StockLog_Product FOREIGN KEY (product_id)
        REFERENCES Products(id)
);
GO

CREATE NONCLUSTERED INDEX IX_StockLog_Product ON StockLog(product_id, created_at DESC);
GO

-- ============================================================
-- 8. DELIVERY TRACKING TABLE
-- Real-time GPS coordinates for active deliveries
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DeliveryTracking')
CREATE TABLE DeliveryTracking (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    order_id            INT           NOT NULL,
    rider_name          NVARCHAR(100) NULL,
    rider_phone         VARCHAR(15)   NULL,
    rider_lat           DECIMAL(10,7) NULL,
    rider_lng           DECIMAL(10,7) NULL,
    estimated_arrival   DATETIME2     NULL,
    updated_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_Tracking_Order FOREIGN KEY (order_id)
        REFERENCES Orders(id)
);
GO

CREATE NONCLUSTERED INDEX IX_Tracking_Order ON DeliveryTracking(order_id);
GO

-- ============================================================
-- SEED DATA: Categories & Sample Products
-- ============================================================
INSERT INTO Categories (name, sort_order) VALUES
    (N'Fruits & Vegetables', 1),
    (N'Dairy & Eggs', 2),
    (N'Snacks & Beverages', 3),
    (N'Staples & Grains', 4),
    (N'Personal Care', 5),
    (N'Cleaning & Household', 6);
GO

INSERT INTO Products (category_id, name, description, cost_price, selling_price, stock_quantity, unit, low_stock_threshold) VALUES
    (1, N'Fresh Bananas (1 dozen)',    N'Organic farm-fresh bananas',       25.00,  40.00,  150, 'dozen', 20),
    (1, N'Tomatoes (1 kg)',            N'Red ripe tomatoes',                30.00,  45.00,  200, 'kg',    25),
    (1, N'Onions (1 kg)',              N'Premium quality onions',           22.00,  35.00,  300, 'kg',    30),
    (1, N'Potatoes (1 kg)',            N'Farm fresh potatoes',              18.00,  30.00,  250, 'kg',    30),
    (1, N'Fresh Spinach (250g)',       N'Crisp green spinach leaves',       12.00,  20.00,  100, 'pack',  15),
    (2, N'Amul Toned Milk (1L)',       N'Pasteurized toned milk',           28.00,  30.00,  100, 'pack',  15),
    (2, N'Farm Eggs (12 pcs)',         N'Free-range eggs',                  55.00,  72.00,   80, 'tray',  10),
    (2, N'Amul Butter (100g)',         N'Salted butter, creamy smooth',     40.00,  56.00,   60, 'pack',  10),
    (2, N'Curd (400g)',                N'Fresh thick curd',                 22.00,  35.00,   90, 'cup',   12),
    (3, N'Lays Classic Salted (52g)',  N'Potato chips, classic flavour',    15.00,  20.00,  200, 'pack',  25),
    (3, N'Coca-Cola (750ml)',          N'Chilled carbonated drink',         32.00,  40.00,  150, 'bottle',20),
    (3, N'Parle-G Biscuits (250g)',    N'Gold biscuits',                     8.00,  10.00,  300, 'pack',  40),
    (4, N'Basmati Rice (1 kg)',        N'Aged premium basmati',             80.00, 110.00,  120, 'kg',    15),
    (4, N'Toor Dal (1 kg)',            N'Split pigeon peas',                95.00, 130.00,  100, 'kg',    12),
    (4, N'Aashirvaad Atta (5 kg)',     N'Whole wheat flour',               190.00, 250.00,   50, 'bag',    8),
    (5, N'Dove Soap (100g)',           N'Moisturizing beauty bar',          38.00,  49.00,  120, 'bar',   15),
    (5, N'Colgate MaxFresh (150g)',    N'Cooling crystal toothpaste',       70.00,  95.00,   80, 'tube',  10),
    (6, N'Vim Dishwash Bar (200g)',    N'Lemon fresh dishwash',             12.00,  15.00,  200, 'bar',   25),
    (6, N'Surf Excel (1 kg)',          N'Detergent powder',                130.00, 175.00,   70, 'pack',  10);
GO

-- Create the default Owner account (OTP-only, no password)
INSERT INTO Users (mobile, name, role) VALUES
    ('9999999999', N'Adwithya Owner', 'Owner');
GO

PRINT '✅ Jiggile database schema created successfully!';
PRINT '📊 Seeded 6 categories, 19 products, and 1 Owner account.';
GO
