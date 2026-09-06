// ============================================================
// EMPIRE TYCOON
// Zentrale Spielsteuerung
// ============================================================

import { supabase, getCurrentUser } from './supabase.js';
import { initializeProduction, refreshProduction } from './production.js';
import { initializeStorage, refreshStorage } from './storage.js';
import { initializeMarket, refreshMarket } from './market.js?v=20260906-market-v2';
import { initializeResearch, refreshResearch } from './research.js';
import { initializeMachines, refreshMachines } from './machines.js';

// ============================================================
// SPIELSTATUS
// ============================================================

let currentUser = null;
let currentProfile = null;
let currentCompany = null;
let currentLocation = null;

let refreshInterval = null;
let gameInitialized = false;

// ============================================================
// INITIALISIERUNG
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    showLoading(true);

    initializeNavigation();
    initializePanelTargets();
    initializeLogout();
    window.addEventListener('market-changed', handleMarketChanged);
    window.addEventListener('research-changed', handleResearchChanged);
    window.addEventListener('machines-changed', handleMachinesChanged);

    try {
        await initializeGame();
        initializeAutoRefresh();
    } catch (error) {
        console.error('Fehler bei der Spielinitialisierung:', error);

        showGameMessage(
            'Das Spiel konnte nicht vollständig geladen werden.',
            'error'
        );
    } finally {
        showLoading(false);
    }
});

// ============================================================
// SPIEL LADEN
// ============================================================

export async function initializeGame() {
    currentUser = await getCurrentUser();

    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }

    await loadProfile();
    await loadCompany();
    await loadLocation();

    updateUserInterface();

    gameInitialized = true;

    await initializeProduction(currentCompany);
    await initializeStorage(currentCompany);
    await initializeMarket(currentCompany);
    await initializeResearch(currentCompany);
    await initializeMachines(currentCompany, currentLocation);
}

// ============================================================
// PROFIL LADEN
// ============================================================

async function loadProfile() {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error) {
        console.error('Fehler beim Laden des Profils:', error);
        throw error;
    }

    currentProfile = data;
}

// ============================================================
// UNTERNEHMEN LADEN
// ============================================================

async function loadCompany() {
    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('owner_id', currentUser.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('Fehler beim Laden des Unternehmens:', error);
        throw error;
    }

    if (!data) {
        await createInitialCompany();
        return;
    }

    currentCompany = data;
}

// ============================================================
// ERSTES UNTERNEHMEN ERSTELLEN
// ============================================================

async function createInitialCompany() {
    const companyName =
        currentProfile?.display_name ||
        currentProfile?.username ||
        'Mein Unternehmen';

    const { data, error } = await supabase.rpc(
        'create_initial_company',
        {
            p_company_name: companyName
        }
    );

    if (error) {
        console.error(
            'Fehler beim Erstellen des Unternehmens:',
            error
        );

        throw error;
    }

    if (data) {
        if (Array.isArray(data)) {
            currentCompany = data[0] || null;
        } else {
            currentCompany = data;
        }
    }

    // Falls die RPC-Funktion keine Zeile zurückgibt,
    // Unternehmen anschließend erneut aus der Datenbank laden.
    if (!currentCompany) {
        const { data: company, error: reloadError } =
            await supabase
                .from('companies')
                .select('*')
                .eq('owner_id', currentUser.id)
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();

        if (reloadError) {
            console.error(
                'Fehler beim erneuten Laden des Unternehmens:',
                reloadError
            );

            throw reloadError;
        }

        currentCompany = company;
    }

    if (!currentCompany) {
        throw new Error(
            'Das Unternehmen konnte nicht erstellt werden.'
        );
    }
}

// ============================================================
// STANDORT LADEN
// ============================================================

async function loadLocation() {
    if (!currentCompany) {
        return;
    }

    const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('company_id', currentCompany.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(
            'Fehler beim Laden des Standorts:',
            error
        );

        throw error;
    }

    currentLocation = data;
}

// ============================================================
// BENUTZEROBERFLÄCHE AKTUALISIEREN
// ============================================================

function updateUserInterface() {
    updateUserName();
    updateCompanyName();
    updateLocationName();

    updateCash();
    updateMaterials();
    updateStorageStatus();
    updatePowerStatus();

    updateOverview();
    updateProfitPerHour();
    updateProductionStatus();
    updateFinanceOverview();
}

