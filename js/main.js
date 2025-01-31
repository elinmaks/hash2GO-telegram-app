import { MiningSystem } from './miningSystem.js';
import { VisualizationManager } from './visualization.js';

let tg = window.Telegram.WebApp;
let miningSystem;
let visualization;
let updateTimer;
let lastSection = 'mining';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Telegram WebApp
  tg.ready();
  tg.expand();

  // Set theme based on Telegram theme
  document.documentElement.className = tg.colorScheme;
  
  try {
    // Initialize systems with proper error handling
    miningSystem = new MiningSystem();
    visualization = new VisualizationManager();
    
    // Get user data with safety checks
    const user = tg?.initDataUnsafe?.user;
    if (user) {
      const cores = navigator.hardwareConcurrency || 4;
      const statusElement = document.querySelector('.mining-status');
      if (statusElement) {
        statusElement.textContent = `Detected ${cores} CPU cores`;
      }
      
      miningSystem.setUser({
        telegramId: user.id,
        username: user.username || `User_${user.id.toString().substring(0,6)}`,
        firstName: user.first_name,
        lastName: user.last_name
      });
    }

    await initializeApp();
    setupEventListeners();
    setupScrollHandler();
    startPeriodicUpdates();
    
  } catch (error) {
    console.error('Initialization error:', error);
    const statusElement = document.querySelector('.mining-status');
    if (statusElement) {
      statusElement.textContent = `Error initializing: ${error.message}`;
    }
  }
  
  // Close app when back button is pressed
  if (tg.BackButton) {
    tg.BackButton.onClick(() => tg.close());
  }
});

async function initializeApp() {
  await miningSystem.db.connect();
  updateDisplay();
}

function setupEventListeners() {
  const miningButton = document.getElementById('startMining');
  if (miningButton) {
    miningButton.addEventListener('click', toggleMining);
  }

  // Add mission click handler
  const missionButton = document.getElementById('confirmActivityBtn');
  if (missionButton) {
    missionButton.addEventListener('click', handleMissionConfirm);
  }

  // Navigation
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      lastSection = item.dataset.section;
      showSection(item.dataset.section);
    });
  });

  // Add upgrade button handler
  const upgradeButton = document.getElementById('purchaseUpgrade');
  if (upgradeButton) {
    upgradeButton.addEventListener('click', handleUpgradePurchase);
  }

  // Block click handlers
  const blocksContainer = document.querySelector('.blocks-container');
  if (blocksContainer) {
    blocksContainer.addEventListener('click', (e) => {
      const blockItem = e.target.closest('.blockchain-item');
      if (blockItem) {
        showBlockDetails(blockItem.dataset.blockNumber);
      }
    });
  }

  // Modal close button
  const modalClose = document.querySelector('.modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', () => {
      const modal = document.querySelector('.modal-overlay');
      if (modal) {
        modal.classList.remove('active');
      }
    });
  }

  window.addEventListener('validHash', (e) => {
    visualization.showValidHash(e.detail);
    updateDisplay();
  });

  window.addEventListener('rejectedHash', (e) => {
    updateMiningStatus(`Rejected hash: ${e.detail.hash} (${e.detail.reason})`);
  });

  window.addEventListener('energyDepleted', () => {
    updateMiningStatus('Mining stopped - Energy depleted');
    const button = document.getElementById('startMining');
    if (button) {
      button.textContent = 'Start Mining';
      button.classList.remove('stopping');
    }
  });

  window.addEventListener('difficultyChange', (e) => {
    const { oldDifficulty, newDifficulty, reason } = e.detail;
    updateMiningStatus(`Difficulty adjusted: ${oldDifficulty.toFixed(2)} → ${newDifficulty.toFixed(2)} (${reason})`);
  });

  // Add Telegram theme change handler
  tg.onEvent('themeChanged', () => {
    document.documentElement.className = tg.colorScheme;
  });
  
  // Update MainButton state based on mining status
  miningSystem.on('miningStateChanged', (isMining) => {
    if (isMining) {
      tg.MainButton.setText('Stop Mining');
      tg.MainButton.show();
    } else {
      tg.MainButton.setText('Start Mining');
      tg.MainButton.show();
    }
  });
}

