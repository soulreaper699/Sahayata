const socket = io();

const donationsContainer = document.getElementById('donations-container');
const loadingDonations = document.getElementById('loading-donations');
const donateModal = document.getElementById('donate-modal');
const claimModal = document.getElementById('claim-modal');

let listingsData = [];
let claimTargetId = null;

// Ensure auth securely
const userJson = localStorage.getItem('sustaina_user_v3');
if (!userJson) {
    window.location.href = 'login.html';
}

const currentUser = JSON.parse(userJson);

document.addEventListener('DOMContentLoaded', () => {
    const greeting = document.getElementById('user-greeting');
    if (greeting) greeting.textContent = `Hello, ${currentUser.name}`;
    fetchListings();
});

// Socket Events
socket.on('new_listing', (listing) => {
    if (currentUser.role === 'ngo' || listing.donor_id === currentUser.id) {
        listingsData.unshift(listing);
        renderListings();
    }
});

socket.on('listing_updated', () => {
    // For simplicity, just refetch since multiple relations might have changed
    fetchListings();
});

// API Calls
async function fetchListings() {
    try {
        const url = `/api/listings?user_id=${currentUser.id}&role=${currentUser.role}`;
        const response = await fetch(url);
        listingsData = await response.json();
        renderListings();
    } catch (err) {
        console.error('Failed to fetch listings', err);
        if (loadingDonations) loadingDonations.innerHTML = '<p>Error loading dashboard.</p>';
    }
}

// Global Actions
async function markDone(listingId) {
    try {
        await fetch(`/api/listings/${listingId}/complete`, { method: 'POST' });
    } catch (e) {
        console.error(e);
    }
}

async function approveRequest(listingId, requestId) {
    try {
        await fetch(`/api/listings/${listingId}/approve`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: requestId })
        });
    } catch (e) {
        console.error(e);
    }
}

