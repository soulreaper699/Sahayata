const socket = io();

// DOM Elements
const donationsContainer = document.getElementById('donations-container');
const loadingDonations = document.getElementById('loading-donations');
const donateModal = document.getElementById('donate-modal');
const claimModal = document.getElementById('claim-modal');

// State
let donationsData = [];
let claimTargetId = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    fetchDonations();
});

// Socket Events
socket.on('new_donation', (donation) => {
    donationsData.unshift(donation); // Add to beginning
    renderDonations();
});

socket.on('donation_claimed', (updatedDonation) => {
    const index = donationsData.findIndex(d => d.id === updatedDonation.id);
    if (index !== -1) {
        donationsData[index] = updatedDonation;
        renderDonations();
    }
});

// API Calls
async function fetchDonations() {
    try {
        const response = await fetch('/api/donations');
        donationsData = await response.json();
        renderDonations();
    } catch (err) {
        console.error('Failed to fetch donations', err);
        loadingDonations.innerHTML = '<p>Error loading live feed.</p>';
    }
}

// Render Logic
function renderDonations() {
    if (donationsData.length === 0) {
        donationsContainer.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color: var(--text-muted)">No active donations right now. Be the first to donate!</p>';
        return;
    }

    donationsContainer.innerHTML = '';
    
    donationsData.forEach(item => {
        const isAvailable = item.status === 'Available';
        const card = document.createElement('div');
        card.className = 'glass-card donation-card';
        card.innerHTML = `
            <div class="card-header">
                <span class="status-badge ${isAvailable ? 'status-available' : 'status-claimed'}">
                    ${item.status}
                </span>
                <span style="font-size: 0.8rem; color: var(--text-muted);">${item.pickupTime}</span>
            </div>
            <div class="card-body">
                <h3>${item.foodType}</h3>
                <p><span>Quantity:</span> <span style="color:white; font-weight: 500">${item.quantity}</span></p>
                <div class="donor-info">Donated by: ${item.donorName}</div>
            </div>
        `;
        
        if (isAvailable) {
            const clampBtn = document.createElement('button');
            clampBtn.className = 'btn btn-secondary btn-block';
            clampBtn.style.marginTop = '10px';
            clampBtn.textContent = 'Claim for NGO';
            clampBtn.onclick = () => openClaimModal(item.id, item.foodType, item.quantity);
            card.appendChild(clampBtn);
        } else {
            const claimedText = document.createElement('div');
            claimedText.style.marginTop = '10px';
            claimedText.style.fontSize = '0.85rem';
            claimedText.style.color = 'var(--accent-red)';
            claimedText.innerHTML = `Claimed securely by <b>${item.claimedBy}</b>`;
            card.appendChild(claimedText);
        }

        donationsContainer.appendChild(card);
    });
}

// Modal Form Logic
function openDonateModal() {
    donateModal.classList.add('active');
}
function closeDonateModal() {
    donateModal.classList.remove('active');
}

document.getElementById('donation-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-donation-btn');
    btn.textContent = 'Submitting...';
    
    const payload = {
        donorName: document.getElementById('donorName').value,
        foodType: document.getElementById('foodType').value,
        quantity: document.getElementById('quantity').value,
        pickupTime: document.getElementById('pickupTime').value
    };

    try {
        await fetch('/api/donations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        e.target.reset();
        closeDonateModal();
    } catch (err) {
        console.error(err);
    } finally {
        btn.textContent = 'Submit Donation';
    }
});

function openClaimModal(id, foodType, quantity) {
    claimTargetId = id;
    document.getElementById('claim-details').innerText = `You are claiming: ${quantity} of ${foodType}. This action cannot be undone.`;
    claimModal.classList.add('active');
}
function closeClaimModal() {
    claimModal.classList.remove('active');
    claimTargetId = null;
}

document.getElementById('claim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!claimTargetId) return;

    const ngoName = document.getElementById('ngoName').value;
    const btn = e.target.querySelector('button');
    btn.textContent = 'Securing...';

    try {
        await fetch(`/api/donations/${claimTargetId}/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ngoName })
        });
        e.target.reset();
        closeClaimModal();
    } catch (err) {
        console.error(err);
    } finally {
        btn.textContent = 'Confirm Claim';
    }
});

function scrollToDashboard() {
    document.getElementById('dashboard').scrollIntoView({ behavior: 'smooth' });
}
