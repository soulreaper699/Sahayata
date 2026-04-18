const socket = io();

// Constants
const donationsContainer = document.getElementById('donations-container');
const loadingDonations = document.getElementById('loading-donations');
const donateModal = document.getElementById('donate-modal');
const claimModal = document.getElementById('claim-modal');
const reqModal = document.getElementById('req-modal');
const ratingModal = document.getElementById('rating-modal');

let listingsData = [];
let claimTargetId = null;
let ratingTargetListingId = null;
let ratingTargetUserId = null;

// User Auth
const userJson = localStorage.getItem('sustaina_user_v3');
if (!userJson) {
    window.location.href = 'login.html';
}
const currentUser = JSON.parse(userJson);

document.addEventListener('DOMContentLoaded', () => {
    const greeting = document.getElementById('user-greeting');
    if (greeting) greeting.textContent = `Hello, ${currentUser.name}`;
    
    fetchListings();
    fetchRequirements();
    fetchTrustStats();
    setupStars();
});

// Socket Events
socket.on('new_listing', (listing) => {
    if (currentUser.role === 'ngo' || listing.donor_id === currentUser.id) {
        listingsData.unshift(listing);
        renderListings();
    }
});

socket.on('listing_updated', () => fetchListings());
socket.on('requirement_updated', () => fetchRequirements());

// --- API CALLS ---

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

async function fetchRequirements() {
    try {
        const response = await fetch('/api/ngo/requirements');
        const reqs = await response.json();
        renderRequirements(reqs);
    } catch (err) {
        console.error('Failed to fetch requirements', err);
    }
}

async function fetchTrustStats() {
    try {
        const response = await fetch(`/api/ratings/${currentUser.id}`);
        const data = await response.json();
        renderTrustHeader(data);
        renderReviewsList(data.reviews);
    } catch (err) {
        console.error('Failed to fetch trust stats', err);
    }
}

// --- RENDERING LOGIC ---

function renderListings() {
    if (!donationsContainer) return;
    
    if (listingsData.length === 0) {
        donationsContainer.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color: var(--text-muted); padding: 3rem;">
            ${currentUser.role === 'donor' ? 'You have no active food listings.' : 'No available food listings in your area yet.'}
        </p>`;
        return;
    }

    donationsContainer.innerHTML = '';
    
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
        if (isDone) card.style.opacity = '0.7';

        let badgeClass = 'status-claimed';
        if (isPending) badgeClass = 'status-available';
        if (isAccepted) badgeClass = 'status-accepted';

        let expiryParsed = 'N/A';
        if (item.expiry_time) {
             const d = new Date(item.expiry_time);
             expiryParsed = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        const dietClass = item.diet_type === 'veg' ? 'diet-veg' : 'diet-nonveg';
        const dietLabel = item.diet_type === 'veg' ? 'VEG' : 'NON-VEG';

        innerHTML = `
            <div class="card-header">
                <span class="status-badge ${badgeClass}">
                    ${item.status.toUpperCase()}
                </span>
                <span style="font-size: 0.8rem; color: var(--text-muted);">Exp: ${expiryParsed}</span>
            </div>
            <div class="card-body" style="margin-top: 10px;">
                ${item.image_url ? `<img src="${item.image_url}" class="food-image-preview">` : ''}
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 0.5rem;">
                    <h3 style="margin:0;">${item.food_type}</h3>
                    <span class="diet-badge ${dietClass}">${dietLabel}</span>
                </div>
                <div style="margin-bottom: 10px;">
                    <span class="category-tag">${item.category || 'General'}</span>
                </div>
                <p style="margin-bottom: 6px;"><span>Quantity:</span> <span style="color:var(--text-main); font-weight: 600">${item.quantity}</span></p>
                <div class="donor-info">
                    <strong>${item.donor_name}</strong><br>
                    📍 ${item.location}
                </div>
            </div>
        `;

        const actionArea = document.createElement('div');
        actionArea.style.marginTop = '15px';

        if (isAccepted && currentUser.role === 'donor') {
            innerHTML += `
                <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dotted var(--card-border);">
                    <p style="color:var(--primary-color); font-size:0.85rem; margin-bottom:5px;"><b>Claimed by: ${item.ngo_name}</b></p>
                    <p style="font-size:0.8rem; line-height: 1.4;">
                        Loc: ${item.ngo_contact?.location || 'N/A'}
                    </p>
                </div>
            `;
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary btn-block';
            btn.textContent = 'Mark Completed';
            btn.onclick = () => markDone(item.id);
            actionArea.appendChild(btn);
        } 
        else if (isPending && currentUser.role === 'donor' && item.pending_requests?.length > 0) {
            innerHTML += `<div style="margin-top:15px; border-top:1px dotted #ccc; padding-top:10px;"><p style="font-size:0.8rem; color:var(--primary-color); font-weight:700;">Pending Approvals (${item.pending_requests.length})</p></div>`;
            item.pending_requests.forEach(req => {
                const rdiv = document.createElement('div');
                rdiv.style.cssText = "background:rgba(0,0,0,0.02); padding:8px; border-radius:8px; margin-top:8px; display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;";
                rdiv.innerHTML = `<span>${req.name}</span> <button class="btn btn-primary" style="padding:4px 8px; font-size:0.7rem;" onclick="approveRequest('${item.id}', '${req.request_id}')">Approve</button>`;
                actionArea.appendChild(rdiv);
            });
        }
        else if (isAccepted && currentUser.role === 'ngo') {
             innerHTML += `
               <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dotted var(--card-border);">
                    <p style="color:var(--primary-color); font-size:0.85rem; margin-bottom:5px;"><b>Donor: ${item.donor_contact?.phone || 'Contact Private'}</b></p>
                </div>
            `;
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary btn-block';
            btn.textContent = 'Mark Completed';
            btn.onclick = () => markDone(item.id);
            actionArea.appendChild(btn);
        }
        else if (isPending && currentUser.role === 'ngo') {
            const btn = document.createElement('button');
            btn.className = item.ngo_has_pending ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block';
            btn.disabled = item.ngo_has_pending;
            btn.textContent = item.ngo_has_pending ? 'Request Pending...' : 'Request Food';
            btn.onclick = () => openClaimModal(item.id);
            actionArea.appendChild(btn);
        }
        else if (isDone) {
            const rateBtn = document.createElement('button');
            rateBtn.className = 'btn btn-secondary btn-block';
            rateBtn.textContent = 'Rate Experience';
            rateBtn.onclick = () => openRatingModal(item.id, currentUser.role === 'donor' ? item.claimed_by_ngo_id : item.donor_id);
            actionArea.appendChild(rateBtn);
        }

        // Map Button
        if (item.lat && item.lng) {
            const mapBtn = document.createElement('button');
            mapBtn.className = 'btn btn-secondary btn-block';
            mapBtn.style.marginTop = '10px';
            mapBtn.innerHTML = '🗺️ View on Map';
            mapBtn.onclick = () => window.open(`https://www.google.com/maps?q=${item.lat},${item.lng}`, '_blank');
            actionArea.appendChild(mapBtn);
        }

        card.innerHTML = innerHTML;
        card.appendChild(actionArea);
        donationsContainer.appendChild(card);
    });
}

