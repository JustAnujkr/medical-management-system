require("dotenv").config();

const express = require("express");
const path = require("path");
const pool = require("./db");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const asyncRoute = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// ================= HEALTH CHECK =================

app.get("/api/health", asyncRoute(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
}));

// ================= DASHBOARD =================

app.get("/api/dashboard", asyncRoute(async (req, res) => {
    const [[totals]] = await pool.query(`
        SELECT
            COUNT(*) totalMedicines,
            COALESCE(SUM(stock), 0) totalStock,
            SUM(stock <= min_stock) lowStock,
            SUM(exp_date < CURDATE()) expired,
            SUM(
                exp_date >= CURDATE()
                AND exp_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
            ) expiringSoon
        FROM medicines
    `);

    const [[sales]] = await pool.query(`
        SELECT COALESCE(SUM(total_amount), 0) todaySales
        FROM sales
        WHERE DATE(sale_date) = CURDATE()
    `);

    res.json({ ...totals, ...sales });
}));

// ================= MEDICINES =================

app.get("/api/medicines", asyncRoute(async (req, res) => {
    const q = `%${req.query.q || ""}%`;

    const [rows] = await pool.query(`
        SELECT m.*, s.supplier_name
        FROM medicines m
        LEFT JOIN suppliers s
            ON s.supplier_id = m.supplier_id
        WHERE
            m.medicine_name LIKE ?
            OR m.batch_number LIKE ?
            OR m.generic_name LIKE ?
        ORDER BY m.medicine_name, m.exp_date
    `, [q, q, q]);

    res.json(rows);
}));

