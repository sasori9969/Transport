// ============================================================
// EMPIRE TYCOON
// Produktionssystem
// ============================================================

import { supabase } from './supabase.js';

let currentCompany = null;
let productionInterval = null;
let productionInitialized = false;
const selectedQuantities = new Map();
const selectedRecipes = new Map();

// ============================================================
// INITIALISIERUNG
// ============================================================

export async function initializeProduction(company = null) {
    if (productionInitialized) {
        return;
    }

    productionInitialized = true;

    if (company) {
        currentCompany = company;
    } else {
        await loadCurrentCompany();
    }

    if (!currentCompany) {
        renderProductionError('Kein Unternehmen gefunden.');
        return;
    }

    await refreshProduction();

    if (productionInterval) {
        clearInterval(productionInterval);
    }

    productionInterval = setInterval(async () => {
        await processFinishedJobs();
        await refreshProduction();
    }, 5000);
}

// ============================================================
// UNTERNEHMEN LADEN
// ============================================================

async function loadCurrentCompany() {
    const {
        data: { user },
        error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
        renderProductionError('Nicht eingeloggt.');
        return;
    }

    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('Fehler beim Laden des Unternehmens:', error);
        renderProductionError('Unternehmen konnte nicht geladen werden.');
        return;
    }

    currentCompany = data;
}

// ============================================================
// PRODUKTION AKTUALISIEREN
// ============================================================

export async function refreshProduction() {
    if (!currentCompany) {
        await loadCurrentCompany();
    }

    if (!currentCompany) {
        return;
    }

    await processFinishedJobs();

    const [
        machinesResult,
        jobsResult,
        recipesResult,
        productsResult,
        machineTypesResult,
        recipeMaterialsResult,
        ownedMaterialsResult
    ] = await Promise.all([
        loadMachines(),
        loadProductionJobs(),
        loadRecipes(),
        loadProducts(),
        loadMachineTypes(),
        loadRecipeMaterials(),
        loadOwnedMaterials()
    ]);

    renderProduction({
        machines: machinesResult,
        jobs: jobsResult,
        recipes: recipesResult,
        products: productsResult,
        machineTypes: machineTypesResult,
        recipeMaterials: recipeMaterialsResult,
        ownedMaterials: ownedMaterialsResult
    });
}

// ============================================================
// DATEN LADEN
// ============================================================

async function loadMachines() {
    const { data, error } = await supabase
        .from('machines')
        .select(`
            id,
            company_id,
            location_id,
            machine_type_id,
            name,
            level,
            condition,
            efficiency,
            quality_bonus,
            status,
            machine_types (
                id,
                name,
                purchase_price,
                power_usage,
                base_speed,
                base_quality
            )
        `)
        .eq('company_id', currentCompany.id)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Fehler beim Laden der Maschinen:', error);
        return [];
    }

    return data || [];
}

async function loadProductionJobs() {
    const { data, error } = await supabase
        .from('production_jobs')
        .select(`
            id,
            company_id,
            machine_id,
            recipe_id,
            quantity,
            started_at,
            finishes_at,
            status,
            output_quality
        `)
        .eq('company_id', currentCompany.id)
        .order('finishes_at', { ascending: true });

    if (error) {
        console.error('Fehler beim Laden der Produktionsaufträge:', error);
        return [];
    }

    return data || [];
}

async function loadRecipes() {
    const { data, error } = await supabase
        .from('recipes')
        .select(`
            id,
            product_id,
            machine_type_id,
            production_time_seconds,
            output_quantity
        `);

    if (error) {
        console.error('Fehler beim Laden der Rezepte:', error);
        return [];
    }

    return data || [];
}

async function loadProducts() {
    const { data, error } = await supabase
        .from('products')
        .select(`
            id,
            name,
            category,
            unit,
            base_price,
            base_quality,
            market_demand,
            unlocked
        `)
        .eq('unlocked', true)
        .order('name', { ascending: true });

    if (error) {
        console.error('Fehler beim Laden der Produkte:', error);
        return [];
    }

    return data || [];
}