// ============================================================
// BENUTZERNAME
// ============================================================

function updateUserName() {
    const element =
        document.getElementById('username-display') ||
        document.getElementById('username');

    if (!element) {
        return;
    }

    element.textContent =
        currentProfile?.display_name ||
        currentProfile?.username ||
        'Spieler';
}

// ============================================================
// UNTERNEHMENSNAME
// ============================================================

function updateCompanyName() {
    const elements = [
        document.getElementById('company-name'),
        document.getElementById('topbar-company-name')
    ];

    elements.forEach(element => {
        if (!element) {
            return;
        }

        element.textContent =
            currentCompany?.name ||
            'Mein Unternehmen';
    });
}

// ============================================================
// STANDORTNAME
// ============================================================

function updateLocationName() {
    const elements = [
        document.getElementById('location-name'),
        document.getElementById('overview-location')
    ];

    elements.forEach(element => {
        if (!element) {
            return;
        }

        element.textContent =
            currentLocation?.name ||
            'Eltern-Keller';
    });
}

// ============================================================
// GELD
// ============================================================

function updateCash() {
    const element =
        document.getElementById('cash-value');

    if (!element) {
        return;
    }

    element.textContent =
        formatCurrency(
            currentProfile?.cash || 0
        );
}

// ============================================================
// MATERIALIEN
// ============================================================

async function updateMaterials() {
    if (!currentCompany) {
        return;
    }

    const { data, error } = await supabase
        .from('player_materials')
        .select(`
            quantity,
            materials (
                unit
            )
        `)
        .eq('company_id', currentCompany.id);

    if (error) {
        console.error(
            'Fehler beim Laden der Materialien:',
            error
        );

        return;
    }

    const totalMaterials =
        (data || []).reduce(
            (total, item) =>
                total + Number(item.quantity || 0),
            0
        );

    const element =
        document.getElementById('materials-value');

    if (element) {
        element.textContent =
            formatNumber(totalMaterials);
    }
}

// ============================================================
// LAGER
// ============================================================

async function updateStorageStatus() {
    if (!currentCompany) {
        return;
    }

    const { data, error } = await supabase
        .from('storage')
        .select('quantity')
        .eq('company_id', currentCompany.id);

    if (error) {
        console.error(
            'Fehler beim Laden des Lagers:',
            error
        );

        return;
    }

    const used =
        (data || []).reduce(
            (total, item) =>
                total + Number(item.quantity || 0),
            0
        );

    const capacity =
        Number(
            currentLocation?.storage_capacity || 0
        );

    const element =
        document.getElementById('storage-value');

    if (element) {
        element.textContent =
            `${formatNumber(used)} / ${formatNumber(capacity)}`;
    }
}

// ============================================================
// STROM
// ============================================================

async function updatePowerStatus() {
    if (!currentCompany || !currentLocation) {
        return;
    }

    const { data, error } = await supabase
        .from('machines')
        .select(`
            status,
            machine_types (
                power_usage
            )
        `)
        .eq('company_id', currentCompany.id);

    if (error) {
        console.error(
            'Fehler beim Laden des Stromverbrauchs:',
            error
        );

        return;
    }

    const powerUsed =
        (data || []).reduce(
            (total, machine) => {
                if (
                    machine.status === 'working' ||
                    machine.status === 'maintenance'
                ) {
                    return (
                        total +
                        Number(
                            machine.machine_types?.power_usage ||
                            0
                        )
                    );
                }

                return total;
            },
            0
        );

    const powerCapacity =
        Number(
            currentLocation.power_capacity || 0
        );

    const element =
        document.getElementById('power-value');

    if (element) {
        element.textContent =
            `${formatNumber(powerUsed, 1)} / ${formatNumber(powerCapacity, 1)}`;
    }
}

// ============================================================
// OVERVIEW
// ============================================================

function updateOverview() {
    if (!currentCompany) {
        return;
    }

    const reputationElement =
        document.getElementById(
            'overview-reputation'
        );

    if (reputationElement) {
        reputationElement.textContent =
            formatNumber(
                currentCompany.reputation || 0,
                0
            );
    }

    const marketShareElement =
        document.getElementById(
            'overview-market-share'
        );

    if (marketShareElement) {
        marketShareElement.textContent =
            `${formatNumber(
                currentCompany.market_share || 0,
                2
            )}%`;
    }
}