app.post("/api/medicines", asyncRoute(async (req, res) => {
    const {
        medicine_name,
        generic_name,
        category,
        manufacturer,
        batch_number,
        mfg_date,
        exp_date,
        purchase_price,
        mrp,
        stock,
        min_stock,
        supplier_id
    } = req.body;

    if (!medicine_name || !batch_number || !mfg_date || !exp_date) {
        return res.status(400).json({
            error: "Medicine name, batch number, MFG and EXP dates are required."
        });
    }

    if (new Date(exp_date) <= new Date(mfg_date)) {
        return res.status(400).json({
            error: "Expiry date must be after manufacturing date."
        });
    }

    const [result] = await pool.query(`
        INSERT INTO medicines
        (
            medicine_name,
            generic_name,
            category,
            manufacturer,
            batch_number,
            mfg_date,
            exp_date,
            purchase_price,
            mrp,
            stock,
            min_stock,
            supplier_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        medicine_name,
        generic_name || null,
        category || null,
        manufacturer || null,
        batch_number,
        mfg_date,
        exp_date,
        purchase_price || 0,
        mrp || 0,
        stock || 0,
        min_stock ?? 10,
        supplier_id || null
    ]);

    if (Number(stock) > 0) {
        await pool.query(`
            INSERT INTO stock_movements
                (medicine_id, movement_type, quantity, note)
            VALUES (?, 'IN', ?, 'Opening stock')
        `, [result.insertId, Number(stock)]);
    }

    res.status(201).json({
        message: "Medicine added",
        medicine_id: result.insertId
    });
}));

app.put("/api/medicines/:id", asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    const fields = [
        "medicine_name",
        "generic_name",
        "category",
        "manufacturer",
        "batch_number",
        "mfg_date",
        "exp_date",
        "purchase_price",
        "mrp",
        "stock",
        "min_stock",
        "supplier_id"
    ];

    const updates = fields.filter(k => req.body[k] !== undefined);

    if (!updates.length) {
        return res.status(400).json({ error: "No fields supplied." });
    }

    if (
        req.body.mfg_date &&
        req.body.exp_date &&
        new Date(req.body.exp_date) <= new Date(req.body.mfg_date)
    ) {
        return res.status(400).json({
            error: "Expiry date must be after manufacturing date."
        });
    }

    const [old] = await pool.query(
        "SELECT stock FROM medicines WHERE medicine_id = ?",
        [id]
    );

    if (!old.length) {
        return res.status(404).json({ error: "Medicine not found." });
    }

    await pool.query(
        `UPDATE medicines SET ${
            updates.map(k => `\`${k}\` = ?`).join(", ")
        } WHERE medicine_id = ?`,
        [
            ...updates.map(k => req.body[k] === "" ? null : req.body[k]),
            id
        ]
    );

    if (
        req.body.stock !== undefined &&
        Number(req.body.stock) !== Number(old[0].stock)
    ) {
        const delta = Number(req.body.stock) - Number(old[0].stock);

        await pool.query(`
            INSERT INTO stock_movements
                (medicine_id, movement_type, quantity, note)
            VALUES (?, ?, ?, ?)
        `, [
            id,
            delta > 0 ? "IN" : "OUT",
            Math.abs(delta),
            "Manual stock correction"
        ]);
    }

    res.json({ message: "Medicine updated" });
}));

// ================= DELETE MEDICINE =================

app.delete("/api/medicines/:id", asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "Invalid medicine id." });
    }

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        const [[sold]] = await conn.query(
            "SELECT COUNT(*) n FROM sale_items WHERE medicine_id = ?",
            [id]
        );

        if (sold.n > 0) {
            await conn.rollback();

            return res.status(409).json({
                error: "This batch has sales history and cannot be deleted. Set its stock to 0 instead."
            });
        }

        await conn.query(
            "DELETE FROM stock_movements WHERE medicine_id = ?",
            [id]
        );

        const [result] = await conn.query(
            "DELETE FROM medicines WHERE medicine_id = ?",
            [id]
        );

        if (!result.affectedRows) {
            await conn.rollback();
            return res.status(404).json({ error: "Medicine not found." });
        }

        await conn.commit();

        res.json({ message: "Medicine deleted" });

    } catch (error) {
        await conn.rollback();
        throw error;

    } finally {
        conn.release();
    }
}));

// ================= SUPPLIERS =================

app.get("/api/suppliers", asyncRoute(async (req, res) => {
    const [rows] = await pool.query(
        "SELECT * FROM suppliers ORDER BY supplier_name"
    );

    res.json(rows);
}));

app.post("/api/suppliers", asyncRoute(async (req, res) => {
    const { supplier_name, phone, email, address } = req.body;

    if (!supplier_name) {
        return res.status(400).json({
            error: "Supplier name is required."
        });
    }

    const [result] = await pool.query(`
        INSERT INTO suppliers
            (supplier_name, phone, email, address)
        VALUES (?, ?, ?, ?)
    `, [
        supplier_name,
        phone || null,
        email || null,
        address || null
    ]);

    res.status(201).json({
        supplier_id: result.insertId,
        message: "Supplier added"
    });
}));

// ================= STOCK ADJUSTMENT =================

app.post("/api/stock/adjust", asyncRoute(async (req, res) => {
    const { medicine_id, movement_type, quantity, note } = req.body;
    const qty = Number(quantity);

    if (
        !medicine_id ||
        !["IN", "OUT"].includes(movement_type) ||
        !Number.isInteger(qty) ||
        qty <= 0
    ) {
        return res.status(400).json({
            error: "Provide medicine, IN/OUT movement and a positive whole quantity."
        });
    }

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        const [[med]] = await conn.query(
            "SELECT stock FROM medicines WHERE medicine_id = ? FOR UPDATE",
            [medicine_id]
        );

        if (!med) {
            throw new Error("Medicine not found.");
        }

        if (movement_type === "OUT" && med.stock < qty) {
            throw new Error("Insufficient stock.");
        }

        const newStock = med.stock +
            (movement_type === "IN" ? qty : -qty);

        await conn.query(
            "UPDATE medicines SET stock = ? WHERE medicine_id = ?",
            [newStock, medicine_id]
        );

        await conn.query(`
            INSERT INTO stock_movements
                (medicine_id, movement_type, quantity, note)
            VALUES (?, ?, ?, ?)
        `, [
            medicine_id,
            movement_type,
            qty,
            note || "Manual stock update"
        ]);

        await conn.commit();

        res.json({
            message: "Stock updated",
            stock: newStock
        });

    } catch (error) {
        await conn.rollback();
        throw error;

    } finally {
        conn.release();
    }
}));

// ================= CREATE SALE =================

app.post("/api/sales", asyncRoute(async (req, res) => {
    const { customer_name, customer_phone, items } = req.body;

    if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({
            error: "Add at least one sale item."
        });
    }

    const conn = await pool.getConnection();

    try {
        await conn.beginTransaction();

        let total = 0;
        const prepared = [];

        for (const item of items) {
            const qty = Number(item.quantity);

            if (!Number.isInteger(qty) || qty <= 0) {
                throw new Error(
                    "Sale quantity must be a positive whole number."
                );
            }

            const [[med]] = await conn.query(
                "SELECT * FROM medicines WHERE medicine_id = ? FOR UPDATE",
                [item.medicine_id]
            );

            if (!med) {
                throw new Error("Medicine not found.");
            }

            const expiryDate = String(med.exp_date).slice(0, 10);
            const today = new Date().toISOString().slice(0, 10);

            if (expiryDate < today) {
                throw new Error(
                    `${med.medicine_name} is expired and cannot be sold.`
                );
            }

            if (med.stock < qty) {
                throw new Error(
                    `Insufficient stock for ${med.medicine_name}.`
                );
            }

            const price = Number(item.unit_price ?? med.mrp);

            if (!Number.isFinite(price) || price < 0) {
                throw new Error("Invalid medicine price.");
            }

            const subtotal = price * qty;

            total += subtotal;

            prepared.push({
                med,
                qty,
                price,
                subtotal
            });
        }

        const [sale] = await conn.query(`
            INSERT INTO sales
                (customer_name, customer_phone, total_amount)
            VALUES (?, ?, ?)
        `, [
            customer_name || "Walk-in Customer",
            customer_phone || null,
            total
        ]);

        for (const p of prepared) {
            await conn.query(`
                INSERT INTO sale_items
                    (sale_id, medicine_id, quantity, unit_price, subtotal)
                VALUES (?, ?, ?, ?, ?)
            `, [
                sale.insertId,
                p.med.medicine_id,
                p.qty,
                p.price,
                p.subtotal
            ]);

            await conn.query(
                "UPDATE medicines SET stock = stock - ? WHERE medicine_id = ?",
                [p.qty, p.med.medicine_id]
            );

            // Sale ID connects this stock movement to its customer.
            await conn.query(`
                INSERT INTO stock_movements
                    (medicine_id, movement_type, quantity, note)
                VALUES (?, 'OUT', ?, ?)
            `, [
                p.med.medicine_id,
                p.qty,
                `Sale #${sale.insertId}`
            ]);
        }

        await conn.commit();

        res.status(201).json({
            message: "Sale recorded",
            sale_id: sale.insertId,
            total_amount: total
        });

    } catch (error) {
        await conn.rollback();
        throw error;

    } finally {
        conn.release();
    }
}));