async function loadMachineTypes() {
    const { data, error } = await supabase
        .from('machine_types')
        .select(`
            id,
            name,
            purchase_price,
            power_usage,
            base_speed,
            base_quality
        `)
        .order('purchase_price', { ascending: true });

    if (error) {
        console.error('Fehler beim Laden der Maschinentypen:', error);
        return [];
    }

    return data || [];
}

async function loadRecipeMaterials() {
    const { data, error } = await supabase
        .from('recipe_materials')
        .select(`
            recipe_id,
            material_id,
            quantity,
            materials (
                name,
                unit
            )
        `);

    if (error) {
        console.error('Fehler beim Laden der Rezeptmaterialien:', error);
        return [];
    }

    return data || [];
}

async function loadOwnedMaterials() {
    const { data, error } = await supabase
        .from('player_materials')
        .select('material_id, quantity')
        .eq('company_id', currentCompany.id);

    if (error) {
        console.error('Fehler beim Laden des Materialbestands:', error);
        return [];
    }

    return data || [];
}

// ============================================================
// FERTIGE PRODUKTION VERARBEITEN
// ============================================================

async function processFinishedJobs() {
    if (!currentCompany) {
        return;
    }

    const { data, error } = await supabase.rpc(
        'process_finished_production'
    );

    if (error) {
        console.error(
            'Fehler bei der Verarbeitung fertiger Produktionen:',
            error
        );
    }

    return data;
}

// ============================================================
// PRODUKTION STARTEN
// ============================================================

export async function startProduction(machineId, recipeId, quantity = 1) {
    if (!currentCompany) {
        showProductionMessage(
            'Kein Unternehmen gefunden.',
            'error'
        );
        return false;
    }

    const parsedQuantity = Number(quantity);

    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
        showProductionMessage(
            'Bitte eine gültige Produktionsmenge eingeben.',
            'error'
        );
        return false;
    }

    const { data, error } = await supabase.rpc(
        'start_production',
        {
            p_company_id: currentCompany.id,
            p_machine_id: machineId,
            p_recipe_id: recipeId,
            p_quantity: parsedQuantity
        }
    );

    if (error) {
        console.error('Fehler beim Start der Produktion:', error);

        showProductionMessage(
            translateProductionError(error),
            'error'
        );

        return false;
    }

    showProductionMessage(
        'Produktion erfolgreich gestartet.',
        'success'
    );

    await refreshProduction();

    return data;
}

// ============================================================
// EINZELNEN PRODUKTIONSJOB ABSCHLIESSEN
// ============================================================

export async function completeProduction(jobId) {
    if (!jobId) {
        return false;
    }

    const { data, error } = await supabase.rpc(
        'complete_production',
        {
            p_job_id: jobId
        }
    );

    if (error) {
        console.error(
            'Fehler beim Abschließen der Produktion:',
            error
        );

        showProductionMessage(
            translateProductionError(error),
            'error'
        );

        return false;
    }

    showProductionMessage(
        'Produktion abgeschlossen und eingelagert.',
        'success'
    );

    await refreshProduction();

    return data;
}

// ============================================================
// PRODUKTIONSANSICHT
// ============================================================

function renderProduction({
    machines,
    jobs,
    recipes,
    products,
    machineTypes,
    recipeMaterials,
    ownedMaterials
}) {
    const container = document.getElementById('production-content');

    if (!container) {
        return;
    }

    container
        .querySelectorAll('.production-quantity-input')
        .forEach(input => {
            selectedQuantities.set(
                input.dataset.machineId,
                input.value
            );
        });

    container
        .querySelectorAll('.production-recipe-select')
        .forEach(select => {
            selectedRecipes.set(
                select.dataset.machineId,
                select.value
            );
        });

    const jobsByMachine = new Map();

    jobs.forEach(job => {
        jobsByMachine.set(job.machine_id, job);
    });

    let html = '';

    html += `
        <div class="production-header">
            <div>
                <h2>Produktion</h2>
                <p>
                    Produziere Waren, verwalte deine Maschinen
                    und baue dein Imperium aus.
                </p>
            </div>
        </div>
    `;

    if (!machines.length) {
        html += renderNoMachines(machineTypes);
        container.innerHTML = html;
        return;
    }

    html += `
        <div class="production-machines">
    `;

    machines.forEach(machine => {
        const activeJob = jobsByMachine.get(machine.id);

        html += renderMachineCard(
            machine,
            activeJob,
            recipes,
            products,
            recipeMaterials,
            ownedMaterials
        );
    });

    html += `
        </div>
    `;

    container.innerHTML = html;

    attachProductionEvents(
        recipes,
        recipeMaterials,
        ownedMaterials
    );
}