// ============================================================
// PRODUKTION
// ============================================================

async function updateProductionStatus() {
    if (!currentCompany) {
        return;
    }

    const { data, error } = await supabase
        .from('production_jobs')
        .select('id, status')
        .eq('company_id', currentCompany.id)
        .eq('status', 'running');

    if (error) {
        console.error(
            'Fehler beim Laden der Produktion:',
            error
        );

        return;
    }

    const element =
        document.getElementById(
            'overview-production'
        );

    if (!element) {
        return;
    }

    const activeJobs =
        data?.length || 0;

    if (activeJobs === 0) {
        element.textContent =
            'Keine aktive Produktion';
    } else if (activeJobs === 1) {
        element.textContent =
            '1 Auftrag läuft';
    } else {
        element.textContent =
            `${activeJobs} Aufträge laufen`;
    }
}

// ============================================================
// FINANZEN
// ============================================================

async function updateFinanceOverview() {
    if (!currentCompany) {
        return;
    }

    const [machinesResult, storageResult] = await Promise.all([
        supabase
            .from('machines')
            .select(`
                machine_types (
                    purchase_price
                )
            `)
            .eq('company_id', currentCompany.id),
        supabase
            .from('storage')
            .select(`
                quantity,
                product_id,
                products (
                    base_price
                )
            `)
            .eq('company_id', currentCompany.id)
    ]);

    if (machinesResult.error || storageResult.error) {
        console.error(
            'Fehler beim Laden der Finanzübersicht:',
            machinesResult.error || storageResult.error
        );
        return;
    }

    const assets = (machinesResult.data || []).reduce(
        (total, machine) => total + Number(
            machine.machine_types?.purchase_price || 0
        ),
        0
    );

    const inventory = (storageResult.data || []).reduce(
        (total, item) => {
            const product = item.products || {};
            const price = Number(
                product.current_price ?? product.base_price ?? 0
            );
            return total + Number(item.quantity || 0) * price;
        },
        0
    );

    const cash = Number(currentProfile?.cash || 0);
    const netWorth = cash + assets + inventory;

    setFinanceValue('finance-cash', cash);
    setFinanceValue('finance-assets', assets);
    setFinanceValue('finance-inventory', inventory);
    setFinanceValue('finance-net-worth', netWorth);
}

function setFinanceValue(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = formatCurrency(value);
    }
}

// ============================================================
// GEWINN PRO STUNDE
// ============================================================

async function updateProfitPerHour() {
    const element =
        document.getElementById(
            'profit-hour-value'
        );

    if (!element) {
        return;
    }

    /*
     * Der vollständige Gewinn-pro-Stunde-Rechner
     * wird später mit Produktion, Verkauf,
     * Stromkosten und Personal verbunden.
     *
     * Für den MVP zeigen wir zunächst 0 €.
     */

    element.textContent =
        formatCurrency(0);
}

// ============================================================
// NAVIGATION
// ============================================================

function initializeNavigation() {
    const navigationButtons =
        document.querySelectorAll(
            '[data-panel]'
        );

    const panels =
        document.querySelectorAll('.game-panel');

    navigationButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const target =
                button.dataset.panel;

            navigationButtons.forEach(item => {
                item.classList.remove('active');
            });

            button.classList.add('active');

            panels.forEach(panel => {
                panel.classList.remove('active');
            });

            const targetPanel =
                document.getElementById(`panel-${target}`);

            if (targetPanel) {
                targetPanel.classList.add('active');
            }

            if (target === 'production') {
                await refreshProduction();
            }

            if (target === 'storage') {
                await refreshStorage();
            }

            if (target === 'market') {
                await refreshMarket();
            }

            if (target === 'research') {
                await refreshResearch();
            }

            if (target === 'machines') {
                await refreshMachines(currentCompany, currentLocation);
            }
        });
    });
}


// ============================================================
// PANEL SHORTCUTS (Overview buttons etc.)
// ============================================================