function renderRequirements(reqs) {
    const container = document.getElementById('ngo-requirements-container');
    const myList = document.getElementById('my-requirements-list');
    
    if (container) {
        container.innerHTML = '';
        const activeReqs = reqs.filter(r => r.ngo_id !== currentUser.id);
        if (activeReqs.length === 0) container.innerHTML = '<p style="color:var(--text-muted); font-size:0.8rem;">No active requirements.</p>';
        activeReqs.forEach(r => {
            const card = document.createElement('div');
            card.className = `req-card urgency-${r.urgency.toLowerCase()}`;
            card.style.minWidth = '220px';
            card.innerHTML = `
                <strong style="color:var(--text-main);">${r.title}</strong><br>
                <span style="font-size:0.75rem;">Qty: ${r.quantity}</span><br>
                <span style="font-size:0.7rem; color:var(--text-muted);">Needed: ${r.needed_by ? new Date(r.needed_by).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'ASAP'}</span><br>
                <span style="font-size:0.7rem; color:var(--text-muted);">By: ${r.ngo_name}</span>
            `;
            container.appendChild(card);
        });
    }

    if (myList) {
        myList.innerHTML = '';
        const myReqs = reqs.filter(r => r.ngo_id === currentUser.id);
        if (myReqs.length === 0) myList.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted);">No requirements posted.</p>';
        myReqs.forEach(r => {
            const card = document.createElement('div');
            card.className = 'req-card urgency-normal';
            card.style.minWidth = '180px';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${r.title}</strong>
                    <button onclick="deleteRequirement('${r.id}')" style="background:none; border:none; color:red; cursor:pointer;">&times;</button>
                </div>
                <span style="font-size:0.75rem;">Qty: ${r.quantity}</span><br>
                <span style="font-size:0.7rem; color:var(--text-muted);">Needed: ${r.needed_by ? new Date(r.needed_by).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : 'ASAP'}</span>
            `;
            myList.appendChild(card);
        });
    }
}

// --- FORMS & MODALS ---

// -- NGO Requirements --
function openReqModal() { document.getElementById('req-modal').classList.add('active'); }
function closeReqModal() { document.getElementById('req-modal').classList.remove('active'); }

const reqForm = document.getElementById('req-form');
if (reqForm) {
    reqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            ngo_id: currentUser.id,
            ngo_name: currentUser.name,
            title: document.getElementById('reqTitle').value,
            quantity: document.getElementById('reqQty').value,
            urgency: document.getElementById('reqUrgency').value,
            needed_by: document.getElementById('reqExpiry').value
        };
        await fetch('/api/ngo/requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        e.target.reset();
        closeReqModal();
    });
}

async function deleteRequirement(id) {
    if(!confirm('Delete this requirement?')) return;
    await fetch(`/api/ngo/requirements/${id}`, { method: 'DELETE' });
    fetchRequirements();
}

// -- Donation Form + Image Upload --
const dnForm = document.getElementById('donation-form');
if (dnForm) {
    dnForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('submit-donation-btn');
        btn.textContent = 'Posting...';
        
        // Handle Image First
        const imgInput = document.getElementById('foodImage');
        let imageUrl = '';
        if (imgInput.files.length > 0) {
            const formData = new FormData();
            formData.append('file', imgInput.files[0]);
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
            const uploadData = await uploadRes.json();
            imageUrl = uploadData.image_url;
        }

        const data = {
            donor_id: currentUser.id,
            food_type: document.getElementById('foodType').value,
            quantity: document.getElementById('quantity').value,
            diet_type: document.getElementById('dietType').value,
            category: document.getElementById('foodCategory').value,
            expiry_time: document.getElementById('expiryTime').value,
            location: document.getElementById('location').value,
            image_url: imageUrl,
            auto_accept: document.getElementById('autoAccept')?.checked || false
        };

        await fetch('/api/listings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        btn.textContent = 'Post Listing';
        e.target.reset();
        closeDonateModal();
    });
}

// -- Ratings --
function openRatingModal(listingId, targetUserId) {
    ratingTargetListingId = listingId;
    ratingTargetUserId = targetUserId;
    ratingModal.classList.add('active');
}
function closeRatingModal() { ratingModal.classList.remove('active'); }

function setupStars() {
    const stars = document.querySelectorAll('#star-selector span');
    stars.forEach(s => {
        s.onclick = () => {
            const val = s.getAttribute('data-val');
            document.getElementById('ratingValue').value = val;
            stars.forEach(st => {
                st.style.opacity = st.getAttribute('data-val') <= val ? '1' : '0.3';
            });
        };
    });
}

const ratingForm = document.getElementById('rating-form');
if (ratingForm) {
    ratingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            from_user_id: currentUser.id,
            to_user_id: ratingTargetUserId,
            listing_id: ratingTargetListingId,
            rating: document.getElementById('ratingValue').value,
            comment: document.getElementById('ratingComment').value
        };
        await fetch('/api/ratings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        alert('Thank you for your feedback!');
        closeRatingModal();
    });
}

// Global actions
async function markDone(listingId) { await fetch(`/api/listings/${listingId}/complete`, { method: 'POST' }); }
async function approveRequest(listingId, reqId) {
    await fetch(`/api/listings/${listingId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: reqId })
    });
}
function openDonateModal() { donateModal.classList.add('active'); }
function closeDonateModal() { donateModal.classList.remove('active'); }
function openClaimModal(id) { claimTargetId = id; claimModal.classList.add('active'); }
function closeClaimModal() { claimModal.classList.remove('active'); }

