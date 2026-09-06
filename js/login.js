import {
    registerUser,
    loginUser,
    requestPasswordReset,
    checkAuth
} from './auth.js';


// ============================================================
// EMPIRE TYCOON
// Login / Registrierung
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {

    // --------------------------------------------------------
    // Elemente
    // --------------------------------------------------------

    const loginSection =
        document.getElementById('login-section');

    const registerSection =
        document.getElementById('register-section');

    const resetSection =
        document.getElementById('reset-section');

    const loginForm =
        document.getElementById('login-form');

    const registerForm =
        document.getElementById('register-form');

    const resetForm =
        document.getElementById('reset-form');

    const showRegisterButton =
        document.getElementById('show-register-button');

    const showLoginButton =
        document.getElementById('show-login-button');

    const showResetButton =
        document.getElementById('show-reset-button');

    const resetBackButton =
        document.getElementById('reset-back-button');

    const loginButton =
        document.getElementById('login-button');

    const registerButton =
        document.getElementById('register-button');

    const resetButton =
        document.getElementById('reset-button');

    const message =
        document.getElementById('auth-message');

    const loading =
        document.getElementById('auth-loading');


    // --------------------------------------------------------
    // Prüfen, ob bereits eingeloggt
    // --------------------------------------------------------

    const auth = await checkAuth();

    if (auth.authenticated) {
        window.location.href = 'game.html';
        return;
    }


    // --------------------------------------------------------
    // Ansicht wechseln
    // --------------------------------------------------------

    function showSection(section) {

        loginSection.classList.remove('active');
        registerSection.classList.remove('active');
        resetSection.classList.remove('active');

        section.classList.add('active');

        clearMessage();
    }


    // --------------------------------------------------------
    // Login anzeigen
    // --------------------------------------------------------

    showLoginButton.addEventListener('click', () => {
        showSection(loginSection);
    });


    // --------------------------------------------------------
    // Registrierung anzeigen
    // --------------------------------------------------------

    showRegisterButton.addEventListener('click', () => {
        showSection(registerSection);
    });


    // --------------------------------------------------------
    // Passwort-Reset anzeigen
    // --------------------------------------------------------

    showResetButton.addEventListener('click', () => {
        showSection(resetSection);
    });


    // --------------------------------------------------------
    // Zurück zum Login
    // --------------------------------------------------------

    resetBackButton.addEventListener('click', () => {
        showSection(loginSection);
    });


    // ========================================================
    // LOGIN
    // ========================================================

    loginForm.addEventListener('submit', async (event) => {

        event.preventDefault();

        clearMessage();

        const email =
            document.getElementById('login-email').value.trim();

        const password =
            document.getElementById('login-password').value;


        setLoading(true, loginButton);

        const result =
            await loginUser(email, password);

        setLoading(false, loginButton);


        if (!result.success) {

            showMessage(
                result.error,
                'error'
            );

            return;
        }


        showMessage(
            'Login erfolgreich. Dein Imperium wird geladen...',
            'success'
        );


        setTimeout(() => {
            window.location.href = 'game.html';
        }, 500);

    });


    // ========================================================
    // REGISTRIERUNG
    // ========================================================

    registerForm.addEventListener('submit', async (event) => {

        event.preventDefault();

        clearMessage();


        const username =
            document
                .getElementById('register-username')
                .value
                .trim();

        const email =
            document
                .getElementById('register-email')
                .value
                .trim();

        const password =
            document
                .getElementById('register-password')
                .value;

        const passwordConfirm =
            document
                .getElementById('register-password-confirm')
                .value;


        // ----------------------------------------------------
        // Passwort prüfen
        // ----------------------------------------------------

        if (password !== passwordConfirm) {

            showMessage(
                'Die beiden Passwörter stimmen nicht überein.',
                'error'
            );

            return;
        }


        if (password.length < 6) {

            showMessage(
                'Das Passwort muss mindestens 6 Zeichen lang sein.',
                'error'
            );

            return;
        }


        setLoading(true, registerButton);


        const result =
            await registerUser(
                email,
                password,
                username
            );


        setLoading(false, registerButton);


        if (!result.success) {

            showMessage(
                result.error,
                'error'
            );

            return;
        }


        // ----------------------------------------------------
        // Prüfen, ob Supabase direkt eine Session erstellt hat
        // ----------------------------------------------------

        if (result.session) {

            showMessage(
                'Account erfolgreich erstellt. Dein Imperium wird gestartet...',
                'success'
            );


            setTimeout(() => {
                window.location.href = 'game.html';
            }, 700);

            return;
        }


        // ----------------------------------------------------
        // E-Mail-Bestätigung erforderlich
        // ----------------------------------------------------

        showMessage(
            'Account erstellt. Bitte bestätige deine E-Mail-Adresse. Danach kannst du dich einloggen.',
            'success'
        );


        registerForm.reset();

        setTimeout(() => {
            showSection(loginSection);
        }, 2500);

    });


    // ========================================================
    // PASSWORT ZURÜCKSETZEN
    // ========================================================

    resetForm.addEventListener('submit', async (event) => {

        event.preventDefault();

        clearMessage();


        const email =
            document
                .getElementById('reset-email')
                .value
                .trim();


        setLoading(true, resetButton);


        const result =
            await requestPasswordReset(email);


        setLoading(false, resetButton);


        if (!result.success) {

            showMessage(
                result.error,
                'error'
            );

            return;
        }


        showMessage(
            'Wenn für diese E-Mail-Adresse ein Konto existiert, wurde ein Reset-Link versendet.',
            'success'
        );


        resetForm.reset();

    });


    // ========================================================
    // MELDUNG ANZEIGEN
    // ========================================================

    function showMessage(text, type = 'info') {

        message.textContent = text;

        message.className =
            `auth-message visible ${type}`;

    }


    // ========================================================
    // MELDUNG LÖSCHEN
    // ========================================================

    function clearMessage() {

        message.textContent = '';

        message.className =
            'auth-message';

    }


    // ========================================================
    // LOADING
    // ========================================================

    function setLoading(isLoading, button) {

        if (isLoading) {

            button.disabled = true;

            loading.classList.add('visible');

            loading.setAttribute(
                'aria-hidden',
                'false'
            );

        } else {

            button.disabled = false;

            loading.classList.remove('visible');

            loading.setAttribute(
                'aria-hidden',
                'true'
            );

        }

    }

});