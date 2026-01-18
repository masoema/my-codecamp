// ===== CONTRACT CONFIGURATION =====
// Contract deployed on Paseo Asset Hub
const CONTRACT_ADDRESS = "0x1AF1C89DCF2fC4aDcC4Ba174289aa6E6cd1710cD";
// Network Configuration - Paseo Asset Hub
const NETWORK_CONFIG = {
    chainId: "0x190F1B46", // Correct Hex for 420420422
    chainName: "Paseo Asset Hub",
    rpcUrls: ["https://testnet-passet-hub-eth-rpc.polkadot.io"],
    nativeCurrency: {
        name: "PAS",
        symbol: "PAS",
        decimals: 18
    },
    blockExplorerUrls: ["https://blockscout-passet-hub.parity-testnet.parity.io"]
};

// ABI - Application Binary Interface
const CONTRACT_ABI = [
    // ERC20 Standard Functions
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",

    // Ownable
    "function owner() view returns (address)",

    // Reward Categories
    "function rewardAmounts(string) view returns (uint256)",
    "function getRewardAmount(string category) view returns (uint256)",
    "function setRewardCategory(string category, uint256 amount)",

    // Teacher Functions
    "function submitAchievement(string achievementType, string description, string proofLink)",
    "function redeemTokens(uint256 amount, string benefit)",
    "function getTeacherSubmissions(address teacher) view returns (uint256[])",
    "function getAchievementHistory(address teacher) view returns (string[])",
    "function getTotalRewards(address teacher) view returns (uint256)",

    // Admin Functions
    "function issueReward(address teacher, string achievementType)",
    "function issueCustomReward(address teacher, uint256 amount, string description)",
    "function approveSubmission(uint256 submissionId)",
    "function rejectSubmission(uint256 submissionId, string reason)",
    "function revokeReward(uint256 submissionId, string reason)",
    "function revokeCustomAmount(address teacher, uint256 amount, string reason)",

    // View Functions
    "function submissionCounter() view returns (uint256)",
    "function getPendingSubmissions() view returns (uint256[])",
    "function getPendingCount() view returns (uint256)",
    "function getSubmission(uint256 submissionId) view returns (tuple(uint256 id, address teacher, string achievementType, string description, string proofLink, uint256 submittedAt, uint8 status, string rejectionReason, uint256 reviewedAt))",
    "function getAllPendingSubmissions() view returns (tuple(uint256 id, address teacher, string achievementType, string description, string proofLink, uint256 submittedAt, uint8 status, string rejectionReason, uint256 reviewedAt)[])",

    // Events
    "event AchievementSubmitted(uint256 indexed submissionId, address indexed teacher, string achievementType, string proofLink, uint256 timestamp)",
    "event SubmissionApproved(uint256 indexed submissionId, address indexed teacher, uint256 rewardAmount, uint256 timestamp)",
    "event SubmissionRejected(uint256 indexed submissionId, address indexed teacher, string reason, uint256 timestamp)",
    "event RewardIssued(address indexed teacher, uint256 amount, string achievementType, uint256 timestamp)",
    "event TokensBurned(address indexed user, uint256 amount, string reason)",
    "event RewardRevoked(uint256 indexed submissionId, address indexed teacher, uint256 amount, string reason, uint256 timestamp)"
];

// ===== GLOBAL VARIABLES =====
let provider;
let signer;
let contract;
let userAddress;
let isOwner = false;
let rawProvider;

// ===== DOM ELEMENTS =====
const connectWalletBtn = document.getElementById('connectWallet');
const walletInfo = document.getElementById('walletInfo');
const walletAddressSpan = document.getElementById('walletAddress');
const walletBalanceSpan = document.getElementById('walletBalance');
const roleIndicator = document.getElementById('roleIndicator');
const userRoleSpan = document.getElementById('userRole');
const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// ===== INITIALIZATION =====
// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initForms();
    initRefreshButtons();

    // Check if wallet was previously connected
    // Priority: Check Talisman first, then standard Ethereum
    const targetProvider = window.talismanEth || window.ethereum;
    
    if (targetProvider && targetProvider.selectedAddress) {
        connectWallet();
    }
});

