import { supabase } from './supabase.js';

let currentCompany = null;
let marketFeedback = null;
let plannedProductionQuantity = 1;
let marketProcessInterval = null;

export async function initializeMarket(company = null) {
    currentCompany = company;
    await refreshMarket();

    if (marketProcessInterval) {
        clearInterval(marketProcessInterval);
    }

    marketProcessInterval = setInterval(async () => {
        const { error } = await supabase.rpc('process_market_listings');

        if (error) {
            console.error('Fehler bei der Marktverarbeitung:', error);
            return;
        }

        await refreshMarket();
        window.dispatchEvent(new CustomEvent('market-changed'));
    }, 30000);
}

export async function refreshMarket(company = null) {
    if (company) {
        currentCompany = company;
    }

    const container = document.getElementById('market-content');

    if (!container) {
        return;
    }

    if (!currentCompany) {
        renderMarketMessage('Kein Unternehmen gefunden.', 'error');
        return;
    }

    const [
        pricesResult,
        materialsResult,
        storageResult,
        listingsResult,
        recipesResult,
        recipeMaterialsResult,
        ownedMaterialsResult,
        profileResult
    ] =
        await Promise.all([
            supabase
                .from('market_prices')
                .select(`
                    product_id,
                    current_price,
                    demand,
                    supply,
                    products (
                        name,
                        unit,
                        base_price
                    )
                `)
                .order('product_id', { ascending: true }),
            supabase
                .from('materials')
                .select('id, name, unit, current_price')
                .order('name', { ascending: true }),
            supabase
                .from('storage')
                .select(`
                    product_id,
                    quantity,
                    products (
                        name,
                        unit,
                        base_price
                    )
                `)
                .eq('company_id', currentCompany.id)
                .order('quantity', { ascending: false }),
            supabase
                .from('market_listings')
                .select(`
                    id,
                    product_id,
                    remaining_quantity,
                    price_per_unit,
                    status,
                    expires_at,
                    total_revenue,
                    products (
                        name,
                        unit,
                        base_price
                    )
                `)
                .eq('company_id', currentCompany.id)
                .eq('status', 'active')
                .order('created_at', { ascending: true }),
            supabase
                .from('recipes')
                .select(`
                    id,
                    product_id,
                    output_quantity,
                    products (
                        name,
                        unlocked
                    )
                `),
            supabase
                .from('recipe_materials')
                .select(`
                    recipe_id,
                    material_id,
                    quantity,
                    materials (
                        name,
                        unit,
                        current_price
                    )
                `),
            supabase
                .from('player_materials')
                .select('material_id, quantity')
                .eq('company_id', currentCompany.id),
            supabase
                .from('profiles')
                .select('cash')
                .eq('id', currentCompany.owner_id)
                .single()
        ]);

    if (
        pricesResult.error ||
        materialsResult.error ||
        storageResult.error ||
        listingsResult.error ||
        recipesResult.error ||
        recipeMaterialsResult.error ||
        ownedMaterialsResult.error ||
        profileResult.error
    ) {
        console.error(
            'Fehler beim Laden des Marktes:',
            pricesResult.error ||
            materialsResult.error ||
            storageResult.error ||
            listingsResult.error ||
            recipesResult.error ||
            recipeMaterialsResult.error ||
            ownedMaterialsResult.error ||
            profileResult.error
        );
        renderMarketMessage('Der Markt konnte nicht geladen werden.', 'error');
        return;
    }

    renderMarket({
        prices: pricesResult.data || [],
        materials: materialsResult.data || [],
        storage: storageResult.data || [],
        listings: listingsResult.data || [],
        ownedMaterials: ownedMaterialsResult.data || [],
        purchasePlan: buildPurchasePlan(
            recipesResult.data || [],
            recipeMaterialsResult.data || [],
            materialsResult.data || [],
            ownedMaterialsResult.data || [],
            Number(profileResult.data?.cash || 0),
            plannedProductionQuantity
        )
    });
}