function initializePanelTargets() {
    const targetButtons =
        document.querySelectorAll(
            '[data-panel-target]'
        );

    targetButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const target =
                button.dataset.panelTarget;

            if (!target) {
                return;
            }

            const navButton =
                document.querySelector(
                    `[data-panel="${target}"]`
                );

            if (navButton) {
                navButton.click();
                return;
            }

            const panels =
                document.querySelectorAll('.game-panel');

            panels.forEach(panel => {
                panel.classList.remove('active');
            });

            const targetPanel =
                document.getElementById(`panel-${target}`);

            if (targetPanel) {
                targetPanel.classList.add('active');
            }
        });
    });
}

// ============================================================
// LOGOUT
// ============================================================

function initializeLogout() {
    const logoutButtons =
        document.querySelectorAll(
            '[data-action="logout"], #logout-button'
        );

    logoutButtons.forEach(button => {
        button.addEventListener('click', async () => {
            await logout();
        });
    });
}

async function logout() {
    const { error } =
        await supabase.auth.signOut();

    if (error) {
        console.error(
            'Fehler beim Ausloggen:',
            error
        );

        showGameMessage(
            'Ausloggen fehlgeschlagen.',
            'error'
        );

        return;
    }

    window.location.href =
        'login.html';
}

// ============================================================
// AUTOMATISCHE AKTUALISIERUNG
// ============================================================

function initializeAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }

    refreshInterval =
        setInterval(async () => {
            if (!gameInitialized) {
                return;
            }

            try {
                await reloadGameData();
            } catch (error) {
                console.error(
                    'Fehler bei der automatischen Aktualisierung:',
                    error
                );
            }
        }, 10000);
}

// ============================================================
// SPIELDATEN NEU LADEN
// ============================================================

async function reloadGameData() {
    await loadProfile();
    await loadCompany();
    await loadLocation();

    updateUserInterface();
    await updateProductionStatus();
    await refreshProduction();
    await refreshStorage();
    await refreshMarket();
    await refreshResearch();
    await refreshMachines(currentCompany, currentLocation);
}

async function handleMarketChanged() {
    try {
        await reloadGameData();
    } catch (error) {
        console.error(
            'Fehler beim Aktualisieren nach einer Marktaktion:',
            error
        );
    }
}

async function handleResearchChanged() {
    try {
        await reloadGameData();
    } catch (error) {
        console.error(
            'Fehler beim Aktualisieren nach einer Forschungsaktion:',
            error
        );
    }
}

async function handleMachinesChanged() {
    try {
        await reloadGameData();
    } catch (error) {
        console.error(
            'Fehler beim Aktualisieren nach einer Maschinenaktion:',
            error
        );
    }
}

// ============================================================
// HILFSFUNKTIONEN
// ============================================================

function formatCurrency(value) {
    return new Intl.NumberFormat(
        'de-DE',
        {
            style: 'currency',
            currency: 'EUR'
        }
    ).format(
        Number(value) || 0
    );
}

function formatNumber(
    value,
    decimals = 0
) {
    return new Intl.NumberFormat(
        'de-DE',
        {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }
    ).format(
        Number(value) || 0
    );
}

function updateStorage(
    used,
    capacity
) {
    const element =
        document.getElementById(
            'storage-value'
        );

    if (!element) {
        return;
    }

    element.textContent =
        `${formatNumber(used)} / ${formatNumber(capacity)}`;
}

function updatePower(
    used,
    capacity
) {
    const element =
        document.getElementById(
            'power-value'
        );

    if (!element) {
        return;
    }

    element.textContent =
        `${formatNumber(used, 1)} / ${formatNumber(capacity, 1)}`;
}

function showGameMessage(
    message,
    type = 'info'
) {
    const element =
        document.getElementById(
            'game-message'
        );

    if (!element) {
        return;
    }

    element.textContent =
        message;

    element.className =
        `game-message ${type}`;

    setTimeout(() => {
        element.textContent = '';
        element.className =
            'game-message';
    }, 4000);
}

function showLoading(
    visible
) {
    const element =
        document.getElementById(
            'game-loading'
        );

    if (!element) {
        return;
    }

    element.classList.toggle(
        'active',
        visible
    );
}

// ============================================================
// ÖFFENTLICHER SPIELSTATUS
// ============================================================

export function getGameState() {
    return {
        user: currentUser,
        profile: currentProfile,
        company: currentCompany,
        location: currentLocation
    };
}

export async function refreshGame() {
    await reloadGameData();
    await refreshProduction();
}

// ============================================================
// EXPORT
// ============================================================

export default {
    initializeGame,
    getGameState,
    refreshGame
};