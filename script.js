const defaultState = {
    balances: {
        USDT: 4250,
        ETH: 2.85,
        BTC: 0.42
    },
    pendingWithdrawals: [],
    pendingPayments: [],
    tradeHoldings: {},
    tradeHistory: []
};

let portfolioState = loadPortfolioState();

function loadPortfolioState() {
    try {
        const savedState = localStorage.getItem('alpscoinchain-portfolio-state');
        if (!savedState) {
            return JSON.parse(JSON.stringify(defaultState));
        }

        const parsed = JSON.parse(savedState);
        return {
            balances: { ...defaultState.balances, ...(parsed.balances || {}) },
            pendingWithdrawals: Array.isArray(parsed.pendingWithdrawals) ? parsed.pendingWithdrawals : [],
            pendingPayments: Array.isArray(parsed.pendingPayments) ? parsed.pendingPayments : [],
            tradeHoldings: parsed.tradeHoldings || {},
            tradeHistory: Array.isArray(parsed.tradeHistory) ? parsed.tradeHistory : []
        };
    } catch (error) {
        console.warn('Unable to load portfolio state:', error);
        return JSON.parse(JSON.stringify(defaultState));
    }
}

function savePortfolioState() {
    localStorage.setItem('alpscoinchain-portfolio-state', JSON.stringify(portfolioState));
}

function roundAmount(value) {
    return Number(value.toFixed(8));
}

function formatAmount(asset, value) {
    const precision = asset === 'USDT' ? 2 : 4;
    return `${Number(value).toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision
    })} ${asset}`;
}

function updateBalanceDisplay() {
    document.getElementById('usdt-balance').textContent = portfolioState.balances.USDT.toFixed(2);
    document.getElementById('eth-balance').textContent = portfolioState.balances.ETH.toFixed(2);
    document.getElementById('btc-balance').textContent = portfolioState.balances.BTC.toFixed(2);
}

function updateWithdrawPreview() {
    const asset = document.getElementById('withdraw-asset').value;
    const symbol = document.getElementById('withdraw-symbol');

    symbol.textContent = asset;
    document.getElementById('withdraw-available').textContent = formatAmount(asset, portfolioState.balances[asset]);
}

function updateAmountPreview() {
    const amount = document.getElementById('deposit-amount').value;
    const asset = document.getElementById('deposit-asset').value;
    const symbol = document.getElementById('deposit-symbol');
    const estimatedSpan = document.getElementById('deposit-estimated');

    symbol.textContent = asset;

    if (amount) {
        const fee = (parseFloat(amount) * 0.01).toFixed(2);
        const estimated = (parseFloat(amount) - fee).toFixed(2);
        estimatedSpan.textContent = `${estimated} ${asset}`;
    } else {
        estimatedSpan.textContent = `0.00 ${asset}`;
    }
}

function showTab(tabIndex) {
    const tabs = document.querySelectorAll('.vault-form');
    const buttons = document.querySelectorAll('.tab-btn');

    tabs.forEach((tab, index) => {
        tab.classList.remove('active');
        buttons[index].classList.remove('active');
    });

    tabs[tabIndex].classList.add('active');
    buttons[tabIndex].classList.add('active');
}

function renderTradingPanel() {
    const positionsContainer = document.getElementById('trade-positions');
    const historyContainer = document.getElementById('trade-history');

    if (!positionsContainer || !historyContainer) {
        return;
    }

    const entries = Object.entries(portfolioState.tradeHoldings).filter(([, amount]) => Number(amount) > 0);

    positionsContainer.innerHTML = entries.length
        ? entries.map(([asset, amount]) => `
            <div class="position-item">
                <strong>${asset}</strong>
                <span>${Number(amount).toFixed(2)} units</span>
            </div>
        `).join('')
        : '<div class="empty-state">No holdings yet. Place your first trade.</div>';

    historyContainer.innerHTML = portfolioState.tradeHistory.length
        ? portfolioState.tradeHistory.slice(0, 5).map((trade) => `
            <div class="history-item">
                <div>
                    <strong>${trade.action.toUpperCase()} ${trade.asset}</strong>
                    <span>${trade.market}</span>
                </div>
                <small>${trade.amount} • ${trade.createdAt}</small>
            </div>
        `).join('')
        : '<div class="empty-state">No trade orders yet.</div>';
}