function setupScrollHandler() {
  window.addEventListener('scroll', () => {
    const balanceHeader = document.querySelector('.blockchain-history.balance-blocks');
    const miningStats = document.querySelector('.mining-stats');
    const scrollThreshold = window.innerHeight * 0.1; // 10% of viewport height
    
    // Only apply scroll-based compact mode in mining section
    const activeMiningSection = document.querySelector('.nav-item.active').dataset.section === 'mining';
    
    if (balanceHeader && activeMiningSection) {
      if (window.scrollY > scrollThreshold) {
        balanceHeader.classList.add('compact');
      } else {
        balanceHeader.classList.remove('compact');
      }
    }

    if (miningStats && activeMiningSection) {
      if (window.scrollY > scrollThreshold * 2) {
        miningStats.classList.add('compact');
      } else {
        miningStats.classList.remove('compact');
      }
    }
  });
}

function toggleMining() {
  const button = document.getElementById('startMining');
  if (!button || !miningSystem) return;

  if (miningSystem.isMining) {
    button.textContent = 'Start Mining';
    button.classList.remove('stopping');
    miningSystem.stopMining();
    updateMiningStatus('Mining stopped - Progress saved');
  } else {
    if (miningSystem.startMining()) {
      button.textContent = 'Stop Mining';
      button.classList.add('stopping');
      updateMiningStatus('Mining started');
    } else {
      updateMiningStatus('Cannot start mining - Check energy level');
    }
  }
}

function startPeriodicUpdates() {
  if (updateTimer) return;
  
  // Update display every second for smooth UI
  updateTimer = setInterval(() => {
    updateDisplay();
  }, 1000);
  
  // Adjust difficulty every 30 seconds
  setInterval(() => {
    miningSystem.adjustDifficulty();
  }, 30000);
}

function updateDisplay() {
  try {
    if (!miningSystem) return;
    updateMiningStats();
    updateBalanceDisplay();
    updateBlockHistory();
    updateEnergyDisplay();
    updateTopMinersStats();
    updateWalletStats();
    updateBlockchainStats();
    updateUpgradeStats();
  } catch (error) {
    console.error('Error updating display:', error);
  }
}

function updateMiningStats() {
  const stats = miningSystem?.getPoolStats() || {
    poolHashRate: 0,
    personalValidHashes: 0,
    totalPoolValidHashes: 0,
    requiredHashes: 1000,
    difficulty: 3.00,
    activeMiners: 0,
    currentBlockNumber: 1
  };
  
  const elements = {
    hashRate: document.getElementById('hashRate'),
    validHashElement: document.getElementById('validHashes'),
    networkProgressElement: document.getElementById('networkProgress'),
    difficultyElement: document.getElementById('currentDifficulty'),
    activeMinersElement: document.getElementById('activeMiners'),
    blockNumberElement: document.getElementById('currentBlock')
  };

  if (elements.hashRate) {
    elements.hashRate.textContent = formatHashRate(stats.poolHashRate);
  }
  
  if (elements.validHashElement) {
    elements.validHashElement.textContent = stats.personalValidHashes;
  }

  if (elements.networkProgressElement) {
    elements.networkProgressElement.textContent = `${stats.totalPoolValidHashes}/${stats.requiredHashes}`;
  }
  
  if (elements.difficultyElement) {
    elements.difficultyElement.textContent = stats.difficulty.toFixed(2);
  }
  
  if (elements.activeMinersElement) {
    elements.activeMinersElement.textContent = stats.activeMiners;
  }
  
  if (elements.blockNumberElement) {
    elements.blockNumberElement.textContent = stats.currentBlockNumber;
  }
}

function updateBalanceDisplay() {
  const stats = miningSystem?.getBalanceStats() || {
    currentBalance: 0,
    totalMined: 0,
    lastReward: 0
  };
  
  const elements = {
    currentBalanceElements: document.querySelectorAll('#currentBalance'),
    totalMinedElement: document.getElementById('totalMined'),
    lastRewardElement: document.getElementById('lastReward')
  };

  elements.currentBalanceElements?.forEach(element => {
    if (element) {
      element.textContent = stats.currentBalance.toFixed(2);
    }
  });

  if (elements.totalMinedElement) {
    elements.totalMinedElement.textContent = stats.totalMined.toFixed(2);
  }
  
  if (elements.lastRewardElement) {
    elements.lastRewardElement.textContent = stats.lastReward.toFixed(2);
  }
}