// ============================================================
// MASCHINENKARTE
// ============================================================

function renderMachineCard(
    machine,
    activeJob,
    recipes,
    products,
    recipeMaterials,
    ownedMaterials
) {
    const machineType = machine.machine_types || {};

    const machineRecipes = recipes.filter(
        recipe =>
            recipe.machine_type_id === machine.machine_type_id
    );

    let html = `
        <div class="production-machine-card">

            <div class="production-machine-header">
                <div>
                    <h3>${escapeHtml(machine.name)}</h3>
                    <span class="production-machine-type">
                        ${escapeHtml(machineType.name || 'Maschine')}
                    </span>
                </div>

                <span class="machine-status ${getMachineStatusClass(machine.status)}">
                    ${getMachineStatusText(machine.status)}
                </span>
            </div>

            <div class="production-machine-stats">

                <div class="production-stat">
                    <span>Stufe</span>
                    <strong>${formatNumber(machine.level)}</strong>
                </div>

                <div class="production-stat">
                    <span>Zustand</span>
                    <strong>${formatNumber(machine.condition)}%</strong>
                </div>

                <div class="production-stat">
                    <span>Effizienz</span>
                    <strong>${formatNumber(machine.efficiency, 2)}x</strong>
                </div>

                <div class="production-stat">
                    <span>Qualität</span>
                    <strong>+${formatNumber(machine.quality_bonus, 0)}</strong>
                </div>

            </div>
    `;

    if (activeJob && activeJob.status === 'running') {
        html += renderActiveProduction(
            activeJob,
            machine,
            recipes,
            products
        );
    } else {
        html += renderProductionSelector(
            machine,
            machineRecipes,
            products,
            recipeMaterials,
            ownedMaterials
        );
    }

    html += `
        </div>
    `;

    return html;
}

// ============================================================
// AKTIVE PRODUKTION
// ============================================================

function renderActiveProduction(
    job,
    machine,
    recipes,
    products
) {
    const recipe = recipes.find(
        item => item.id === job.recipe_id
    );

    const product = recipe
        ? products.find(item => item.id === recipe.product_id)
        : null;

    const finishTime = new Date(job.finishes_at);
    const startTime = new Date(job.started_at);

    const now = Date.now();
    const start = startTime.getTime();
    const finish = finishTime.getTime();

    const total = Math.max(finish - start, 1);
    const elapsed = Math.min(
        Math.max(now - start, 0),
        total
    );

    const progress = Math.min(
        Math.max((elapsed / total) * 100, 0),
        100
    );

    const remaining = Math.max(
        finish - now,
        0
    );

    return `
        <div class="production-active">

            <div class="production-active-title">
                <span>Aktuelle Produktion</span>
                <strong>
                    ${escapeHtml(product?.name || 'Produkt')}
                </strong>
            </div>

            <div class="production-progress">
                <div
                    class="production-progress-bar"
                    style="width: ${progress.toFixed(1)}%"
                ></div>
            </div>

            <div class="production-active-info">

                <span>
                    Menge:
                    <strong>${formatNumber(job.quantity)}</strong>
                </span>

                <span>
                    Fertig:
                    <strong>
                        ${formatDateTime(finishTime)}
                    </strong>
                </span>

                <span>
                    Restzeit:
                    <strong
                        data-production-countdown="${escapeHtml(job.id)}"
                        data-finish-time="${finishTime.toISOString()}"
                    >
                        ${formatDuration(remaining)}
                    </strong>
                </span>

            </div>

            ${
                remaining <= 0
                    ? `
                        <button
                            class="production-complete-button"
                            data-complete-production="${escapeHtml(job.id)}"
                        >
                            Produktion einlagern
                        </button>
                    `
                    : ''
            }

        </div>
    `;
}