function renderPendingRequests() {
    const withdrawalList = document.getElementById('withdrawal-requests-list');
    const paymentList = document.getElementById('payment-requests-list');
    const withdrawalCount = document.getElementById('withdrawal-count');
    const paymentCount = document.getElementById('payment-count');

    withdrawalCount.textContent = portfolioState.pendingWithdrawals.length;
    paymentCount.textContent = portfolioState.pendingPayments.length;

    withdrawalList.innerHTML = portfolioState.pendingWithdrawals.length
        ? portfolioState.pendingWithdrawals.map((request) => `
            <div class="request-item">
                <div class="request-details">
                    <strong>${request.asset} withdrawal</strong>
                    <span>${formatAmount(request.asset, request.amount)} • ${request.requestedAt}</span>
                </div>
                <div class="request-actions">
                    <button class="action-btn approve-btn" onclick="approveWithdrawal(${request.id})">Approve</button>
                    <button class="action-btn deny-btn" onclick="denyWithdrawal(${request.id})">Deny</button>
                </div>
            </div>
        `).join('')
        : '<div class="empty-state">No withdrawal requests pending.</div>';

    paymentList.innerHTML = portfolioState.pendingPayments.length
        ? portfolioState.pendingPayments.map((request) => `
            <div class="request-item">
                <div class="request-details">
                    <strong>${request.asset} incoming payment</strong>
                    <span>${formatAmount(request.asset, request.amount)} • ${request.requestedAt}</span>
                </div>
                <div class="request-actions">
                    <button class="action-btn approve-btn" onclick="approvePayment(${request.id})">Confirm</button>
                    <button class="action-btn deny-btn" onclick="denyPayment(${request.id})">Deny</button>
                </div>
            </div>
        `).join('')
        : '<div class="empty-state">No incoming payment confirmations pending.</div>';
}

function makeDeposit() {
    const amount = document.getElementById('deposit-amount').value;
    const asset = document.getElementById('deposit-asset').value;

    if (!amount || parseFloat(amount) <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    const parsedAmount = parseFloat(amount);
    portfolioState.pendingPayments.push({
        id: Date.now(),
        asset,
        amount: parsedAmount,
        status: 'pending',
        requestedAt: new Date().toLocaleString()
    });

    savePortfolioState();
    renderPendingRequests();
    document.getElementById('deposit-amount').value = '';
    updateAmountPreview();

    alert(`Incoming payment confirmation requested.\n\nAsset: ${asset}\nAmount: ${amount}\n\nThe payment will be confirmed once approved.`);
}

function makeWithdraw() {
    const amount = document.getElementById('withdraw-amount').value;
    const asset = document.getElementById('withdraw-asset').value;

    if (!amount || parseFloat(amount) <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    const parsedAmount = parseFloat(amount);
    if (parsedAmount > portfolioState.balances[asset]) {
        alert(`Insufficient ${asset} balance for this withdrawal request.`);
        return;
    }

    portfolioState.pendingWithdrawals.push({
        id: Date.now(),
        asset,
        amount: parsedAmount,
        status: 'pending',
        requestedAt: new Date().toLocaleString()
    });

    savePortfolioState();
    renderPendingRequests();
    document.getElementById('withdraw-amount').value = '';
    updateWithdrawPreview();

    alert(`Withdrawal approval requested.\n\nAsset: ${asset}\nAmount: ${amount}\n\nThe request will be approved or denied by the review team.`);
}

function approveWithdrawal(requestId) {
    const request = portfolioState.pendingWithdrawals.find((item) => item.id === requestId);
    if (!request) {
        return;
    }

    if (request.amount > portfolioState.balances[request.asset]) {
        alert(`The ${request.asset} balance is no longer sufficient for this withdrawal.`);
        return;
    }

    portfolioState.balances[request.asset] = roundAmount(portfolioState.balances[request.asset] - request.amount);
    portfolioState.pendingWithdrawals = portfolioState.pendingWithdrawals.filter((item) => item.id !== requestId);
    savePortfolioState();
    updateBalanceDisplay();
    updateWithdrawPreview();
    renderPendingRequests();
    alert(`Withdrawal approved and ${formatAmount(request.asset, request.amount)} was released.`);
}

function denyWithdrawal(requestId) {
    const request = portfolioState.pendingWithdrawals.find((item) => item.id === requestId);
    if (!request) {
        return;
    }

    portfolioState.pendingWithdrawals = portfolioState.pendingWithdrawals.filter((item) => item.id !== requestId);
    savePortfolioState();
    renderPendingRequests();
    alert(`Withdrawal request for ${formatAmount(request.asset, request.amount)} was denied.`);
}

function approvePayment(requestId) {
    const request = portfolioState.pendingPayments.find((item) => item.id === requestId);
    if (!request) {
        return;
    }

    portfolioState.balances[request.asset] = roundAmount(portfolioState.balances[request.asset] + request.amount);
    portfolioState.pendingPayments = portfolioState.pendingPayments.filter((item) => item.id !== requestId);
    savePortfolioState();
    updateBalanceDisplay();
    updateWithdrawPreview();
    renderPendingRequests();
    alert(`Incoming ${formatAmount(request.asset, request.amount)} was confirmed and added to your balance.`);
}

function denyPayment(requestId) {
    const request = portfolioState.pendingPayments.find((item) => item.id === requestId);
    if (!request) {
        return;
    }

    portfolioState.pendingPayments = portfolioState.pendingPayments.filter((item) => item.id !== requestId);
    savePortfolioState();
    renderPendingRequests();
    alert(`Incoming payment request for ${formatAmount(request.asset, request.amount)} was denied.`);
}

// Wallet Connection
function connectWallet() {
    alert('Wallet connection:\n\nThis would trigger Web3 connection to MetaMask or other wallet providers.\n\nFeature requires Web3.js or ethers.js integration.');
}

// Start Investing
function startInvesting() {
    const portfolioSection = document.getElementById('portfolio');
    portfolioSection.scrollIntoView({ behavior: 'smooth' });
}

// Whitepaper
function viewWhitepaper() {
    alert('Whitepaper:\n\nThis would open or download the AlpsCoinChain whitepaper PDF.');
}

// Buy Token
function buyToken() {
    alert('Buy $ALPS Token:\n\nThis would redirect to a DEX (Decentralized Exchange) or integrated purchase page where you can buy $ALPS tokens.');
}

// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

async function submitContactForm(event) {
    event.preventDefault();

    const form = event.target;
    const status = document.getElementById('contact-status');
    const submitButton = form.querySelector('button[type="submit"]');

    status.textContent = 'Sending your message...';
    status.style.color = '#fbbf24';
    submitButton.disabled = true;

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
        const response = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Unable to send message.');
        }

        form.reset();
        status.textContent = 'Your message was sent successfully.';
        status.style.color = '#10b981';
    } catch (error) {
        status.textContent = error.message || 'Unable to send message right now.';
        status.style.color = '#fda4af';
    } finally {
        submitButton.disabled = false;
    }
}

