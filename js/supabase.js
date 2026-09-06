// ============================================================
// EMPIRE TYCOON
// Supabase Verbindung
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY
} from './config.js';


// ============================================================
// SUPABASE CLIENT
// ============================================================

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);


// ============================================================
// VERBINDUNG TESTEN
// ============================================================

export async function testSupabaseConnection() {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('id, name')
            .limit(1);

        if (error) {
            console.error(
                'Supabase-Verbindung fehlgeschlagen:',
                error
            );

            return {
                success: false,
                error
            };
        }

        console.log(
            'Supabase-Verbindung erfolgreich.',
            data
        );

        return {
            success: true,
            data
        };

    } catch (error) {
        console.error(
            'Fehler bei der Supabase-Verbindung:',
            error
        );

        return {
            success: false,
            error
        };
    }
}


// ============================================================
// AKTUELLEN BENUTZER ABRUFEN
// ============================================================

export async function getCurrentUser() {
    try {
        const {
            data: { user },
            error
        } = await supabase.auth.getUser();

        if (error) {
            console.error(
                'Benutzer konnte nicht abgerufen werden:',
                error
            );

            return null;
        }

        return user;

    } catch (error) {
        console.error(
            'Fehler beim Abrufen des Benutzers:',
            error
        );

        return null;
    }
}


// ============================================================
// AKTUELLE SESSION ABRUFEN
// ============================================================

export async function getCurrentSession() {
    try {
        const {
            data: { session },
            error
        } = await supabase.auth.getSession();

        if (error) {
            console.error(
                'Session konnte nicht abgerufen werden:',
                error
            );

            return null;
        }

        return session;

    } catch (error) {
        console.error(
            'Fehler beim Abrufen der Session:',
            error
        );

        return null;
    }
}


// ============================================================
// AUTH-ÄNDERUNGEN BEOBACHTEN
// ============================================================

export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(
        (event, session) => {
            callback(event, session);
        }
    );
}