function renderMarket({
    prices,
    materials,
    storage,
    listings,
    ownedMaterials,
    purchasePlan
}) {
    const container = document.getElementById('market-content');

    if (!container) {
        return;
    }

    const priceRows = prices.map(item => {
        const product = item.products || {};

        return `
            <tr>
                <td>${escapeHtml(product.name || 'Produkt')}</td>
                <td>${formatCurrency(item.current_price)}</td>
                <td>${formatCurrency(product.base_price)}</td>
                <td>${formatNumber(item.demand, 2)}</td>
                <td>${formatNumber(item.supply, 2)}</td>
            </tr>
        `;
    }).join('');

    const ownedByMaterial = new Map(
        ownedMaterials.map(item => [
            item.material_id,
            Number(item.quantity || 0)
        ])
    );

    const materialRows = materials.map(material => `
        <tr>
            <td>${escapeHtml(material.name)}</td>
            <td>${formatCurrency(material.current_price)}</td>
            <td>${escapeHtml(material.unit || '')}</td>
            <td>${formatNumber(ownedByMaterial.get(material.id) || 0, 2)}</td>
            <td>
                <input
                    type="text"
                    inputmode="decimal"
                    value="1"
                    class="market-quantity-input"
                    data-material-id="${escapeHtml(material.id)}"
                >
            </td>
            <td>
                <button
                    type="button"
                    class="secondary-button market-buy-button"
                    data-buy-material="${escapeHtml(material.id)}"
                    data-material-name="${escapeHtml(material.name)}"
                    data-material-price="${escapeHtml(material.current_price)}"
                >
                    Kaufen
                </button>
            </td>
        </tr>
    `).join('');

    const storageRows = storage.map(item => {
        const product = item.products || {};

        return `
            <tr>
                <td>${escapeHtml(product.name || 'Produkt')}</td>
                <td>${formatNumber(item.quantity)} ${escapeHtml(product.unit || '')}</td>
                <td>
                    <input
                        type="number"
                        min="1"
                        max="${escapeHtml(item.quantity)}"
                        step="1"
                        value="1"
                        class="market-quantity-input"
                        data-product-id="${escapeHtml(item.product_id)}"
                    >
                </td>
                <td>
                    <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value="${escapeHtml(product.base_price || 1)}"
                        class="market-price-input"
                        data-price-product-id="${escapeHtml(item.product_id)}"
                    >
                </td>
                <td>
                    <select
                        class="market-duration-input"
                        data-duration-product-id="${escapeHtml(item.product_id)}"
                    >
                        <option value="15">15 Minuten</option>
                        <option value="60" selected>1 Stunde</option>
                        <option value="360">6 Stunden</option>
                        <option value="1440">24 Stunden</option>
                    </select>
                </td>
                <td>
                    <button
                        type="button"
                        class="primary-button market-list-button"
                        data-list-product="${escapeHtml(item.product_id)}"
                    >
                        Angebot einstellen
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    const purchaseRows = purchasePlan.items.map(item => `
        <div class="market-purchase-row">
            <span>${escapeHtml(item.name)} <small>${escapeHtml(item.unit)}</small></span>
            <strong>${formatNumber(item.missing, 2)}</strong>
            <span>${formatCurrency(item.totalCost)}</span>
        </div>
    `).join('');

    const canAfford = purchasePlan.totalCost <= purchasePlan.cash + 0.000001;
    const missingCash = Math.max(
        purchasePlan.totalCost - purchasePlan.cash,
        0
    );
    const purchaseButton = purchasePlan.items.length && canAfford
        ? `
            <button
                type="button"
                class="primary-button"
                data-buy-production-materials
            >
                Fehlende Materialien kaufen
            </button>
        `
        : purchasePlan.items.length
            ? `
            <div class="market-purchase-warning">
                ${formatCurrency(missingCash)} fehlen für den Komplettkauf.
            </div>
            `
            : `
            <div class="market-purchase-complete">
                Alle benötigten Materialien sind vorhanden.
            </div>
        `;

    container.innerHTML = `
        ${marketFeedback
            ? `<div id="market-feedback" class="message ${marketFeedback.type}">${escapeHtml(marketFeedback.message)}</div>`
            : ''}

        <section class="market-purchase-plan">
            <h2>Nächste Produktion: ${escapeHtml(purchasePlan.productName)}</h2>
            <label class="market-production-quantity-label">
                Produktionsmenge
                <input
                    type="number"
                    min="1"
                    step="1"
                    value="${escapeHtml(purchasePlan.productionQuantity)}"
                    data-production-quantity
                >
            </label>
            <p>
                Fehlende Materialien für ${formatNumber(purchasePlan.productionQuantity)} Einheiten:
                ${formatCurrency(purchasePlan.totalCost)}
                <br>
                Guthaben: ${formatCurrency(purchasePlan.cash)}
            </p>
            <div class="market-purchase-rows">
                ${purchaseRows || '<div class="market-purchase-complete">Keine Materialien fehlen.</div>'}
            </div>
            ${purchaseButton}
        </section>

        <section class="market-section">
            <h2>Marktpreise</h2>
            <table class="data-table market-table">
                <thead>
                    <tr>
                        <th>Produkt</th>
                        <th>Marktpreis</th>
                        <th>Grundpreis</th>
                        <th>Nachfrage</th>
                        <th>Angebot</th>
                    </tr>
                </thead>
                <tbody>
                    ${priceRows || '<tr><td colspan="5">Noch keine Marktpreise vorhanden.</td></tr>'}
                </tbody>
            </table>
        </section>

        <section class="market-section">
            <h2>Materialien kaufen</h2>
            <table class="data-table market-table">
                <thead>
                    <tr>
                        <th>Material</th>
                        <th>Preis</th>
                        <th>Einheit</th>
                        <th>Bestand</th>
                        <th>Menge</th>
                        <th>Aktion</th>
                    </tr>
                </thead>
                <tbody>${materialRows}</tbody>
            </table>
        </section>

        <section class="market-section">
            <h2>Produkte auf den Markt stellen</h2>
            <p class="market-help-text">
                Günstige Angebote verkaufen sich schneller. Teure Angebote können länger liegen bleiben.
            </p>
            <table class="data-table market-table">
                <thead>
                    <tr>
                        <th>Produkt</th>
                        <th>Bestand</th>
                        <th>Menge</th>
                        <th>Preis / Stück</th>
                        <th>Dauer</th>
                        <th>Aktion</th>
                    </tr>
                </thead>
                <tbody>
                    ${storageRows || '<tr><td colspan="6">Noch keine fertigen Produkte im Lager.</td></tr>'}
                </tbody>
            </table>
        </section>

        <section class="market-section">
            <h2>Meine aktiven Angebote</h2>
            <table class="data-table market-table">
                <thead>
                    <tr>
                        <th>Produkt</th>
                        <th>Offen</th>
                        <th>Preis / Stück</th>
                        <th>Erlös</th>
                        <th>Endet</th>
                        <th>Aktion</th>
                    </tr>
                </thead>
                <tbody>
                    ${renderListingRows(listings)}
                </tbody>
            </table>
        </section>
    `;

    attachMarketEvents(purchasePlan);
}

function renderListingRows(listings) {
    if (!listings.length) {
        return '<tr><td colspan="6">Keine aktiven Angebote.</td></tr>';
    }

    return listings.map(listing => {
        const product = listing.products || {};
        const expiresAt = new Date(listing.expires_at);

        return `
            <tr>
                <td>${escapeHtml(product.name || 'Produkt')}</td>
                <td>${formatNumber(listing.remaining_quantity, 2)} ${escapeHtml(product.unit || '')}</td>
                <td>${formatCurrency(listing.price_per_unit)}</td>
                <td>${formatCurrency(listing.total_revenue)}</td>
                <td>${formatDateTime(expiresAt)}</td>
                <td>
                    <button
                        type="button"
                        class="secondary-button market-cancel-button"
                        data-cancel-listing="${escapeHtml(listing.id)}"
                    >
                        Zurücknehmen
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function attachMarketEvents(purchasePlan) {
    const productionQuantityInput = document.querySelector(
        '[data-production-quantity]'
    );

    productionQuantityInput?.addEventListener('change', async () => {
        const quantity = Number(productionQuantityInput.value);

        if (!Number.isInteger(quantity) || quantity < 1) {
            productionQuantityInput.value = plannedProductionQuantity;
            return;
        }

        plannedProductionQuantity = quantity;
        await refreshMarket();
    });

    const planButton = document.querySelector(
        '[data-buy-production-materials]'
    );

    planButton?.addEventListener('click', async () => {
        if (purchasePlan.totalCost > purchasePlan.cash + 0.000001) {
            showMarketMessage(
                `${formatCurrency(purchasePlan.totalCost - purchasePlan.cash)} fehlen für den Komplettkauf.`,
                'error'
            );
            return;
        }

        planButton.disabled = true;

        for (const item of purchasePlan.items) {
            const { error } = await supabase.rpc('buy_material', {
                p_company_id: currentCompany.id,
                p_material_id: item.materialId,
                p_quantity: item.missing
            });

            if (error) {
                console.error('Fehler beim Komplettkauf:', error);
                planButton.disabled = false;
                showMarketMessage(translateMarketError(error), 'error');
                return;
            }
        }

        showMarketMessage(
            `${purchasePlan.productName}: alle fehlenden Materialien gekauft.`,
            'success'
        );
        window.dispatchEvent(new CustomEvent('market-changed'));
        await refreshMarket();
    });

    document.querySelectorAll('[data-buy-material]').forEach(button => {
        button.addEventListener('click', async () => {
            const materialId = button.dataset.buyMaterial;
            const input = document.querySelector(
                `.market-quantity-input[data-material-id="${materialId}"]`
            );
            const quantity = parseQuantity(input?.value);

            if (!Number.isFinite(quantity) || quantity <= 0) {
                showMarketMessage('Bitte eine gültige Menge eingeben.', 'error');
                return;
            }

            button.disabled = true;

            const { error } = await supabase.rpc('buy_material', {
                p_company_id: currentCompany.id,
                p_material_id: materialId,
                p_quantity: quantity
            });

            button.disabled = false;

            if (error) {
                console.error('Fehler beim Materialkauf:', error);
                showMarketMessage(translateMarketError(error), 'error');
                return;
            }

            const materialName = button.dataset.materialName || 'Material';
            const materialPrice = Number(
                button.dataset.materialPrice || 0
            );
            const totalCost = materialPrice * quantity;

            showMarketMessage(
                `${formatNumber(quantity, 2)} ${materialName} gekauft - Gesamt: ${formatCurrency(totalCost)}.`,
                'success'
            );
            window.dispatchEvent(new CustomEvent('market-changed'));
            await refreshMarket();
        });
    });

    document.querySelectorAll('[data-list-product]').forEach(button => {
        button.addEventListener('click', async () => {
            const productId = button.dataset.listProduct;
            const quantityInput = document.querySelector(
                `.market-quantity-input[data-product-id="${productId}"]`
            );
            const priceInput = document.querySelector(
                `.market-price-input[data-price-product-id="${productId}"]`
            );
            const durationInput = document.querySelector(
                `.market-duration-input[data-duration-product-id="${productId}"]`
            );
            const quantity = parseQuantity(quantityInput?.value);
            const price = parseQuantity(priceInput?.value);
            const duration = Number(durationInput?.value || 60);

            if (!Number.isFinite(quantity) || quantity <= 0) {
                showMarketMessage('Bitte eine gültige Menge eingeben.', 'error');
                return;
            }

            if (!Number.isFinite(price) || price <= 0) {
                showMarketMessage('Bitte einen gültigen Verkaufspreis eingeben.', 'error');
                return;
            }

            button.disabled = true;

            const { error } = await supabase.rpc('create_market_listing', {
                p_company_id: currentCompany.id,
                p_product_id: productId,
                p_quantity: quantity,
                p_price_per_unit: price,
                p_duration_minutes: duration
            });

            button.disabled = false;

            if (error) {
                console.error('Fehler beim Erstellen des Marktangebots:', error);
                showMarketMessage(translateMarketError(error), 'error');
                return;
            }

            showMarketMessage(
                'Angebot eingestellt. Der Markt verkauft deine Waren nach und nach.',
                'success'
            );
            window.dispatchEvent(new CustomEvent('market-changed'));
            await refreshMarket();
        });
    });

    document.querySelectorAll('[data-cancel-listing]').forEach(button => {
        button.addEventListener('click', async () => {
            button.disabled = true;

            const { error } = await supabase.rpc('cancel_market_listing', {
                p_listing_id: button.dataset.cancelListing
            });

            button.disabled = false;

            if (error) {
                console.error('Fehler beim Zurücknehmen des Marktangebots:', error);
                showMarketMessage(translateMarketError(error), 'error');
                return;
            }

            showMarketMessage('Das Angebot wurde zurückgenommen. Restliche Waren liegen wieder im Lager.', 'success');
            window.dispatchEvent(new CustomEvent('market-changed'));
            await refreshMarket();
        });
    });
}

function showMarketMessage(message, type = 'info') {
    marketFeedback = { message, type };

    const element = document.getElementById('game-message');

    if (!element) {
        return;
    }

    element.textContent = message;
    element.className = `game-message ${type}`;
}

function translateMarketError(error) {
    const message = error?.message || error?.details || error?.hint || '';
    const lower = message.toLowerCase();

    if (lower.includes('cash') || lower.includes('money')) {
        return 'Nicht genügend Geld vorhanden.';
    }

    if (lower.includes('storage')) {
        return 'Dein Lager hat nicht genügend freien Platz.';
    }

    if (lower.includes('quantity') || lower.includes('product')) {
        return 'Die gewünschte Menge ist nicht verfügbar.';
    }

    return message || 'Die Marktaktion konnte nicht ausgeführt werden.';
}

function parseQuantity(value) {
    return Number(
        String(value ?? '')
            .trim()
            .replace(',', '.')
    );
}

function renderMarketMessage(message, type) {
    marketFeedback = { message, type };

    const container = document.getElementById('market-content');

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="message ${type}">${escapeHtml(message)}</div>
    `;
}

function buildPurchasePlan(
    recipes,
    recipeMaterials,
    materials,
    ownedMaterials,
    cash,
    productionQuantity
) {
    const recipe = recipes.find(
        item => item.products?.unlocked !== false
    );

    if (!recipe) {
        return {
            productName: 'Produktion',
            items: [],
            totalCost: 0,
            cash,
            productionQuantity
        };
    }

    const ownedByMaterial = new Map(
        ownedMaterials.map(item => [
            item.material_id,
            Number(item.quantity || 0)
        ])
    );
    const materialById = new Map(
        materials.map(item => [item.id, item])
    );

    const items = recipeMaterials
        .filter(item => item.recipe_id === recipe.id)
        .map(item => {
            const material = materialById.get(item.material_id) || item.materials || {};
            const required =
                Number(item.quantity || 0) * productionQuantity;
            const owned = ownedByMaterial.get(item.material_id) || 0;
            const missing = Math.max(required - owned, 0);
            const price = Number(material.current_price || 0);

            return {
                materialId: item.material_id,
                name: material.name || 'Material',
                unit: material.unit || '',
                missing,
                totalCost: missing * price
            };
        })
        .filter(item => item.missing > 0);

    return {
        productName: recipe.products?.name || 'Produktion',
        items,
        totalCost: items.reduce(
            (total, item) => total + item.totalCost,
            0
        ),
        cash,
        productionQuantity
    };
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