async function submitTrade(event) {
    event.preventDefault();

    const form = event.target;
    const status = document.getElementById('trade-status');
    const submitButton = form.querySelector('button[type="submit"]');

    status.textContent = 'Placing order...';
    status.style.color = '#fbbf24';
    submitButton.disabled = true;

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.amount = Number(payload.amount);

    try {
        if (!payload.clientEmail || !payload.asset || !payload.action || !payload.amount) {
            throw new Error('Please complete all trade fields.');
        }

        const currentHolding = portfolioState.tradeHoldings[payload.asset] || 0;
        if (payload.action === 'sell' && currentHolding < payload.amount) {
            throw new Error(`You do not own enough ${payload.asset} to place that sell order.`);
        }

        const response = await fetch('/api/trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Unable to place trade.');
        }

        const updatedHolding = (payload.action === 'buy' ? currentHolding + payload.amount : currentHolding - payload.amount);
        portfolioState.tradeHoldings[payload.asset] = Math.max(0, updatedHolding);
        if (portfolioState.tradeHoldings[payload.asset] === 0) {
            delete portfolioState.tradeHoldings[payload.asset];
        }

        portfolioState.tradeHistory.unshift({
            id: Date.now(),
            asset: payload.asset,
            action: payload.action,
            amount: payload.amount,
            market: payload.market,
            clientEmail: payload.clientEmail,
            createdAt: new Date().toLocaleString()
        });

        savePortfolioState();
        renderTradingPanel();
        form.reset();
        status.textContent = `${payload.action === 'buy' ? 'Bought' : 'Sold'} ${payload.asset} successfully.`;
        status.style.color = '#10b981';
    } catch (error) {
        status.textContent = error.message || 'Unable to place order right now.';
        status.style.color = '#fda4af';
    } finally {
        submitButton.disabled = false;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    updateAmountPreview();
    updateWithdrawPreview();
    updateBalanceDisplay();
    renderPendingRequests();
    renderTradingPanel();

    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', submitContactForm);
    }

    const tradeForm = document.getElementById('trade-form');
    if (tradeForm) {
        tradeForm.addEventListener('submit', submitTrade);
    }
});

// Scroll reveal animation
const revealElements = document.querySelectorAll('.feature-card, .step, .section-header');
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.animation = 'fadeInUp 0.6s ease-out forwards';
            observer.unobserve(entry.target);
        }
    });
}, {
    threshold: 0.1
});

revealElements.forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
});