// ===== TAB NAVIGATION =====
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            const targetSection = document.getElementById(targetTab);

            // Check if trying to access admin-only section without being owner
            if (targetSection.dataset.adminOnly === 'true' && !isOwner) {
                showToast('Access denied. Admin only.', 'error');
                return;
            }

            // Update active states
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            targetSection.classList.add('active');
        });
    });
}

// ===== WALLET CONNECTION =====
connectWalletBtn.addEventListener('click', connectWallet);
 async function connectWallet() {
    // 1. Detect Provider: Check for Talisman specifically, then fallback to generic Ethereum (MetaMask/others)
    let rawProvider;
    if (window.talismanEth) {
        rawProvider = window.talismanEth;
    } else if (window.ethereum) {
        rawProvider = window.ethereum;
    } else {
        showToast('Please install Talisman or MetaMask to use this dApp', 'error');
        return;
    }

    try {
        showLoading();

        // 2. Request account access using the detected provider
        await rawProvider.request({
            method: 'eth_requestAccounts'
        });

        // 3. Check Network and Switch if necessary
        const chainId = await rawProvider.request({ method: 'eth_chainId' });
        
        if (chainId.toLowerCase() !== NETWORK_CONFIG.chainId.toLowerCase()) {
            try {
                await rawProvider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: NETWORK_CONFIG.chainId }],
                });
            } catch (switchError) {
                // This error code indicates that the chain has not been added to the wallet
                if (switchError.code === 4902) {
                    try {
                        await rawProvider.request({
                            method: 'wallet_addEthereumChain',
                            params: [NETWORK_CONFIG],
                        });
                    } catch (addError) {
                        throw new Error('Failed to add network to wallet');
                    }
                } else {
                    throw switchError;
                }
            }
        }

        // 4. Setup ethers provider using the RAW provider we detected
        provider = new ethers.providers.Web3Provider(rawProvider, "any");
        
        // Wait for the network to be ready
        await provider.ready;
        
        // Get signer without specifying account index (let ethers handle it)
        signer = provider.getSigner();
        userAddress = await signer.getAddress();

        // Create contract instance
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        // Check if user is owner
        const ownerAddress = await contract.owner();
        isOwner = userAddress.toLowerCase() === ownerAddress.toLowerCase();

        // Update UI
        await updateWalletUI();

        // 5. Setup event listeners on the CORRECT provider
        // Remove old listeners to prevent stacking
        rawProvider.removeAllListeners('accountsChanged');
        rawProvider.removeAllListeners('chainChanged');

        rawProvider.on('accountsChanged', handleAccountChange);
        rawProvider.on('chainChanged', () => window.location.reload());

        showToast('Wallet connected successfully!', 'success');

        // Load initial data
        await loadAllData();

    } catch (error) {
        console.error('Connection error:', error);
        showToast('Failed to connect: ' + (error.reason || error.message), 'error');
    } finally {
        hideLoading();
    }
}


async function handleAccountChange(accounts) {
    if (accounts.length === 0) {
        // Disconnected
        userAddress = null;
        isOwner = false;
        walletInfo.classList.add('hidden');
        roleIndicator.classList.add('hidden');
        connectWalletBtn.classList.remove('hidden');

        // Hide admin panel and reset to teacher tab
        document.getElementById('adminTab').classList.add('hidden');
        document.getElementById('admin').classList.add('hidden');

        // Switch to teacher tab
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('[data-tab="teacher"]').classList.add('active');
        document.getElementById('teacher').classList.add('active');
    } else {
        signer = provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        const ownerAddress = await contract.owner();
        isOwner = userAddress.toLowerCase() === ownerAddress.toLowerCase();

        await updateWalletUI();
        await loadAllData();
    }
}

