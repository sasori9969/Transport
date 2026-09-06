import { supabase } from './supabase.js';

let currentCompany = null;

export function initializeStorage(company = null) {
    currentCompany = company;
    return refreshStorage();
}

export async function refreshStorage(company = null) {
    if (company) {
        currentCompany = company;
    }

    const container = document.getElementById('storage-content');

    if (!container) {
        return;
    }

    if (!currentCompany) {
        renderStorageMessage('Kein Unternehmen gefunden.', 'error');
        return;
    }

    const { data, error } = await supabase
        .from('storage')
        .select(`
            product_id,
            quantity,
            average_cost,
            average_quality,
            products (
                name,
                unit,
                base_price
            )
        `)
        .eq('company_id', currentCompany.id)
        .order('quantity', { ascending: false });

    if (error) {
        console.error('Fehler beim Laden des Lagers:', error);
        renderStorageMessage('Das Lager konnte nicht geladen werden.', 'error');
        return;
    }

    renderStorage(data || []);
}

function renderStorage(items) {
    const container = document.getElementById('storage-content');

    if (!container) {
        return;
    }

    if (!items.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">▣</div>
                <h3>Dein Lager ist leer</h3>
                <p>Fertige Produkte aus der Produktion werden hier eingelagert.</p>
            </div>
        `;
        return;
    }

    const rows = items.map(item => {
        const product = item.products || {};
        const quantity = Number(item.quantity || 0);
        const quality = Number(item.average_quality || 0);
        const value = quantity * Number(product.base_price || 0);

        return `
            <tr>
                <td>${escapeHtml(product.name || 'Produkt')}</td>
                <td>${formatNumber(quantity)} ${escapeHtml(product.unit || '')}</td>
                <td>${formatNumber(quality, 1)}</td>
                <td>${formatCurrency(value)}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="storage-table-wrapper">
            <table class="data-table storage-table">
                <thead>
                    <tr>
                        <th>Produkt</th>
                        <th>Menge</th>
                        <th>Qualität</th>
                        <th>Geschätzter Wert</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderStorageMessage(message, type) {
    const container = document.getElementById('storage-content');

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="message ${type}">${escapeHtml(message)}</div>
    `;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function formatNumber(value, decimals = 0) {
    return new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(Number(value) || 0);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(Number(value) || 0);
}