// ================= RECENT SALES =================
// Includes medicine names and quantities for every sale.

app.get("/api/sales", asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT
            s.sale_id,
            s.customer_name,
            s.customer_phone,
            s.sale_date,
            s.total_amount,

            GROUP_CONCAT(
                CONCAT(m.medicine_name, ' × ', si.quantity)
                ORDER BY m.medicine_name
                SEPARATOR ', '
            ) AS medicines_purchased

        FROM sales s

        LEFT JOIN sale_items si
            ON si.sale_id = s.sale_id

        LEFT JOIN medicines m
            ON m.medicine_id = si.medicine_id

        GROUP BY
            s.sale_id,
            s.customer_name,
            s.customer_phone,
            s.sale_date,
            s.total_amount

        ORDER BY s.sale_date DESC
        LIMIT 100
    `);

    res.json(rows);
}));

// ================= RECENT STOCK MOVEMENTS =================
// Sale note connects each medicine movement to its customer.

app.get("/api/stock/movements", asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT
            sm.*,
            m.medicine_name,
            m.batch_number,
            s.customer_name

        FROM stock_movements sm

        JOIN medicines m
            ON m.medicine_id = sm.medicine_id

        LEFT JOIN sales s
            ON sm.note = CONCAT('Sale #', s.sale_id)

        ORDER BY sm.movement_date DESC
        LIMIT 100
    `);

    res.json(rows);
}));

// ================= FRONTEND =================

app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ================= ERROR HANDLER =================

app.use((err, req, res, next) => {
    console.error(err);

    res.status(400).json({
        error: err.message || "Something went wrong."
    });
});

// ================= START SERVER =================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(
        `Medical Management System running at http://localhost:${PORT}`
    );
});