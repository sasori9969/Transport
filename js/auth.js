import {
    supabase,
    getCurrentUser,
    onAuthStateChange
} from './supabase.js';


// ============================================================
// EMPIRE TYCOON
// Authentifizierung
// ============================================================


// ============================================================
// REGISTRIERUNG
// ============================================================

export async function registerUser(email, password, username) {
    try {
        email = String(email).trim().toLowerCase();
        password = String(password);
        username = String(username).trim();

        if (!email) {
            throw new Error('Bitte eine E-Mail-Adresse eingeben.');
        }

        if (!password) {
            throw new Error('Bitte ein Passwort eingeben.');
        }

        if (password.length < 6) {
            throw new Error(
                'Das Passwort muss mindestens 6 Zeichen lang sein.'
            );
        }

        if (!username) {
            throw new Error('Bitte einen Benutzernamen eingeben.');
        }

        if (username.length < 3) {
            throw new Error(
                'Der Benutzername muss mindestens 3 Zeichen lang sein.'
            );
        }

        // Prüfen, ob der Benutzername bereits existiert
        const { data: existingProfile, error: usernameCheckError } =
            await supabase
                .from('profiles')
                .select('id')
                .eq('username', username)
                .maybeSingle();

        if (usernameCheckError) {
            console.error(
                'Fehler bei der Benutzername-Prüfung:',
                usernameCheckError
            );

            throw new Error(
                'Der Benutzername konnte nicht geprüft werden.'
            );
        }

        if (existingProfile) {
            throw new Error(
                'Dieser Benutzername ist bereits vergeben.'
            );
        }

        // Benutzer bei Supabase Auth registrieren
        const {
            data,
            error
        } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username,
                    display_name: username
                }
            }
        });

        if (error) {
            console.error(
                'Registrierung fehlgeschlagen:',
                error
            );

            throw new Error(
                translateAuthError(error)
            );
        }

        if (!data.user) {
            throw new Error(
                'Die Registrierung konnte nicht abgeschlossen werden.'
            );
        }

        return {
            success: true,
            user: data.user,
            session: data.session
        };

    } catch (error) {
        console.error(
            'Registrierungsfehler:',
            error
        );

        return {
            success: false,
            error: error.message
        };
    }
}


// ============================================================
// LOGIN
// ============================================================

export async function loginUser(email, password) {
    try {
        email = String(email).trim().toLowerCase();
        password = String(password);

        if (!email) {
            throw new Error(
                'Bitte deine E-Mail-Adresse eingeben.'
            );
        }

        if (!password) {
            throw new Error(
                'Bitte dein Passwort eingeben.'
            );
        }

        const {
            data,
            error
        } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error(
                'Login fehlgeschlagen:',
                error
            );

            throw new Error(
                translateAuthError(error)
            );
        }

        if (!data.user) {
            throw new Error(
                'Login konnte nicht abgeschlossen werden.'
            );
        }

        return {
            success: true,
            user: data.user,
            session: data.session
        };

    } catch (error) {
        console.error(
            'Loginfehler:',
            error
        );

        return {
            success: false,
            error: error.message
        };
    }
}


// ============================================================
// LOGOUT
// ============================================================

export async function logoutUser() {
    try {
        const {
            error
        } = await supabase.auth.signOut();

        if (error) {
            console.error(
                'Logout fehlgeschlagen:',
                error
            );

            return {
                success: false,
                error: translateAuthError(error)
            };
        }

        return {
            success: true
        };

    } catch (error) {
        console.error(
            'Logoutfehler:',
            error
        );

        return {
            success: false,
            error: error.message
        };
    }
}


// ============================================================
// SESSION PRÜFEN
// ============================================================

export async function checkAuth() {
    try {
        const user = await getCurrentUser();

        if (!user) {
            return {
                authenticated: false,
                user: null
            };
        }

        return {
            authenticated: true,
            user
        };

    } catch (error) {
        console.error(
            'Fehler bei der Authentifizierungsprüfung:',
            error
        );

        return {
            authenticated: false,
            user: null
        };
    }
}


// ============================================================
// AUTH-STATUS BEOBACHTEN
// ============================================================

export function watchAuthState(callback) {
    return onAuthStateChange(
        (event, session) => {

            callback({
                event,
                session,
                user: session?.user ?? null,
                authenticated: Boolean(session?.user)
            });

        }
    );
}


// ============================================================
// PROFIL LADEN
// ============================================================

export async function getUserProfile(userId = null) {
    try {
        let id = userId;

        if (!id) {
            const user = await getCurrentUser();

            if (!user) {
                return {
                    success: false,
                    profile: null,
                    error: 'Nicht eingeloggt.'
                };
            }

            id = user.id;
        }

        const {
            data,
            error
        } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            console.error(
                'Profil konnte nicht geladen werden:',
                error
            );

            return {
                success: false,
                profile: null,
                error: error.message
            };
        }

        return {
            success: true,
            profile: data
        };

    } catch (error) {
        console.error(
            'Fehler beim Laden des Profils:',
            error
        );

        return {
            success: false,
            profile: null,
            error: error.message
        };
    }
}


