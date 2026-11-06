const $ = selector => document.querySelector(selector);

let medicines = [];
let suppliers = [];
let cart = [];

const medicineDialog = document.getElementById("medicineDialog");

// ================= API HELPER =================

async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Request failed");
    }

    return data;
}

// ================= COMMON FUNCTIONS =================

function toast(message) {
    const el = $("#toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    setTimeout(() => el.classList.remove("show"), 2800);
}

function money(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function dateText(d) {
    if (!d) return "—";

    const date = String(d).slice(0, 10);
    const parts = date.split("-");

    if (parts.length !== 3) return "Invalid Date";

    const [year, month, day] = parts;

    return new Date(
        Number(year),
        Number(month) - 1,
        Number(day)
    ).toLocaleDateString("en-IN");
}

function dateTimeText(d) {
    if (!d) return "—";

    const date = new Date(d);

    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleString("en-IN");
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function status(m) {
    const today = new Date().toISOString().slice(0, 10);
    const expiry = String(m.exp_date).slice(0, 10);

    if (expiry < today) {
        return '<span class="pill red">Expired</span>';
    }

    if (Number(m.stock) <= Number(m.min_stock)) {
        return '<span class="pill orange">Low stock</span>';
    }

    const soon = new Date();
    soon.setDate(soon.getDate() + 30);

    if (expiry <= soon.toISOString().slice(0, 10)) {
        return '<span class="pill orange">Expiring soon</span>';
    }

    return '<span class="pill">Healthy</span>';
}

// ================= TABLE GENERATOR =================

function table(headers, rows) {
    if (!rows.length) {
        return '<div class="empty">No records found.</div>';
    }

    return `
        <table>
            <thead>
                <tr>
                    ${headers.map(h => `<th>${h}</th>`).join("")}
                </tr>
            </thead>

            <tbody>
                ${rows.map(row => `
                    <tr>
                        ${row.map(cell => `<td>${cell ?? "—"}</td>`).join("")}
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

// ================= REFRESH ALL DATA =================

async function refresh() {
    try {
        const results = await Promise.all([
            api("/api/medicines"),
            api("/api/suppliers")
        ]);

        medicines = results[0];
        suppliers = results[1];

        await Promise.all([
            loadDashboard(),
            renderMedicines(),
            loadSelects(),
            loadMovements(),
            loadSales(),
            renderSuppliers()
        ]);

    } catch (error) {
        console.error("Refresh error:", error);
        toast(error.message);
    }
}

// ================= DASHBOARD =================

async function loadDashboard() {
    const d = await api("/api/dashboard");

    const dashboardFields = {
        totalMedicines: "totalMedicines",
        totalStock: "totalStock",
        lowStock: "lowStock",
        expired: "expired",
        expiringSoon: "expiringSoon"
    };

    for (const [id, key] of Object.entries(dashboardFields)) {
        const el = $("#" + id);

        if (el) {
            el.textContent = Number(d[key] || 0).toLocaleString("en-IN");
        }
    }

    $("#todaySales").textContent = money(d.todaySales);

    const today = new Date().toISOString().slice(0, 10);

    const attention = medicines.filter(m => {
        const expiry = String(m.exp_date).slice(0, 10);

        return (
            expiry < today ||
            Number(m.stock) <= Number(m.min_stock) ||
            expiry <= new Date(
                Date.now() + 30 * 86400000
            ).toISOString().slice(0, 10)
        );
    }).slice(0, 8);

    $("#attention-list").innerHTML = attention.length
        ? table(
            ["MEDICINE / BATCH", "STOCK", "EXPIRY", "STATUS"],
            attention.map(m => [
                `${escapeHtml(m.medicine_name)}
                <span class="muted">/ ${escapeHtml(m.batch_number)}</span>`,
                m.stock,
                dateText(m.exp_date),
                status(m)
            ])
        )
        : '<div class="empty">No stock or expiry alerts. Inventory looks good.</div>';
}

// ================= MEDICINE INVENTORY =================

async function renderMedicines() {
    const q = ($("#medicineSearch")?.value || "").toLowerCase();

    const list = medicines.filter(m =>
        [
            m.medicine_name,
            m.generic_name,
            m.batch_number
        ].some(value =>
            String(value || "").toLowerCase().includes(q)
        )
    );

    $("#medicineCount").textContent = `${list.length} records`;

    $("#medicine-table").innerHTML = table(
        [
            "MEDICINE",
            "BATCH / CATEGORY",
            "MFG DATE",
            "EXP DATE",
            "STOCK",
            "MRP",
            "STATUS",
            "ACTIONS"
        ],

        list.map(m => [
            `
                <span class="medicine-name">
                    ${escapeHtml(m.medicine_name)}
                </span>
                <br>
                <span class="muted">
                    ${escapeHtml(m.manufacturer || "")}
                </span>
            `,

            `
                ${escapeHtml(m.batch_number)}
                <br>
                <span class="muted">
                    ${escapeHtml(m.category || "—")}
                </span>
            `,

            dateText(m.mfg_date),
            dateText(m.exp_date),
            m.stock,
            money(m.mrp),
            status(m),

            `
                <button type="button" class="action"
                    onclick="editMedicine(${m.medicine_id})">
                    Edit
                </button>

                <button type="button" class="action delete"
                    onclick="deleteMedicine(${m.medicine_id})">
                    Delete
                </button>
            `
        ])
    );
}

// ================= DROPDOWN DATA =================

async function loadSelects() {
    $("#stockMedicine").innerHTML = medicines.map(m => `
        <option value="${m.medicine_id}">
            ${escapeHtml(m.medicine_name)} —
            ${escapeHtml(m.batch_number)}
            (stock: ${m.stock})
        </option>
    `).join("");

    const today = new Date().toISOString().slice(0, 10);

    $("#saleMedicine").innerHTML = medicines
        .filter(m => String(m.exp_date).slice(0, 10) >= today)
        .map(m => `
            <option
                value="${m.medicine_id}"
                data-price="${m.mrp}"
                data-stock="${m.stock}">
                ${escapeHtml(m.medicine_name)} —
                ${escapeHtml(m.batch_number)}
                (stock: ${m.stock})
            </option>
        `).join("");

    $("#medicineSupplier").innerHTML =
        '<option value="">No supplier</option>' +
        suppliers.map(s => `
            <option value="${s.supplier_id}">
                ${escapeHtml(s.supplier_name)}
            </option>
        `).join("");

    updateSalePrice();
}

// ================= ADD MEDICINE =================

function openMedicineForm() {
    const form = $("#medicineForm");

    form.reset();

    form.elements["medicine_id"].value = "";

    $("#dialogTitle").textContent = "Add medicine";

    form.elements["stock"].value = 0;
    form.elements["min_stock"].value = 10;
    form.elements["purchase_price"].value = 0;
    form.elements["mrp"].value = 0;

    medicineDialog.showModal();
}

// ================= EDIT MEDICINE =================

function editMedicine(id) {
    const m = medicines.find(
        x => Number(x.medicine_id) === Number(id)
    );

    if (!m) return;

    const form = $("#medicineForm");

    Object.keys(m).forEach(key => {
        const el = form.elements[key];

        if (el) {
            if (el.type === "date") {
                el.value = m[key]
                    ? String(m[key]).slice(0, 10)
                    : "";
            } else {
                el.value = m[key] ?? "";
            }
        }
    });

    $("#dialogTitle").textContent = "Edit medicine";

    medicineDialog.showModal();
}

// ================= SAVE MEDICINE =================

$("#medicineForm").addEventListener("submit", async e => {
    e.preventDefault();

    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());

    const id = data.medicine_id;

    delete data.medicine_id;

    [
        "stock",
        "min_stock",
        "purchase_price",
        "mrp",
        "supplier_id"
    ].forEach(key => {
        data[key] = data[key] === ""
            ? null
            : Number(data[key]);
    });

    try {
        await api(
            id ? `/api/medicines/${id}` : "/api/medicines",
            {
                method: id ? "PUT" : "POST",
                body: JSON.stringify(data)
            }
        );

        medicineDialog.close();

        toast(id ? "Medicine updated" : "Medicine added");

        await refresh();

    } catch (error) {
        console.error(error);
        toast(error.message);
    }
});

// ================= DELETE MEDICINE =================

async function deleteMedicine(id) {
    if (!confirm("Delete this medicine batch? This cannot be undone.")) {
        return;
    }

    try {
        await api(`/api/medicines/${id}`, {
            method: "DELETE"
        });

        toast("Medicine deleted");

        await refresh();

    } catch (error) {
        toast(error.message);
    }
}

// ================= STOCK MOVEMENTS =================

$("#stockForm").addEventListener("submit", async e => {
    e.preventDefault();

    const data = Object.fromEntries(
        new FormData(e.target).entries()
    );

    data.medicine_id = Number(data.medicine_id);
    data.quantity = Number(data.quantity);

    try {
        await api("/api/stock/adjust", {
            method: "POST",
            body: JSON.stringify(data)
        });

        e.target.reset();

        toast("Stock movement saved");

        await refresh();

    } catch (error) {
        toast(error.message);
    }
});

// Recent movements now include customer name.

async function loadMovements() {
    const rows = await api("/api/stock/movements");

    $("#movement-table").innerHTML = table(
        [
            "DATE",
            "MEDICINE",
            "BATCH",
            "TYPE",
            "QUANTITY",
            "CUSTOMER NAME",
            "REMARKS"
        ],

        rows.map(r => [
            dateTimeText(r.movement_date),

            escapeHtml(r.medicine_name),

            escapeHtml(r.batch_number),

            `<span class="pill ${
                r.movement_type === "OUT" ? "orange" : ""
            }">
                ${escapeHtml(r.movement_type)}
            </span>`,

            r.quantity,

            escapeHtml(r.customer_name || "—"),

            escapeHtml(r.note || "—")
        ])
    );
}

// ================= SALES AND BILLING =================

function updateSalePrice() {
    const option = $("#saleMedicine").selectedOptions[0];

    if (option) {
        $("#salePrice").value = option.dataset.price;
    }
}

$("#saleMedicine").addEventListener("change", updateSalePrice);

function addSaleItem() {
    const id = Number($("#saleMedicine").value);

    const m = medicines.find(
        x => Number(x.medicine_id) === id
    );

    const qty = Number($("#saleQuantity").value);
    const price = Number($("#salePrice").value);

    if (!m || !Number.isInteger(qty) || qty < 1 || price < 0) {
        return toast("Enter valid medicine, quantity and price.");
    }

    const already = cart
        .filter(x => x.medicine_id === id)
        .reduce((sum, x) => sum + x.quantity, 0);

    if (already + qty > Number(m.stock)) {
        return toast("Quantity exceeds available stock.");
    }

    cart.push({
        medicine_id: id,
        medicine_name: m.medicine_name,
        quantity: qty,
        unit_price: price
    });

    renderCart();
}

function renderCart() {
    $("#saleCart").innerHTML = cart.length
        ? table(
            ["MEDICINE", "QTY", "UNIT PRICE", "SUBTOTAL", ""],

            cart.map((item, index) => [
                escapeHtml(item.medicine_name),
                item.quantity,
                money(item.unit_price),
                money(item.quantity * item.unit_price),

                `<button type="button" class="action delete"
                    onclick="removeCart(${index})">
                    Remove
                </button>`
            ])
        )
        : "<div class='empty'>No items added to bill.</div>";

    const total = cart.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0
    );

    $("#saleTotal").textContent = "Total: " + money(total);
}

function removeCart(index) {
    cart.splice(index, 1);
    renderCart();
}

// ================= SAVE SALE =================

$("#saleForm").addEventListener("submit", async e => {
    e.preventDefault();

    if (!cart.length) {
        return toast("Add at least one medicine to the bill.");
    }

    const form = new FormData(e.target);

    const payload = {
        customer_name: form.get("customer_name"),
        customer_phone: form.get("customer_phone"),
        items: cart
    };

    try {
        const result = await api("/api/sales", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        toast(
            `Sale #${result.sale_id} saved · ${money(result.total_amount)}`
        );

        cart = [];

        e.target.reset();

        renderCart();

        await refresh();

    } catch (error) {
        toast(error.message);
    }
});

// Recent sales now include purchased medicine names and quantities.

async function loadSales() {
    const rows = await api("/api/sales");

    $("#sales-table").innerHTML = table(
        [
            "SALE ID",
            "CUSTOMER",
            "PHONE",
            "MEDICINES PURCHASED",
            "DATE",
            "TOTAL"
        ],

        rows.map(s => [
            `#${s.sale_id}`,

            escapeHtml(s.customer_name || "Walk-in Customer"),

            escapeHtml(s.customer_phone || "—"),

            escapeHtml(s.medicines_purchased || "—"),

            dateTimeText(s.sale_date),

            money(s.total_amount)
        ])
    );
}

// ================= SUPPLIERS =================

$("#supplierForm").addEventListener("submit", async e => {
    e.preventDefault();

    const data = Object.fromEntries(
        new FormData(e.target).entries()
    );

    try {
        await api("/api/suppliers", {
            method: "POST",
            body: JSON.stringify(data)
        });

        e.target.reset();

        toast("Supplier added");

        await refresh();

    } catch (error) {
        toast(error.message);
    }
});

async function renderSuppliers() {
    $("#supplier-table").innerHTML = table(
        ["SUPPLIER", "PHONE", "EMAIL", "ADDRESS"],

        suppliers.map(s => [
            escapeHtml(s.supplier_name),
            escapeHtml(s.phone || "—"),
            escapeHtml(s.email || "—"),
            escapeHtml(s.address || "—")
        ])
    );
}

// ================= PAGE NAVIGATION =================

function showView(name) {
    const target = document.getElementById(`${name}-view`);

    if (!target) {
        console.error("Page not found:", name);
        return;
    }

    document.querySelectorAll(".view").forEach(view => {
        view.classList.add("hidden");
    });

    target.classList.remove("hidden");

    document.querySelectorAll(".nav").forEach(nav => {
        nav.classList.toggle(
            "active",
            nav.dataset.view === name
        );
    });

    const titles = {
        dashboard: "Dashboard",
        medicines: "Medicines",
        stock: "Stock movement",
        sales: "Sales & billing",
        suppliers: "Suppliers"
    };

    $("#page-title").textContent = titles[name] || name;

    if (name === "dashboard") {
        loadDashboard().catch(error => toast(error.message));
    }
}

// ================= EVENT LISTENERS =================

document.querySelectorAll(".nav").forEach(nav => {
    nav.addEventListener("click", () => {
        showView(nav.dataset.view);
    });
});

// ================= EXPOSE FUNCTIONS FOR HTML =================

window.openMedicineForm = openMedicineForm;
window.editMedicine = editMedicine;
window.deleteMedicine = deleteMedicine;
window.showView = showView;
window.renderMedicines = renderMedicines;
window.addSaleItem = addSaleItem;
window.removeCart = removeCart;

// ================= INITIALIZE APPLICATION =================

renderCart();
refresh();