// ============================================================
// PRODUKTIONSAUSWAHL
// ============================================================

function renderProductionSelector(
    machine,
    recipes,
    products,
    recipeMaterials,
    ownedMaterials
) {
    if (
        machine.status === 'maintenance' ||
        machine.status === 'broken'
    ) {
        return `
            <div class="production-unavailable">
                Maschine ist aktuell nicht verfügbar.
            </div>
        `;
    }

    if (!recipes.length) {
        return `
            <div class="production-unavailable">
                Für diese Maschine ist noch kein Rezept verfügbar.
            </div>
        `;
    }

    const firstRecipe = recipes[0];
    const storedRecipeId = selectedRecipes.get(machine.id);
    const selectedRecipeId = recipes.some(
        recipe => recipe.id === storedRecipeId
    )
        ? storedRecipeId
        : firstRecipe.id;
    const selectedQuantity =
        selectedQuantities.get(machine.id) || 1;
    const canStart = canProduceRecipe(
        selectedRecipeId,
        selectedQuantity,
        recipes,
        recipeMaterials,
        ownedMaterials
    );

    let options = '';

    recipes.forEach(recipe => {
        const product = products.find(
            item => item.id === recipe.product_id
        );

        if (!product) {
            return;
        }

        options += `
            <option
                value="${escapeHtml(recipe.id)}"
                ${recipe.id === selectedRecipeId ? 'selected' : ''}
            >
                ${escapeHtml(product.name)}
                – ${formatDuration(
                    recipe.production_time_seconds * 1000
                )}
            </option>
        `;
    });

    return `
        <div class="production-form">

            <label>
                Produkt
            </label>

            <select
                class="production-recipe-select"
                data-machine-id="${escapeHtml(machine.id)}"
            >
                ${options}
            </select>

            <label>
                Menge
            </label>

            <input
                type="number"
                min="1"
                step="1"
                value="${escapeHtml(selectedQuantity)}"
                class="production-quantity-input"
                data-machine-id="${escapeHtml(machine.id)}"
            >

            <div class="production-material-requirements">
                ${renderMaterialRequirements(
                    selectedRecipeId,
                    recipes,
                    recipeMaterials,
                    ownedMaterials,
                    Number(selectedQuantity) || 1
                )}
            </div>

            <button
                class="production-start-button"
                data-start-production="${escapeHtml(machine.id)}"
                ${canStart ? '' : 'disabled'}
            >
                Produktion starten
            </button>

        </div>
    `;
}

function canProduceRecipe(
    recipeId,
    quantity,
    recipes,
    recipeMaterials,
    ownedMaterials
) {
    const parsedQuantity = Number(quantity);

    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
        return false;
    }

    const recipe = recipes.find(item => item.id === recipeId);

    if (!recipe) {
        return false;
    }

    const ownedByMaterial = new Map(
        ownedMaterials.map(item => [
            item.material_id,
            Number(item.quantity || 0)
        ])
    );

    return recipeMaterials
        .filter(item => item.recipe_id === recipe.id)
        .every(item => {
            const required = Number(item.quantity || 0) * parsedQuantity;
            const owned = ownedByMaterial.get(item.material_id) || 0;
            return owned >= required;
        });
}

