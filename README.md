# Inventory – Zoutra & Adraba

Phone app for the monthly stock count (installable from the browser: "Add to Home Screen").

- The app files in this repository are published with GitHub Pages.
- Staff log in with email + password (approved by an owner; 30-day login; reset by email link).
- Counts, products and team members live in the Google Sheet "Zoutra Inventory App - Data", read and written by its attached Apps Script (`backend/Code.gs` is a copy for reference).
- `config.js` holds the address of that Apps Script. No passwords or inventory data are stored here.
