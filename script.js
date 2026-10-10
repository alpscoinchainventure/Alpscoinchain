// AlpsCoinChain - TEST DASHBOARD
// This version is for testing the dashboard UI and workflow.
// Test balances are stored locally in the browser.
// Supabase connection is kept available for future integration.

const SUPABASE_URL = 'https://uevofmlzpwrdidjnwxfd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_OLqZsWFBHY8CaTkko0-FcA_26y2jhJB';

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

// TEST DATA ONLY
const defaultState = {
    balances: {
        USDT: 4250,
        ETH: 2.85,
        BTC: 0.42
    },

    pendingWithdrawals: [],
    pendingPayments: [],

    completedWithdrawals: [],
    completedPayments: [],

    failedWithdrawals: [],
    failedPayments: [],

    tradeHoldings: {},
    tradeHistory: []
};

let portfolioState = loadPortfolioState();

function loadPortfolioState() {
    try {
        const savedState = localStorage.getItem(
            'alpscoinchain-test-portfolio-state'
        );

        if (!savedState) {
            return JSON.parse(JSON.stringify(defaultState));
        }

        const parsed = JSON.parse(savedState);

        return {
            balances: {
                ...defaultState.balances,
                ...(parsed.balances || {})
            },

            pendingWithdrawals: Array.isArray(
                parsed.pendingWithdrawals
            )
                ? parsed.pendingWithdrawals
                : [],

            pendingPayments: Array.isArray(
                parsed.pendingPayments
            )
                ? parsed.pendingPayments
                : [],

            completedWithdrawals: Array.isArray(
                parsed.completedWithdrawals
            )
                ? parsed.completedWithdrawals
                : [],

            completedPayments: Array.isArray(
                parsed.completedPayments
            )
                ? parsed.completedPayments
                : [],

            failedWithdrawals: Array.isArray(
                parsed.failedWithdrawals
            )
                ? parsed.failedWithdrawals
                : [],

            failedPayments: Array.isArray(
                parsed.failedPayments
            )
                ? parsed.failedPayments
                : [],

            tradeHoldings:
                parsed.tradeHoldings || {},

            tradeHistory: Array.isArray(
                parsed.tradeHistory
            )
                ? parsed.tradeHistory
                : []
        };
    } catch (error) {
        console.warn(
            'Unable to load test portfolio state:',
            error
        );

        return JSON.parse(
            JSON.stringify(defaultState)
        );
    }
}

function savePortfolioState() {
    localStorage.setItem(
        'alpscoinchain-test-portfolio-state',
        JSON.stringify(portfolioState)
    );
}

function roundAmount(value) {
    return Number(Number(value).toFixed(8));
}

function formatAmount(asset, value) {
    const precision =
        asset === 'USDT' ? 2 : 4;

    return `${Number(value).toLocaleString(
        undefined,
        {
            minimumFractionDigits: precision,
            maximumFractionDigits: precision
        }
    )} ${asset}`;
}

function calculatePortfolioValue() {
    // TEST DISPLAY ONLY.
    // These prices are only used to give the dashboard
    // a visual total during testing.

    const prices = {
        USDT: 1,
        ETH: 3412,
        BTC: 64221
    };

    return (
        portfolioState.balances.USDT * prices.USDT +
        portfolioState.balances.ETH * prices.ETH +
        portfolioState.balances.BTC * prices.BTC
    );
}

function updateBalanceDisplay() {
    const usdtBalance =
        document.getElementById('usdt-balance');

    const ethBalance =
        document.getElementById('eth-balance');

    const btcBalance =
        document.getElementById('btc-balance');

    const totalBalance =
        document.getElementById('total-balance');

    if (usdtBalance) {
        usdtBalance.textContent =
            Number(
                portfolioState.balances.USDT
            ).toFixed(2);
    }

    if (ethBalance) {
        ethBalance.textContent =
            Number(
                portfolioState.balances.ETH
            ).toFixed(4);
    }

    if (btcBalance) {
        btcBalance.textContent =
            Number(
                portfolioState.balances.BTC
            ).toFixed(4);
    }

    if (totalBalance) {
        totalBalance.textContent =
            `$${calculatePortfolioValue().toLocaleString(
                undefined,
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            )}`;
    }
}