function renderMaterialRequirements(
    recipeId,
    recipes,
    recipeMaterials,
    ownedMaterials,
    quantity
) {
    const selectedRecipe = recipes.find(
        recipe => recipe.id === recipeId
    );

    if (!selectedRecipe) {
        return '';
    }

    const requirements = recipeMaterials.filter(
        item => item.recipe_id === selectedRecipe.id
    );

    if (!requirements.length) {
        return `
            <div class="production-materials-ok">
                Keine Rohstoffe erforderlich.
            </div>
        `;
    }

    const ownedByMaterial = new Map(
        ownedMaterials.map(item => [
            item.material_id,
            Number(item.quantity || 0)
        ])
    );

    const rows = requirements.map(requirement => {
        const material = requirement.materials || {};
        const required = Number(requirement.quantity || 0) * quantity;
        const owned = ownedByMaterial.get(requirement.material_id) || 0;
        const enough = owned >= required;
        const statusClass = enough
            ? 'material-available'
            : 'material-missing';
        const statusText = enough ? 'ausreichend' : 'fehlt';

        return `
            <div class="production-material-row ${statusClass}">
                <span>
                    ${escapeHtml(material.name || 'Material')}
                    <small>${escapeHtml(material.unit || '')}</small>
                </span>
                <strong>
                    ${formatNumber(owned, 2)} /
                    ${formatNumber(required, 2)}
                </strong>
                <em>${statusText}</em>
            </div>
        `;
    }).join('');

    return `
        <div class="production-materials-title">
            Benötigte Rohstoffe
        </div>
        ${rows}
    `;
}

// ============================================================
// KEINE MASCHINEN
// ============================================================

function renderNoMachines(machineTypes) {
    const freeWorkbench = machineTypes.find(
        type =>
            type.purchase_price === 0 &&
            type.name.toLowerCase().includes('werkbank')
    );

    return `
        <div class="production-empty">

            <div class="production-empty-icon">
                🛠️
            </div>

            <h3>Noch keine Produktionsmaschine vorhanden</h3>

            <p>
                Deine erste Produktionsstätte beginnt mit
                einer kostenlosen Werkbank.
            </p>

            ${
                freeWorkbench
                    ? `
                        <div class="production-empty-note">
                            Kostenlose Werkbank:
                            <strong>
                                ${escapeHtml(freeWorkbench.name)}
                            </strong>
                        </div>
                    `
                    : ''
            }

            <p class="production-empty-hint">
                Die Werkbank wird beim Start deines Unternehmens
                eingerichtet.
            </p>

        </div>
    `;
}

// ============================================================
// EVENTS
// ============================================================

function attachProductionEvents(
    recipes,
    recipeMaterials,
    ownedMaterials
) {
    const recipeSelects = document.querySelectorAll(
        '.production-recipe-select'
    );

    recipeSelects.forEach(select => {
        const form = select.closest('.production-form');
        const quantityInput = form?.querySelector(
            '.production-quantity-input'
        );
        const requirements = form?.querySelector(
            '.production-material-requirements'
        );
        const startButton = form?.querySelector(
            '[data-start-production]'
        );

        const updateRequirements = () => {
            if (!quantityInput || !requirements) {
                return;
            }

            const quantity = Number(quantityInput.value) || 1;

            requirements.innerHTML = renderMaterialRequirements(
                select.value,
                recipes,
                recipeMaterials,
                ownedMaterials,
                quantity
            );

            if (startButton) {
                startButton.disabled = !canProduceRecipe(
                    select.value,
                    quantity,
                    recipes,
                    recipeMaterials,
                    ownedMaterials
                );
            }
        };

        select.addEventListener('change', () => {
            selectedRecipes.set(
                select.dataset.machineId,
                select.value
            );
            updateRequirements();
        });
        quantityInput?.addEventListener('input', () => {
            selectedQuantities.set(
                select.dataset.machineId,
                quantityInput.value
            );
            updateRequirements();
        });

        updateRequirements();
    });

    const startButtons = document.querySelectorAll(
        '[data-start-production]'
    );

    startButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const machineId =
                button.dataset.startProduction;

            const recipeSelect =
                document.querySelector(
                    `.production-recipe-select[data-machine-id="${machineId}"]`
                );

            const quantityInput =
                document.querySelector(
                    `.production-quantity-input[data-machine-id="${machineId}"]`
                );

            if (!recipeSelect || !quantityInput) {
                return;
            }

            const recipeId = recipeSelect.value;
            const quantity = Number(quantityInput.value);

            button.disabled = true;

            await startProduction(
                machineId,
                recipeId,
                quantity
            );

            button.disabled = false;
        });
    });

    const completeButtons = document.querySelectorAll(
        '[data-complete-production]'
    );

    completeButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const jobId =
                button.dataset.completeProduction;

            button.disabled = true;

            await completeProduction(jobId);
        });
    });
}

