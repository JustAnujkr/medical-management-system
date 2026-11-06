# MedVault — Medical Store Management System

A starter full-stack medical inventory application using Node.js, Express and MySQL.

## Features
- Medicine batch records: medicine/generic name, category, manufacturer, batch number, MFG date, EXP date, purchase price, MRP, stock and minimum-stock threshold.
- Dashboard totals, low-stock count, expired batch count, 30-day expiry count and today's sales.
- Search, add, edit and delete medicine batches.
- Supplier directory.
- Stock IN/OUT movement history.
- Sales recording with transactional stock deduction.
- Prevents selling expired batches and selling more than available stock.

## Requirements
- Node.js 18+
- MySQL 8+
- npm

## Setup (macOS / Windows)
1. Open this project folder in VS Code.
2. Start your MySQL server.
3. Open MySQL Workbench and run all statements in `database.sql`.
4. In Terminal, install packages:
   ```bash
   npm install
   ```
5. Copy `.env.example` to `.env` and enter your MySQL username/password.
   - macOS/Linux: `cp .env.example .env`
   - Windows PowerShell: `Copy-Item .env.example .env`
6. Start the app:
   ```bash
   npm run dev
   ```
   Or use `npm start`.
7. Open http://localhost:3000

## Important database note
The project stores each medicine batch as a separate inventory record. This is intentional because one medicine can have multiple batches with different manufacturing dates, expiry dates and quantities. Use a separate record for every batch.

## API endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check server/database |
| GET | `/api/dashboard` | Dashboard metrics |
| GET | `/api/medicines?q=` | Search/list medicines |
| POST | `/api/medicines` | Add medicine batch |
| PUT | `/api/medicines/:id` | Update medicine batch |
| DELETE | `/api/medicines/:id` | Delete medicine batch |
| GET/POST | `/api/suppliers` | List/add suppliers |
| POST | `/api/stock/adjust` | Stock IN/OUT |
| GET | `/api/stock/movements` | Stock history |
| POST | `/api/sales` | Record a sale |
| GET | `/api/sales` | Recent sales |

## Suggested future enhancements
- Login with admin/pharmacist roles and password hashing.
- Invoice PDF printing and GST fields.
- Purchase orders and supplier invoices.
- Returns, damaged-stock handling and audit logs.
- Pagination, backups and role-based authorization.

This is an educational starter project, not a validated pharmacy/clinical system. Review local regulatory, tax, privacy and record-retention requirements before real-world deployment.