const clForm = document.getElementById('claim-form');
if (clForm) {
    clForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await fetch(`/api/listings/${claimTargetId}/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ngo_id: currentUser.id })
        });
        closeClaimModal();
    });
}

function renderTrustHeader(data) {
    const container = document.getElementById('user-trust-stats');
    if (!container) return;
    
    const joined = data.joined_at ? new Date(data.joined_at * 1000) : new Date();
    const joinedStr = joined.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    container.innerHTML = `
        <div class="trust-badge">
            <span>🛡️ Serving Since ${joinedStr}</span>
        </div>
        <div class="star-rating">
            ${Array.from({length: 5}, (_, i) => `<span class="star ${i < Math.floor(data.average) ? '' : 'empty'}">★</span>`).join('')}
            <span style="color:var(--text-main); font-size: 0.9rem; margin-left: 5px;">(${data.average || 0})</span>
        </div>
    `;
}

function renderReviewsList(reviews) {
    const container = document.getElementById('reviews-container');
    if (!container) return;
    
    if (!reviews || reviews.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 2rem;">No feedback received yet. Complete donations to build your reputation!</p>';
        return;
    }
    
    container.innerHTML = reviews.map(r => `
        <div class="review-card">
            <div class="star-rating" style="font-size: 0.8rem; margin-bottom: 5px;">
                ${Array.from({length: 5}, (_, i) => `<span class="star ${i < r.rating ? '' : 'empty'}">★</span>`).join('')}
            </div>
            <p style="font-size: 0.9rem; margin:0;">"${r.comment || 'No comment provided.'}"</p>
            <div class="review-meta">
                <span>By Anonymous</span>
            </div>
        </div>
    `).join('');
}