// ============================================================
// COUNTDOWN
// ============================================================

function updateCountdowns() {
    const countdowns = document.querySelectorAll(
        '[data-production-countdown]'
    );

    countdowns.forEach(element => {
        const finishTime =
            new Date(
                element.dataset.finishTime
            ).getTime();

        const remaining =
            Math.max(
                finishTime - Date.now(),
                0
            );

        element.textContent =
            formatDuration(remaining);

        if (remaining <= 0) {
            element.closest('.production-active')
                ?.querySelector(
                    '.production-complete-button'
                );
        }
    });
}

setInterval(updateCountdowns, 1000);

// ============================================================
// FEHLERMELDUNGEN
// ============================================================

function translateProductionError(error) {
    const message =
        error?.message ||
        error?.details ||
        error?.hint ||
        '';

    const lower =
        message.toLowerCase();

    if (lower.includes('not enough')) {
        return 'Nicht genügend Rohstoffe vorhanden.';
    }

    if (lower.includes('material')) {
        return 'Die benötigten Rohstoffe sind nicht ausreichend vorhanden.';
    }

    if (lower.includes('storage')) {
        return 'Dein Lager hat nicht genügend freien Platz.';
    }

    if (lower.includes('machine')) {
        return 'Die Maschine ist nicht verfügbar.';
    }

    if (lower.includes('recipe')) {
        return 'Dieses Rezept kann mit der Maschine nicht produziert werden.';
    }

    if (lower.includes('cash')) {
        return 'Nicht genügend Geld vorhanden.';
    }

    if (message) {
        return message;
    }

    return 'Die Produktion konnte nicht ausgeführt werden.';
}

// ============================================================
// UI HILFEN
// ============================================================

function showProductionMessage(message, type = 'info') {
    const element =
        document.getElementById('game-message');

    if (!element) {
        return;
    }

    element.textContent = message;
    element.className =
        `game-message ${type}`;

    setTimeout(() => {
        element.textContent = '';
        element.className = 'game-message';
    }, 4000);
}

function renderProductionError(message) {
    const container =
        document.getElementById('production-content');

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="production-error">
            ${escapeHtml(message)}
        </div>
    `;
}

// ============================================================
// FORMATIERUNG
// ============================================================

function formatCurrency(value) {
    return new Intl.NumberFormat(
        'de-DE',
        {
            style: 'currency',
            currency: 'EUR'
        }
    ).format(Number(value) || 0);
}

function formatNumber(value, decimals = 0) {
    return new Intl.NumberFormat(
        'de-DE',
        {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }
    ).format(Number(value) || 0);
}

function formatDateTime(date) {
    return new Intl.DateTimeFormat(
        'de-DE',
        {
            dateStyle: 'short',
            timeStyle: 'short'
        }
    ).format(date);
}

function formatDuration(milliseconds) {
    const totalSeconds =
        Math.max(
            Math.floor(milliseconds / 1000),
            0
        );

    const hours =
        Math.floor(totalSeconds / 3600);

    const minutes =
        Math.floor(
            (totalSeconds % 3600) / 60
        );

    const seconds =
        totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
}

function getMachineStatusClass(status) {
    switch (status) {
        case 'working':
            return 'status-working';

        case 'maintenance':
            return 'status-maintenance';

        case 'broken':
            return 'status-broken';

        default:
            return 'status-idle';
    }
}

function getMachineStatusText(status) {
    switch (status) {
        case 'working':
            return 'Produktion';

        case 'maintenance':
            return 'Wartung';

        case 'broken':
            return 'Defekt';

        default:
            return 'Bereit';
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================================
// EXPORT
// ============================================================

export default {
    initializeProduction,
    refreshProduction,
    startProduction,
    completeProduction
};
