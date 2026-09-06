// ============================================================
// EMPIRE TYCOON
// Maschinen: Katalog, Bestand, Kauf, Verkauf, Reparatur
// ============================================================

import { supabase } from './supabase.js';

let currentCompany = null;
let currentLocation = null;
let machinesInitialized = false;

// Spielregeln – müssen zu supabase/07_machines.sql passen
const SELL_FACTOR = 0.5;
const REPAIR_FACTOR = 0.3;
const MAX_NAME_LENGTH = 60;


// ============================================================
// INITIALISIERUNG
// ============================================================

export async function initializeMachines(company = null, location = null) {
    if (company) {
        currentCompany = company;
    }

    if (location) {
        currentLocation = location;
    }

    machinesInitialized = true;

    await refreshMachines();
}


// ============================================================
// AKTUALISIEREN
// ============================================================

export async function refreshMachines(company = null, location = null) {
    if (company) {
        currentCompany = company;
    }

    if (location) {
        currentLocation = location;
    }

    const container = document.getElementById('machines-content');

    if (!container) {
        return;
    }

    if (!currentCompany) {
        renderMachinesMessage('Kein Unternehmen gefunden.', 'error');
        return;
    }

    if (!currentLocation) {
        await loadLocation();
    }

    const [
        machinesResult,
        machineTypesResult,
        jobsResult,
        profileResult
    ] = await Promise.all([
        supabase
            .from('machines')
            .select(`
                id,
                machine_type_id,
                name,
                level,
                condition,
                efficiency,
                quality_bonus,
                status,
                created_at,
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
            .order('created_at', { ascending: true }),
        supabase
            .from('machine_types')
            .select(`
                id,
                name,
                purchase_price,
                power_usage,
                base_speed,
                base_quality
            `)
            .order('purchase_price', { ascending: true }),
        supabase
            .from('production_jobs')
            .select('machine_id, status')
            .eq('company_id', currentCompany.id)
            .eq('status', 'running'),
        supabase
            .from('profiles')
            .select('cash')
            .eq('id', currentCompany.owner_id)
            .single()
    ]);

    const error =
        machinesResult.error ||
        machineTypesResult.error ||
        jobsResult.error ||
        profileResult.error;

    if (error) {
        console.error('Fehler beim Laden der Maschinen:', error);
        renderMachinesMessage(
            'Die Maschinen konnten nicht geladen werden.',
            'error'
        );
        return;
    }

    renderMachines({
        machines: machinesResult.data || [],
        machineTypes: machineTypesResult.data || [],
        runningJobs: jobsResult.data || [],
        cash: Number(profileResult.data?.cash || 0)
    });
}


// ============================================================
// STANDORT LADEN (Fallback, falls nicht übergeben)
// ============================================================

async function loadLocation() {
    if (!currentCompany) {
        return;
    }

    const { data, error } = await supabase
        .from('locations')
        .select('id, name, power_capacity, storage_capacity')
        .eq('company_id', currentCompany.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('Fehler beim Laden des Standorts:', error);
        return;
    }

    currentLocation = data;
}


// ============================================================
// RENDERING
// ============================================================

function renderMachines({ machines, machineTypes, runningJobs, cash }) {
    const container = document.getElementById('machines-content');

    if (!container) {
        return;
    }

    const busyMachineIds = new Set(
        runningJobs.map(job => job.machine_id)
    );

    const powerCapacity = Number(currentLocation?.power_capacity || 0);
    const powerUsed = machines.reduce(
        (total, machine) =>
            total + Number(machine.machine_types?.power_usage || 0),
        0
    );
    const powerFree = Math.max(powerCapacity - powerUsed, 0);

    const ownedTypeIds = new Set(
        machines.map(machine => machine.machine_type_id)
    );

    container.innerHTML = `
        ${renderPowerSummary({
            machines,
            cash,
            powerUsed,
            powerCapacity
        })}

        <section class="machines-section">
            <div class="machines-section-header">
                <h2>Deine Maschinen</h2>
                <span>${formatNumber(machines.length)} ${machines.length === 1 ? 'Anlage' : 'Anlagen'}</span>
            </div>
            ${
                machines.length
                    ? `
                        <div class="machines-grid">
                            ${machines
                                .map(machine =>
                                    renderOwnedMachine(
                                        machine,
                                        busyMachineIds.has(machine.id),
                                        cash
                                    )
                                )
                                .join('')}
                        </div>
                    `
                    : `
                        <div class="empty-state">
                            <div class="empty-icon">⚙</div>
                            <h3>Noch keine Maschinen</h3>
                            <p>Kaufe unten deine erste Anlage.</p>
                        </div>
                    `
            }
        </section>

        <section class="machines-section">
            <div class="machines-section-header">
                <h2>Maschinen kaufen</h2>
                <span>Guthaben: <strong>${formatCurrency(cash)}</strong></span>
            </div>
            ${
                machineTypes.length
                    ? `
                        <div class="machines-grid">
                            ${machineTypes
                                .map(type =>
                                    renderCatalogItem(type, {
                                        cash,
                                        powerFree,
                                        alreadyOwned: ownedTypeIds.has(type.id)
                                    })
                                )
                                .join('')}
                        </div>
                    `
                    : `
                        <div class="empty-state">
                            <div class="empty-icon">⚙</div>
                            <h3>Keine Maschinentypen verfügbar</h3>
                            <p>Der Katalog ist derzeit leer.</p>
                        </div>
                    `
            }
        </section>
    `;

    attachMachineEvents();
}


// ------------------------------------------------------------
// Stromübersicht
// ------------------------------------------------------------

function renderPowerSummary({ machines, cash, powerUsed, powerCapacity }) {
    const ratio = powerCapacity > 0
        ? Math.min(powerUsed / powerCapacity, 1)
        : 0;

    const percent = Math.round(ratio * 100);

    let gaugeClass = 'ok';

    if (ratio >= 1) {
        gaugeClass = 'full';
    } else if (ratio >= 0.75) {
        gaugeClass = 'warning';
    }

    const brokenCount = machines.filter(
        machine => machine.status === 'broken'
    ).length;

    const workingCount = machines.filter(
        machine => machine.status === 'working'
    ).length;

    return `
        <div class="machines-summary">
            <div class="machines-summary-card machines-power">
                <div class="machines-summary-label">
                    <span>Stromkapazität – ${escapeHtml(currentLocation?.name || 'Standort')}</span>
                    <strong>${formatNumber(powerUsed, 1)} / ${formatNumber(powerCapacity, 1)} kW</strong>
                </div>
                <div class="power-gauge">
                    <div
                        class="power-gauge-bar ${gaugeClass}"
                        style="width: ${percent}%"
                    ></div>
                </div>
                <p class="machines-summary-hint">
                    ${
                        ratio >= 1
                            ? 'Dein Stromnetz ist ausgelastet. Verkaufe eine Maschine oder erweitere später deinen Standort.'
                            : `Noch ${formatNumber(powerCapacity - powerUsed, 1)} kW frei für neue Anlagen.`
                    }
                </p>
            </div>

            <div class="machines-summary-card">
                <span class="machines-summary-title">Anlagen</span>
                <strong class="machines-summary-value">${formatNumber(machines.length)}</strong>
                <p class="machines-summary-hint">
                    ${formatNumber(workingCount)} in Produktion
                    ${brokenCount ? `· <span class="text-danger">${formatNumber(brokenCount)} defekt</span>` : ''}
                </p>
            </div>

            <div class="machines-summary-card">
                <span class="machines-summary-title">Guthaben</span>
                <strong class="machines-summary-value">${formatCurrency(cash)}</strong>
                <p class="machines-summary-hint">Verfügbar für Investitionen</p>
            </div>
        </div>
    `;
}


// ------------------------------------------------------------
// Eigene Maschine
// ------------------------------------------------------------

function renderOwnedMachine(machine, isBusy, cash) {
    const type = machine.machine_types || {};
    const purchasePrice = Number(type.purchase_price || 0);
    const condition = clamp(Number(machine.condition || 0), 0, 100);
    const isFree = purchasePrice <= 0;
    const busy = isBusy || machine.status === 'working';

    const sellValue = round2(
        purchasePrice * SELL_FACTOR * (condition / 100)
    );

    const repairCost = round2(
        purchasePrice * REPAIR_FACTOR * ((100 - condition) / 100)
    );

    const needsRepair = condition < 100;
    const canAffordRepair = repairCost <= cash + 0.000001;

    let conditionClass = 'good';

    if (condition < 40) {
        conditionClass = 'bad';
    } else if (condition < 75) {
        conditionClass = 'medium';
    }

    return `
        <article class="machine-card" data-machine-id="${escapeHtml(machine.id)}">
            <div class="machine-card-header">
                <div>
                    <h3>${escapeHtml(machine.name)}</h3>
                    <span class="machine-card-type">${escapeHtml(type.name || 'Maschine')}</span>
                </div>
                <span class="machine-status ${getMachineStatusClass(machine.status)}">
                    ${getMachineStatusText(machine.status)}
                </span>
            </div>

            <div class="machine-condition">
                <div class="machine-condition-label">
                    <span>Zustand</span>
                    <strong>${formatNumber(condition, 0)}%</strong>
                </div>
                <div class="condition-bar">
                    <div
                        class="condition-bar-fill ${conditionClass}"
                        style="width: ${condition}%"
                    ></div>
                </div>
            </div>

            <div class="machine-card-stats">
                <div class="machine-stat">
                    <span>Stufe</span>
                    <strong>${formatNumber(machine.level || 1)}</strong>
                </div>
                <div class="machine-stat">
                    <span>Effizienz</span>
                    <strong>${formatNumber(machine.efficiency || 1, 2)}x</strong>
                </div>
                <div class="machine-stat">
                    <span>Qualität</span>
                    <strong>+${formatNumber(machine.quality_bonus || 0, 0)}</strong>
                </div>
                <div class="machine-stat">
                    <span>Strom</span>
                    <strong>${formatNumber(type.power_usage || 0, 1)} kW</strong>
                </div>
            </div>

            <div class="machine-card-actions">
                ${
                    isFree
                        ? `
                            <span class="machine-card-note">
                                Deine Startausrüstung – bleibt dir immer erhalten.
                            </span>
                        `
                        : `
                            ${
                                needsRepair
                                    ? `
                                        <button
                                            type="button"
                                            class="secondary-button"
                                            data-repair-machine="${escapeHtml(machine.id)}"
                                            data-machine-name="${escapeHtml(machine.name)}"
                                            data-repair-cost="${repairCost}"
                                            ${busy || !canAffordRepair ? 'disabled' : ''}
                                            title="${busy ? 'Maschine ist in Produktion' : (!canAffordRepair ? 'Nicht genügend Geld' : '')}"
                                        >
                                            Reparieren · ${formatCurrency(repairCost)}
                                        </button>
                                    `
                                    : ''
                            }
                            <button
                                type="button"
                                class="danger-button"
                                data-sell-machine="${escapeHtml(machine.id)}"
                                data-machine-name="${escapeHtml(machine.name)}"
                                data-sell-value="${sellValue}"
                                ${busy ? 'disabled' : ''}
                                title="${busy ? 'Maschine ist in Produktion' : ''}"
                            >
                                Verkaufen · ${formatCurrency(sellValue)}
                            </button>
                        `
                }
            </div>
        </article>
    `;
}


// ------------------------------------------------------------
// Katalog-Eintrag
// ------------------------------------------------------------

function renderCatalogItem(type, { cash, powerFree, alreadyOwned }) {
    const price = Number(type.purchase_price || 0);
    const power = Number(type.power_usage || 0);
    const isFree = price <= 0;

    const canAfford = price <= cash + 0.000001;
    const hasPower = power <= powerFree + 0.000001;
    const freeBlocked = isFree && alreadyOwned;
    const canBuy = canAfford && hasPower && !freeBlocked;

    let blocker = '';

    if (freeBlocked) {
        blocker = 'Bereits vorhanden';
    } else if (!hasPower) {
        blocker = `Zu wenig Strom (${formatNumber(power, 1)} kW benötigt)`;
    } else if (!canAfford) {
        blocker = `${formatCurrency(price - cash)} fehlen`;
    }

    return `
        <article class="machine-card catalog ${canBuy ? '' : 'is-locked'}">
            <div class="machine-card-header">
                <div>
                    <h3>${escapeHtml(type.name)}</h3>
                    <span class="machine-card-type">
                        ${alreadyOwned ? 'Im Besitz' : 'Neu'}
                    </span>
                </div>
                <strong class="machine-price">
                    ${isFree ? 'Kostenlos' : formatCurrency(price)}
                </strong>
            </div>

            <p class="machine-card-description">
                ${escapeHtml(type.description || 'Keine Beschreibung vorhanden.')}
            </p>

            <div class="machine-card-stats">
                <div class="machine-stat">
                    <span>Tempo</span>
                    <strong>${formatNumber(type.base_speed || 1, 2)}x</strong>
                </div>
                <div class="machine-stat">
                    <span>Qualität</span>
                    <strong>+${formatNumber(type.base_quality || 0, 0)}</strong>
                </div>
                <div class="machine-stat">
                    <span>Strom</span>
                    <strong>${formatNumber(power, 1)} kW</strong>
                </div>
            </div>

            <div class="machine-card-actions machine-buy-row">
                <input
                    type="text"
                    class="machine-name-input"
                    data-machine-type-id="${escapeHtml(type.id)}"
                    maxlength="${MAX_NAME_LENGTH}"
                    placeholder="Name (optional)"
                    aria-label="Name für ${escapeHtml(type.name)}"
                    ${canBuy ? '' : 'disabled'}
                >
                <button
                    type="button"
                    class="primary-button"
                    data-buy-machine="${escapeHtml(type.id)}"
                    data-machine-type-name="${escapeHtml(type.name)}"
                    data-machine-price="${price}"
                    ${canBuy ? '' : 'disabled'}
                    title="${escapeHtml(blocker)}"
                >
                    Kaufen
                </button>
            </div>

            ${
                blocker
                    ? `<p class="machine-card-blocker">${escapeHtml(blocker)}</p>`
                    : ''
            }
        </article>
    `;
}


// ============================================================
// EVENTS
// ============================================================

function attachMachineEvents() {
    document.querySelectorAll('[data-buy-machine]').forEach(button => {
        button.addEventListener('click', async () => {
            const typeId = button.dataset.buyMachine;
            const typeName = button.dataset.machineTypeName || 'Maschine';
            const price = Number(button.dataset.machinePrice || 0);

            const input = document.querySelector(
                `.machine-name-input[data-machine-type-id="${typeId}"]`
            );

            const customName = String(input?.value || '')
                .trim()
                .slice(0, MAX_NAME_LENGTH);

            if (
                price > 0 &&
                !window.confirm(
                    `${typeName} für ${formatCurrency(price)} kaufen?`
                )
            ) {
                return;
            }

            button.disabled = true;

            const { data, error } = await supabase.rpc('buy_machine', {
                p_company_id: currentCompany.id,
                p_machine_type_id: typeId,
                p_name: customName || null
            });

            if (error) {
                console.error('Fehler beim Maschinenkauf:', error);
                button.disabled = false;
                showMachinesMessage(translateMachineError(error), 'error');
                return;
            }

            const machineName = data?.name || typeName;

            showMachinesMessage(
                price > 0
                    ? `${machineName} gekauft – ${formatCurrency(price)} investiert.`
                    : `${machineName} eingerichtet.`,
                'success'
            );

            notifyChange();
            await refreshMachines();
        });
    });

    document.querySelectorAll('[data-sell-machine]').forEach(button => {
        button.addEventListener('click', async () => {
            const machineId = button.dataset.sellMachine;
            const machineName = button.dataset.machineName || 'Maschine';
            const sellValue = Number(button.dataset.sellValue || 0);

            if (
                !window.confirm(
                    `${machineName} wirklich für ${formatCurrency(sellValue)} verkaufen?\n\nDie Maschine ist danach unwiderruflich weg.`
                )
            ) {
                return;
            }

            button.disabled = true;

            const { data, error } = await supabase.rpc('sell_machine', {
                p_machine_id: machineId
            });

            if (error) {
                console.error('Fehler beim Maschinenverkauf:', error);
                button.disabled = false;
                showMachinesMessage(translateMachineError(error), 'error');
                return;
            }

            showMachinesMessage(
                `${machineName} verkauft – ${formatCurrency(Number(data ?? sellValue))} erhalten.`,
                'success'
            );

            notifyChange();
            await refreshMachines();
        });
    });

    document.querySelectorAll('[data-repair-machine]').forEach(button => {
        button.addEventListener('click', async () => {
            const machineId = button.dataset.repairMachine;
            const machineName = button.dataset.machineName || 'Maschine';
            const repairCost = Number(button.dataset.repairCost || 0);

            button.disabled = true;

            const { data, error } = await supabase.rpc('repair_machine', {
                p_machine_id: machineId
            });

            if (error) {
                console.error('Fehler bei der Reparatur:', error);
                button.disabled = false;
                showMachinesMessage(translateMachineError(error), 'error');
                return;
            }

            showMachinesMessage(
                `${machineName} repariert – ${formatCurrency(Number(data ?? repairCost))} bezahlt.`,
                'success'
            );

            notifyChange();
            await refreshMachines();
        });
    });
}


function notifyChange() {
    // game.js hört darauf und lädt Geld, Strom & Produktion neu
    window.dispatchEvent(new CustomEvent('machines-changed'));
}


// ============================================================
// FEHLERMELDUNGEN
// ============================================================

function translateMachineError(error) {
    const message =
        error?.message ||
        error?.details ||
        error?.hint ||
        '';

    const lower = message.toLowerCase();

    if (lower.includes('not authenticated')) {
        return 'Deine Sitzung ist abgelaufen. Bitte neu einloggen.';
    }

    if (lower.includes('does not belong')) {
        return 'Diese Aktion ist für dein Unternehmen nicht erlaubt.';
    }

    if (lower.includes('power')) {
        return 'Nicht genügend Stromkapazität an deinem Standort.';
    }

    if (lower.includes('cash') || lower.includes('money')) {
        return 'Nicht genügend Geld vorhanden.';
    }

    if (lower.includes('busy') || lower.includes('running')) {
        return 'Die Maschine ist gerade in Produktion.';
    }

    if (lower.includes('free workbench') || lower.includes('cannot be sold')) {
        return 'Die kostenlose Werkbank kann nicht verkauft werden.';
    }

    if (lower.includes('already owned')) {
        return 'Diese Maschine besitzt du bereits.';
    }

    if (lower.includes('perfect condition')) {
        return 'Diese Maschine ist bereits in einwandfreiem Zustand.';
    }

    if (lower.includes('machine type not found')) {
        return 'Dieser Maschinentyp existiert nicht mehr.';
    }

    if (lower.includes('location')) {
        return 'Kein Standort gefunden.';
    }

    if (lower.includes('machine not found')) {
        return 'Die Maschine wurde nicht gefunden.';
    }

    if (
        lower.includes('function') &&
        lower.includes('does not exist')
    ) {
        return 'Die Maschinen-Funktionen fehlen in der Datenbank (supabase/07_machines.sql ausführen).';
    }

    return message || 'Die Aktion konnte nicht ausgeführt werden.';
}


// ============================================================
// UI HILFEN
// ============================================================

function showMachinesMessage(message, type = 'info') {
    const element = document.getElementById('game-message');

    if (!element) {
        return;
    }

    element.textContent = message;
    element.className = `game-message ${type}`;

    setTimeout(() => {
        if (element.textContent === message) {
            element.textContent = '';
            element.className = 'game-message';
        }
    }, 4000);
}

function renderMachinesMessage(message, type) {
    const container = document.getElementById('machines-content');

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="message ${type}">${escapeHtml(message)}</div>
    `;
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


// ============================================================
// FORMATIERUNG
// ============================================================

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(Number(value) || 0);
}

function formatNumber(value, decimals = 0) {
    return new Intl.NumberFormat('de-DE', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(Number(value) || 0);
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
    initializeMachines,
    refreshMachines
};