function updateWithdrawPreview() {
    const assetElement =
        document.getElementById(
            'withdraw-asset'
        );

    const symbol =
        document.getElementById(
            'withdraw-symbol'
        );

    const available =
        document.getElementById(
            'withdraw-available'
        );

    if (
        !assetElement ||
        !symbol ||
        !available
    ) {
        return;
    }

    const asset =
        assetElement.value;

    symbol.textContent = asset;

    available.textContent =
        formatAmount(
            asset,
            portfolioState.balances[asset] || 0
        );
}

function updateAmountPreview() {
    const amountElement =
        document.getElementById(
            'deposit-amount'
        );

    const assetElement =
        document.getElementById(
            'deposit-asset'
        );

    const symbol =
        document.getElementById(
            'deposit-symbol'
        );

    const estimatedSpan =
        document.getElementById(
            'deposit-estimated'
        );

    if (
        !amountElement ||
        !assetElement ||
        !symbol ||
        !estimatedSpan
    ) {
        return;
    }

    const amount =
        amountElement.value;

    const asset =
        assetElement.value;

    symbol.textContent = asset;

    if (amount) {
        const numericAmount =
            parseFloat(amount);

        if (
            !Number.isNaN(
                numericAmount
            ) &&
            numericAmount > 0
        ) {
            const fee =
                numericAmount * 0.01;

            const estimated =
                numericAmount - fee;

            estimatedSpan.textContent =
                `${estimated.toFixed(
                    2
                )} ${asset}`;

            return;
        }
    }

    estimatedSpan.textContent =
        `0.00 ${asset}`;
}

function showTab(tabIndex) {
    const tabs =
        document.querySelectorAll(
            '.vault-form'
        );

    const buttons =
        document.querySelectorAll(
            '.tab-btn'
        );

    tabs.forEach(
        (tab, index) => {
            tab.classList.remove(
                'active'
            );

            if (buttons[index]) {
                buttons[index].classList.remove(
                    'active'
                );
            }
        }
    );

    if (tabs[tabIndex]) {
        tabs[tabIndex].classList.add(
            'active'
        );
    }

    if (buttons[tabIndex]) {
        buttons[tabIndex].classList.add(
            'active'
        );
    }
}

function renderTradingPanel() {
    const positionsContainer =
        document.getElementById(
            'trade-positions'
        );

    const historyContainer =
        document.getElementById(
            'trade-history'
        );

    if (
        !positionsContainer ||
        !historyContainer
    ) {
        return;
    }

    const entries =
        Object.entries(
            portfolioState.tradeHoldings
        ).filter(
            ([, amount]) =>
                Number(amount) > 0
        );

    positionsContainer.innerHTML =
        entries.length
            ? entries
                  .map(
                      ([asset, amount]) => `
                        <div class="position-item">
                            <strong>${asset}</strong>
                            <span>
                                ${Number(amount).toFixed(
                                    2
                                )} units
                            </span>
                        </div>
                    `
                  )
                  .join('')
            : `
                <div class="empty-state">
                    No holdings yet.
                </div>
            `;

    historyContainer.innerHTML =
        portfolioState.tradeHistory.length
            ? portfolioState.tradeHistory
                  .slice(0, 5)
                  .map(
                      (trade) => `
                        <div class="history-item">
                            <div>
                                <strong>
                                    ${trade.action.toUpperCase()}
                                    ${trade.asset}
                                </strong>

                                <span>
                                    ${trade.market}
                                </span>
                            </div>

                            <small>
                                ${trade.amount}
                                •
                                ${trade.createdAt}
                            </small>
                        </div>
                    `
                  )
                  .join('')
            : `
                <div class="empty-state">
                    No trade orders yet.
                </div>
            `;
}

function renderPending
