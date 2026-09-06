import { supabase } from './supabase.js';

let currentCompany = null;

export async function initializeResearch(company = null) {
    currentCompany = company;
    await refreshResearch();
}

export async function refreshResearch(company = null) {
    if (company) {
        currentCompany = company;
    }

    const container = document.getElementById('research-content');

    if (!container) {
        return;
    }

    if (!currentCompany) {
        renderResearchMessage('Kein Unternehmen gefunden.', 'error');
        return;
    }

    const [researchResult, playerResearchResult] = await Promise.all([
        supabase
            .from('research')
            .select(`
                id,
                name,
                description,
                cost,
                duration_seconds,
                prerequisite_research_id,
                prerequisite_machine_type_id,
                prerequisite_location_type
            `)
            .order('cost', { ascending: true }),
        supabase
            .from('player_research')
            .select(`
                id,
                research_id,
                status,
                started_at,
                finishes_at,
                completed_at
            `)
            .eq('company_id', currentCompany.id)
    ]);

    if (researchResult.error || playerResearchResult.error) {
        console.error(
            'Fehler beim Laden der Forschung:',
            researchResult.error || playerResearchResult.error
        );
        renderResearchMessage('Die Forschung konnte nicht geladen werden.', 'error');
        return;
    }

    renderResearch(
        researchResult.data || [],
        playerResearchResult.data || []
    );
}

function renderResearch(researchItems, playerResearch) {
    const container = document.getElementById('research-content');

    if (!container) {
        return;
    }

    if (!researchItems.length) {
        renderResearchMessage(
            'Noch keine Forschungen verfügbar.',
            'info'
        );
        return;
    }

    const playerByResearch = new Map(
        playerResearch.map(item => [item.research_id, item])
    );

    const cards = researchItems.map(research => {
        const playerState = playerByResearch.get(research.id);
        const status = playerState?.status || 'available';
        const statusText = getStatusText(status);
        const prerequisite = getPrerequisiteText(research);
        const action = renderResearchAction(research, playerState, status);

        return `
            <article class="research-card">
                <div class="research-card-header">
                    <div>
                        <h3>${escapeHtml(research.name)}</h3>
                        <span class="research-status status-${escapeHtml(status)}">
                            ${statusText}
                        </span>
                    </div>
                    <strong>${formatCurrency(research.cost)}</strong>
                </div>

                <p>${escapeHtml(research.description || 'Keine Beschreibung vorhanden.')}</p>

                <div class="research-meta">
                    <span>Dauer: <strong>${formatDuration(research.duration_seconds)}</strong></span>
                    <span>${prerequisite}</span>
                </div>

                ${action}
            </article>
        `;
    }).join('');

    container.innerHTML = `<div class="research-grid">${cards}</div>`;
    attachResearchEvents();
}

function renderResearchAction(research, playerState, status) {
    if (status === 'available') {
        return `
            <div class="research-card-actions">
                <button
                    type="button"
                    class="primary-button"
                    data-start-research="${escapeHtml(research.id)}"
                >
                    Forschung starten
                </button>
            </div>
        `;
    }

    if (status !== 'running') {
        return '';
    }

    const finishesAt = playerState?.finishes_at
        ? new Date(playerState.finishes_at)
        : null;

    if (!finishesAt || finishesAt.getTime() > Date.now()) {
        return `
            <div class="research-card-actions research-running">
                Läuft bis ${finishesAt ? formatDateTime(finishesAt) : 'unbekannt'}
            </div>
        `;
    }

    return `
        <div class="research-card-actions">
            <button
                type="button"
                class="primary-button"
                data-complete-research="${escapeHtml(playerState.id)}"
            >
                Forschung abschließen
            </button>
        </div>
    `;
}

function attachResearchEvents() {
    document.querySelectorAll('[data-start-research]').forEach(button => {
        button.addEventListener('click', async () => {
            button.disabled = true;

            const { error } = await supabase.rpc('start_research', {
                p_company_id: currentCompany.id,
                p_research_id: button.dataset.startResearch
            });

            if (error) {
                button.disabled = false;
                console.error('Fehler beim Start der Forschung:', error);
                showResearchMessage(translateResearchError(error), 'error');
                return;
            }

            showResearchMessage('Forschung erfolgreich gestartet.', 'success');
            window.dispatchEvent(new CustomEvent('research-changed'));
            await refreshResearch();
        });
    });

    document.querySelectorAll('[data-complete-research]').forEach(button => {
        button.addEventListener('click', async () => {
            button.disabled = true;

            const { error } = await supabase.rpc('complete_research', {
                p_player_research_id: button.dataset.completeResearch
            });

            if (error) {
                button.disabled = false;
                console.error('Fehler beim Abschluss der Forschung:', error);
                showResearchMessage(translateResearchError(error), 'error');
                return;
            }

            showResearchMessage('Forschung erfolgreich abgeschlossen.', 'success');
            window.dispatchEvent(new CustomEvent('research-changed'));
            await refreshResearch();
        });
    });
}

function showResearchMessage(message, type) {
    const element = document.getElementById('game-message');

    if (!element) {
        return;
    }

    element.textContent = message;
    element.className = `game-message ${type}`;
}

function translateResearchError(error) {
    const message = error?.message || error?.details || error?.hint || '';
    const lower = message.toLowerCase();

    if (lower.includes('cash') || lower.includes('money')) {
        return 'Nicht genügend Geld für diese Forschung.';
    }

    if (lower.includes('prerequisite') || lower.includes('voraus')) {
        return 'Eine Voraussetzung für diese Forschung fehlt.';
    }

    return message || 'Die Forschung konnte nicht ausgeführt werden.';
}

function getStatusText(status) {
    const labels = {
        locked: 'Gesperrt',
        available: 'Verfügbar',
        running: 'Läuft',
        completed: 'Abgeschlossen'
    };

    return labels[status] || 'Verfügbar';
}

function getPrerequisiteText(research) {
    if (research.prerequisite_research_id) {
        return 'Voraussetzung vorhanden';
    }

    if (research.prerequisite_machine_type_id) {
        return 'Maschine erforderlich';
    }

    if (research.prerequisite_location_type) {
        return `Standort: ${escapeHtml(research.prerequisite_location_type)}`;
    }

    return 'Keine Voraussetzung';
}

function formatDateTime(date) {
    return new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short'
    }).format(date);
}

function renderResearchMessage(message, type) {
    const container = document.getElementById('research-content');

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="message ${type}">${escapeHtml(message)}</div>
    `;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR'
    }).format(Number(value) || 0);
}

function formatDuration(seconds) {
    const totalSeconds = Math.max(Number(seconds) || 0, 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