async function updateWalletUI() {
    // Update wallet info display
    connectWalletBtn.classList.add('hidden');
    walletInfo.classList.remove('hidden');

    // Shorten address for display
    const shortAddress = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    walletAddressSpan.textContent = shortAddress;

    // Get balance
    const balance = await contract.balanceOf(userAddress);
    const formattedBalance = ethers.utils.formatEther(balance);
    walletBalanceSpan.textContent = `${parseFloat(formattedBalance).toFixed(2)} EDU`;

    // Update role indicator
    roleIndicator.classList.remove('hidden');
    if (isOwner) {
        userRoleSpan.textContent = 'Admin (Owner)';
        userRoleSpan.className = 'owner';
    } else {
        userRoleSpan.textContent = 'Teacher';
        userRoleSpan.className = 'teacher';
    }

    // Update UI based on role (Admin vs Teacher)
    updateRoleBasedUI();
}

// ===== ROLE-BASED UI =====
function updateRoleBasedUI() {
    const adminTab = document.getElementById('adminTab');
    const adminSection = document.getElementById('admin');

    if (isOwner) {
        // Show Admin Panel tab and section for owner
        adminTab.classList.remove('hidden');
        adminSection.classList.remove('hidden');
    } else {
        // Hide Admin Panel for regular teachers
        adminTab.classList.add('hidden');
        adminSection.classList.add('hidden');

        // If currently on admin tab, switch to teacher tab
        if (adminSection.classList.contains('active')) {
            adminSection.classList.remove('active');
            document.getElementById('teacher').classList.add('active');
            document.querySelector('[data-tab="teacher"]').classList.add('active');
            adminTab.classList.remove('active');
        }
    }
}

// ===== FORM HANDLERS =====
function initForms() {
    // Submit Achievement Form
    document.getElementById('submitAchievementForm').addEventListener('submit', handleSubmitAchievement);

    // Redeem Tokens Form
    document.getElementById('redeemForm').addEventListener('submit', handleRedeemTokens);

    // Direct Reward Form (Admin)
    document.getElementById('directRewardForm').addEventListener('submit', handleDirectReward);

    // Custom Reward Form (Admin)
    document.getElementById('customRewardForm').addEventListener('submit', handleCustomReward);

    // Category Form (Admin)
    document.getElementById('categoryForm').addEventListener('submit', handleAddCategory);

    // Revoke Forms (Admin)
    document.getElementById('revokeBySubmissionForm').addEventListener('submit', handleRevokeBySubmission);
    document.getElementById('revokeCustomForm').addEventListener('submit', handleRevokeCustomAmount);
}