function updateBlockHistory() {
  const blockHistory = miningSystem.getBlockHistory();
  const miningContainer = document.querySelector('.blockchain-history:not(.balance-blocks) .blocks-container');
  const chainContainer = document.querySelector('.blockchain-section .blocks-container');
  
  if (miningContainer) {
    // Clear existing blocks
    miningContainer.innerHTML = '';
    // Add last 10 blocks for mining section
    blockHistory.slice(-10).reverse().forEach(block => {
      const blockElement = createBlockElement(block, false);
      miningContainer.appendChild(blockElement);
    });
  }

  if (chainContainer) {
    // Clear existing blocks
    chainContainer.innerHTML = '';
    // Add last 100 blocks for blockchain section with extended info
    blockHistory.slice(-100).reverse().forEach(block => {
      const blockElement = createBlockElement(block, true);
      chainContainer.appendChild(blockElement);
    });
  }
}

function createBlockElement(block, extended = false) {
  const div = document.createElement('div');
  div.className = 'blockchain-item';
  div.dataset.blockNumber = block.number;

  const personalReward = block.minerRewards.find(r => r.name === 'You')?.reward || 0;
  
  if (extended) {
    div.innerHTML = `
      <div class="block-header">
        <span class="block-number">Block #${block.number}</span>
        <span class="block-winner">${block.winnerName}</span>
      </div>
      <div class="personal-reward ${personalReward > 0 ? 'positive' : ''}">
        Reward: ${personalReward.toFixed(2)} MNG
      </div>
      <div class="block-hash">
        ${block.hash.substring(0, 20)}...
      </div>
      <div class="block-details">
        <div>Difficulty: ${block.difficulty.toFixed(2)}</div>
        <div>Shares: ${block.validHashes}/1000</div>
      </div>
      <div class="block-stats">
        <div>Network: ${formatHashRate(block.totalHashes)}</div>
        <div>${new Date(block.time).toLocaleTimeString()}</div>
      </div>
    `;
  } else {
    div.innerHTML = `
      <div class="block-header">
        <span class="block-number">Block #${block.number}</span>
        <span class="block-winner">${block.winnerName}</span>
      </div>
      <div class="personal-reward ${personalReward > 0 ? 'positive' : ''}">
        Reward: ${personalReward.toFixed(2)} MNG
      </div>
      <div class="block-stats">
        <div>Network: ${formatHashRate(block.totalHashes)}</div>
        <div>Valid: ${block.validHashes} shares</div>
      </div>
    `;
  }

  return div;
}

function updateEnergyDisplay() {
  const energyStats = miningSystem.updateEnergy();
  const energyBar = document.querySelector('.energy-bar');
  const energyLevel = document.getElementById('energyLevel');
  const chargingStatus = document.querySelector('.charging-status');
  
  if (energyBar) {
    energyBar.style.width = `${energyStats.percentage}%`;
    
    // Update color based on energy level
    energyBar.classList.remove('warning', 'critical');
    if (energyStats.percentage <= 25) {
      energyBar.classList.add('critical');
    } else if (energyStats.percentage <= 50) {
      energyBar.classList.add('warning');
    }
  }

  if (energyLevel) {
    energyLevel.textContent = `${Math.floor(energyStats.current)} kW`;
  }

  if (chargingStatus) {
    chargingStatus.textContent = miningSystem.isCharging ? '(Charging)' : '';
  }
}