// Rendering Logic
function renderListings() {
    if (!donationsContainer) return;
    
    if (listingsData.length === 0) {
        donationsContainer.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color: var(--text-muted)">
            ${currentUser.role === 'donor' ? 'You have no active food listings.' : 'No available food listings in your area yet.'}
        </p>`;
        return;
    }

    donationsContainer.innerHTML = '';
    
    // Primary Sort: available first, claimed second, completed last
    let sorted = [...listingsData].sort((a,b) => {
        const order = { "available": 1, "claimed": 2, "completed": 3 };
        return order[a.status] - order[b.status];
    });

    sorted.forEach(item => {
        const isPending = item.status === 'available';
        const isAccepted = item.status === 'claimed';
        const isDone = item.status === 'completed';
        
        const card = document.createElement('div');
        card.className = 'glass-card donation-card';
        if (isDone) card.style.opacity = '0.6';

        let badgeClass = 'status-claimed'; // completed
        if (isPending) badgeClass = 'status-available';
        if (isAccepted) badgeClass = 'status-accepted'; 

        const badgeStyle = isAccepted ? 'background: rgba(0, 210, 255, 0.15); color: var(--secondary-color);' : '';

        // Expiry formatting
        let expiryParsed = 'N/A';
        if (item.expiry_time) {
             const d = new Date(item.expiry_time);
             expiryParsed = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        let innerHTML = `
            <div class="card-header">
                <span class="status-badge ${badgeClass}" style="${badgeStyle}">
                    ${item.status.toUpperCase()}
                </span>
                <span style="font-size: 0.8rem; color: var(--text-muted);">Exp: ${expiryParsed}</span>
            </div>
            <div class="card-body" style="margin-top: 10px;">
                <h3>${item.food_type}</h3>
                <p style="margin-bottom: 2px;"><span>Quantity:</span> <span style="color:var(--text-main); font-weight: 600">${item.quantity}</span></p>
                <div class="donor-info">From: ${item.donor_name} <br> Loc: ${item.location}</div>
            </div>
        `;

        // If Donor sees Accepted -> Show NGO Info
        if (isAccepted && currentUser.role === 'donor') {
            innerHTML += `
                <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dotted var(--card-border);">
                    <p style="color:var(--primary-color); font-size:0.85rem; margin-bottom:5px;"><b>Requested & Claimed by: ${item.ngo_name}</b></p>
                    <p style="font-size:0.8rem; line-height: 1.4;">
                    Capacity: <span style="color:var(--text-main); font-weight: 500">${item.ngo_contact?.capacity || 'N/A'}</span><br>
                    Location: <span style="color:var(--text-main); font-weight: 500">${item.ngo_contact?.location || 'N/A'}</span>
                    </p>
                </div>
            `;
            const markDoneBtn = document.createElement('button');
            markDoneBtn.className = 'btn btn-secondary btn-block';
            markDoneBtn.textContent = 'Mark Completed';
            markDoneBtn.style.marginTop = '15px';
            markDoneBtn.onclick = () => markDone(item.id);
            card.innerHTML = innerHTML;
            card.appendChild(markDoneBtn);
        } 
        // If Donor sees Available and has pending requests -> Show Queue
        else if (isPending && currentUser.role === 'donor' && item.pending_requests && item.pending_requests.length > 0) {
            innerHTML += `
                <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dotted var(--card-border);">
                    <p style="color:var(--primary-color); font-size:0.85rem; margin-bottom:10px;"><b>Pending Requests (${item.pending_requests.length})</b></p>
            `;
            let queueHTML = '</div><div style="display:flex; flex-direction:column; gap:8px;">';
            
            card.innerHTML = innerHTML + queueHTML;
            
            item.pending_requests.forEach(req => {
                const reqDiv = document.createElement('div');
                reqDiv.style.cssText = "background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; font-size: 0.8rem; display:flex; justify-content:space-between; align-items:center;";
                
                reqDiv.innerHTML = `
                    <div>
                        <strong style="color:var(--text-main);">${req.name}</strong><br>
                        Cap: ${req.capacity}
                    </div>
                `;
                
                const appBtn = document.createElement('button');
                appBtn.style.cssText = "background: var(--primary-color); color: white; border:none; padding: 5px 10px; border-radius: 6px; cursor: pointer; font-weight:600;";
                appBtn.textContent = 'Approve';
                appBtn.onclick = () => approveRequest(item.id, req.request_id);
                
                reqDiv.appendChild(appBtn);
                card.appendChild(reqDiv);
            });
        }
        // If NGO sees Accepted -> Show Donor Info
        else if (isAccepted && currentUser.role === 'ngo') {
             innerHTML += `
               <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dotted var(--card-border);">
                    <p style="color:var(--primary-color); font-size:0.85rem; margin-bottom:5px;"><b>Donor Contact Details</b></p>
                    <p style="font-size:0.8rem; line-height: 1.4;">
                    Phone: <span style="color:var(--text-main); font-weight: 500">${item.donor_contact?.phone || 'N/A'}</span>
                    </p>
                </div>
            `;
            const markDoneBtn = document.createElement('button');
            markDoneBtn.className = 'btn btn-secondary btn-block';
            markDoneBtn.textContent = 'Mark Completed';
            markDoneBtn.style.marginTop = '15px';
            markDoneBtn.onclick = () => markDone(item.id);
            card.innerHTML = innerHTML;
            card.appendChild(markDoneBtn);
        }
        else if (isPending && currentUser.role === 'ngo') {
            if (item.ngo_has_pending) {
                const waitBadge = document.createElement('div');
                waitBadge.style.cssText = "background: rgba(0,0,0,0.05); color: var(--text-muted); text-align:center; padding: 10px; border-radius: 8px; margin-top: 15px; font-size: 0.9rem; font-weight: 600;";
                waitBadge.textContent = '🤞 Pending Donor Approval...';
                card.innerHTML = innerHTML;
                card.appendChild(waitBadge);
            } else {
                const claimBtn = document.createElement('button');
                claimBtn.className = 'btn btn-primary btn-block';
                claimBtn.textContent = 'Send Request / Claim';
                claimBtn.style.marginTop = '15px';
                claimBtn.onclick = () => openClaimModal(item.id);
                card.innerHTML = innerHTML;
                card.appendChild(claimBtn);
            }
        }
        else {
             card.innerHTML = innerHTML;
        }

        donationsContainer.appendChild(card);
    });
}

// Forms & Modals
// -- Donor Modal --
function openDonateModal() { if(donateModal) donateModal.classList.add('active'); }
function closeDonateModal() { if(donateModal) donateModal.classList.remove('active'); }

const dnForm = document.getElementById('donation-form');
if (dnForm) {
    dnForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('submit-donation-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Posting...';
        
        try {
            await fetch('/api/listings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    donor_id: currentUser.id,
                    food_type: document.getElementById('foodType').value,
                    quantity: document.getElementById('quantity').value,
                    expiry_time: document.getElementById('expiryTime').value,
                    location: document.getElementById('location').value,
                    auto_accept: document.getElementById('autoAccept') ? document.getElementById('autoAccept').checked : false
                })
            });
            e.target.reset();
            closeDonateModal();
        } catch (err) {
            console.error(err);
        } finally {
            btn.textContent = originalText;
        }
    });
}

// -- NGO Claim Modal --
function openClaimModal(id) {
    claimTargetId = id;
    if(claimModal) claimModal.classList.add('active');
}
function closeClaimModal() {
    if(claimModal) claimModal.classList.remove('active');
    claimTargetId = null;
}

const clForm = document.getElementById('claim-form');
if (clForm) {
    clForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!claimTargetId) return;

        const btn = e.target.querySelector('button');
        const originalText = btn.textContent;
        btn.textContent = 'Requesting...';

        try {
            await fetch(`/api/listings/${claimTargetId}/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ngo_id: currentUser.id })
            });
            closeClaimModal();
        } catch (err) {
            console.error(err);
        } finally {
            btn.textContent = originalText;
        }
    });
}