async function handleSubmitAchievement(e) {
    e.preventDefault();

    if (!contract) {
        showToast('Please connect your wallet first', 'error');
        return;
    }

    const achievementType = document.getElementById('achievementType').value;
    const description = document.getElementById('description').value;
    const proofLink = document.getElementById('proofLink').value;

    try {
        showLoading();

        const tx = await contract.submitAchievement(achievementType, description, proofLink);
        await tx.wait();

        showToast('Achievement submitted successfully!', 'success');

        // Reset form
        e.target.reset();

        // Refresh submissions
        await loadMySubmissions();

    } catch (error) {
        console.error('Submit error:', error);
        showToast('Failed to submit: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

async function handleRedeemTokens(e) {
    e.preventDefault();

    if (!contract) {
        showToast('Please connect your wallet first', 'error');
        return;
    }

    const amount = document.getElementById('redeemAmount').value;
    const benefit = document.getElementById('benefit').value;

    try {
        showLoading();

        const amountWei = ethers.utils.parseEther(amount);
        const tx = await contract.redeemTokens(amountWei, benefit);
        await tx.wait();

        showToast('Tokens redeemed successfully!', 'success');

        // Reset form and update balance
        e.target.reset();
        await updateWalletUI();

    } catch (error) {
        console.error('Redeem error:', error);
        showToast('Failed to redeem: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

async function handleDirectReward(e) {
    e.preventDefault();

    if (!contract || !isOwner) {
        showToast('Only admin can issue rewards', 'error');
        return;
    }

    const teacherAddress = document.getElementById('teacherAddress').value;
    const achievementType = document.getElementById('directAchievementType').value;

    try {
        showLoading();

        const tx = await contract.issueReward(teacherAddress, achievementType);
        await tx.wait();

        showToast('Reward issued successfully!', 'success');
        e.target.reset();

    } catch (error) {
        console.error('Issue reward error:', error);
        showToast('Failed to issue reward: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

async function handleCustomReward(e) {
    e.preventDefault();

    if (!contract || !isOwner) {
        showToast('Only admin can issue rewards', 'error');
        return;
    }

    const teacherAddress = document.getElementById('customTeacherAddress').value;
    const amount = document.getElementById('customAmount').value;
    const description = document.getElementById('customDescription').value;

    try {
        showLoading();

        const amountWei = ethers.utils.parseEther(amount);
        const tx = await contract.issueCustomReward(teacherAddress, amountWei, description);
        await tx.wait();

        showToast('Custom reward issued successfully!', 'success');
        e.target.reset();

    } catch (error) {
        console.error('Custom reward error:', error);
        showToast('Failed to issue custom reward: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

async function handleAddCategory(e) {
    e.preventDefault();

    if (!contract || !isOwner) {
        showToast('Only admin can manage categories', 'error');
        return;
    }

    const categoryName = document.getElementById('categoryName').value;
    const categoryAmount = document.getElementById('categoryAmount').value;

    try {
        showLoading();

        const amountWei = ethers.utils.parseEther(categoryAmount);
        const tx = await contract.setRewardCategory(categoryName, amountWei);
        await tx.wait();

        showToast('Category added/updated successfully!', 'success');
        e.target.reset();

    } catch (error) {
        console.error('Category error:', error);
        showToast('Failed to add category: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

// ===== REFRESH BUTTONS =====
function initRefreshButtons() {
    document.getElementById('refreshMySubmissions').addEventListener('click', loadMySubmissions);
    document.getElementById('refreshPending').addEventListener('click', loadPendingSubmissions);
    document.getElementById('refreshHistory').addEventListener('click', loadHistory);
}

// ===== DATA LOADING =====
async function loadAllData() {
    await Promise.all([
        loadMySubmissions(),
        loadPendingSubmissions(),
        loadHistory()
    ]);
}

async function loadMySubmissions() {
    if (!contract || !userAddress) return;

    const container = document.getElementById('mySubmissionsList');

    try {
        const submissionIds = await contract.getTeacherSubmissions(userAddress);

        if (submissionIds.length === 0) {
            container.innerHTML = '<p class="empty-state">No submissions yet</p>';
            return;
        }

        let html = '';

        for (const id of submissionIds) {
            const submission = await contract.getSubmission(id);
            html += createSubmissionCard(submission, false);
        }

        container.innerHTML = html;

    } catch (error) {
        console.error('Load submissions error:', error);
        container.innerHTML = '<p class="empty-state">Error loading submissions</p>';
    }
}

async function loadPendingSubmissions() {
    if (!contract) return;

    const container = document.getElementById('pendingSubmissionsList');
    const countSpan = document.getElementById('pendingNumber');

    try {
        const pendingCount = await contract.getPendingCount();
        countSpan.textContent = pendingCount.toString();

        if (pendingCount.toNumber() === 0) {
            container.innerHTML = '<p class="empty-state">No pending submissions</p>';
            return;
        }

        const pendingSubmissions = await contract.getAllPendingSubmissions();

        let html = '';
        for (const submission of pendingSubmissions) {
            html += createSubmissionCard(submission, isOwner);
        }

        container.innerHTML = html;

        // Add event listeners for approve/reject buttons
        if (isOwner) {
            container.querySelectorAll('.approve-btn').forEach(btn => {
                btn.addEventListener('click', () => approveSubmission(btn.dataset.id));
            });

            container.querySelectorAll('.reject-btn').forEach(btn => {
                btn.addEventListener('click', () => showRejectInput(btn.dataset.id));
            });
        }

    } catch (error) {
        console.error('Load pending error:', error);
        container.innerHTML = '<p class="empty-state">Error loading pending submissions</p>';
    }
}

async function loadHistory() {
    if (!contract || !userAddress) return;

    const container = document.getElementById('achievementHistoryList');
    const totalRewardsSpan = document.getElementById('totalRewards');
    const currentBalanceSpan = document.getElementById('currentBalance');

    try {
        // Get total rewards
        const totalRewards = await contract.getTotalRewards(userAddress);
        totalRewardsSpan.textContent = `${ethers.utils.formatEther(totalRewards)} EDU`;

        // Get current balance
        const balance = await contract.balanceOf(userAddress);
        currentBalanceSpan.textContent = `${ethers.utils.formatEther(balance)} EDU`;

        // Get achievement history
        const history = await contract.getAchievementHistory(userAddress);

        if (history.length === 0) {
            container.innerHTML = '<p class="empty-state">No achievements yet</p>';
            return;
        }

        let html = '';
        for (const achievement of history) {
            const rewardAmount = await contract.getRewardAmount(achievement);
            const formattedReward = ethers.utils.formatEther(rewardAmount);

            html += `
                <div class="history-item">
                    <span class="achievement-name">${achievement}</span>
                    <span class="achievement-reward">+${formattedReward} EDU</span>
                </div>
            `;
        }

        container.innerHTML = html;

    } catch (error) {
        console.error('Load history error:', error);
        container.innerHTML = '<p class="empty-state">Error loading history</p>';
    }
}

// ===== SUBMISSION ACTIONS =====
async function approveSubmission(submissionId) {
    if (!contract || !isOwner) {
        showToast('Only admin can approve submissions', 'error');
        return;
    }

    try {
        showLoading();

        const tx = await contract.approveSubmission(submissionId);
        await tx.wait();

        showToast('Submission approved! Reward sent to teacher.', 'success');

        await loadPendingSubmissions();

    } catch (error) {
        console.error('Approve error:', error);
        showToast('Failed to approve: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

function showRejectInput(submissionId) {
    const card = document.querySelector(`[data-submission-id="${submissionId}"]`);
    const actionsDiv = card.querySelector('.submission-actions');

    // Check if input already exists
    if (card.querySelector('.rejection-input')) return;

    const inputDiv = document.createElement('div');
    inputDiv.className = 'rejection-input';
    inputDiv.innerHTML = `
        <input type="text" placeholder="Enter rejection reason..." id="rejectReason-${submissionId}">
        <button class="btn btn-danger btn-sm" onclick="confirmReject(${submissionId})">Confirm Reject</button>
        <button class="btn btn-secondary btn-sm" onclick="cancelReject(${submissionId})">Cancel</button>
    `;

    actionsDiv.after(inputDiv);
}

window.confirmReject = async function(submissionId) {
    const reason = document.getElementById(`rejectReason-${submissionId}`).value;

    if (!reason.trim()) {
        showToast('Please enter a rejection reason', 'error');
        return;
    }

    try {
        showLoading();

        const tx = await contract.rejectSubmission(submissionId, reason);
        await tx.wait();

        showToast('Submission rejected.', 'success');

        await loadPendingSubmissions();

    } catch (error) {
        console.error('Reject error:', error);
        showToast('Failed to reject: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
};

window.cancelReject = function(submissionId) {
    const card = document.querySelector(`[data-submission-id="${submissionId}"]`);
    const inputDiv = card.querySelector('.rejection-input');
    if (inputDiv) inputDiv.remove();
};

// ===== REVOKE HANDLERS =====
async function handleRevokeBySubmission(e) {
    e.preventDefault();

    if (!contract || !isOwner) {
        showToast('Only admin can revoke rewards', 'error');
        return;
    }

    const submissionId = document.getElementById('revokeSubmissionId').value;
    const reason = document.getElementById('revokeReason').value;

    try {
        showLoading();

        const tx = await contract.revokeReward(submissionId, reason);
        await tx.wait();

        showToast('Reward revoked successfully!', 'success');
        e.target.reset();

        // Refresh data
        await loadAllData();

    } catch (error) {
        console.error('Revoke error:', error);
        showToast('Failed to revoke: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

async function handleRevokeCustomAmount(e) {
    e.preventDefault();

    if (!contract || !isOwner) {
        showToast('Only admin can revoke rewards', 'error');
        return;
    }

    const teacherAddress = document.getElementById('revokeTeacherAddress').value;
    const amount = document.getElementById('revokeCustomAmount').value;
    const reason = document.getElementById('revokeCustomReason').value;

    try {
        showLoading();

        const amountWei = ethers.utils.parseEther(amount);
        const tx = await contract.revokeCustomAmount(teacherAddress, amountWei, reason);
        await tx.wait();

        showToast('Custom amount revoked successfully!', 'success');
        e.target.reset();

    } catch (error) {
        console.error('Revoke custom error:', error);
        showToast('Failed to revoke: ' + getErrorMessage(error), 'error');
    } finally {
        hideLoading();
    }
}

// ===== HELPER FUNCTIONS =====
function createSubmissionCard(submission, showActions) {
    const statusLabels = ['Pending', 'Approved', 'Rejected', 'Revoked'];
    const statusClasses = ['status-pending', 'status-approved', 'status-rejected', 'status-revoked'];

    const status = submission.status;
    const submittedDate = new Date(submission.submittedAt.toNumber() * 1000).toLocaleString();
    const reviewedDate = submission.reviewedAt.toNumber() > 0
        ? new Date(submission.reviewedAt.toNumber() * 1000).toLocaleString()
        : '-';

    const shortAddress = `${submission.teacher.slice(0, 6)}...${submission.teacher.slice(-4)}`;

    let actionsHtml = '';
    if (showActions && status === 0) { // Only show actions for pending
        actionsHtml = `
            <div class="submission-actions">
                <button class="btn btn-success btn-sm approve-btn" data-id="${submission.id}">Approve</button>
                <button class="btn btn-danger btn-sm reject-btn" data-id="${submission.id}">Reject</button>
            </div>
        `;
    }

    let rejectionHtml = '';
    if ((status === 2 || status === 3) && submission.rejectionReason) {
        const label = status === 3 ? 'Revocation Reason' : 'Rejection Reason';
        rejectionHtml = `<p><strong>${label}:</strong> ${submission.rejectionReason}</p>`;
    }

    return `
        <div class="submission-card" data-submission-id="${submission.id}">
            <div class="submission-header">
                <div>
                    <div class="submission-title">${submission.achievementType}</div>
                    <div class="submission-id">ID: #${submission.id}</div>
                </div>
                <span class="submission-status ${statusClasses[status]}">${statusLabels[status]}</span>
            </div>
            <div class="submission-details">
                <p><strong>Teacher:</strong> ${shortAddress}</p>
                <p><strong>Description:</strong> ${submission.description}</p>
                <p><strong>Proof:</strong> <a href="${submission.proofLink}" target="_blank">View Document</a></p>
                <p><strong>Submitted:</strong> ${submittedDate}</p>
                <p><strong>Reviewed:</strong> ${reviewedDate}</p>
                ${rejectionHtml}
            </div>
            ${actionsHtml}
        </div>
    `;
}

function getErrorMessage(error) {
    if (error.reason) return error.reason;
    if (error.message) {
        // Extract revert reason if present
        const match = error.message.match(/reason="([^"]+)"/);
        if (match) return match[1];
        return error.message;
    }
    return 'Unknown error';
}

function showLoading() {
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'info') {
    toast.className = `toast ${type}`;
    toastMessage.textContent = message;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}
