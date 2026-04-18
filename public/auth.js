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
            const payload = {
                role: role,
                name: document.getElementById('name').value,
                password: document.getElementById('password').value
            };
            
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
});

function logout() {
    localStorage.removeItem('sustaina_user_v3');
    window.location.href = 'login.html';
}
