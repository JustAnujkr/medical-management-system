CREATE DATABASE IF NOT EXISTS medical_store;

USE medical_store;

CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(120),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medicines (
    medicine_id INT AUTO_INCREMENT PRIMARY KEY,
    medicine_name VARCHAR(150) NOT NULL,
    generic_name VARCHAR(150),
    category VARCHAR(80),
    manufacturer VARCHAR(150),
    batch_number VARCHAR(80) NOT NULL,
    mfg_date DATE NOT NULL,
    exp_date DATE NOT NULL,
    purchase_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    mrp DECIMAL(10, 2) NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    min_stock INT NOT NULL DEFAULT 10,
    supplier_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_medicine_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (supplier_id) ON DELETE SET NULL,
    CONSTRAINT chk_medicine_dates CHECK (exp_date > mfg_date),
    CONSTRAINT chk_medicine_stock CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS sales (
    sale_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(120) DEFAULT 'Walk-in Customer',
    customer_phone VARCHAR(20),
    total_amount DECIMAL(12, 2) NOT NULL,
    sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
    sale_item_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    medicine_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales (sale_id) ON DELETE CASCADE,
    FOREIGN KEY (medicine_id) REFERENCES medicines (medicine_id),
    CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS stock_movements (
    movement_id INT AUTO_INCREMENT PRIMARY KEY,
    medicine_id INT NOT NULL,
    movement_type ENUM('IN', 'OUT', 'ADJUSTMENT') NOT NULL,
    quantity INT NOT NULL,
    note VARCHAR(255),
    movement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (medicine_id) REFERENCES medicines (medicine_id)
);

CREATE INDEX idx_medicine_expiry ON medicines (exp_date);

CREATE INDEX idx_medicine_name ON medicines (medicine_name);