function showBlockDetails(blockNumber) {
  const block = miningSystem.getBlockHistory().find(b => b.number === parseInt(blockNumber));
  if (!block) return;

  const modal = document.querySelector('.modal-overlay');
  const content = modal.querySelector('.modal-content');

  content.innerHTML = `
    <div class="block-detail-section">
      <h4>Block Information</h4>
      <div class="block-detail-row">
        <span>Block Number:</span>
        <span>#${block.number}</span>
      </div>
      <div class="block-detail-row">
        <span>Winner:</span>
        <span>${block.winnerName}</span>
      </div>
      <div class="block-detail-row">
        <span>Block Time:</span>
        <span>${new Date(block.time).toLocaleString()}</span>
      </div>
      <div class="block-detail-row">
        <span>Creation Time:</span>
        <span>${miningSystem.getAverageBlockTime().toFixed(1)}s</span>
      </div>
      <div class="block-detail-row">
        <span>Total Reward:</span>
        <span>${block.reward.toFixed(2)} MNG</span>
      </div>
      <div class="block-detail-row">
        <span>Difficulty:</span>
        <span>${block.difficulty.toFixed(2)}</span>
      </div>
      <div class="block-detail-row">
        <span>Network Hash Rate:</span>
        <span>${formatHashRate(block.totalHashes)}</span>
      </div>
      <div class="block-detail-row">
        <span>Valid Hashes:</span>
        <span>${block.validHashes}/1000</span>
      </div>
    </div>

    <div class="block-detail-section">
      <h4>Block Hash</h4>
      <div class="block-hash">${block.hash}</div>
    </div>

    <div class="block-detail-section">
      <h4>Miners Distribution</h4>
      <div class="miners-distribution">
        ${block.minerRewards.map(miner => `
          <div class="miner-reward-row ${miner.name === 'You' ? 'personal' : ''}">
            <div class="miner-info">
              <span class="miner-name">${miner.name}</span>
              <span class="miner-shares">${miner.validHashes} valid hashes</span>
            </div>
            <span class="miner-reward">${miner.reward.toFixed(2)} MNG</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function updateMiningStatus(message) {
  const statusElement = document.querySelector('.mining-status');
  if (statusElement) {
    statusElement.innerHTML = ''; // Clear old content
    statusElement.textContent = message;
  }
}

function formatHashRate(hashes) {
  if (hashes >= 1e9) return `${(hashes / 1e9).toFixed(2)} GH/s`;
  if (hashes >= 1e6) return `${(hashes / 1e6).toFixed(2)} MH/s`;
  if (hashes >= 1e3) return `${(hashes / 1e3).toFixed(2)} KH/s`;
  return `${Math.floor(hashes)} H/s`;
}

function showSection(sectionName) {
  const sections = {
    terminal: document.querySelector('.terminal'),
    difficultyChart: document.querySelector('.difficulty-chart'),
    missionsSection: document.querySelector('.missions-section'),
    topMinersSection: document.querySelector('.top-miners-section'),
    upgradesSection: document.querySelector('.upgrades-section'),
    blockchainHistory: document.querySelector('.blockchain-history:not(.balance-blocks)'),
    walletSection: document.querySelector('.wallet-section'),
    blockchainSection: document.querySelector('.blockchain-section')
  };

  // Hide all sections first
  Object.values(sections).forEach(section => {
    if (section) {
      section.style.display = 'none';
    }
  });

  // Get balance and stats elements
  const balanceHeader = document.querySelector('.blockchain-history.balance-blocks');
  const miningStats = document.querySelector('.mining-stats');
  const energyContainer = document.querySelector('.energy-container');

  // Toggle compact mode based on section
  if (balanceHeader) {
    if (sectionName === 'mining') {
      balanceHeader.classList.remove('compact');
      balanceHeader.querySelector('.balance-section').classList.remove('mini');
    } else {
      balanceHeader.classList.add('compact');
      balanceHeader.querySelector('.balance-section').classList.add('mini');
    }
  }

  if (miningStats) {
    if (sectionName === 'mining') {
      miningStats.classList.remove('compact');
    } else {
      miningStats.classList.add('compact');
    }
  }

  if (energyContainer) {
    if (sectionName === 'mining') {
      energyContainer.classList.remove('compact');
    } else {
      energyContainer.classList.add('compact');
    }
  }

  // Show selected section and update its stats
  switch(sectionName) {
    case 'mining':
      if (sections.terminal) sections.terminal.style.display = 'block';
      if (sections.blockchainHistory) sections.blockchainHistory.style.display = 'block';
      updateMiningStats();
      break;
    case 'missions':
      if (sections.missionsSection) sections.missionsSection.style.display = 'block';
      updateMissionStatus();
      break;
    case 'miners':
      if (sections.topMinersSection) sections.topMinersSection.style.display = 'block';
      updateTopMinersStats();
      break;
    case 'blockchain':
      if (sections.blockchainSection) sections.blockchainSection.style.display = 'block';
      updateBlockchainStats();
      break;
    case 'wallet':
      if (sections.walletSection) sections.walletSection.style.display = 'block';
      updateWalletStats();
      break;
    case 'upgrades':
      if (sections.upgradesSection) sections.upgradesSection.style.display = 'block';
      updateUpgradeStats();
      break;
  }
  
  updateBalanceDisplay();
}

function handleMissionConfirm() {
  const button = document.getElementById('confirmActivityBtn');
  const timer = document.getElementById('missionTimer');
  
  if (!button || !timer) return;
  
  // Get last completion time from localStorage
  const lastCompletion = localStorage.getItem('lastMissionCompletion');
  const now = Date.now();
  
  if (!lastCompletion || (now - parseInt(lastCompletion)) >= 12 * 60 * 60 * 1000) {
    // Mission can be completed
    miningSystem.addEnergyBonus(50); // Add 50kW bonus
    localStorage.setItem('lastMissionCompletion', now.toString());
    button.disabled = true;
    button.classList.add('completed');
    button.textContent = 'Completed!';
    updateMissionStatus();
  }
}

function updateMissionStatus() {
  const button = document.getElementById('confirmActivityBtn');
  const timer = document.getElementById('missionTimer');
  
  if (!button || !timer) return;
  
  const lastCompletion = localStorage.getItem('lastMissionCompletion');
  const now = Date.now();
  
  if (!lastCompletion || (now - parseInt(lastCompletion)) >= 12 * 60 * 60 * 1000) {
    // Mission is available
    button.disabled = false;
    button.classList.remove('completed');
    button.textContent = 'Confirm Activity';
    timer.textContent = 'Available now';
  } else {
    // Mission is on cooldown
    button.disabled = true;
    button.classList.add('completed');
    button.textContent = 'Completed!';
    
    // Calculate remaining time
    const remainingTime = 12 * 60 * 60 * 1000 - (now - parseInt(lastCompletion));
    const hours = Math.floor(remainingTime / (60 * 60 * 1000));
    const minutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
    
    timer.textContent = `Next available in: ${hours}h ${minutes}m`;
  }
}

// Start periodic mission status updates
setInterval(updateMissionStatus, 60000); // Update every minute

function updateTopMinersStats() {
  const balanceStats = miningSystem?.getBalanceStats() || { currentBalance: 0 };
  const topMinersBalanceElement = document.getElementById('topMinersBalance');
  const topMinersContainer = document.getElementById('topMinersList');
  
  if (!topMinersContainer) return;
  
  if (topMinersBalanceElement) {
    topMinersBalanceElement.textContent = `${balanceStats.currentBalance.toFixed(2)} MNG`;
  }

  // Get and display actual top miners
  const topMiners = miningSystem.getTopMiners();
  topMinersContainer.innerHTML = '';

  // Find actual user position
  const userPosition = topMiners.findIndex(miner => miner.name === 'You') + 1;

  topMiners.forEach((miner, index) => {
    const minerElement = document.createElement('div');
    minerElement.className = 'top-miner-item';
    if (miner.name === 'You') minerElement.classList.add('personal');

    minerElement.innerHTML = `
      <div class="miner-rank">#${index + 1}</div>
      <div class="miner-info">
        <div class="miner-name">${miner.name}</div>
        <div class="miner-stats">
          <span class="miner-balance">${miner.balance.toFixed(2)} MNG</span>
        </div>
      </div>
    `;

    topMinersContainer.appendChild(minerElement);
  });

  // Add user position if not in top 100 and has balance
  if (!topMiners.find(m => m.name === 'You') && balanceStats.currentBalance > 0) {
    const userPositionElement = document.createElement('div');
    userPositionElement.className = 'user-position';
    userPositionElement.innerHTML = `
      <div class="position-divider"></div>
      <div class="top-miner-item personal">
        <div class="miner-rank">#${userPosition}</div>
        <div class="miner-info">
          <div class="miner-name">You</div>
          <div class="miner-stats">
            <span class="miner-balance">${balanceStats.currentBalance.toFixed(2)} MNG</span>
          </div>
        </div>
      </div>
    `;
    topMinersContainer.appendChild(userPositionElement);
  }
}

function updateWalletStats() {
  const stats = miningSystem.getBalanceStats();
  
  document.getElementById('walletBalance').textContent = `${stats.currentBalance.toFixed(2)} MNG`;
  document.getElementById('walletTotalMined').textContent = `${stats.totalMined.toFixed(2)} MNG`;
  document.getElementById('walletLastReward').textContent = `${stats.lastReward.toFixed(2)} MNG`;
}

function updateBlockchainStats() {
  const stats = miningSystem.getPoolStats();
  const blockHistory = miningSystem.getBlockHistory();
  const avgBlockTime = miningSystem.getAverageBlockTime();
  
  // Update stats
  document.getElementById('chainCurrentBlock').textContent = stats.currentBlockNumber;
  document.getElementById('chainDifficulty').textContent = stats.difficulty.toFixed(2);
  document.getElementById('chainHashRate').textContent = formatHashRate(stats.poolHashRate);
  
  // Format average block time
  const avgBlockTimeText = avgBlockTime > 0 
    ? `${avgBlockTime.toFixed(1)}s` 
    : 'Calculating...';
  document.getElementById('avgBlockTime').textContent = avgBlockTimeText;

  // Update blockchain visualization
  const container = document.querySelector('.blockchain-section .blocks-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Display last 100 blocks in reverse order
  blockHistory.slice(-100).reverse().forEach((block, index) => {
    const blockElement = document.createElement('div');
    blockElement.className = 'blockchain-item';
    if (index === 0) blockElement.classList.add('new-block');
    
    blockElement.dataset.blockNumber = block.number;
    
    blockElement.innerHTML = `
      <div class="block-header">
        <span class="block-number">Block #${block.number}</span>
        <span class="block-winner">${block.winnerName}</span>
      </div>
      <div class="block-hash">
        ${block.hash.substring(0, 20)}...
      </div>
      <div class="block-details">
        <div>Difficulty: ${block.difficulty.toFixed(2)}</div>
        <div>Valid hashes: ${block.validHashes}</div>
      </div>
      <div class="block-stats">
        <div>${formatHashRate(block.totalHashes)}</div>
        <div>${new Date(block.time).toLocaleTimeString()}</div>
      </div>
    `;
    
    blockElement.addEventListener('click', () => showBlockDetails(block.number));
    container.appendChild(blockElement);
  });
}

function handleUpgradePurchase() {
  const result = miningSystem.purchaseUpgrade();
  
  if (result.success) {
    updateUpgradeStats();
    updateBalanceDisplay();
    // Show success message
    const status = document.querySelector('.mining-status');
    if (status) {
      status.textContent = `Upgrade purchased! New speed bonus: +${result.speedBonus}%`;
    }
  } else {
    // Show error message
    const status = document.querySelector('.mining-status');
    if (status) {
      status.textContent = `Upgrade failed: ${result.reason}`;
    }
  }
}

function updateUpgradeStats() {
  const upgradeInfo = miningSystem.getUpgradeInfo();
  const stats = miningSystem.getPoolStats();
  const balance = miningSystem.getBalanceStats();

  // Update upgrade level
  const levelElement = document.getElementById('upgradeLevel');
  if (levelElement) {
    levelElement.textContent = upgradeInfo.currentLevel;
  }

  // Update speed bonus
  const bonusElement = document.getElementById('upgradeBonus');
  if (bonusElement) {
    bonusElement.textContent = `+${upgradeInfo.speedBonus}%`;
  }

  // Update cost
  const costElement = document.getElementById('upgradeCost');
  if (costElement) {
    costElement.textContent = `${upgradeInfo.cost.toFixed(2)} MNG`;
  }

  // Update balance
  const balanceElement = document.getElementById('upgradeBalance');
  if (balanceElement) {
    balanceElement.textContent = `${balance.currentBalance.toFixed(2)} MNG`;
  }

  // Update current hash rate
  const hashRateElement = document.getElementById('upgradeHashRate');
  if (hashRateElement) {
    hashRateElement.textContent = formatHashRate(stats.poolHashRate);
  }

  // Update button state
  const button = document.getElementById('purchaseUpgrade');
  if (button) {
    const canPurchase = balance.currentBalance >= upgradeInfo.cost && 
                       upgradeInfo.currentLevel < upgradeInfo.maxLevel;
    button.disabled = !canPurchase;
  }
}