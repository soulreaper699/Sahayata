document.addEventListener('DOMContentLoaded', () => {
    
    // Auto redirect if already logged in
    const userJson = localStorage.getItem('sustaina_user_v3');
    if (userJson) {
        const user = JSON.parse(userJson);
        const currentPath = window.location.pathname;
        if (currentPath.includes('login.html') || currentPath.includes('register.html')) {
            if (user.role === 'admin') window.location.href = 'admin.html';
            else window.location.href = user.role === 'donor' ? 'donor.html' : 'ngo.html';
        }
        
        // If we are on the landing page, update the toolbar
        if (currentPath === '/' || currentPath.includes('index.html')) {
            const dynamicNav = document.getElementById('dynamic-nav');
            if (dynamicNav) {
                let dashUrl = user.role === 'donor' ? 'donor.html' : 'ngo.html';
                if (user.role === 'admin') dashUrl = 'admin.html';
                
                dynamicNav.innerHTML = `
                    <span style="color:var(--text-main); font-weight:600; margin-right: 15px;">Hello, ${user.name}</span>
                    <a href="${dashUrl}" class="btn btn-primary" style="color:white !important; text-decoration: none;">Go to Dashboard</a>
                    <button class="btn btn-secondary" onclick="logout()" style="margin-left: 10px;">Logout</button>
                `;
            }
        }
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const errorMsg = document.getElementById('error-msg');
            btn.textContent = 'Authenticating...';
            errorMsg.style.display = 'none';

            try {
                const ident = document.getElementById('email') ? document.getElementById('email').value : document.getElementById('name').value;
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: ident, 
                        password: document.getElementById('password').value
                    })
                });

                if (res.ok) {
                    const user = await res.json();
                    localStorage.setItem('sustaina_user_v3', JSON.stringify(user));
                    if (user.role === 'admin') window.location.href = 'admin.html';
                    else window.location.href = user.role === 'donor' ? 'donor.html' : 'ngo.html';
                } else {
                    const data = await res.json();
                    errorMsg.textContent = data.error || 'Login failed';
                    errorMsg.style.display = 'block';
                }
            } catch (err) {
                errorMsg.textContent = 'Network error during login';
                errorMsg.style.display = 'block';
            } finally {
                btn.textContent = 'Sign In';
            }
        });
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const errorMsg = document.getElementById('error-msg');
            btn.textContent = 'Creating Account...';
            errorMsg.style.display = 'none';

            const role = document.getElementById('role').value;
            const googleIdVal = document.getElementById('google-id') ? document.getElementById('google-id').value : '';
            const emailVal = document.getElementById('google-email') ? document.getElementById('google-email').value : '';
            
            const payload = {
                role: role,
                name: document.getElementById('name').value,
                password: document.getElementById('password').value,
                lat: document.getElementById('lat').value,
                lng: document.getElementById('lng').value
            };
            
            if (googleIdVal) payload.google_id = googleIdVal;
            if (emailVal) payload.email = emailVal;
            
            if (role === 'donor') {
                payload.phone = document.getElementById('phone').value;
            } else {
                payload.capacity = document.getElementById('capacity').value;
                payload.location = document.getElementById('location').value;
            }

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    const user = await res.json();
                    localStorage.setItem('sustaina_user_v3', JSON.stringify(user));
                    window.location.href = user.role === 'donor' ? 'donor.html' : 'ngo.html';
                } else {
                    const data = await res.json();
                    errorMsg.textContent = data.error || 'Registration failed';
                    errorMsg.style.display = 'block';
                }
            } catch (err) {
                errorMsg.textContent = 'Network error during registration';
                errorMsg.style.display = 'block';
            } finally {
                btn.textContent = 'Complete Registration';
            }
        });
    }

    // Load real-time stats for the landing page
    const currentPath = window.location.pathname;
    if (currentPath === '/' || currentPath.includes('index.html')) {
        fetch('/api/stats')
            .then(res => res.json())
            .then(data => {
                const mealsEl = document.getElementById('meals-saved-count');
                const ngosEl = document.getElementById('active-ngos-count');
                if (mealsEl) {
                    const totalMeals = 50000 + data.meals_saved;
                    mealsEl.textContent = totalMeals.toLocaleString() + '+';
                }
                if (ngosEl) {
                    const totalNGOs = 120 + data.active_ngos;
                    ngosEl.textContent = totalNGOs.toLocaleString() + '+';
                }
            })
            .catch(err => console.error('Error fetching stats:', err));
    }

    // --- GOOGLE SIGN IN INTEGRATION ---
    const mockGoogleAccounts = [
        { name: "Chirag Sharma", email: "chirag.donor@gmail.com", avatar: "CS" },
        { name: "Robin Hood NGO", email: "robin.ngo@gmail.com", avatar: "RH" },
        { name: "Farming Co-op", email: "farm.coop@gmail.com", avatar: "FC" }
    ];

    async function handleGoogleLogin(email, name, google_id, id_token = null) {
        const errorMsg = document.getElementById('error-msg');
        if (errorMsg) errorMsg.style.display = 'none';
        
        try {
            const payload = id_token ? { id_token } : { google_id, email, name };
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const data = await res.json();
                if (data.new_user) {
                    // Redirect new Google user to registration page to select role & location
                    window.location.href = `register.html?google_signup=true&email=${encodeURIComponent(data.email)}&name=${encodeURIComponent(data.name)}&google_id=${encodeURIComponent(data.google_id)}`;
                } else {
                    // Log in existing Google user
                    localStorage.setItem('sustaina_user_v3', JSON.stringify(data));
                    if (data.role === 'admin') window.location.href = 'admin.html';
                    else window.location.href = data.role === 'donor' ? 'donor.html' : 'ngo.html';
                }
            } else {
                const data = await res.json();
                if (errorMsg) {
                    errorMsg.textContent = data.error || 'Google sign-in failed';
                    errorMsg.style.display = 'block';
                }
            }
        } catch (err) {
            if (errorMsg) {
                errorMsg.textContent = 'Network error during Google sign-in';
                errorMsg.style.display = 'block';
            }
        }
    }

    function openMockGoogleAccountsModal() {
        const modal = document.getElementById('google-accounts-modal');
        const list = document.getElementById('google-accounts-list');
        if (!modal || !list) return;

        list.innerHTML = '';
        mockGoogleAccounts.forEach((acc, idx) => {
            const li = document.createElement('li');
            li.className = 'google-account-item';
            li.innerHTML = `
                <div class="google-account-avatar">${acc.avatar}</div>
                <div class="google-account-details">
                    <span class="google-account-name">${acc.name}</span>
                    <span class="google-account-email">${acc.email}</span>
                </div>
            `;
            li.addEventListener('click', () => {
                modal.classList.remove('active');
                handleGoogleLogin(acc.email, acc.name, 'google-mock-id-' + idx);
            });
            list.appendChild(li);
        });

        // Use custom account option
        const customLi = document.createElement('li');
        customLi.className = 'google-account-item';
        customLi.innerHTML = `
            <div class="google-account-avatar" style="background-color:#e8f0fe; color:#1a73e8;">+</div>
            <div class="google-account-details">
                <span class="google-account-name" style="color:#1a73e8;">Use another account</span>
                <span class="google-account-email">Sign in with a custom Google email</span>
            </div>
        `;
        customLi.addEventListener('click', () => {
            document.getElementById('google-custom-input-section').classList.add('active');
            list.style.display = 'none';
        });
        list.appendChild(customLi);

        modal.classList.add('active');
    }

    // Initialize GIS if real client ID exists, otherwise bind custom mock modal
    const googleBtnContainer = document.getElementById('google-login-btn-container');
    if (googleBtnContainer) {
        const isPlaceholder = !window.CONFIG || CONFIG.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID';
        
        if (isPlaceholder) {
            // Render a high-fidelity placeholder Google button
            googleBtnContainer.innerHTML = `
                <button id="google-login-btn" class="btn btn-google btn-block" style="padding: 0.8rem 1rem; margin-top: 0; display: flex; align-items: center; justify-content: center; width: 100%;">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google logo" style="width:20px; height:20px; margin-right:12px;">
                    Continue with Google (Demo Mode)
                </button>
            `;
            const demoBtn = document.getElementById('google-login-btn');
            demoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                alert("ℹ️ Sahayata is in Google Login Demo Mode.\n\nTo connect the real Google Login:\n1. Update CONFIG.GOOGLE_CLIENT_ID in public/config.js with your Google Client ID.\n2. We will now open the mock Google accounts chooser so you can test the login flow!");
                openMockGoogleAccountsModal();
            });
        } else {
            // Render the official Google Sign-In button
            const initGIS = () => {
                if (window.google) {
                    window.google.accounts.id.initialize({
                        client_id: CONFIG.GOOGLE_CLIENT_ID,
                        callback: async (response) => {
                            // Send ID Token to backend for verification
                            await handleGoogleLogin(null, null, null, response.credential);
                        }
                    });
                    
                    window.google.accounts.id.renderButton(
                        googleBtnContainer,
                        { theme: "outline", size: "large", width: googleBtnContainer.offsetWidth || 340, text: "continue_with" }
                    );
                }
            };

            window.onload = initGIS;
            // Execute immediately if google object is already available
            if (window.google) {
                initGIS();
            }
        }
    }

    // Modal click out closing
    const accountsModal = document.getElementById('google-accounts-modal');
    if (accountsModal) {
        accountsModal.addEventListener('click', (e) => {
            if (e.target === accountsModal) {
                accountsModal.classList.remove('active');
                document.getElementById('google-custom-input-section').classList.remove('active');
                document.getElementById('google-accounts-list').style.display = 'block';
            }
        });
    }

    // Custom submit click
    const customSubmit = document.getElementById('google-custom-submit');
    if (customSubmit) {
        customSubmit.addEventListener('click', () => {
            const email = document.getElementById('google-custom-email').value;
            const name = document.getElementById('google-custom-name').value;
            if (!email || !name) {
                alert('Please enter both email and name.');
                return;
            }
            if (accountsModal) {
                accountsModal.classList.remove('active');
            }
            document.getElementById('google-custom-input-section').classList.remove('active');
            document.getElementById('google-accounts-list').style.display = 'block';
            const mockId = 'google-mock-id-' + email.replace(/[^a-zA-Z0-9]/g, '');
            handleGoogleLogin(email, name, mockId);
        });
    }
});

function logout() {
    localStorage.removeItem('sustaina_user_v3');
    window.location.href = 'login.html';
}