// ============================================================
// PROFIL AKTUALISIEREN
// ============================================================

export async function updateProfile(updates) {
    try {
        const user = await getCurrentUser();

        if (!user) {
            throw new Error(
                'Du bist nicht eingeloggt.'
            );
        }

        if (!updates || typeof updates !== 'object') {
            throw new Error(
                'Keine gültigen Profildaten übergeben.'
            );
        }

        const allowedUpdates = {};

        if (
            Object.prototype.hasOwnProperty.call(
                updates,
                'username'
            )
        ) {
            const username = String(
                updates.username
            ).trim();

            if (username.length < 3) {
                throw new Error(
                    'Der Benutzername muss mindestens 3 Zeichen lang sein.'
                );
            }

            allowedUpdates.username = username;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                updates,
                'display_name'
            )
        ) {
            allowedUpdates.display_name =
                String(
                    updates.display_name
                ).trim();
        }

        if (
            Object.keys(allowedUpdates).length === 0
        ) {
            throw new Error(
                'Keine gültigen Änderungen vorhanden.'
            );
        }

        const {
            data,
            error
        } = await supabase
            .from('profiles')
            .update(allowedUpdates)
            .eq('id', user.id)
            .select()
            .single();

        if (error) {
            console.error(
                'Profil konnte nicht aktualisiert werden:',
                error
            );

            throw new Error(
                translateAuthError(error)
            );
        }

        return {
            success: true,
            profile: data
        };

    } catch (error) {
        console.error(
            'Profil-Update fehlgeschlagen:',
            error
        );

        return {
            success: false,
            error: error.message
        };
    }
}


// ============================================================
// PASSWORT-RESET ANFORDERN
// ============================================================

export async function requestPasswordReset(email) {
    try {
        email = String(email).trim().toLowerCase();

        if (!email) {
            throw new Error(
                'Bitte deine E-Mail-Adresse eingeben.'
            );
        }

        const {
            error
        } = await supabase.auth.resetPasswordForEmail(
            email,
            {
                redirectTo:
                    `${window.location.origin}/login.html`
            }
        );

        if (error) {
            console.error(
                'Passwort-Reset fehlgeschlagen:',
                error
            );

            throw new Error(
                translateAuthError(error)
            );
        }

        return {
            success: true
        };

    } catch (error) {
        console.error(
            'Passwort-Reset-Fehler:',
            error
        );

        return {
            success: false,
            error: error.message
        };
    }
}


// ============================================================
// PASSWORT ÄNDERN
// ============================================================

export async function updatePassword(newPassword) {
    try {
        newPassword = String(newPassword);

        if (!newPassword) {
            throw new Error(
                'Bitte ein neues Passwort eingeben.'
            );
        }

        if (newPassword.length < 6) {
            throw new Error(
                'Das Passwort muss mindestens 6 Zeichen lang sein.'
            );
        }

        const {
            error
        } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (error) {
            console.error(
                'Passwort konnte nicht geändert werden:',
                error
            );

            throw new Error(
                translateAuthError(error)
            );
        }

        return {
            success: true
        };

    } catch (error) {
        console.error(
            'Passwortänderung fehlgeschlagen:',
            error
        );

        return {
            success: false,
            error: error.message
        };
    }
}


// ============================================================
// AUTH-FEHLER INS DEUTSCHE ÜBERSETZEN
// ============================================================

function translateAuthError(error) {
    if (!error) {
        return 'Ein unbekannter Fehler ist aufgetreten.';
    }

    const message = String(
        error.message || ''
    ).toLowerCase();

    if (
        message.includes('invalid login credentials')
    ) {
        return 'E-Mail-Adresse oder Passwort ist falsch.';
    }

    if (
        message.includes('email not confirmed')
    ) {
        return 'Bitte bestätige zuerst deine E-Mail-Adresse.';
    }

    if (
        message.includes('user already registered')
    ) {
        return 'Für diese E-Mail-Adresse existiert bereits ein Konto.';
    }

    if (
        message.includes('password should be at least')
    ) {
        return 'Das Passwort ist zu kurz.';
    }

    if (
        message.includes('invalid email')
    ) {
        return 'Bitte gib eine gültige E-Mail-Adresse ein.';
    }

    if (
        message.includes('email rate limit exceeded')
    ) {
        return 'Zu viele E-Mail-Anfragen. Bitte später erneut versuchen.';
    }

    if (
        message.includes('signup is disabled')
    ) {
        return 'Die Registrierung ist momentan deaktiviert.';
    }

    if (
        message.includes('network')
    ) {
        return 'Netzwerkfehler. Bitte überprüfe deine Internetverbindung.';
    }

    return error.message ||
        'Ein unbekannter Fehler ist aufgetreten.';
}


// ============================================================
// EXPORT
// ============================================================

export default {
    registerUser,
    loginUser,
    logoutUser,
    checkAuth,
    watchAuthState,
    getUserProfile,
    updateProfile,
    requestPasswordReset,
    updatePassword
};